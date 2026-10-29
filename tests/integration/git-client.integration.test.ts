import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { GitClient } from '../../src/services/git-client.js';

/**
 * Runs the real git binary against a throwaway repository in the OS temp
 * directory. Covers behaviour that cannot be asserted through a mocked
 * IGitClient: how git itself interprets the arguments GitClient builds.
 */

let root: string;
let env: NodeJS.ProcessEnv;
const hashes: Record<string, string> = {};

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, env, encoding: 'utf-8' });
}

function commit(file: string, message: string): string {
  const full = join(root, file);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, `${message}\n${Date.now()}\n`);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', message);
  return git(root, 'rev-parse', 'HEAD').trim();
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'lore-git-client-'));
  // Isolate from the developer's global config (signing, hooks, templates).
  const emptyConfig = join(root, '.empty-gitconfig');
  writeFileSync(emptyConfig, '');
  env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: emptyConfig,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Lore Test',
    GIT_AUTHOR_EMAIL: 'lore@example.com',
    GIT_COMMITTER_NAME: 'Lore Test',
    GIT_COMMITTER_EMAIL: 'lore@example.com',
  };
  git(root, 'init', '-q', '-b', 'main');

  hashes.initial = commit('README.md', 'chore: initial commit');
  hashes.atom = commit(
    'project/src/file.ts',
    'feat: first atom\n\nLore-id: aaaa1111\nConfidence: high',
  );
  hashes.noSpace = commit('project/src/other.ts', 'feat: no-space trailer\n\nLore-id:bbbb2222');
  hashes.bodyMention = commit(
    'project/src/file.ts',
    'docs: mentions an id in the body\n\nLore-id: cccc3333 appears here but this paragraph is not the trailer block.\n\nSigned-off-by: Lore Test <lore@example.com>',
  );
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('GitClient.log loreOnly pre-filter', () => {
  it('returns every commit without the option', async () => {
    const client = new GitClient(root);
    const commits = await client.log([]);
    expect(commits).toHaveLength(4);
  });

  it('skips commits with no Lore-id line and keeps trailers written without a space after the colon', async () => {
    const client = new GitClient(root);
    const commits = await client.log([], { loreOnly: true });
    const subjects = commits.map((c) => c.subject);

    expect(subjects).toContain('feat: first atom');
    expect(subjects).toContain('feat: no-space trailer');
    expect(subjects).not.toContain('chore: initial commit');
  });

  it('is only a coarse filter: a body mention is a candidate, but its trailer block has no Lore-id', async () => {
    const client = new GitClient(root);
    const commits = await client.log([], { loreOnly: true });
    const candidate = commits.find((c) => c.hash === hashes.bodyMention);

    expect(candidate).toBeDefined();
    expect(candidate!.trailers).not.toContain('Lore-id');
  });

  it('applies the pre-filter to the bulk file pass as well, so filesChanged stays populated', async () => {
    const client = new GitClient(root);
    const commits = await client.log([], { loreOnly: true });
    const atom = commits.find((c) => c.hash === hashes.atom);

    expect(atom!.filesChanged).toEqual(['project/src/file.ts']);
  });
});

describe('GitClient.countCommitsSince from a subdirectory (issue #60)', () => {
  it('counts commits touching a repository-relative path even when cwd is nested', async () => {
    // After hashes.atom, exactly one commit (bodyMention) touched project/src/file.ts.
    const fromRoot = new GitClient(root);
    const fromSubdir = new GitClient(join(root, 'project'));

    expect(await fromRoot.countCommitsSince('project/src/file.ts', hashes.atom)).toBe(1);
    expect(await fromSubdir.countCommitsSince('project/src/file.ts', hashes.atom)).toBe(1);
  });
});
