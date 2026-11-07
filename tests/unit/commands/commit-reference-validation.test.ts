import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerCommitCommand } from '../../../src/commands/commit.js';
import { ValidationError, GitError } from '../../../src/util/errors.js';
import { CommitBuilder } from '../../../src/services/commit-builder.js';
import { JsonFormatter } from '../../../src/formatters/json-formatter.js';
import { AtomRepository } from '../../../src/services/atom-repository.js';
import { TrailerParser } from '../../../src/services/trailer-parser.js';
import { CommitInputResolver } from '../../../src/services/commit-input-resolver.js';
import { PROMPT_STRINGS } from '../../../src/util/constants.js';
import type { CommitInput } from '../../../src/services/commit-builder.js';
import type { LoreIdGenerator } from '../../../src/services/lore-id-generator.js';
import { DEFAULT_CONFIG } from '../../../src/types/config.js';
import type { IGitClient } from '../../../src/interfaces/git-client.js';
import type { IOutputFormatter } from '../../../src/interfaces/output-formatter.js';
import type { HeadLoreIdReader } from '../../../src/services/head-lore-id-reader.js';
import type { LoreAtom, LoreId } from '../../../src/types/domain.js';
import type { IPrompt } from '../../../src/interfaces/prompt.js';
import { CustomTrailerCollection } from '../../../src/types/custom-trailer-collection.js';

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

/**
 * Real CommitBuilder whose validate() exercises the production reference
 * format rules (the hint sentences live there); collaborators are inert
 * because validate() never touches them.
 */
function createRealValidatingBuilder(): CommitBuilder {
  const inertParser = { serialize: vi.fn(() => '') } as unknown as TrailerParser;
  const inertGenerator = { generate: vi.fn(() => 'a1b2c3d4') } as unknown as LoreIdGenerator;
  return new CommitBuilder(inertParser, inertGenerator, DEFAULT_CONFIG);
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

function makeAtom(loreId: LoreId): LoreAtom {
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
      Related: [],
      custom: CustomTrailerCollection.empty(),
    },
    filesChanged: [],
  };
}

function createMockAtomRepository(): AtomRepository {
  return {
    findByLoreId: vi.fn(async () => null),
    getLoreIdIndex: vi.fn(async () => new Map<LoreId, LoreAtom>()),
    resolveReferenceIds: vi.fn(async () => new Map<LoreId, LoreAtom | null>()),
    findNearMatchIds: vi.fn(async () => [] as LoreId[]),
  } as unknown as AtomRepository;
}

/**
 * Build resolved input citing one reference id under the given trailer key,
 * mirroring what FlagsInputReader produces for the matching CLI flags.
 */
function withReference(
  trailerKey: 'Supersedes' | 'Depends-on' | 'Related',
  ids: readonly string[],
): CommitInput {
  const intent = 'test commit';
  switch (trailerKey) {
    case 'Supersedes':
      return { intent, trailers: { Supersedes: [...ids] } };
    case 'Depends-on':
      return { intent, trailers: { 'Depends-on': [...ids] } };
    case 'Related':
      return { intent, trailers: { Related: [...ids] } };
  }
}

async function runCommitCommand(
  args: string[],
  deps: ReturnType<typeof createDeps>,
): Promise<void> {
  const program = new Command();
  program.exitOverride();
  registerCommitCommand(program, deps);
  await program.parseAsync(['node', 'lore', 'commit', ...args]);
}

function createDeps(overrides?: {
  gitClient?: IGitClient;
  atomRepository?: AtomRepository;
  resolvedInput?: CommitInput;
  commitBuilder?: CommitBuilder;
  /** Formatter instance the command renders through (assert on its calls). */
  formatter?: IOutputFormatter;
  /** Resolver override: inject a real CommitInputResolver over a mock prompt. */
  commitInputResolver?: CommitInputResolver;
}) {
  return {
    commitBuilder: overrides?.commitBuilder ?? createMockCommitBuilder(),
    gitClient: overrides?.gitClient ?? createMockGitClient(),
    getFormatter: () => overrides?.formatter ?? createMockFormatter(),
    commitInputResolver:
      overrides?.commitInputResolver ??
      createMockInputResolver(overrides?.resolvedInput ?? { intent: 'test commit' }),
    headLoreIdReader: createMockHeadLoreIdReader(),
    atomRepository: overrides?.atomRepository ?? createMockAtomRepository(),
  };
}

