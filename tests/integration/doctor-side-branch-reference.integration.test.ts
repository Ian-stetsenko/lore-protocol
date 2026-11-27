import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Command } from 'commander';
import { GitClient } from '../../src/services/git-client.js';
import { TrailerParser } from '../../src/services/trailer-parser.js';
import { AtomRepository } from '../../src/services/atom-repository.js';
import { registerDoctorCommand } from '../../src/commands/doctor.js';
import { SupersessionResolver } from '../../src/services/supersession-resolver.js';
import { JsonFormatter } from '../../src/formatters/json-formatter.js';

/**
 * Real-git end-to-end proof of the side-branch reference fix.
 *
 * The current branch carries an atom whose Related trailer points at a
 * Lore-id that exists only on another branch. Doctor's default scan is
 * branch-only, so the scanned atom set does not contain the referenced
 * id -- before the fix this produced a false 'broken reference' warning.
 * Resolution now goes through the shared all-refs Lore-id index, so the
 * reference check reports ok.
 */

let root: string;
let env: NodeJS.ProcessEnv;
const hashes: Record<string, string> = {};

function git(extraEnv: NodeJS.ProcessEnv, ...args: string[]): string {
  return execFileSync('git', args, { cwd: root, env: { ...env, ...extraEnv }, encoding: 'utf-8' });
}

function commit(file: string, message: string, extraEnv: NodeJS.ProcessEnv = {}): string {
  const full = join(root, file);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, `${message}\n${Date.now()}\n`);
  git(extraEnv, 'add', '-A');
  git(extraEnv, 'commit', '-q', '-m', message);
  return git({}, 'rev-parse', 'HEAD').trim();
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'lore-doctor-side-ref-'));
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
    GIT_AUTHOR_DATE: '2024-06-01T00:00:00Z',
    GIT_COMMITTER_DATE: '2024-06-01T00:00:00Z',
  };

  git({}, 'init', '-q', '-b', 'main');

  // Non-Lore base commit on main.
  commit('README.md', 'chore: initial commit');

  // Side branch carries the referenced atom (branch-only id 'bbbb2222').
  git({}, 'checkout', '-q', '-b', 'side-branch');
  hashes.referenced = commit(
    'side/referenced.md',
    'feat: referenced atom\n\nLore-id: bbbb2222\nConfidence: high',
  );

  // Back on main: an atom referencing the side-branch-only id.
  git({}, 'checkout', '-q', 'main');
  hashes.referencing = commit(
    'docs/referencing.md',
    'feat: referencing atom\n\nLore-id: aaaa1111\nRelated: bbbb2222\nConfidence: high',
  );
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function makeRepository(): AtomRepository {
  const client = new GitClient(root);
  const parser = new TrailerParser();
  return new AtomRepository(client, parser);
}

describe('lore doctor with a side-branch-only reference (real git)', () => {
  it('accepts the cross-branch reference under the default branch-only scan', async () => {
    // Setup validity: the referenced atom lives only off the default branch.
    const repo = makeRepository();
    const scanned = await repo.findAll({ maxCommits: 10000 });
    expect(scanned.some((atom) => atom.loreId === 'bbbb2222')).toBe(false);

    const outputs: string[] = [];
    const log = console.log;
    console.log = (out: string) => outputs.push(out);
    try {
      const program = new Command();
      registerDoctorCommand(program, {
        atomRepository: makeRepository(),
        configLoader: {
          loadForPath: async () => ({}),
          loadFromFile: async () => ({}),
          findConfigPath: async () => null,
        },
        getFormatter: () => new JsonFormatter(),
        supersessionResolver: new SupersessionResolver(),
      });
      await program.parseAsync(['node', 'lore', 'doctor']);
    } finally {
      console.log = log;
    }

    const checks: Array<{ name: string; status: string; message: string; details: string[] }> =
      JSON.parse(outputs.join('\n')).checks;
    const references = checks.find(
      (c) => c.name === 'Reference resolution (supersedes/depends-on)',
    );
    expect(references).toBeDefined();
    // The side-branch-only id resolves via the all-refs index: no false
    // 'broken reference' warning, no dangling detail.
    expect(references!.status).toBe('ok');
    expect(references!.message).toBe('All references resolve to existing atoms');
    expect(references!.details).toEqual([]);
    // Warnings do not touch the errors-only exit contract.
    expect(process.exitCode).toBeUndefined();
  });
});
