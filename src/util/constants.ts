import type { TrailerKey, ArrayTrailerKey, EnumTrailerKey } from '../types/domain.js';

export const LORE_TRAILER_KEYS: readonly TrailerKey[] = [
  'Lore-id',
  'Constraint',
  'Rejected',
  'Confidence',
  'Scope-risk',
  'Reversibility',
  'Directive',
  'Tested',
  'Not-tested',
  'Supersedes',
  'Depends-on',
  'Related',
];

export const ARRAY_TRAILER_KEYS: readonly ArrayTrailerKey[] = [
  'Constraint',
  'Rejected',
  'Directive',
  'Tested',
  'Not-tested',
  'Supersedes',
  'Depends-on',
  'Related',
];

export const ENUM_TRAILER_KEYS: readonly EnumTrailerKey[] = [
  'Confidence',
  'Scope-risk',
  'Reversibility',
];

export const CONFIDENCE_VALUES = ['low', 'medium', 'high'] as const;
export const SCOPE_RISK_VALUES = ['narrow', 'moderate', 'wide'] as const;
export const REVERSIBILITY_VALUES = ['clean', 'migration-needed', 'irreversible'] as const;

export const LORE_ID_PATTERN = /^[0-9a-f]{8}$/;
export const LORE_ID_LENGTH = 8;

export const REFERENCE_TRAILER_KEYS = ['Supersedes', 'Depends-on', 'Related'] as const;

export const DEFAULT_QUERY_LIMIT = 100;
export const DEFAULT_STALE_OLDER_THAN = '6m';
export const DEFAULT_STALE_DRIFT_THRESHOLD = 20;
export const GIT_FILES_CHANGED_BATCH_SIZE = 20;

export const CONFIG_FILENAME = 'config.toml';
export const CONFIG_DIR = '.lore';

export const STALE_SIGNAL = {
  AGE: 'age',
  DRIFT: 'drift',
  LOW_CONFIDENCE: 'low-confidence',
  EXPIRED_HINT: 'expired-hint',
  ORPHANED_DEP: 'orphaned-dep',
} as const;

export type StaleSignal = typeof STALE_SIGNAL[keyof typeof STALE_SIGNAL];

export const EXIT_CODE_SUCCESS = 0;
export const EXIT_CODE_VALIDATION_ERROR = 1;
export const EXIT_CODE_GIT_ERROR = 2;
export const EXIT_CODE_NO_STAGED_CHANGES = 3;

export const PROMPT_STRINGS = {
  INTENT: 'Intent (why the change was made):',
  ADD_BODY: 'Add a body? (narrative context)',
  BODY_INPUT: 'Body (press Enter on empty line to finish):',
  ADD_CONSTRAINT: 'Add a Constraint?',
  CONSTRAINT_INPUT: 'Constraint:',
  ADD_REJECTED: 'Add a Rejected alternative?',
  REJECTED_INPUT: 'Rejected (format: alternative | reason):',
  SET_CONFIDENCE: 'Set Confidence?',
  CONFIDENCE_CHOICE: 'Confidence:',
  SET_SCOPE_RISK: 'Set Scope-risk?',
  SCOPE_RISK_CHOICE: 'Scope-risk:',
  SET_REVERSIBILITY: 'Set Reversibility?',
  REVERSIBILITY_CHOICE: 'Reversibility:',
  ADD_DIRECTIVE: 'Add a Directive?',
  DIRECTIVE_INPUT: 'Directive:',
  ADD_TESTED: 'Add a Tested entry?',
  TESTED_INPUT: 'Tested:',
  ADD_NOT_TESTED: 'Add a Not-tested entry?',
  NOT_TESTED_INPUT: 'Not-tested:',
  ADD_SUPERSEDES: 'Add a Supersedes reference?',
  SUPERSEDES_INPUT: 'Supersedes (8-char hex Lore-id):',
  ADD_DEPENDS_ON: 'Add a Depends-on reference?',
  DEPENDS_ON_INPUT: 'Depends-on (8-char hex Lore-id):',
  ADD_RELATED: 'Add a Related reference?',
  RELATED_INPUT: 'Related (8-char hex Lore-id):',
} as const;
