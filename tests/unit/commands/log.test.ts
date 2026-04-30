import { describe, it, expect, vi, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerLogCommand } from '../../../src/commands/log.js';
import type { AtomRepository } from '../../../src/services/atom-repository.js';
import type { SupersessionResolver } from '../../../src/services/supersession-resolver.js';
import type { IOutputFormatter } from '../../../src/interfaces/output-formatter.js';
import type { LoreAtom } from '../../../src/types/domain.js';
import { CustomTrailerCollection } from '../../../src/types/custom-trailer-collection.js';

/**
 * Regression tests for issue #22: `lore log` must accept positional path
 * arguments (`lore log src/foo.ts`) and the `--` pass-through
 * (`lore log -- src/foo.ts`), routing to `findByTarget` for git-level
 * path filtering.
 *
 * Driven through Commander's parseAsync with mocked services.
 */

function makeAtom(overrides: Partial<LoreAtom> & { filesChanged: readonly string[] }): LoreAtom {
  return {
    loreId: 'abcd1234',
    commitHash: 'a'.repeat(40),
    date: new Date('2026-01-01T00:00:00Z'),
    author: 'Tester <tester@example.com>',
    intent: 'fix: example',
    body: '',
    trailers: {
      'Lore-id': 'abcd1234',
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
      Related: [],
      custom: CustomTrailerCollection.empty(),
    },
    ...overrides,
  };
}

interface Harness {
  program: Command;
  capturedResult: { data: unknown };
  findAll: ReturnType<typeof vi.fn>;
  findByTarget: ReturnType<typeof vi.fn>;
  consoleSpy: ReturnType<typeof vi.spyOn>;
}

function buildHarness(atoms: LoreAtom[], filteredAtoms?: LoreAtom[]): Harness {
  const findAll = vi.fn().mockResolvedValue(atoms);
  const findByTarget = vi.fn().mockResolvedValue(filteredAtoms ?? atoms);
  const atomRepository = { findAll, findByTarget } as unknown as AtomRepository;

  const supersessionResolver = {
    resolve: vi.fn().mockReturnValue(new Map()),
  } as unknown as SupersessionResolver;

  const capturedResult: { data: unknown } = { data: undefined };
  const formatQueryResult = vi.fn((data: unknown) => {
    capturedResult.data = data;
    return '';
  });

  const formatter = {
    formatQueryResult,
    formatValidationResult: vi.fn(),
    formatStalenessResult: vi.fn(),
    formatTraceResult: vi.fn(),
    formatDoctorResult: vi.fn(),
    formatSuccess: vi.fn(),
    formatError: vi.fn(),
  } as IOutputFormatter;

  const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

  const program = new Command();
  program.exitOverride();
  registerLogCommand(program, {
    atomRepository,
    supersessionResolver,
    getFormatter: () => formatter,
  });

  return { program, capturedResult, findAll, findByTarget, consoleSpy };
}

describe('registerLogCommand (issue #22 path arguments)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts a positional path and routes through findByTarget', async () => {
    const matching = makeAtom({
      loreId: 'match0001',
      filesChanged: ['src/main.ts'],
    });
    const h = buildHarness([matching], [matching]);

    await h.program.parseAsync(['node', 'lore', 'log', 'src/main.ts']);

    expect(h.findByTarget).toHaveBeenCalledTimes(1);
    expect(h.findByTarget).toHaveBeenCalledWith(
      ['--', 'src/main.ts'],
      expect.any(Object),
    );
    expect(h.findAll).not.toHaveBeenCalled();

    const result = (h.capturedResult.data as { result: { atoms: LoreAtom[] } }).result;
    expect(result.atoms).toHaveLength(1);
    expect(result.atoms[0].loreId).toBe('match0001');
  });

  it('accepts the `--` pass-through and routes identically', async () => {
    const matching = makeAtom({
      loreId: 'match0002',
      filesChanged: ['src/main.ts'],
    });
    const h = buildHarness([matching], [matching]);

    await h.program.parseAsync(['node', 'lore', 'log', '--', 'src/main.ts']);

    expect(h.findByTarget).toHaveBeenCalledTimes(1);
    expect(h.findByTarget).toHaveBeenCalledWith(
      ['--', 'src/main.ts'],
      expect.any(Object),
    );

    const result = (h.capturedResult.data as { result: { atoms: LoreAtom[] } }).result;
    expect(result.atoms).toHaveLength(1);
    expect(result.atoms[0].loreId).toBe('match0002');
  });

  it('uses findAll (not findByTarget) when no path argument is provided', async () => {
    const a = makeAtom({ loreId: 'all00001', filesChanged: ['src/a.ts'] });
    const b = makeAtom({ loreId: 'all00002', filesChanged: ['src/b.ts'] });
    const h = buildHarness([a, b]);

    await h.program.parseAsync(['node', 'lore', 'log']);

    expect(h.findAll).toHaveBeenCalledTimes(1);
    expect(h.findByTarget).not.toHaveBeenCalled();

    const result = (h.capturedResult.data as { result: { atoms: LoreAtom[] } }).result;
    expect(result.atoms).toHaveLength(2);
  });

  it('combines --limit with a positional path argument (limit applied client-side)', async () => {
    const a = makeAtom({ loreId: 'limit001', filesChanged: ['src/main.ts'] });
    const b = makeAtom({ loreId: 'limit002', filesChanged: ['src/main.ts'] });
    const h = buildHarness([], [a, b]);

    await h.program.parseAsync(['node', 'lore', 'log', '--limit', '1', 'src/main.ts']);

    expect(h.findByTarget).toHaveBeenCalledTimes(1);
    expect(h.findByTarget).toHaveBeenCalledWith(
      ['--', 'src/main.ts'],
      expect.any(Object),
    );

    const result = (h.capturedResult.data as { result: { atoms: LoreAtom[] } }).result;
    expect(result.atoms).toHaveLength(1);
    expect(result.atoms[0].loreId).toBe('limit001');
  });

  it('passes --max-commits to findByTarget as maxCommits in PathQueryOptions', async () => {
    const atom = makeAtom({ loreId: 'mc000001', filesChanged: ['src/main.ts'] });
    const h = buildHarness([], [atom]);

    await h.program.parseAsync(['node', 'lore', 'log', '--max-commits', '50', 'src/main.ts']);

    const queryOptions = h.findByTarget.mock.calls[0][1];
    expect(queryOptions.maxCommits).toBe(50);
  });

  it('reflects totalAtoms before --limit in meta', async () => {
    const atoms = [
      makeAtom({ loreId: 'meta0001', filesChanged: ['src/a.ts'] }),
      makeAtom({ loreId: 'meta0002', filesChanged: ['src/b.ts'] }),
      makeAtom({ loreId: 'meta0003', filesChanged: ['src/c.ts'] }),
    ];
    const h = buildHarness(atoms);

    await h.program.parseAsync(['node', 'lore', 'log', '--limit', '1']);

    const data = h.capturedResult.data as { result: { atoms: LoreAtom[]; meta: { totalAtoms: number; filteredAtoms: number } } };
    expect(data.result.meta.totalAtoms).toBe(3);
    expect(data.result.meta.filteredAtoms).toBe(1);
    expect(data.result.atoms).toHaveLength(1);
  });
});
