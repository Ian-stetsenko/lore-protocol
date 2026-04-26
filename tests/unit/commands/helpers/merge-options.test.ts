import { describe, it, expect, vi } from 'vitest';
import { mergeOptions } from '../../../../src/commands/helpers/merge-options.js';

function mockCommand(localOpts: Record<string, unknown>, parentOpts?: Record<string, unknown>) {
  return {
    opts: vi.fn().mockReturnValue(localOpts),
    parent: parentOpts !== undefined
      ? { opts: vi.fn().mockReturnValue(parentOpts) }
      : null,
  } as any;
}

describe('mergeOptions', () => {
  it('should return local options when no global options exist', () => {
    const command = mockCommand({ limit: 5, since: '2025-01-01' }, {});

    const result = mergeOptions<{ limit?: number; since?: string }>(command);

    expect(result.limit).toBe(5);
    expect(result.since).toBe('2025-01-01');
  });

  it('should return global options when no local options exist', () => {
    const command = mockCommand({}, { limit: 5, since: '2025-01-01' });

    const result = mergeOptions<{ limit?: number; since?: string }>(command);

    expect(result.limit).toBe(5);
    expect(result.since).toBe('2025-01-01');
  });

  it('should merge global and local options with local taking precedence', () => {
    const command = mockCommand(
      { limit: 10 },
      { limit: 5, since: '2025-01-01' },
    );

    const result = mergeOptions<{ limit?: number; since?: string }>(command);

    expect(result.limit).toBe(10);
    expect(result.since).toBe('2025-01-01');
  });

  it('should not overwrite global values with undefined local values', () => {
    const command = mockCommand(
      { limit: undefined, since: undefined },
      { limit: 5, since: '2025-01-01' },
    );

    const result = mergeOptions<{ limit?: number; since?: string }>(command);

    expect(result.limit).toBe(5);
    expect(result.since).toBe('2025-01-01');
  });

  it('should handle case where command has no parent', () => {
    const command = mockCommand({ limit: 5 });

    const result = mergeOptions<{ limit?: number }>(command);

    expect(result.limit).toBe(5);
  });

  it('should pass through non-conflicting options from both levels', () => {
    const command = mockCommand(
      { limit: 5 },
      { json: true, format: 'json' },
    );

    const result = mergeOptions<{ limit?: number; json?: boolean; format?: string }>(command);

    expect(result.limit).toBe(5);
    expect(result.json).toBe(true);
    expect(result.format).toBe('json');
  });
});
