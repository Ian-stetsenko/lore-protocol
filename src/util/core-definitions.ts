import type { CustomTrailerDefinition, ValueDefinition, TrailerUiKind, TrailerUiColor } from '../types/config.js';

/**
 * Enum levels are ordered from LEAST to MOST significant.
 * This order is used by 'lore squash' to determine the "most conservative" value.
 */
const CONFIDENCE_VALUES_MAP: Record<string, ValueDefinition> = {
  low: { description: 'Hypothesis/first attempt; no verification.' },
  medium: { description: 'Locally verified or based on docs.' },
  high: { description: 'Thoroughly tested (CI/staging) or extensive domain knowledge.' }
};

const SCOPE_RISK_VALUES_MAP: Record<string, ValueDefinition> = {
  narrow: { description: 'Isolated to a single function/file; no external callers.' },
  moderate: { description: 'Affects a module; bounded/enumerable radius.' },
  wide: { description: 'Affects cross-cutting concerns, public APIs, or schemas.' }
};

const REVERSIBILITY_VALUES_MAP: Record<string, ValueDefinition> = {
  clean: { description: 'Revertible via git revert with no side effects.' },
  'migration-needed': { description: 'Requires data migration or infra updates.' },
  irreversible: { description: 'Cannot be fully undone (e.g., data deletion).' }
};

export const CONFIDENCE_VALUES = Object.keys(CONFIDENCE_VALUES_MAP);
export const SCOPE_RISK_VALUES = Object.keys(SCOPE_RISK_VALUES_MAP);
export const REVERSIBILITY_VALUES = Object.keys(REVERSIBILITY_VALUES_MAP);

/** The name of the protocol (e.g. Lore, Fred, etc.) */
export const PROTOCOL_NAME = 'Lore';

/** The unique trailer key used for Lore atom identity */
export const LORE_ID_KEY = `${PROTOCOL_NAME}-id`;

/** The structural JSON key for atom identity */
export const LORE_ID_JSON_KEY = LORE_ID_KEY.toLowerCase().replace(/-/g, '_');

/** The structural JSON key for protocol version */
export const LORE_VERSION_JSON_KEY = `${PROTOCOL_NAME.toLowerCase()}_version`;

/**
 * Formal definitions for the Core Lore Protocol trailers.
...
 * This is the CENTRAL SOURCE OF TRUTH for the Lore Protocol.
 * All validation, interactive prompts, and UI rendering are driven by these definitions.
 */
