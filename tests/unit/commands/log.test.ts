import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';
import { registerLogCommand } from '../../../src/commands/log.js';
import type { AtomRepository } from '../../../src/services/atom-repository.js';
import type { SupersessionResolver } from '../../../src/services/supersession-resolver.js';
import type { IOutputFormatter } from '../../../src/interfaces/output-formatter.js';
import type { LoreAtom } from '../../../src/types/domain.js';

/**
 * Regression tests for issue #22: `lore log` must accept positional path
 * arguments (`lore log src/foo.ts`) and the historical `--`-pass-through
 * (`lore log -- src/foo.ts`) without erroring out, and must filter atoms
 * to those whose `filesChanged` matches the requested path(s).
 *
 * Constructed at the command-action layer so we can drive it through
 * Commander's parseAsync the same way the CLI binary does, but with the
 * downstream services mocked so the test stays a unit test.
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
    },
    ...overrides,
  };
}

interface Harness {
  program: Command;
  atomRepository: AtomRepository;
  supersessionResolver: SupersessionResolver;
  getFormatter: () => IOutputFormatter;
  capturedResult: { data: unknown };
  formatQueryResult: ReturnType<typeof vi.fn>;
  findAll: ReturnType<typeof vi.fn>;
  findByTarget: ReturnType<typeof vi.fn>;
  log: ReturnType<typeof vi.spyOn>;
}

function buildHarness(atoms: LoreAtom[], filteredAtoms?: LoreAtom[]): Harness {
  // `lore log` without paths goes through findAll; with paths it routes
  // through findByTarget (git-level path filtering, see #24). The harness
  // returns the same atoms either way unless the caller passes a separate
  // filtered set for the path-filtered branch.
  const findAll = vi.fn().mockResolvedValue(atoms);
  const findByTarget = vi
    .fn()
    .mockResolvedValue(filteredAtoms ?? atoms);
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

  const log = vi.spyOn(console, 'log').mockImplementation(() => {});

  const program = new Command();
  program.exitOverride();
  registerLogCommand(program, {
    atomRepository,
    supersessionResolver,
    getFormatter: () => formatter,
  });

  return {
    program,
    atomRepository,
    supersessionResolver,
    getFormatter: () => formatter,
    capturedResult,
    formatQueryResult,
    findAll,
    findByTarget,
    log,
  };
}

// process.argv determines the `--` pass-through inside the action body.
// Vitest gives each test a fresh sandbox but not a fresh argv, so reset
// it explicitly around each case.
const ORIGINAL_ARGV = process.argv;

describe('registerLogCommand (issue #22 path arguments)', () => {
  beforeEach(() => {
    process.argv = [...ORIGINAL_ARGV];
  });

  it('accepts a positional path and routes through findByTarget', async () => {
    const matching = makeAtom({
      loreId: 'match0001',
      filesChanged: ['src/main.ts'],
    });
    // No filtered set passed — findByTarget returns the matching atom.
    const h = buildHarness([matching], [matching]);

    process.argv = ['node', 'lore', 'log', 'src/main.ts'];
    await h.program.parseAsync(process.argv);

    expect(h.findByTarget).toHaveBeenCalledTimes(1);
    expect(h.findByTarget).toHaveBeenCalledWith(
      ['--', 'src/main.ts'],
      expect.any(Object),
    );
    expect(h.findAll).not.toHaveBeenCalled();

    const result = (h.capturedResult.data as { result: { atoms: LoreAtom[] } }).result;
    expect(result.atoms).toHaveLength(1);
    expect(result.atoms[0].loreId).toBe('match0001');
    h.log.mockRestore();
  });

  it('accepts the historical `--` pass-through and routes identically', async () => {
    const matching = makeAtom({
      loreId: 'match0002',
      filesChanged: ['src/main.ts'],
    });
    const h = buildHarness([matching], [matching]);

    process.argv = ['node', 'lore', 'log', '--', 'src/main.ts'];
    await h.program.parseAsync(process.argv);

    expect(h.findByTarget).toHaveBeenCalledTimes(1);
    expect(h.findByTarget).toHaveBeenCalledWith(
      ['--', 'src/main.ts'],
      expect.any(Object),
    );

    const result = (h.capturedResult.data as { result: { atoms: LoreAtom[] } }).result;
    expect(result.atoms).toHaveLength(1);
    expect(result.atoms[0].loreId).toBe('match0002');
    h.log.mockRestore();
  });

  it('uses findAll (not findByTarget) when no path argument is provided', async () => {
    const a = makeAtom({ loreId: 'all00001', filesChanged: ['src/a.ts'] });
    const b = makeAtom({ loreId: 'all00002', filesChanged: ['src/b.ts'] });
    const h = buildHarness([a, b]);

    process.argv = ['node', 'lore', 'log'];
    await h.program.parseAsync(process.argv);

    expect(h.findAll).toHaveBeenCalledTimes(1);
    expect(h.findByTarget).not.toHaveBeenCalled();

    const result = (h.capturedResult.data as { result: { atoms: LoreAtom[] } }).result;
    expect(result.atoms).toHaveLength(2);
    h.log.mockRestore();
  });

  it('combines --limit with a positional path argument (limit applied client-side)', async () => {
    const a = makeAtom({ loreId: 'limit001', filesChanged: ['src/main.ts'] });
    const b = makeAtom({ loreId: 'limit002', filesChanged: ['src/main.ts'] });
    const h = buildHarness([], [a, b]);

    process.argv = ['node', 'lore', 'log', '--limit', '1', 'src/main.ts'];
    await h.program.parseAsync(process.argv);

    // Path arg routes to findByTarget regardless of --limit.
    expect(h.findByTarget).toHaveBeenCalledTimes(1);
    expect(h.findByTarget).toHaveBeenCalledWith(
      ['--', 'src/main.ts'],
      expect.any(Object),
    );

    // --limit truncates the formatted result client-side.
    const result = (h.capturedResult.data as { result: { atoms: LoreAtom[] } }).result;
    expect(result.atoms).toHaveLength(1);
    expect(result.atoms[0].loreId).toBe('limit001');
    h.log.mockRestore();
  });
});
