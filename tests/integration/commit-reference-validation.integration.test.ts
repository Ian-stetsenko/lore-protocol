import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Command } from 'commander';
import { registerCommitCommand } from '../../src/commands/commit.js';
import { GitClient } from '../../src/services/git-client.js';
import { TrailerParser } from '../../src/services/trailer-parser.js';
import { AtomRepository } from '../../src/services/atom-repository.js';
import { CommitBuilder } from '../../src/services/commit-builder.js';
import { LoreIdGenerator } from '../../src/services/lore-id-generator.js';
import { CommitInputResolver } from '../../src/services/commit-input-resolver.js';
import { HeadLoreIdReader } from '../../src/services/head-lore-id-reader.js';
import { JsonFormatter } from '../../src/formatters/json-formatter.js';
import { DEFAULT_CONFIG } from '../../src/types/config.js';
import { ValidationError } from '../../src/util/errors.js';
import type { IPrompt } from '../../src/interfaces/prompt.js';

/**
 * Real-git integration for the commit reference gate: a dangling trailer id
 * fails and creates nothing, then the corrected id and the --no-verify-refs
 * escape hatch each succeed. The command is instantiated with real services
 * (mirroring lore-id-shadowing.integration.test.ts), never spawned.
 *
 * Windows-safe: os.tmpdir for the scratch repository, separator-agnostic
 * joins, and a hermetic git environment (empty global config, fixed identity).
 */
const SEED_LORE_ID = 'feed1234';
const DANGLING_LORE_ID = '12345678';

/**
 * No-op prompt: Flags mode never reaches it, but the resolver constructor
 * requires one.
 */
const noopPrompt: IPrompt = {
  askText: async () => '',
  askMultiline: async () => '',
  askChoice: async <T extends string>(_message: string, choices: readonly T[]): Promise<T> =>
    choices[0],
  askConfirm: async () => false,
  close: () => {},
};

describe('lore commit reference validation (real git integration)', () => {
  let root: string;
  let env: Record<string, string>;
  let savedEnv: Record<string, string | undefined>;

  const git = (args: readonly string[]): string =>
    execFileSync('git', [...args], { cwd: root, env, encoding: 'utf-8' });

  /** Seed a plain git commit (write file, stage, commit) and return its hash. */
  const commitRaw = (file: string, message: string): string => {
    const full = join(root, file);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, 'seed content\n');
    git(['add', '-A']);
    git(['commit', '-q', '-m', message]);
    return git(['rev-parse', 'HEAD']).trim();
  };

  /** Stage a change without committing (leaves the index dirty for lore commit). */
  const stage = (file: string): void => {
    const full = join(root, file);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, 'change content\n');
    git(['add', '-A']);
  };

  /** Commit count via direct git, not Lore APIs (fail-creates-nothing assert). */
  const commitCount = (): number => Number(git(['rev-list', '--count', 'HEAD']).trim());

  /**
   * Run `lore commit` in-repo with real services. Fresh program per call: a
   * thrown ValidationError rejects parseAsync, and a program that has thrown
   * once is not reused. Success output is silenced; failures propagate.
   */
  const runLoreCommit = async (args: readonly string[]): Promise<void> => {
    const gitClient = new GitClient(root);
    const trailerParser = new TrailerParser();
    const deps = {
      commitBuilder: new CommitBuilder(trailerParser, new LoreIdGenerator(), DEFAULT_CONFIG),
      gitClient,
      getFormatter: () => new JsonFormatter(),
      commitInputResolver: new CommitInputResolver(noopPrompt),
      headLoreIdReader: new HeadLoreIdReader(gitClient, trailerParser),
      atomRepository: new AtomRepository(gitClient, trailerParser),
    };
    const program = new Command();
    registerCommitCommand(program, deps);
    const originalLog = console.log;
    console.log = () => {};
    try {
      await program.parseAsync(['node', 'lore', 'commit', ...args]);
    } finally {
      console.log = originalLog;
    }
  };

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'lore-commit-ref-validation-'));
    const emptyConfig = join(root, 'empty-gitconfig');
    writeFileSync(emptyConfig, '');
    env = {
      ...process.env,
      GIT_CONFIG_GLOBAL: emptyConfig,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'Lore Test',
      GIT_AUTHOR_EMAIL: 'lore@example.com',
      GIT_COMMITTER_NAME: 'Lore Test',
      GIT_COMMITTER_EMAIL: 'lore@example.com',
    } as Record<string, string>;
    // GitClient.exec inherits process.env (only cwd is pinned), so the same
    // hermetic identity must hold for lore-driven commits too.
    savedEnv = {
      GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL,
      GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM,
      GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME,
      GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL,
      GIT_COMMITTER_NAME: process.env.GIT_COMMITTER_NAME,
      GIT_COMMITTER_EMAIL: process.env.GIT_COMMITTER_EMAIL,
    };
    Object.assign(process.env, {
      GIT_CONFIG_GLOBAL: emptyConfig,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'Lore Test',
      GIT_AUTHOR_EMAIL: 'lore@example.com',
      GIT_COMMITTER_NAME: 'Lore Test',
      GIT_COMMITTER_EMAIL: 'lore@example.com',
    });
    git(['init', '-q', '-b', 'main']);
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    rmSync(root, { recursive: true, force: true });
  });

  it('drives the whole story: dangling id fails creating nothing, corrected id and escape hatch succeed', async () => {
    // (1) Seed one lore-bearing atom; its Lore-id is the citable target.
    commitRaw(
      'seed.md',
      `feat: seed the original decision\n\nBody for the seed atom.\n\nLore-id: ${SEED_LORE_ID}\nConfidence: high\n`,
    );
    const seededMessage = git(['log', '-1', '--format=%B']);
    expect(seededMessage).toContain(`Lore-id: ${SEED_LORE_ID}`);
    const seedCount = commitCount();
    expect(seedCount).toBe(1);

    // (2) A dangling reference id fails the lore commit and creates nothing:
    // the commit count (direct git) is unchanged.
    stage('change-a.txt');
    await expect(
      runLoreCommit(['--intent', 'docs: cite the seeded decision', '--supersedes', DANGLING_LORE_ID]),
    ).rejects.toThrow(ValidationError);
    expect(commitCount()).toBe(seedCount);

    // (3) The corrected id resolves and the commit succeeds.
    await runLoreCommit([
      '--intent',
      'docs: cite the seeded decision',
      '--supersedes',
      SEED_LORE_ID,
    ]);
    expect(commitCount()).toBe(seedCount + 1);

    // (4) The escape hatch commits despite the dangling id.
    stage('change-b.txt');
    await runLoreCommit([
      '--intent',
      'docs: bypass the reference gate',
      '--supersedes',
      DANGLING_LORE_ID,
      '--no-verify-refs',
    ]);
    expect(commitCount()).toBe(seedCount + 2);
  });
});
