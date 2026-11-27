import { describe, it, expect, vi, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerStaleCommand } from '../../../src/commands/stale.js';
import type { AtomRepository } from '../../../src/services/atom-repository.js';
import type { SupersessionResolver } from '../../../src/services/supersession-resolver.js';
import type { StalenessDetector } from '../../../src/services/staleness-detector.js';
import type { PathResolver } from '../../../src/services/path-resolver.js';
import type { IOutputFormatter } from '../../../src/interfaces/output-formatter.js';
import type { LoreAtom } from '../../../src/types/domain.js';
import type { StaleAtomReport } from '../../../src/types/output.js';
import { STALE_SIGNAL } from '../../../src/util/constants.js';

/**
 * `lore stale --older-than` / `--drift` override the config thresholds
 * (passed to StalenessDetector.analyze) and still select which signals are
 * reported. Driven through Commander's parseAsync with mocked services.
 */

const fakeAtom = { loreId: 'aaaa1111' } as unknown as LoreAtom;

function report(signal: string): StaleAtomReport {
  return { atom: fakeAtom, reasons: [{ signal, description: `${signal} reason` }] } as StaleAtomReport;
}

interface Harness {
  readonly program: Command;
  readonly analyze: ReturnType<typeof vi.fn>;
  readonly formatStalenessResult: ReturnType<typeof vi.fn>;
}

function buildHarness(reports: readonly StaleAtomReport[] = []): Harness {
  const atomRepository = {
    findAll: vi.fn().mockResolvedValue([fakeAtom]),
    findByTarget: vi.fn().mockResolvedValue([fakeAtom]),
  } as unknown as AtomRepository;
  const supersessionResolver = {
    resolve: vi.fn(() => new Map()),
    filterActive: vi.fn((atoms: readonly LoreAtom[]) => atoms),
  } as unknown as SupersessionResolver;
  const analyze = vi.fn().mockResolvedValue([...reports]);
  const stalenessDetector = { analyze } as unknown as StalenessDetector;
  const pathResolver = {
    parseTarget: vi.fn(),
    toGitLogArgs: vi.fn(() => []),
  } as unknown as PathResolver;
  const formatStalenessResult = vi.fn(() => '');
  const formatter = { formatStalenessResult } as unknown as IOutputFormatter;

  vi.spyOn(console, 'log').mockImplementation(() => {});

  const program = new Command();
  program.exitOverride();
  registerStaleCommand(program, {
    atomRepository,
    supersessionResolver,
    stalenessDetector,
    pathResolver,
    getFormatter: () => formatter,
  });

  return { program, analyze, formatStalenessResult };
}

async function runStale(harness: Harness, ...argv: string[]): Promise<void> {
  await harness.program.parseAsync(['node', 'lore', 'stale', ...argv]);
}

describe('registerStaleCommand threshold flags', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should pass no threshold overrides when no flags are given', async () => {
    const harness = buildHarness();

    await runStale(harness);

    expect(harness.analyze).toHaveBeenCalledWith(expect.any(Array), expect.any(Map), {
      olderThan: undefined,
      driftThreshold: undefined,
    });
  });

  it('should pass --older-than as the olderThan override', async () => {
    const harness = buildHarness();

    await runStale(harness, '--older-than', '30d');

    expect(harness.analyze).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Map),
      expect.objectContaining({ olderThan: '30d' }),
    );
  });

  it('should pass --drift as the driftThreshold override, including 0', async () => {
    const harness = buildHarness();

    await runStale(harness, '--drift', '0');

    expect(harness.analyze).toHaveBeenCalledWith(
      expect.any(Array),
      expect.any(Map),
      expect.objectContaining({ driftThreshold: 0 }),
    );
  });

  it('should still filter reports to the signals selected by the flags', async () => {
    const harness = buildHarness([report(STALE_SIGNAL.AGE), report(STALE_SIGNAL.DRIFT)]);

    await runStale(harness, '--older-than', '30d');

    const [result] = harness.formatStalenessResult.mock.calls[0];
    expect(result.atoms.map((r: StaleAtomReport) => r.reasons[0].signal)).toEqual([STALE_SIGNAL.AGE]);
  });

  it.each(['30', 'x', '6M', '-1d'])('should reject --older-than %j', async (value) => {
    const harness = buildHarness();

    await expect(runStale(harness, '--older-than', value)).rejects.toThrow(
      `Expected a duration like 30d, 2w, 6m or 1y, got "${value}"`,
    );
    expect(harness.analyze).not.toHaveBeenCalled();
  });

  it.each(['x', '-1', '2.5'])('should reject --drift %j', async (value) => {
    const harness = buildHarness();

    await expect(runStale(harness, '--drift', value)).rejects.toThrow(
      `Expected a non-negative integer, got "${value}"`,
    );
    expect(harness.analyze).not.toHaveBeenCalled();
  });
});
