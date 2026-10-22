import { describe, it, expect, vi } from 'vitest';
import { Command } from 'commander';
import { registerTraceCommand } from '../../../src/commands/trace.js';
import type { AtomRepository } from '../../../src/services/atom-repository.js';
import type { IOutputFormatter } from '../../../src/interfaces/output-formatter.js';
import type { LoreAtom, LoreId } from '../../../src/types/domain.js';
import { CustomTrailerCollection } from '../../../src/types/custom-trailer-collection.js';

function makeAtom(loreId: LoreId, related: readonly LoreId[] = []): LoreAtom {
  return {
    loreId,
    commitHash: `hash-${loreId}`,
    date: new Date(),
    author: 'dev@example.com',
    intent: 'feat: test',
    body: '',
    trailers: {
      'Lore-id': loreId,
      Constraint: [],
      Rejected: [],
      Confidence: null,
      'Scope-risk': null,
      Reversibility: null,
      Directive: [],
      Tested: [],
      'Not-tested': [],
      Supersedes: [],
      'Depends-on': [],
      Related: [...related],
      custom: CustomTrailerCollection.empty(),
    },
    filesChanged: [],
  };
}

function createMockFormatter(): IOutputFormatter {
  return {
    formatTraceResult: vi.fn(() => 'trace output'),
  } as unknown as IOutputFormatter;
}

async function runTrace(
  atomRepository: AtomRepository,
  ...argv: string[]
): Promise<void> {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    const program = new Command();
    registerTraceCommand(program, { atomRepository, getFormatter: createMockFormatter });
    await program.parseAsync(['node', 'lore', 'trace', ...argv]);
  } finally {
    log.mockRestore();
  }
}

describe('trace command', () => {
  it('should resolve the root via findByLoreId and edges via the shared index', async () => {
    const root = makeAtom('aaaa1111', ['bbbb2222']);
    const linked = makeAtom('bbbb2222');
    const findByLoreId = vi.fn(async () => root);
    const getLoreIdIndex = vi.fn(async () =>
      new Map<LoreId, LoreAtom>([
        [root.loreId, root],
        [linked.loreId, linked],
      ]),
    );
    const repo = { findByLoreId, getLoreIdIndex } as unknown as AtomRepository;

    await runTrace(repo, 'aaaa1111');

    expect(findByLoreId).toHaveBeenCalledTimes(1);
    expect(findByLoreId).toHaveBeenCalledWith('aaaa1111');
    expect(getLoreIdIndex).toHaveBeenCalledTimes(1);
  });

  it('should throw when the root Lore-id is unknown', async () => {
    const findByLoreId = vi.fn(async () => null);
    const getLoreIdIndex = vi.fn(async () => new Map<LoreId, LoreAtom>());
    const repo = { findByLoreId, getLoreIdIndex } as unknown as AtomRepository;

    await expect(runTrace(repo, 'deadbeef')).rejects.toThrow(
      'Lore-id "deadbeef" not found in commit history.',
    );
    expect(getLoreIdIndex).not.toHaveBeenCalled();
  });

  it('should not build the index when the root atom has no references', async () => {
    const root = makeAtom('aaaa1111');
    const findByLoreId = vi.fn(async () => root);
    const getLoreIdIndex = vi.fn(async () => new Map<LoreId, LoreAtom>());
    const repo = { findByLoreId, getLoreIdIndex } as unknown as AtomRepository;

    await runTrace(repo, 'aaaa1111');

    expect(getLoreIdIndex).not.toHaveBeenCalled();
  });
});
