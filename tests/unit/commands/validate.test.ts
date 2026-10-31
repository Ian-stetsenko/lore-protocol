import { describe, it, expect, vi, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerValidateCommand } from '../../../src/commands/validate.js';
import type { Validator } from '../../../src/services/validator.js';
import type { IGitClient, RawCommit } from '../../../src/interfaces/git-client.js';
import type { IOutputFormatter } from '../../../src/interfaces/output-formatter.js';
import type { TrailerParser } from '../../../src/services/trailer-parser.js';

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue('feat: hook commit\n\nLore-id: abcd1234'),
}));

/**
 * Tests for issue #69: `lore validate` gains `--from <ref>` for revision
 * ranges (`<ref>..HEAD`), while `--since <ref>` keeps its ref semantics but
 * prints a deprecation warning (removal in 0.7).
 *
 * Driven through Commander's parseAsync with mocked services.
 */

function makeRawCommit(hash: string): RawCommit {
  return {
    hash,
    date: new Date('2026-01-01T00:00:00Z').toISOString(),
    author: 'Tester <tester@example.com>',
    subject: 'fix: example',
    body: 'fix: example',
    trailers: 'Lore-id: abcd1234',
    filesChanged: [],
  };
}

interface Harness {
  program: Command;
  validate: ReturnType<typeof vi.fn>;
  log: ReturnType<typeof vi.fn>;
  consoleLogSpy: ReturnType<typeof vi.spyOn>;
  consoleErrorSpy: ReturnType<typeof vi.spyOn>;
}

function buildHarness(commits: readonly RawCommit[] = []): Harness {
  const validate = vi.fn().mockResolvedValue([]);
  const validator = { validate } as unknown as Validator;

  const log = vi.fn().mockResolvedValue(commits);
  const gitClient = { log } as unknown as IGitClient;

  const trailerParser = { extractTrailerBlock: vi.fn() } as unknown as TrailerParser;

  const formatter = {
    formatQueryResult: vi.fn(),
    formatValidationResult: vi.fn(() => ''),
    formatStalenessResult: vi.fn(),
    formatTraceResult: vi.fn(),
    formatDoctorResult: vi.fn(),
    formatSuccess: vi.fn(),
    formatError: vi.fn(
      (_code: number, messages: readonly { severity: string; message: string }[]) =>
        messages.map((m) => `${m.severity}: ${m.message}`).join('\n'),
    ),
  } as IOutputFormatter;

  const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  const program = new Command();
  program.exitOverride();
  registerValidateCommand(program, {
    validator,
    gitClient,
    trailerParser,
    getFormatter: () => formatter,
  });

  return { program, validate, log, consoleLogSpy, consoleErrorSpy };
}

describe('registerValidateCommand (issue #69 --from and --since deprecation)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('routes --from to the <ref>..HEAD range and feeds the result to the validator', async () => {
    const commits = [makeRawCommit('a'.repeat(40))];
    const h = buildHarness(commits);

    await h.program.parseAsync(['node', 'lore', 'validate', '--from', 'main']);

    expect(h.log).toHaveBeenCalledTimes(1);
    expect(h.log).toHaveBeenCalledWith(['main..HEAD']);
    expect(h.validate).toHaveBeenCalledWith(commits);
  });

  it('validates the same commits as the equivalent positional range', async () => {
    const commits = [makeRawCommit('b'.repeat(40))];
    const positional = buildHarness(commits);
    const fromFlag = buildHarness(commits);

    await positional.program.parseAsync(['node', 'lore', 'validate', 'main..HEAD']);
    await fromFlag.program.parseAsync(['node', 'lore', 'validate', '--from', 'main']);

    expect(fromFlag.log).toHaveBeenCalledWith(...positional.log.mock.calls[0]);
    expect(fromFlag.validate).toHaveBeenCalledWith(...positional.validate.mock.calls[0]);
  });

  it('keeps the positional range working unchanged', async () => {
    const h = buildHarness();

    await h.program.parseAsync(['node', 'lore', 'validate', 'main..feature']);

    expect(h.log).toHaveBeenCalledWith(['main..feature']);
  });

  it('rejects a positional range combined with --from', async () => {
    const h = buildHarness();

    await expect(
      h.program.parseAsync(['node', 'lore', 'validate', 'main..feature', '--from', 'main']),
    ).rejects.toThrow(/Conflicting range specifiers.*--from/);

    expect(h.log).not.toHaveBeenCalled();
    expect(h.validate).not.toHaveBeenCalled();
  });

  it('keeps --since working as a ref but warns about removal in 0.7', async () => {
    const commits = [makeRawCommit('c'.repeat(40))];
    const h = buildHarness(commits);

    await h.program.parseAsync(['node', 'lore', 'validate', '--since', 'main']);

    expect(h.log).toHaveBeenCalledWith(['main..HEAD']);
    expect(h.validate).toHaveBeenCalledWith(commits);

    expect(h.consoleErrorSpy).toHaveBeenCalledTimes(1);
    const warning = h.consoleErrorSpy.mock.calls[0].join(' ');
    expect(warning).toContain('--since is deprecated');
    expect(warning).toContain('0.7');
    expect(warning).toContain('--from');
  });

  it('prefers --from when both --from and --since are given, and still warns', async () => {
    const h = buildHarness();

    await h.program.parseAsync(['node', 'lore', 'validate', '--from', 'develop', '--since', 'main']);

    expect(h.log).toHaveBeenCalledTimes(1);
    expect(h.log).toHaveBeenCalledWith(['develop..HEAD']);
    expect(h.consoleErrorSpy.mock.calls[0].join(' ')).toContain('--since is deprecated');
  });

  it('keeps the positional range winning over --since, as before, and still warns', async () => {
    const h = buildHarness();

    await h.program.parseAsync(['node', 'lore', 'validate', 'main..feature', '--since', 'develop']);

    expect(h.log).toHaveBeenCalledWith(['main..feature']);
    expect(h.consoleErrorSpy.mock.calls[0].join(' ')).toContain('--since is deprecated');
  });

  it('does not warn when --from is used without --since', async () => {
    const h = buildHarness();

    await h.program.parseAsync(['node', 'lore', 'validate', '--from', 'main']);

    expect(h.consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('keeps the default (last commit) and --last behavior', async () => {
    const defaults = buildHarness();
    await defaults.program.parseAsync(['node', 'lore', 'validate']);
    expect(defaults.log).toHaveBeenCalledWith(['-1']);

    const last = buildHarness();
    await last.program.parseAsync(['node', 'lore', 'validate', '--last', '3']);
    expect(last.log).toHaveBeenCalledWith(['-3']);
  });

  it('still warns when --since is passed in hook mode (--commit-msg-file)', async () => {
    const { readFile } = await import('node:fs/promises');
    vi.mocked(readFile).mockResolvedValue('feat: hook commit\n\nLore-id: abcd1234');

    const h = buildHarness();

    await h.program.parseAsync([
      'node', 'lore', 'validate', '--since', 'main', '--commit-msg-file', 'msg.txt',
    ]);

    // Hook mode ignores range specifiers; the deprecation warning still fires.
    expect(h.log).not.toHaveBeenCalled();
    expect(h.validate).toHaveBeenCalledTimes(1);
    expect(h.consoleErrorSpy.mock.calls[0].join(' ')).toContain('--since is deprecated');
  });
});