/**
 * Run the command expecting failure; assert the ValidationError vehicle
 * (exit code 1, issues carried to the stderr renderer in main.ts) and
 * return the error for issue-level assertions.
 */
async function runCommitExpectingError(
  args: string[],
  deps: ReturnType<typeof createDeps>,
): Promise<ValidationError> {
  const error: unknown = await runCommitCommand(args, deps).then(
    () => {
      throw new Error('expected lore commit to fail, but it succeeded');
    },
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ValidationError);
  return error as ValidationError;
}

const REFERENCE_CASES = [
  { flag: '--supersedes', trailerKey: 'Supersedes' },
  { flag: '--depends-on', trailerKey: 'Depends-on' },
  { flag: '--related', trailerKey: 'Related' },
] as const;

describe('lore commit reference validation', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it.each(REFERENCE_CASES)(
    '$trailerKey citing an unresolvable id exits 1, creates nothing, and the pair appears in the issues',
    async ({ flag, trailerKey }) => {
      const atomRepository = createMockAtomRepository();
      vi.mocked(atomRepository.resolveReferenceIds).mockResolvedValue(
        new Map<LoreId, LoreAtom | null>([['deadbeef', null]]),
      );
      const deps = createDeps({
        atomRepository,
        resolvedInput: withReference(trailerKey, ['deadbeef']),
      });

      const error = await runCommitExpectingError([flag, 'deadbeef'], deps);

      expect(error.exitCode).toBe(1);
      // Pair presence only (trailer name + id); never full-message equality.
      expect(
        error.issues.some(
          (issue) =>
            issue.severity === 'error' &&
            issue.message.includes(trailerKey) &&
            issue.message.includes('deadbeef'),
        ),
      ).toBe(true);
      // Creates nothing: the gate throws before the builder or git run.
      expect(deps.gitClient.commit).not.toHaveBeenCalled();
      expect(deps.commitBuilder.build).not.toHaveBeenCalled();
    },
  );

  it('succeeds identically to today when every reference id resolves', async () => {
    const atomRepository = createMockAtomRepository();
    vi.mocked(atomRepository.resolveReferenceIds).mockResolvedValue(
      new Map<LoreId, LoreAtom | null>([
        ['aaaa1111', makeAtom('aaaa1111')],
        ['bbbb2222', makeAtom('bbbb2222')],
      ]),
    );
    const deps = createDeps({
      atomRepository,
      resolvedInput: {
        intent: 'test commit',
        trailers: { Supersedes: ['aaaa1111'], Related: ['bbbb2222'] },
      },
    });

    await runCommitCommand(['--supersedes', 'aaaa1111', '--related', 'bbbb2222'], deps);

    expect(atomRepository.resolveReferenceIds).toHaveBeenCalledTimes(1);
    expect(atomRepository.resolveReferenceIds).toHaveBeenCalledWith(['aaaa1111', 'bbbb2222']);
    expect(deps.gitClient.commit).toHaveBeenCalledWith('built message', undefined);
    expect(deps.gitClient.commit).toHaveBeenCalledTimes(1);
  });

  it('passes an id that resolves only on a non-HEAD ref, matching trace semantics', async () => {
    // The repository seam reports the id as resolved through the shared
    // all-refs index even though HEAD history lacks it (HEAD-preferred
    // index semantics are pinned in the atom-repository suite).
    const atomRepository = createMockAtomRepository();
    vi.mocked(atomRepository.resolveReferenceIds).mockResolvedValue(
      new Map<LoreId, LoreAtom | null>([['cccc3333', makeAtom('cccc3333')]]),
    );
    const deps = createDeps({
      atomRepository,
      resolvedInput: withReference('Depends-on', ['cccc3333']),
    });

    await runCommitCommand(['--depends-on', 'cccc3333'], deps);

    expect(deps.gitClient.commit).toHaveBeenCalledTimes(1);
  });

  it('never calls the repository when the commit has no reference ids', async () => {
    const atomRepository = createMockAtomRepository();
    const deps = createDeps({ atomRepository });

    await runCommitCommand(['--intent', 'plain commit'], deps);

    expect(atomRepository.resolveReferenceIds).not.toHaveBeenCalled();
    expect(atomRepository.findNearMatchIds).not.toHaveBeenCalled();
    expect(atomRepository.getLoreIdIndex).not.toHaveBeenCalled();
    expect(atomRepository.findByLoreId).not.toHaveBeenCalled();
    expect(deps.gitClient.commit).toHaveBeenCalledTimes(1);
  });

  it('skips resolution for pattern-invalid reference ids (format gate owns them)', async () => {
    const atomRepository = createMockAtomRepository();
    const deps = createDeps({
      atomRepository,
      resolvedInput: withReference('Supersedes', ['zzzzzzzz']),
    });

    await runCommitCommand(['--supersedes', 'zzzzzzzz'], deps);

    expect(atomRepository.resolveReferenceIds).not.toHaveBeenCalled();
    expect(deps.gitClient.commit).toHaveBeenCalledTimes(1);
  });

  it('bypasses the repository on the --amend --no-edit path', async () => {
    const atomRepository = createMockAtomRepository();
    const deps = createDeps({ atomRepository });

    await runCommitCommand(['--amend', '--no-edit'], deps);

    expect(atomRepository.resolveReferenceIds).not.toHaveBeenCalled();
    expect(atomRepository.getLoreIdIndex).not.toHaveBeenCalled();
    expect(deps.gitClient.commit).toHaveBeenCalledWith('', { amend: true, noEdit: true });
  });

  it('reports one issue per trailer-id pair, not per id', async () => {
    const atomRepository = createMockAtomRepository();
    vi.mocked(atomRepository.resolveReferenceIds).mockResolvedValue(
      new Map<LoreId, LoreAtom | null>([['deadbeef', null]]),
    );
    const deps = createDeps({
      atomRepository,
      resolvedInput: {
        intent: 'test commit',
        trailers: { Supersedes: ['deadbeef'], Related: ['deadbeef'] },
      },
    });

    const error = await runCommitExpectingError(
      ['--supersedes', 'deadbeef', '--related', 'deadbeef'],
      deps,
    );

    const refIssues = error.issues.filter((issue) => issue.message.includes('deadbeef'));
    expect(refIssues).toHaveLength(2);
    expect(refIssues.some((issue) => issue.message.includes('Supersedes'))).toBe(true);
    expect(refIssues.some((issue) => issue.message.includes('Related'))).toBe(true);
    expect(refIssues.every((issue) => issue.rule === 'reference-resolves')).toBe(true);
  });

  it('fails when any reference id is unresolvable, reporting only the failing pairs', async () => {
    const atomRepository = createMockAtomRepository();
    vi.mocked(atomRepository.resolveReferenceIds).mockResolvedValue(
      new Map<LoreId, LoreAtom | null>([
        ['aaaa1111', makeAtom('aaaa1111')],
        ['deadbeef', null],
      ]),
    );
    const deps = createDeps({
      atomRepository,
      resolvedInput: {
        intent: 'test commit',
        trailers: { Supersedes: ['aaaa1111'], Related: ['deadbeef'] },
      },
    });

    const error = await runCommitExpectingError(
      ['--supersedes', 'aaaa1111', '--related', 'deadbeef'],
      deps,
    );

    expect(error.issues).toHaveLength(1);
    expect(error.issues[0].message.includes('Related')).toBe(true);
    expect(error.issues[0].message.includes('deadbeef')).toBe(true);
    expect(deps.gitClient.commit).not.toHaveBeenCalled();
  });

  it('fails once with both classes when format and reference issues coexist', async () => {
    const atomRepository = createMockAtomRepository();
    vi.mocked(atomRepository.resolveReferenceIds).mockResolvedValue(
      new Map<LoreId, LoreAtom | null>([['deadbeef', null]]),
    );
    const deps = createDeps({
      atomRepository,
      resolvedInput: {
        intent: 'test commit',
        trailers: { Supersedes: ['deadbeef', 'zzzzzzzz'] },
      },
    });
    vi.mocked(deps.commitBuilder.validate).mockReturnValue([
      {
        severity: 'error',
        rule: 'invalid-lore-id-ref',
        message: 'Invalid Lore-id reference in Supersedes: "zzzzzzzz". Must be 8-character hex.',
      },
    ]);

    const error = await runCommitExpectingError(
      ['--supersedes', 'deadbeef', '--supersedes', 'zzzzzzzz'],
      deps,
    );

    expect(error.issues).toHaveLength(2);
    const formatIssues = error.issues.filter((issue) => issue.rule === 'invalid-lore-id-ref');
    const referenceIssues = error.issues.filter((issue) => issue.rule === 'reference-resolves');
    expect(formatIssues).toHaveLength(1);
    expect(formatIssues[0].message.includes('zzzzzzzz')).toBe(true);
    expect(referenceIssues).toHaveLength(1);
    expect(referenceIssues[0].message.includes('Supersedes')).toBe(true);
    expect(referenceIssues[0].message.includes('deadbeef')).toBe(true);
    expect(deps.commitBuilder.build).not.toHaveBeenCalled();
    expect(deps.gitClient.commit).not.toHaveBeenCalled();
  });

  it('resolves references after format validation and before the build', async () => {
    const atomRepository = createMockAtomRepository();
    vi.mocked(atomRepository.resolveReferenceIds).mockResolvedValue(
      new Map<LoreId, LoreAtom | null>([['aaaa1111', makeAtom('aaaa1111')]]),
    );
    const deps = createDeps({
      atomRepository,
      resolvedInput: withReference('Supersedes', ['aaaa1111']),
    });

    await runCommitCommand(['--supersedes', 'aaaa1111'], deps);

    const [validateOrder] = vi.mocked(deps.commitBuilder.validate).mock.invocationCallOrder;
    const [resolveOrder] = vi.mocked(atomRepository.resolveReferenceIds).mock.invocationCallOrder;
    const [buildOrder] = vi.mocked(deps.commitBuilder.build).mock.invocationCallOrder;
    expect(validateOrder).toBeLessThan(resolveOrder);
    expect(resolveOrder).toBeLessThan(buildOrder);
    expect(atomRepository.findNearMatchIds).not.toHaveBeenCalled();
    expect(deps.gitClient.commit).toHaveBeenCalledTimes(1);
  });

  it.each(['abc1234', 'abc123456', '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'])(
    'hints a pure-hex id (%s) with the git-hash sentence',
    async (id) => {
      const atomRepository = createMockAtomRepository();
      const deps = createDeps({
        atomRepository,
        commitBuilder: createRealValidatingBuilder(),
        resolvedInput: withReference('Supersedes', [id]),
      });

      const error = await runCommitExpectingError(['--supersedes', id], deps);

      expect(error.issues).toHaveLength(1);
      expect(error.issues[0].rule).toBe('invalid-lore-id-ref');
      expect(error.issues[0].message).toContain(
        'this looks like a git commit hash; Lore-ids are 8-character lowercase hex',
      );
      expect(atomRepository.resolveReferenceIds).not.toHaveBeenCalled();
    },
  );

  it.each(['DEADBEEF', 'AbCdEf12'])(
    'hints an exactly-8-hex id (%s) with the lowercase sentence',
    async (id) => {
      const atomRepository = createMockAtomRepository();
      const deps = createDeps({
        atomRepository,
        commitBuilder: createRealValidatingBuilder(),
        resolvedInput: withReference('Supersedes', [id]),
      });

      const error = await runCommitExpectingError(['--supersedes', id], deps);

      expect(error.issues).toHaveLength(1);
      expect(error.issues[0].rule).toBe('invalid-lore-id-ref');
      expect(error.issues[0].message).toContain('Lore-ids are lowercase hex');
      expect(error.issues[0].message).not.toContain('git commit hash');
      expect(atomRepository.resolveReferenceIds).not.toHaveBeenCalled();
    },
  );

  it.each(['zzzzzzzz', '1234567z', 'abcdefgh9'])(
    'carries no hint for other invalid shapes (%s)',
    async (id) => {
      const deps = createDeps({
        commitBuilder: createRealValidatingBuilder(),
        resolvedInput: withReference('Supersedes', [id]),
      });

      const error = await runCommitExpectingError(['--supersedes', id], deps);

      expect(error.issues).toHaveLength(1);
      expect(error.issues[0].rule).toBe('invalid-lore-id-ref');
      expect(error.issues[0].message).toContain(id);
      expect(error.issues[0].message).not.toContain('Hint');
      expect(error.issues[0].message).not.toContain('git commit hash');
      expect(error.issues[0].message).not.toContain('lowercase hex');
    },
  );

  it('reports each identical trailer-id pair exactly once', async () => {
    const atomRepository = createMockAtomRepository();
    vi.mocked(atomRepository.resolveReferenceIds).mockResolvedValue(
      new Map<LoreId, LoreAtom | null>([['deadbeef', null]]),
    );
    const deps = createDeps({
      atomRepository,
      resolvedInput: withReference('Supersedes', ['deadbeef', 'deadbeef']),
    });

    const error = await runCommitExpectingError(
      ['--supersedes', 'deadbeef', '--supersedes', 'deadbeef'],
      deps,
    );

    const refIssues = error.issues.filter((issue) => issue.message.includes('deadbeef'));
    expect(refIssues).toHaveLength(1);
    expect(refIssues[0].rule).toBe('reference-resolves');
    expect(atomRepository.resolveReferenceIds).toHaveBeenCalledTimes(1);
    expect(atomRepository.resolveReferenceIds).toHaveBeenCalledWith(['deadbeef']);
  });

  it('fails identically when the reference id arrives via a JSON input file', async () => {
    const createUnresolvableRepo = (): AtomRepository => {
      const repo = createMockAtomRepository();
      vi.mocked(repo.resolveReferenceIds).mockResolvedValue(
        new Map<LoreId, LoreAtom | null>([['deadbeef', null]]),
      );
      return repo;
    };
    const flagDeps = createDeps({
      atomRepository: createUnresolvableRepo(),
      resolvedInput: withReference('Supersedes', ['deadbeef']),
    });
    const fileDeps = createDeps({
      atomRepository: createUnresolvableRepo(),
      resolvedInput: withReference('Supersedes', ['deadbeef']),
    });

    const flagError = await runCommitExpectingError(['--supersedes', 'deadbeef'], flagDeps);
    const fileError = await runCommitExpectingError(['--file', 'commit-input.json'], fileDeps);

    expect(vi.mocked(fileDeps.commitInputResolver.resolve)).toHaveBeenCalledTimes(1);
    expect(fileError.message).toBe(flagError.message);
    expect(fileError.exitCode).toBe(flagError.exitCode);
    expect(fileError.issues).toHaveLength(flagError.issues.length);
    expect(fileError.issues[0].rule).toBe('reference-resolves');
    expect(fileError.issues[0].message).toBe(flagError.issues[0].message);
    expect(fileError.issues[0].message).toContain('deadbeef');
  });

  it('renders the merged issues structurally in JSON output mode', async () => {
    const atomRepository = createMockAtomRepository();
    vi.mocked(atomRepository.resolveReferenceIds).mockResolvedValue(
      new Map<LoreId, LoreAtom | null>([['deadbeef', null]]),
    );
    const deps = createDeps({
      atomRepository,
      resolvedInput: {
        intent: 'test commit',
        trailers: { Supersedes: ['deadbeef', 'zzzzzzzz'] },
      },
    });
    vi.mocked(deps.commitBuilder.validate).mockReturnValue([
      {
        severity: 'error',
        rule: 'invalid-lore-id-ref',
        message: 'Invalid Lore-id reference in Supersedes: "zzzzzzzz". Must be 8-character hex.',
      },
    ]);

    const error = await runCommitExpectingError(
      ['--supersedes', 'deadbeef', '--supersedes', 'zzzzzzzz'],
      deps,
    );

    // Mirror the main.ts ValidationError rendering path: issues map to
    // severity+message and flow through the JSON error formatter.
    const messages = error.issues.map((issue) => ({
      severity: issue.severity,
      message: issue.message,
    }));
    const payload = JSON.parse(new JsonFormatter().formatError(error.exitCode, messages));

    expect(payload.error).toBe(true);
    expect(payload.code).toBe(1);
    expect(payload.messages).toHaveLength(2);
    expect(payload.messages.every((m: { severity: string }) => m.severity === 'error')).toBe(true);
    expect(
      payload.messages.some(
        (m: { message: string }) => m.message.includes('zzzzzzzz') && m.message.includes('Supersedes'),
      ),
    ).toBe(true);
    expect(
      payload.messages.some(
        (m: { message: string }) => m.message.includes('deadbeef') && m.message.includes('resolves on no ref'),
      ),
    ).toBe(true);
  });

  it('appends near-match candidates to the resolution error', async () => {
    const atomRepository = createMockAtomRepository();
    vi.mocked(atomRepository.resolveReferenceIds).mockResolvedValue(
      new Map<LoreId, LoreAtom | null>([['deadbeef', null]]),
    );
    vi.mocked(atomRepository.findNearMatchIds).mockResolvedValue(['aaaa1111', 'bbbb2222']);
    const deps = createDeps({
      atomRepository,
      resolvedInput: withReference('Supersedes', ['deadbeef']),
    });

    const error = await runCommitExpectingError(['--supersedes', 'deadbeef'], deps);

    const refIssue = error.issues.find(
      (issue) => issue.rule === 'reference-resolves' && issue.message.includes('deadbeef'),
    );
    expect(refIssue).toBeDefined();
    expect(refIssue?.message).toContain('aaaa1111');
    expect(refIssue?.message).toContain('bbbb2222');
    expect(atomRepository.findNearMatchIds).toHaveBeenCalledTimes(1);
    expect(atomRepository.findNearMatchIds).toHaveBeenCalledWith('deadbeef');
  });
});

