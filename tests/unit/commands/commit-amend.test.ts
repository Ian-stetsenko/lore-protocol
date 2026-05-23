import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';
import { registerCommitCommand } from '../../../src/commands/commit.js';
import type { CommitBuilder } from '../../../src/services/commit-builder.js';
import type { IGitClient } from '../../../src/interfaces/git-client.js';
import type { IOutputFormatter } from '../../../src/interfaces/output-formatter.js';
import type { CommitInputResolver } from '../../../src/services/commit-input-resolver.js';
import type { HeadLoreIdReader } from '../../../src/services/head-lore-id-reader.js';
import { DEFAULT_CONFIG } from '../../../src/util/constants.js';
import { Protocol } from '../../../src/services/protocol.js';
import { LORE_ID_KEY } from '../../../src/util/constants.js';

function createMockGitClient(): IGitClient {
  return {
    log: vi.fn().mockResolvedValue([]),
    blame: vi.fn().mockResolvedValue([]),
    commit: vi.fn().mockResolvedValue({ hash: 'abc1234', success: true }),
    hasStagedChanges: vi.fn().mockResolvedValue(true),
    getRepoRoot: vi.fn().mockResolvedValue('/repo'),
    isInsideRepo: vi.fn().mockResolvedValue(true),
    getFilesChanged: vi.fn().mockResolvedValue([]),
    countCommitsSince: vi.fn().mockResolvedValue(0),
    resolveRef: vi.fn().mockResolvedValue('abc1234'),
    getHeadMessage: vi.fn().mockResolvedValue(''),
    countAllCommits: vi.fn().mockResolvedValue(0),
    listTrackedFiles: vi.fn().mockResolvedValue([]),
  } as any;
}

function createMockFormatter(): IOutputFormatter {
  return {
    formatQueryResult: vi.fn().mockReturnValue(''),
    formatValidationResult: vi.fn().mockReturnValue(''),
    formatStalenessResult: vi.fn().mockReturnValue(''),
    formatTraceResult: vi.fn().mockReturnValue(''),
    formatDoctorResult: vi.fn().mockReturnValue(''),
    formatMetricsResult: vi.fn().mockReturnValue(''),
    formatSuccess: vi.fn().mockReturnValue(''),
    formatError: vi.fn().mockReturnValue(''),
  };
}

function createMockCommitBuilder(): CommitBuilder {
  return {
    build: vi.fn().mockReturnValue('built message'),
    validate: vi.fn().mockReturnValue([]),
  } as unknown as CommitBuilder;
}

function createMockInputResolver(): CommitInputResolver {
  return {
    resolve: vi.fn().mockResolvedValue({ intent: 'test commit' }),
  } as unknown as CommitInputResolver;
}

function createMockHeadLoreIdReader(loreId: string | null = null): HeadLoreIdReader {
  return {
    read: vi.fn().mockResolvedValue(loreId),
  } as unknown as HeadLoreIdReader;
}

async function runCommitCommand(args: string[], deps: ReturnType<typeof createDeps>): Promise<void> {
  const program = new Command();
  program.exitOverride();
  registerCommitCommand(program, deps);
  await program.parseAsync(['node', 'lore', 'commit', ...args]);
}

function createDeps(overrides?: {
  headLoreIdReader?: HeadLoreIdReader;
  gitClient?: IGitClient;
}) {
  return {
    commitBuilder: createMockCommitBuilder(),
    gitClient: overrides?.gitClient ?? createMockGitClient(),
    getFormatter: () => createMockFormatter(),
    commitInputResolver: createMockInputResolver(),
    headLoreIdReader: overrides?.headLoreIdReader ?? createMockHeadLoreIdReader(),
    config: DEFAULT_CONFIG,
    protocol: new Protocol(DEFAULT_CONFIG),
  };
}

