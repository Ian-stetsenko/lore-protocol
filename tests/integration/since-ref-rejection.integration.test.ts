import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { GitClient } from '../../src/services/git-client.js';
import { TrailerParser } from '../../src/services/trailer-parser.js';
import { AtomRepository } from '../../src/services/atom-repository.js';
import { LoreError } from '../../src/util/errors.js';

/**
 * Real-git integration for --since / --until ref rejection: git log's --since
 * silently ignores a ref, so AtomRepository resolves suspicious values with
 * rev-parse and rejects real refs, while every date form still reaches git.
 *
 * Windows-safe: os.tmpdir for the scratch repository, separator-agnostic
 * joins, and a hermetic git environment (empty global config, fixed identity).
 */
const HERMETIC_GIT_ENV = {
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Lore Test',
  GIT_AUTHOR_EMAIL: 'lore@example.com',
  GIT_COMMITTER_NAME: 'Lore Test',
  GIT_COMMITTER_EMAIL: 'lore@example.com',
} as const;

describe('--since / --until ref rejection (real git integration)', () => {
  let root: string;
  let env: Record<string, string>;
  let savedEnv: Record<string, string | undefined>;
  let repo: AtomRepository;

  const git = (args: readonly string[]): string =>
    execFileSync('git', [...args], { cwd: root, env, encoding: 'utf-8' });

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'lore-since-ref-rejection-'));
    const emptyConfig = join(root, 'empty-gitconfig');
    writeFileSync(emptyConfig, '');
    const gitEnv = { GIT_CONFIG_GLOBAL: emptyConfig, ...HERMETIC_GIT_ENV };
    env = { ...process.env, ...gitEnv } as Record<string, string>;
    // GitClient.exec inherits process.env (only cwd is pinned), so the same
    // hermetic config must hold for lore-driven git calls too.
    savedEnv = Object.fromEntries(Object.keys(gitEnv).map((key) => [key, process.env[key]]));
    Object.assign(process.env, gitEnv);

    git(['init', '-q', '-b', 'main']);
    writeFileSync(join(root, 'seed.md'), 'seed content\n');
    git(['add', 'seed.md']);
    git(['commit', '-q', '-m', 'feat: seed\n\nLore-id: feed1234\nConfidence: high\n']);
    git(['tag', 'v1.2']);

    const gitClient = new GitClient(root);
    repo = new AtomRepository(gitClient, new TrailerParser());
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

  it('rejects a tag passed to --since with exit code 1 and a date hint', async () => {
    const error = await repo.findAll({ since: 'v1.2' }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(LoreError);
    expect((error as LoreError).exitCode).toBe(1);
    expect((error as LoreError).message).toBe(
      '--since takes a date, but "v1.2" is a git ref. Pass a date such as 2026-01-31 or "2 weeks ago".',
    );
  });

  it('rejects a branch passed to --until', async () => {
    await expect(repo.findAll({ until: 'main' })).rejects.toThrow(
      '--until takes a date, but "main" is a git ref.',
    );
  });

  it.each(['2026-01-01', '2 weeks ago', 'yesterday', '2001', '1700000000'])(
    'accepts the date %j',
    async (since) => {
      await expect(repo.findAll({ since })).resolves.toBeInstanceOf(Array);
    },
  );

  it('still returns atoms for an accepted date', async () => {
    const atoms = await repo.findAll({ since: '2000-01-01' });

    expect(atoms.map((atom) => atom.loreId)).toEqual(['feed1234']);
  });
});