/**
 * Counting mock prompt for the interactive path: collects a valid intent,
 * declines everything except one Supersedes id ('deadbeef'), and exposes
 * the vi.fn handles so prompt-call counts are observable across time.
 * The real CommitInputResolver runs against it, so the interactive
 * collection flow is the production one.
 */
function createUnresolvableInteractivePrompt(): {
  readonly prompt: IPrompt;
  readonly askText: ReturnType<typeof vi.fn>;
  readonly askConfirm: ReturnType<typeof vi.fn>;
  readonly askMultiline: ReturnType<typeof vi.fn>;
  readonly askChoice: ReturnType<typeof vi.fn>;
  readonly close: ReturnType<typeof vi.fn>;
} {
  const askText = vi.fn(async (message: string): Promise<string> =>
    message === PROMPT_STRINGS.SUPERSEDES_INPUT ? 'deadbeef' : 'interactive intent',
  );
  let supersedesCollected = false;
  const askConfirm = vi.fn(async (message: string): Promise<boolean> => {
    if (message === PROMPT_STRINGS.ADD_SUPERSEDES && !supersedesCollected) {
      supersedesCollected = true;
      return true; // accept one Supersedes id, then decline the re-ask
    }
    return false; // decline body and every other trailer collector
  });
  const askMultiline = vi.fn(async (): Promise<string> => '');
  const askChoice = vi.fn(
    async <T extends string>(_message: string, choices: readonly T[]): Promise<T> => choices[0],
  );
  const close = vi.fn((): void => {});
  return {
    prompt: { askText, askConfirm, askMultiline, askChoice, close },
    askText,
    askConfirm,
    askMultiline,
    askChoice,
    close,
  };
}

