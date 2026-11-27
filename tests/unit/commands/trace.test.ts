import { describe, it, expect, vi } from 'vitest';
import { Command } from 'commander';
import { registerTraceCommand } from '../../../src/commands/trace.js';
import type { AtomRepository } from '../../../src/services/atom-repository.js';
import type { IOutputFormatter } from '../../../src/interfaces/output-formatter.js';
import type { LoreAtom, LoreId } from '../../../src/types/domain.js';
import type { FormattableTraceResult } from '../../../src/types/output.js';
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

describe('trace command --max-depth', () => {
  // Chain A -> B -> C -> D via Related.
  const atomA = makeAtom('aaaaaaaa', ['bbbbbbbb']);
  const atomB = makeAtom('bbbbbbbb', ['cccccccc']);
  const atomC = makeAtom('cccccccc', ['dddddddd']);
  const atomD = makeAtom('dddddddd');

  function makeRepo(root: LoreAtom, atoms: readonly LoreAtom[]): AtomRepository {
    const index = new Map<LoreId, LoreAtom>(atoms.map((atom) => [atom.loreId, atom]));
    return {
      findByLoreId: vi.fn(async () => root),
      getLoreIdIndex: vi.fn(async () => index),
    } as unknown as AtomRepository;
  }

  const chainRepo = (): AtomRepository => makeRepo(atomA, [atomA, atomB, atomC, atomD]);

  async function traceEdges(
    atomRepository: AtomRepository,
    ...argv: string[]
  ): Promise<string[]> {
    const formatTraceResult = vi.fn((_result: FormattableTraceResult) => 'trace output');
    const formatter = { formatTraceResult } as unknown as IOutputFormatter;
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const program = new Command();
      registerTraceCommand(program, { atomRepository, getFormatter: () => formatter });
      await program.parseAsync(['node', 'lore', 'trace', ...argv]);
    } finally {
      log.mockRestore();
    }
    const [result] = formatTraceResult.mock.calls[0];
    return result.edges.map((edge) => `${edge.from}->${edge.to}`);
  }

  it('should list no edges with --max-depth 0 (root only)', async () => {
    const repo = chainRepo();

    expect(await traceEdges(repo, 'aaaaaaaa', '--max-depth', '0')).toEqual([]);
    expect(repo.getLoreIdIndex).not.toHaveBeenCalled();
  });

  it('should list only edges from the root with --max-depth 1', async () => {
    expect(await traceEdges(chainRepo(), 'aaaaaaaa', '--max-depth', '1')).toEqual([
      'aaaaaaaa->bbbbbbbb',
    ]);
  });

  it('should list edges with source depth < 2 with --max-depth 2', async () => {
    expect(await traceEdges(chainRepo(), 'aaaaaaaa', '--max-depth', '2')).toEqual([
      'aaaaaaaa->bbbbbbbb',
      'bbbbbbbb->cccccccc',
    ]);
  });

  it('should list the full A->B->C->D chain with --max-depth 3', async () => {
    expect(await traceEdges(chainRepo(), 'aaaaaaaa', '--max-depth', '3')).toEqual([
      'aaaaaaaa->bbbbbbbb',
      'bbbbbbbb->cccccccc',
      'cccccccc->dddddddd',
    ]);
  });

  it('should default to 10 levels', async () => {
    expect(await traceEdges(chainRepo(), 'aaaaaaaa')).toHaveLength(3);
  });

  it('should still list an edge back to a visited atom (cycle) without looping', async () => {
    const cycleA = makeAtom('aaaaaaaa', ['bbbbbbbb']);
    const cycleB = makeAtom('bbbbbbbb', ['aaaaaaaa']);
    const repo = makeRepo(cycleA, [cycleA, cycleB]);

    expect(await traceEdges(repo, 'aaaaaaaa')).toEqual([
      'aaaaaaaa->bbbbbbbb',
      'bbbbbbbb->aaaaaaaa',
    ]);
  });

  it.each(['x', '-1', '1.5'])('should reject --max-depth %j', async (value) => {
    await expect(runTrace(chainRepo(), 'aaaaaaaa', '--max-depth', value)).rejects.toThrow(
      `Expected a non-negative integer, got "${value}"`,
    );
  });
});