describe('lore commit --amend', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('should skip staged-changes guard when --amend is used', async () => {
    const gitClient = createMockGitClient();
    vi.mocked(gitClient.hasStagedChanges).mockResolvedValue(false);
    const deps = createDeps({ gitClient });

    // Without --amend, would throw NoStagedChangesError
    // With --amend, should succeed
    await runCommitCommand(['--amend', '--intent', 'amend test'], deps);

    expect(gitClient.hasStagedChanges).not.toHaveBeenCalled();
  });

  it(`should pass existing ${LORE_ID_KEY} to commitBuilder.build when amending`, async () => {
    const headLoreIdReader = createMockHeadLoreIdReader('cafebabe');
    const deps = createDeps({ headLoreIdReader });

    await runCommitCommand(['--amend', '--intent', 'amend test'], deps);

    expect(headLoreIdReader.read).toHaveBeenCalledOnce();
    expect(deps.commitBuilder.build).toHaveBeenCalledWith(
      expect.anything(),
      'cafebabe',
    );
  });

  it('should pass --amend flag to gitClient.commit', async () => {
    const deps = createDeps();

    await runCommitCommand(['--amend', '--intent', 'amend test'], deps);

    expect(deps.gitClient.commit).toHaveBeenCalledWith(
      'built message',
      { amend: true },
    );
  });

  it('should bypass Lore processing with --amend --no-edit', async () => {
    const deps = createDeps();

    await runCommitCommand(['--amend', '--no-edit'], deps);

    expect(deps.commitInputResolver.resolve).not.toHaveBeenCalled();
    expect(deps.commitBuilder.build).not.toHaveBeenCalled();
    expect(deps.commitBuilder.validate).not.toHaveBeenCalled();
    expect(deps.gitClient.commit).toHaveBeenCalledWith(
      '',
      { amend: true, noEdit: true },
    );
  });

  it('should throw when --no-edit is combined with --file', async () => {
    const deps = createDeps();
    await expect(
      runCommitCommand(['--amend', '--no-edit', '--file', 'input.json'], deps),
    ).rejects.toThrow('--no-edit keeps the existing message unchanged');
  });

  it('should throw when --no-edit is combined with --intent', async () => {
    const deps = createDeps();
    await expect(
      runCommitCommand(['--amend', '--no-edit', '--intent', 'new'], deps),
    ).rejects.toThrow('--no-edit keeps the existing message unchanged');
  });

  it('should throw when --no-edit is combined with --interactive', async () => {
    const deps = createDeps();
    await expect(
      runCommitCommand(['--amend', '--no-edit', '-i'], deps),
    ).rejects.toThrow('--no-edit keeps the existing message unchanged');
  });

  it('should throw when --no-edit is combined with --body', async () => {
    const deps = createDeps();
    await expect(
      runCommitCommand(['--amend', '--no-edit', '--body', 'some context'], deps),
    ).rejects.toThrow('--no-edit keeps the existing message unchanged');
  });

  it('should throw when --no-edit is combined with trailer flags', async () => {
    const deps = createDeps();
    await expect(
      runCommitCommand(['--amend', '--no-edit', '--constraint', 'must use X'], deps),
    ).rejects.toThrow('--no-edit keeps the existing message unchanged');
  });

  it('should throw when --no-edit is combined with enum trailer flags', async () => {
    const deps = createDeps();
    await expect(
      runCommitCommand(['--amend', '--no-edit', '--confidence', 'high'], deps),
    ).rejects.toThrow('--no-edit keeps the existing message unchanged');
  });

  it('should throw when --no-edit is combined with reference trailer flags', async () => {
    const deps = createDeps();
    await expect(
      runCommitCommand(['--amend', '--no-edit', '--related', 'abc12345'], deps),
    ).rejects.toThrow('--no-edit keeps the existing message unchanged');
  });

  it('should throw when --no-edit is used without --amend', async () => {
    const deps = createDeps();

    await expect(
      runCommitCommand(['--no-edit', '--intent', 'test'], deps),
    ).rejects.toThrow('--no-edit can only be used with --amend');
  });

  it(`should generate new ${LORE_ID_KEY} when amending a non-Lore commit`, async () => {
    const headLoreIdReader = createMockHeadLoreIdReader(null);
    const deps = createDeps({ headLoreIdReader });

    await runCommitCommand(['--amend', '--intent', 'amend non-lore'], deps);

    expect(headLoreIdReader.read).toHaveBeenCalledOnce();
    // null from reader -> undefined passed to build -> generates new ID
    expect(deps.commitBuilder.build).toHaveBeenCalledWith(
      expect.anything(),
      undefined,
    );
  });

  it(`should not read ${LORE_ID_KEY} from HEAD for normal commits`, async () => {
    const headLoreIdReader = createMockHeadLoreIdReader('cafebabe');
    const deps = createDeps({ headLoreIdReader });

    await runCommitCommand(['--intent', 'normal commit'], deps);

    expect(headLoreIdReader.read).not.toHaveBeenCalled();
    expect(deps.commitBuilder.build).toHaveBeenCalledWith(
      expect.anything(),
      undefined,
    );
  });

  it('should check staged changes for normal commits', async () => {
    const gitClient = createMockGitClient();
    const deps = createDeps({ gitClient });

    await runCommitCommand(['--intent', 'normal'], deps);

    expect(gitClient.hasStagedChanges).toHaveBeenCalledOnce();
  });
});