export const CORE_TRAILER_DEFINITIONS: Record<string, CustomTrailerDefinition> = {
  [LORE_ID_KEY]: {
    description: 'Stable atom identity.',
    multivalue: false,
    validation: 'pattern',
    pattern: '^[0-9a-f]{8}$',
    required: true,
    ui: { kind: 'identity' as TrailerUiKind, color: 'dim' as TrailerUiColor },
    directives: [
      '[on:amend] Preserve the existing ID to maintain graph integrity',
      '[on:commit] Handled by Lore CLI; MUST NOT manually generate IDs or use git hashes',
      '[on:commit] The CLI automatically assigns a random 8-character hex string'
    ]
  },
  'Constraint': {
    description: 'Rules that shaped this decision and may still be active.',
    multivalue: true,
    validation: 'none',
    ui: { kind: 'decision' as TrailerUiKind, color: 'cyan' as TrailerUiColor },
    cli: { flag: 'constraint' },
    prompt: {
      confirm: 'Add a Constraint?',
      input: 'Constraint:',
      order: 100,
    },
    directives: [
      '[on:commit] Obey all active constraints. Violations are bugs unless explicitly superseded.',
      '[on:squash] Carry forward only those that apply to the final state'
    ]
  },
  'Rejected': {
    description: 'Alternatives evaluated and dismissed.',
    multivalue: true,
    validation: 'pattern',
    pattern: '^.+ \\| .+$',
    ui: { kind: 'decision' as TrailerUiKind, color: 'magenta' as TrailerUiColor },
    cli: { flag: 'rejected' },
    prompt: {
      confirm: 'Add a Rejected alternative?',
      input: 'Rejected (format: alternative | reason):',
      order: 110,
    },
    directives: [
      '[on:squash] Record all failed starts or intermediate pivots here'
    ]
  },
  'Confidence': {
    description: "Author’s assessment of the decision's correctness.",
    multivalue: false,
    validation: 'values',
    values: CONFIDENCE_VALUES_MAP,
    ui: { kind: 'risk' as TrailerUiKind, color: 'cyan' as TrailerUiColor },
    cli: { flag: 'confidence' },
    prompt: {
      confirm: 'Set Confidence?',
      choice: 'Confidence:',
      order: 120,
    },
    squash: 'rank-min',
    directives: [
      '[on:squash] Take the most conservative value (e.g., low + high = low)'
    ]
  },
  'Scope-risk': {
    description: 'The "blast radius" of the change.',
    multivalue: false,
    validation: 'values',
    values: SCOPE_RISK_VALUES_MAP,
    ui: { kind: 'risk' as TrailerUiKind, color: 'cyan' as TrailerUiColor },
    cli: { flag: 'scope-risk' },
    prompt: {
      confirm: 'Set Scope-risk?',
      choice: 'Scope-risk:',
      order: 130,
    },
    squash: 'rank-max',
    directives: [
      '[on:squash] Take the most conservative value (e.g., narrow + wide = wide)'
    ]
  },
  'Reversibility': {
    description: 'Ease of undoing the change.',
    multivalue: false,
    validation: 'values',
    values: REVERSIBILITY_VALUES_MAP,
    ui: { kind: 'risk' as TrailerUiKind, color: 'cyan' as TrailerUiColor },
    cli: { flag: 'reversibility' },
    prompt: {
      confirm: 'Set Reversibility?',
      choice: 'Reversibility:',
      order: 140,
    },
    squash: 'rank-max',
    directives: [
      '[on:modify] If "irreversible", seek explicit approval before proceeding',
      '[on:squash] Take the most conservative value (e.g., clean + irreversible = irreversible)'
    ]
  },
  'Directive': {
    description: 'Forward-looking instructions for future modifiers.',
    multivalue: true,
    validation: 'none',
    ui: { kind: 'decision' as TrailerUiKind, color: 'yellow' as TrailerUiColor },
    cli: { flag: 'directive' },
    prompt: {
      confirm: 'Add a Directive?',
      input: 'Directive:',
      order: 150,
    },
    directives: [
      '[on:commit] Use [until:...] prefix for temporary rules that expire',
      '[on:squash] Carry forward until fulfilled, rejected, or condition met',
      '[on:stale][until:YYYY-MM-DD] Flag as stale if hint is expired'
    ]
  },
  'Tested': {
    description: 'What was verified and how.',
    multivalue: true,
    validation: 'none',
    ui: { kind: 'evidence' as TrailerUiKind, color: 'green' as TrailerUiColor },
    cli: { flag: 'tested' },
    prompt: {
      confirm: 'Add a Tested entry?',
      input: 'Tested:',
      order: 160,
    },
    directives: [
      '[on:squash] Consolidate evidence into 3-4 high-signal summary statements'
    ]
  },
  'Not-tested': {
    description: 'What was not verified and why.',
    multivalue: true,
    validation: 'none',
    ui: { kind: 'evidence' as TrailerUiKind, color: 'red' as TrailerUiColor },
    cli: { flag: 'not-tested' },
    prompt: {
      confirm: 'Add a Not-tested entry?',
      input: 'Not-tested:',
      order: 170,
    },
  },
  'Supersedes': {
    description: 'Lore-id of the atom this decision replaces.',
    multivalue: true,
    validation: 'pattern',
    pattern: '^[0-9a-f]{8}$',
    ui: { kind: 'reference' as TrailerUiKind, color: 'dim' as TrailerUiColor },
    cli: { flag: 'supersedes' },
    prompt: {
      confirm: 'Add a Supersedes reference?',
      input: 'Supersedes (8-char hex Lore-id):',
      order: 180,
    },
    directives: [
      '[on:commit] Only for replacements. Use "Related" or "Depends-on" for additive context.',
      '[on:squash] Remove IDs that only exist in local-only (squashed) commits'
    ]
  },
  'Depends-on': {
    description: 'Lore-id of the atom this decision requires.',
    multivalue: true,
    validation: 'pattern',
    pattern: '^[0-9a-f]{8}$',
    ui: { kind: 'reference' as TrailerUiKind, color: 'dim' as TrailerUiColor },
    cli: { flag: 'depends-on' },
    prompt: {
      confirm: 'Add a Depends-on reference?',
      input: 'Depends-on (8-char hex Lore-id):',
      order: 190,
    },
    directives: [
      '[on:commit] Run "lore trace <id>" to verify the target exists and is relevant'
    ]
  },
  'Related': {
    description: 'Lore-id of an atom with a general relationship.',
    multivalue: true,
    validation: 'pattern',
    pattern: '^[0-9a-f]{8}$',
    ui: { kind: 'reference' as TrailerUiKind, color: 'dim' as TrailerUiColor },
    cli: { flag: 'related' },
    prompt: {
      confirm: 'Add a Related reference?',
      input: 'Related (8-char hex Lore-id):',
      order: 200,
    },
  }
};

/** Derived list of all standard trailer keys */
export const LORE_TRAILER_KEYS = Object.keys(CORE_TRAILER_DEFINITIONS);

/** Derived list of trailer keys that contain arrays */
export const ARRAY_TRAILER_KEYS = Object.entries(CORE_TRAILER_DEFINITIONS)
  .filter(([_, def]) => def.multivalue)
  .map(([key]) => key);

/** Derived list of trailer keys that contain single enum values */
export const ENUM_TRAILER_KEYS = Object.entries(CORE_TRAILER_DEFINITIONS)
  .filter(([_, def]) => !def.multivalue && def.validation === 'values')
  .map(([key]) => key);

/** Derived list of trailer keys that reference other atoms */
export const REFERENCE_TRAILER_KEYS = Object.entries(CORE_TRAILER_DEFINITIONS)
  .filter(([_, def]) => def.ui?.kind === 'reference')
  .map(([key]) => key);

/** The set of signals that indicate an atom may be stale. */
const STALE_SIGNALS_MAP = {
  AGE: 'age',
  DRIFT: 'drift',
  LOW_CONFIDENCE: 'low-confidence',
  EXPIRED_HINT: 'expired-hint',
  ORPHANED_DEP: 'orphaned-dep',
} as const;

export const STALE_SIGNALS = Object.values(STALE_SIGNALS_MAP);
export const STALE_SIGNAL_METADATA = STALE_SIGNALS_MAP;
