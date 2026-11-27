import { describe, it, expect, vi, afterEach } from 'vitest';
import { Command } from 'commander';
import type { PathQueryDeps } from '../../../../src/commands/helpers/path-query.js';
import type { FormattableQueryResult } from '../../../../src/types/output.js';
import { registerContextCommand } from '../../../../src/commands/context.js';
import { registerConstraintsCommand } from '../../../../src/commands/constraints.js';
import { registerRejectedCommand } from '../../../../src/commands/rejected.js';
import { registerDirectivesCommand } from '../../../../src/commands/directives.js';
import { registerTestedCommand } from '../../../../src/commands/tested.js';
import { DEFAULT_CONFIG } from '../../../../src/types/config.js';
import { LoreError } from '../../../../src/util/errors.js';

/**
 * The five path commands (plus the `coverage` alias) take an optional
 * [target]: `--scope <name>` alone is a complete query, and passing neither
 * exits 1 with a clear message before any git work. Driven through
 * Commander's parseAsync with mocked services.
 */

type Register = (program: Command, deps: PathQueryDeps) => void;

const COMMANDS: ReadonlyArray<readonly [string, Register]> = [
  ['context', registerContextCommand],
  ['constraints', registerConstraintsCommand],
  ['rejected', registerRejectedCommand],
  ['directives', registerDirectivesCommand],
  ['tested', registerTestedCommand],
  ['coverage', registerTestedCommand],
];

interface Harness {
  readonly program: Command;
  readonly findByScope: ReturnType<typeof vi.fn>;
  readonly findByTarget: ReturnType<typeof vi.fn>;
  readonly formatQueryResult: ReturnType<typeof vi.fn>;
}

function buildHarness(register: Register): Harness {
  const findByScope = vi.fn().mockResolvedValue([]);
  const findByTarget = vi.fn().mockResolvedValue([]);
  const formatQueryResult = vi.fn(() => '');
  const deps = {
    atomRepository: { findByScope, findByTarget, resolveFollowLinks: vi.fn() },
    supersessionResolver: {
      resolve: vi.fn(() => new Map()),
      filterActive: vi.fn((atoms: readonly unknown[]) => atoms),
    },
    pathResolver: {
      parseTarget: vi.fn((raw: string) => ({ raw, type: 'directory' })),
      toGitLogArgs: vi.fn(() => ['--', 'src/']),
    },
    getFormatter: () => ({ formatQueryResult }),
    config: DEFAULT_CONFIG,
  } as unknown as PathQueryDeps;

  vi.spyOn(console, 'log').mockImplementation(() => {});

  const program = new Command();
  program.exitOverride();
  register(program, deps);
  return { program, findByScope, findByTarget, formatQueryResult };
}

describe.each(COMMANDS)('lore %s [target]', (name, register) => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should run a --scope query without a target', async () => {
    const harness = buildHarness(register);

    await harness.program.parseAsync(['node', 'lore', name, '--scope', 'auth']);

    expect(harness.findByScope).toHaveBeenCalledWith('auth', expect.objectContaining({ scope: 'auth' }));
    expect(harness.findByTarget).not.toHaveBeenCalled();
    const [formattable] = harness.formatQueryResult.mock.calls[0] as [FormattableQueryResult];
    expect(formattable.result.target).toBe('scope:auth');
  });

  it('should still run a target query', async () => {
    const harness = buildHarness(register);

    await harness.program.parseAsync(['node', 'lore', name, 'src/']);

    expect(harness.findByTarget).toHaveBeenCalledTimes(1);
    expect(harness.findByScope).not.toHaveBeenCalled();
  });

  it('should exit 1 when neither a target nor --scope is given', async () => {
    const harness = buildHarness(register);

    const error = await harness.program
      .parseAsync(['node', 'lore', name])
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(LoreError);
    expect((error as LoreError).exitCode).toBe(1);
    expect((error as LoreError).message).toBe(
      'Missing target: pass a <target> path or --scope <name>.',
    );
    expect(harness.findByScope).not.toHaveBeenCalled();
    expect(harness.findByTarget).not.toHaveBeenCalled();
  });
});
