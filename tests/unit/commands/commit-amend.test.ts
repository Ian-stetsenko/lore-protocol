import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';
import { registerCommitCommand } from '../../../src/commands/commit.js';
import type { CommitBuilder, CommitInput } from '../../../src/services/commit-builder.js';
import type { IGitClient } from '../../../src/interfaces/git-client.js';
import type { IOutputFormatter } from '../../../src/interfaces/output-formatter.js';
import type { CommitInputResolver } from '../../../src/services/commit-input-resolver.js';
import type { HeadLoreIdReader } from '../../../src/services/head-lore-id-reader.js';
import type { AtomRepository } from '../../../src/services/atom-repository.js';

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
  };
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
    build: vi.fn().mockReturnValue({ message: 'built message', loreId: 'a1b2c3d4' }),
    validate: vi.fn().mockReturnValue([]),
  } as unknown as CommitBuilder;
}

function createMockInputResolver(input: CommitInput): CommitInputResolver {
  return {
    resolve: vi.fn().mockResolvedValue(input),
  } as unknown as CommitInputResolver;
}

function createMockHeadLoreIdReader(loreId: string | null = null): HeadLoreIdReader {
  return {
    read: vi.fn().mockResolvedValue(loreId),
  } as unknown as HeadLoreIdReader;
}

function createMockAtomRepository(): AtomRepository {
  return {
    findByLoreId: vi.fn(async () => null),
    getLoreIdIndex: vi.fn(async () => new Map()),
    resolveReferenceIds: vi.fn(async () => new Map()),
    findNearMatchIds: vi.fn(async () => []),
  } as unknown as AtomRepository;
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
  atomRepository?: AtomRepository;
  resolvedInput?: CommitInput;
}) {
  return {
    commitBuilder: createMockCommitBuilder(),
    gitClient: overrides?.gitClient ?? createMockGitClient(),
    getFormatter: () => createMockFormatter(),
    commitInputResolver: createMockInputResolver(
      overrides?.resolvedInput ?? { intent: 'test commit' },
    ),
    headLoreIdReader: overrides?.headLoreIdReader ?? createMockHeadLoreIdReader(),
    atomRepository: overrides?.atomRepository ?? createMockAtomRepository(),
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

  it('should pass existing Lore-id to commitBuilder.build when amending', async () => {
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

  it('should read Lore-id from HEAD even with --amend --no-edit', async () => {
    const headLoreIdReader = createMockHeadLoreIdReader('cafebabe');
    const deps = createDeps({ headLoreIdReader });

    await runCommitCommand(['--amend', '--no-edit'], deps);

    expect(headLoreIdReader.read).toHaveBeenCalledOnce();
  });

  it('should accept --amend --no-edit --no-verify-refs as a no-op', async () => {
    const deps = createDeps();

    await runCommitCommand(['--amend', '--no-edit', '--no-verify-refs'], deps);

    // verifyRefs is a non-input mode flag: its presence must not trip
    // the --no-edit conflicting-input check.
    expect(deps.commitInputResolver.resolve).not.toHaveBeenCalled();
    expect(deps.commitBuilder.validate).not.toHaveBeenCalled();
    expect(deps.commitBuilder.build).not.toHaveBeenCalled();
    expect(deps.atomRepository.resolveReferenceIds).not.toHaveBeenCalled();
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

  it('should generate new Lore-id when amending a non-Lore commit', async () => {
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

  it('should not read Lore-id from HEAD for normal commits', async () => {
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

  it('should report the staged-changes guard before reference validation when both would fail', async () => {
    const gitClient = createMockGitClient();
    vi.mocked(gitClient.hasStagedChanges).mockResolvedValue(false);
    const deps = createDeps({
      gitClient,
      resolvedInput: { intent: 'test commit', trailers: { Related: ['deadbeef'] } },
    });

    await expect(
      runCommitCommand(['--related', 'deadbeef'], deps),
    ).rejects.toThrow(
      'No staged changes. Stage files with `git add` before running `lore commit`.',
    );
    // The staged guard wins: the reference gate never runs.
    expect(deps.atomRepository.resolveReferenceIds).not.toHaveBeenCalled();
    expect(deps.gitClient.commit).not.toHaveBeenCalled();
  });

  describe('reference gate escape (--no-verify-refs)', () => {
    it('should commit despite unresolvable reference ids when --no-verify-refs is passed', async () => {
      // Default mock repository resolves nothing: deadbeef is unresolvable.
      const deps = createDeps({
        resolvedInput: { intent: 'test commit', trailers: { Related: ['deadbeef'] } },
      });

      await runCommitCommand(['--related', 'deadbeef', '--no-verify-refs'], deps);

      expect(deps.atomRepository.resolveReferenceIds).not.toHaveBeenCalled();
      expect(deps.gitClient.commit).toHaveBeenCalledWith('built message', undefined);
    });

    it('should keep reference validation active when --no-verify-refs is omitted', async () => {
      const deps = createDeps({
        resolvedInput: { intent: 'test commit', trailers: { Related: ['deadbeef'] } },
      });

      await expect(
        runCommitCommand(['--related', 'deadbeef'], deps),
      ).rejects.toThrow('Commit input validation failed');
      expect(deps.atomRepository.resolveReferenceIds).toHaveBeenCalledWith(['deadbeef']);
      expect(deps.gitClient.commit).not.toHaveBeenCalled();
    });

    it('should validate new reference trailers on amend with reference input', async () => {
      const deps = createDeps({
        resolvedInput: { intent: 'amend test', trailers: { Supersedes: ['deadbeef'] } },
      });

      await expect(
        runCommitCommand(['--amend', '--supersedes', 'deadbeef'], deps),
      ).rejects.toThrow('Commit input validation failed');
      expect(deps.atomRepository.resolveReferenceIds).toHaveBeenCalledWith(['deadbeef']);
      expect(deps.gitClient.commit).not.toHaveBeenCalled();
    });

    it('should commit on amend despite unresolvable ids when --no-verify-refs is passed', async () => {
      const deps = createDeps({
        resolvedInput: { intent: 'amend test', trailers: { Supersedes: ['deadbeef'] } },
      });

      await runCommitCommand(
        ['--amend', '--supersedes', 'deadbeef', '--no-verify-refs'],
        deps,
      );

      expect(deps.atomRepository.resolveReferenceIds).not.toHaveBeenCalled();
      expect(deps.gitClient.commit).toHaveBeenCalledWith('built message', { amend: true });
    });
  });
});
