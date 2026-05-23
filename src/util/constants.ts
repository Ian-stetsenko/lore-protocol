import type {
  TrailerKey,
  ArrayTrailerKey,
  EnumTrailerKey,
  ConfidenceLevel,
  ScopeRiskLevel,
  ReversibilityLevel,
  StaleSignal,
} from '../types/domain.js';
import type { LoreConfig } from '../types/config.js';

import {
  LORE_TRAILER_KEYS as CORE_LORE_TRAILER_KEYS,
  ARRAY_TRAILER_KEYS as CORE_ARRAY_TRAILER_KEYS,
  ENUM_TRAILER_KEYS as CORE_ENUM_TRAILER_KEYS,
  REFERENCE_TRAILER_KEYS as CORE_REFERENCE_TRAILER_KEYS,
  CONFIDENCE_VALUES as CORE_CONFIDENCE_VALUES,
  SCOPE_RISK_VALUES as CORE_SCOPE_RISK_VALUES,
  REVERSIBILITY_VALUES as CORE_REVERSIBILITY_VALUES,
  LORE_ID_KEY as CORE_LORE_ID_KEY,
  LORE_ID_JSON_KEY as CORE_LORE_ID_JSON_KEY,
  LORE_VERSION_JSON_KEY as CORE_LORE_VERSION_JSON_KEY,
  CORE_TRAILER_DEFINITIONS as MASTER_CORE_TRAILER_DEFINITIONS,
  STALE_SIGNAL_METADATA as CORE_STALE_SIGNAL_METADATA,
} from './core-definitions.js';

/** The unique trailer key used for Lore atom identity */
export const LORE_ID_KEY = CORE_LORE_ID_KEY;

/** The structural JSON key for atom identity */
export const LORE_ID_JSON_KEY = CORE_LORE_ID_JSON_KEY;

/** The structural JSON key for protocol version */
export const LORE_VERSION_JSON_KEY = CORE_LORE_VERSION_JSON_KEY;

/** The master specification for core protocol trailers */
export const CORE_TRAILER_DEFINITIONS = MASTER_CORE_TRAILER_DEFINITIONS;

/** Central source of truth for the Lore Protocol version */
export const LORE_PROTOCOL_VERSION = '1.0';

/** All standard Lore trailer keys */
export const LORE_TRAILER_KEYS: readonly TrailerKey[] = CORE_LORE_TRAILER_KEYS as TrailerKey[];

/** Trailer keys that contain arrays of values */
export const ARRAY_TRAILER_KEYS: readonly ArrayTrailerKey[] = CORE_ARRAY_TRAILER_KEYS as ArrayTrailerKey[];

/** Trailer keys that contain a single enum value */
export const ENUM_TRAILER_KEYS: readonly EnumTrailerKey[] = CORE_ENUM_TRAILER_KEYS as EnumTrailerKey[];

/** All trailer keys that reference other atoms by Lore-id */
export const REFERENCE_TRAILER_KEYS = CORE_REFERENCE_TRAILER_KEYS as readonly TrailerKey[];

/** Valid enum values for core trailers */
export const CONFIDENCE_VALUES: readonly ConfidenceLevel[] = CORE_CONFIDENCE_VALUES as ConfidenceLevel[];
export const SCOPE_RISK_VALUES: readonly ScopeRiskLevel[] = CORE_SCOPE_RISK_VALUES as ScopeRiskLevel[];
export const REVERSIBILITY_VALUES: readonly ReversibilityLevel[] = CORE_REVERSIBILITY_VALUES as ReversibilityLevel[];

/** Pattern for validating Lore-id values (8-character hex string) */
export const LORE_ID_PATTERN = /^[0-9a-f]{8}$/;

/** Length of a standard Lore-id */
export const LORE_ID_LENGTH = 8;

/** Default display limit for query results */
export const DEFAULT_QUERY_LIMIT = 20;

/** Default max git commits to scan when looking for Lore atoms */
export const DEFAULT_MAX_COMMITS = 1000;

/** The default configuration for the Lore protocol */
export const DEFAULT_CONFIG: LoreConfig = {
  protocol: { version: '1.0' },
  trailers: { required: [], custom: [], definitions: {}, permissive: true },
  validation: { strict: false, maxMessageLines: 50, intentMaxLength: 72 },
  stale: { olderThan: '6m', driftThreshold: 20 },
  output: { defaultFormat: 'text' },
  follow: { maxDepth: 3 },
  cli: { updateCheck: true },
};

/** Filesystem paths for Lore configuration */
export const CONFIG_DIR = '.lore';
export const CONFIG_FILENAME = 'config.toml';

/** Prompt strings for interactive mode (Intent and Body only) */
export const PROMPT_STRINGS = {
  INTENT: 'Intent (why the change was made):',
  ADD_BODY: 'Add a body? (narrative context)',
  BODY_INPUT: 'Body (press Enter on empty line to finish):',
} as const;

/** Staleness detection signals */
export const STALE_SIGNAL = CORE_STALE_SIGNAL_METADATA;

/** Default batch size for parallel git file-change lookups */
export const GIT_FILES_CHANGED_BATCH_SIZE = 20;

/** Exit codes for the Lore CLI */
export const EXIT_CODE_SUCCESS = 0;
export const EXIT_CODE_VALIDATION_ERROR = 1;
export const EXIT_CODE_GIT_ERROR = 2;
export const EXIT_CODE_NO_STAGED_CHANGES = 3;

/** Standard trailer UI semantic kinds */
export const TRAILER_UI_KINDS = [
  'identity',
  'risk',
  'decision',
  'evidence',
  'reference',
  'custom',
] as const;

/** Standard trailer UI colors (chalk-compatible) */
export const TRAILER_UI_COLORS = [
  'cyan',
  'magenta',
  'yellow',
  'green',
  'red',
  'dim',
] as const;