/**
 * Mock IGitClient shaped like a fresh repository with an unborn HEAD:
 * resolveRef('HEAD') rejects, and every log pass returns no commits.
 */
function createUnbornHeadGitClient(): IGitClient {
  const gitClient = createMockGitClient();
  vi.mocked(gitClient.resolveRef).mockRejectedValue(
    new GitError("git rev-parse failed: fatal: ambiguous argument 'HEAD'"),
  );
  vi.mocked(gitClient.log).mockResolvedValue([]);
  return gitClient;
}

describe('lore commit reference validation robustness', () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('skips validation with a pinned warning and commits when the Lore-id index cannot be built', async () => {
    const formatter = createMockFormatter();
    const atomRepository = createMockAtomRepository();
    vi.mocked(atomRepository.resolveReferenceIds).mockRejectedValue(
      new GitError('git log failed: transient index build failure'),
    );
    const deps = createDeps({
      atomRepository,
      resolvedInput: withReference('Supersedes', ['deadbeef']),
      formatter,
    });

    await runCommitCommand(['--supersedes', 'deadbeef'], deps);

    // "Could not check" is distinct from "check failed": one pinned warning
    // through the formatter to stderr, then the commit proceeds.
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(formatter.formatError).toHaveBeenCalledTimes(1);
    const [code, messages] = vi.mocked(formatter.formatError).mock.calls[0];
    expect(code).toBe(0);
    expect(messages).toEqual([
      {
        severity: 'warning',
        message: 'validation skipped: the Lore-id index could not be built',
      },
    ]);
    expect(deps.commitBuilder.build).toHaveBeenCalledTimes(1);
    expect(deps.gitClient.commit).toHaveBeenCalledTimes(1);
    // The near-match pass never runs after the index build failed.
    expect(atomRepository.findNearMatchIds).not.toHaveBeenCalled();
  });

  it('does not swallow non-git failures raised while checking references', async () => {
    const formatter = createMockFormatter();
    const atomRepository = createMockAtomRepository();
    vi.mocked(atomRepository.resolveReferenceIds).mockRejectedValue(
      new ValidationError('unexpected', [
        { severity: 'error', rule: 'reference-resolves', message: 'upstream issue' },
      ]),
    );
    const deps = createDeps({
      atomRepository,
      resolvedInput: withReference('Supersedes', ['deadbeef']),
      formatter,
    });

    // Only GitError is treated as "could not check"; everything else fails loudly.
    await expect(runCommitCommand(['--supersedes', 'deadbeef'], deps)).rejects.toThrow(
      ValidationError,
    );
    expect(formatter.formatError).not.toHaveBeenCalled();
    expect(deps.gitClient.commit).not.toHaveBeenCalled();
  });

  it('errors after interactive collection ends on an unresolvable id, without replaying the session', async () => {
    const interactive = createUnresolvableInteractivePrompt();
    const atomRepository = createMockAtomRepository();
    vi.mocked(atomRepository.resolveReferenceIds).mockResolvedValue(
      new Map<LoreId, LoreAtom | null>([['deadbeef', null]]),
    );
    const deps = createDeps({
      atomRepository,
      commitInputResolver: new CommitInputResolver(interactive.prompt),
    });

    // Collection runs to completion (--interactive), then the batched gate
    // throws after the session ends.
    const error = await runCommitExpectingError(['--interactive'], deps);

    const refIssue = error.issues.find((issue) => issue.rule === 'reference-resolves');
    expect(refIssue).toBeDefined();
    expect(refIssue?.message).toContain('Supersedes');
    expect(refIssue?.message).toContain('deadbeef');
    expect(deps.gitClient.commit).not.toHaveBeenCalled();

    // The session ran exactly once: close() called once by the reader's
    // finally, and prompt-call counts stay unchanged after the error
    // surfaces (no replay or retry loop re-asks anything).
    expect(interactive.close).toHaveBeenCalledTimes(1);
    const promptCounts = () => ({
      text: interactive.askText.mock.calls.length,
      confirm: interactive.askConfirm.mock.calls.length,
      multiline: interactive.askMultiline.mock.calls.length,
      choice: interactive.askChoice.mock.calls.length,
    });
    const atError = promptCounts();
    expect(atError.confirm).toBeGreaterThan(0); // collection really happened
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(promptCounts()).toEqual(atError);
  });

  it('fails a first-ever lore commit citing any reference id through the unborn-HEAD path', async () => {
    // Real AtomRepository over a mock IGitClient shaped like a fresh repo:
    // unborn HEAD makes the index build fall back to --all, which yields
    // an empty index, so every cited id resolves on no ref.
    const gitClient = createUnbornHeadGitClient();
    const atomRepository = new AtomRepository(gitClient, new TrailerParser());
    const deps = createDeps({
      gitClient,
      atomRepository,
      resolvedInput: withReference('Supersedes', ['deadbeef']),
    });

    const error = await runCommitExpectingError(['--supersedes', 'deadbeef'], deps);

    expect(
      error.issues.some(
        (issue) =>
          issue.rule === 'reference-resolves' &&
          issue.message.includes('deadbeef') &&
          issue.message.includes('Supersedes'),
      ),
    ).toBe(true);
    expect(deps.gitClient.commit).not.toHaveBeenCalled();
    expect(deps.commitBuilder.build).not.toHaveBeenCalled();
  });

  it('lets a first-ever lore commit proceed on unborn HEAD with --no-verify-refs', async () => {
    const gitClient = createUnbornHeadGitClient();
    const atomRepository = new AtomRepository(gitClient, new TrailerParser());
    const resolveSpy = vi.spyOn(atomRepository, 'resolveReferenceIds');
    const deps = createDeps({
      gitClient,
      atomRepository,
      resolvedInput: withReference('Supersedes', ['deadbeef']),
    });

    await runCommitCommand(['--supersedes', 'deadbeef', '--no-verify-refs'], deps);

    expect(deps.gitClient.commit).toHaveBeenCalledTimes(1);
    expect(resolveSpy).not.toHaveBeenCalled();
  });
});
