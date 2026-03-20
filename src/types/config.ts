export interface LoreConfig {
  readonly protocol: {
    readonly version: string;
  };
  readonly trailers: {
    readonly required: readonly string[];
    readonly custom: readonly string[];
  };
  readonly validation: {
    readonly strict: boolean;
    readonly maxMessageLines: number;
    readonly intentMaxLength: number;
  };
  readonly stale: {
    readonly olderThan: string;
    readonly driftThreshold: number;
  };
  readonly output: {
    readonly defaultFormat: 'text' | 'json';
  };
  readonly follow: {
    readonly maxDepth: number;
  };
}

export const DEFAULT_CONFIG: LoreConfig = {
  protocol: { version: '1.0' },
  trailers: { required: [], custom: [] },
  validation: { strict: false, maxMessageLines: 50, intentMaxLength: 72 },
  stale: { olderThan: '6m', driftThreshold: 20 },
  output: { defaultFormat: 'text' },
  follow: { maxDepth: 3 },
};
