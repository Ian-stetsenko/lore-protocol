import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Command } from 'commander';
import { GitClient } from '../../src/services/git-client.js';
import { TrailerParser } from '../../src/services/trailer-parser.js';
import { AtomRepository } from '../../src/services/atom-repository.js';
import { registerTraceCommand } from '../../src/commands/trace.js';
import { registerDoctorCommand } from '../../src/commands/doctor.js';
import { JsonFormatter } from '../../src/formatters/json-formatter.js';

/**
 * Real-git reproduction of issue #57 (Lore-id poisoning).
 *
 * A future-dated commit on a side branch shares a Lore-id with a commit on
 * the current branch. `lore trace` must resolve to the HEAD-reachable atom,
 * `lore doctor` must stay silent by default, and `lore doctor --all` must
 * report the cross-ref duplicate. A Lore-id that exists only on a side
 * branch must still resolve via the --all fallback.
 */

let root: string;
let env: NodeJS.ProcessEnv;
const hashes: Record<string, string> = {};

function git(extraEnv: NodeJS.ProcessEnv, ...args: string[]): string {
  return execFileSync('git', args, { cwd: root, env: { ...env, ...extraEnv }, encoding: 'utf-8' });
}

function commit(
  file: string,
  message: string,
  extraEnv: NodeJS.ProcessEnv = {},
): string {
  const full = join(root, file);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, `${message}\n${Date.now()}\n`);
  git(extraEnv, 'add', '-A');
  git(extraEnv, 'commit', '-q', '-m', message);
  return git({}, 'rev-parse', 'HEAD').trim();
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'lore-id-shadowing-'));
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
    // Fixed past date for every commit unless overridden per commit.
    GIT_AUTHOR_DATE: '2024-06-01T00:00:00Z',
    GIT_COMMITTER_DATE: '2024-06-01T00:00:00Z',
  };

  git({}, 'init', '-q', '-b', 'main');

  // Non-Lore base commit on main.
  commit('README.md', 'chore: initial commit');

  // Side branch carries a future-dated poison atom sharing the Lore-id.
  git({}, 'checkout', '-q', '-b', 'poison-branch');
  hashes.poison = commit(
    'poison/decision.md',
    'feat: poison atom\n\nLore-id: deadbeef\nConfidence: high',
    {
      GIT_AUTHOR_DATE: '2030-01-01T00:00:00Z',
      GIT_COMMITTER_DATE: '2030-01-01T00:00:00Z',
    },
  );

  // Back on main: the legitimate atom with the same Lore-id, older date.
  git({}, 'checkout', '-q', 'main');
  hashes.legit = commit(
    'docs/decision.md',
    'feat: legit atom\n\nLore-id: deadbeef\nConfidence: high',
  );

  // Another side branch with a Lore-id that only exists off main.
  git({}, 'checkout', '-q', '-b', 'side-branch');
  hashes.side = commit(
    'side/decision.md',
    'feat: side atom\n\nLore-id: cafe1234\nConfidence: high',
  );

  // Final state: on main, both side branches ahead of it.
  git({}, 'checkout', '-q', 'main');
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function makeRepository(): AtomRepository {
  const client = new GitClient(root);
  const parser = new TrailerParser();
  return new AtomRepository(client, parser);
}

describe('lore trace with a poisoned Lore-id (issue #57)', () => {
  it('resolves the shared Lore-id to the HEAD-reachable atom, not the future-dated side branch', async () => {
    const repo = makeRepository();
    const atom = await repo.findByLoreId('deadbeef');

    expect(atom).not.toBeNull();
    expect(atom!.commitHash).toBe(hashes.legit);
    expect(atom!.intent).toBe('feat: legit atom');
  });

  it('prints the HEAD-reachable atom as the trace root', async () => {
    const outputs: string[] = [];
    const log = console.log;
    console.log = (out: string) => outputs.push(out);
    try {
      const program = new Command();
      registerTraceCommand(program, {
        atomRepository: makeRepository(),
        getFormatter: () => new JsonFormatter(),
      });
      await program.parseAsync(['node', 'lore', 'trace', 'deadbeef']);
    } finally {
      console.log = log;
    }

    const result = JSON.parse(outputs.join('\n'));
    expect(result.root.commit).toBe(hashes.legit);
    expect(result.root.intent).toBe('feat: legit atom');
  });

  it('still resolves a Lore-id that exists only on a side branch (fallback)', async () => {
    const repo = makeRepository();
    const atom = await repo.findByLoreId('cafe1234');

    expect(atom).not.toBeNull();
    expect(atom!.commitHash).toBe(hashes.side);
  });
});

describe('lore lookups on a fresh repository (unborn HEAD)', () => {
  it('return null and an empty index instead of failing', async () => {
    const fresh = mkdtempSync(join(tmpdir(), 'lore-id-fresh-'));
    try {
      execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: fresh, env, encoding: 'utf-8' });

      const repo = new AtomRepository(new GitClient(fresh), new TrailerParser());

      await expect(repo.findByLoreId('deadbeef')).resolves.toBeNull();
      expect((await repo.getLoreIdIndex()).size).toBe(0);
    } finally {
      rmSync(fresh, { recursive: true, force: true });
    }
  });
});

describe('lore doctor with a poisoned Lore-id (issue #57)', () => {
  function parseChecks(output: string): Array<{ name: string; status: string; details: string[] }> {
    return JSON.parse(output).checks;
  }

  it('stays silent about the duplicate by default (current branch only)', async () => {
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
      });
      await program.parseAsync(['node', 'lore', 'doctor']);
    } finally {
      console.log = log;
    }

    const uniqueness = parseChecks(outputs.join('\n')).find(
      (c) => c.name === 'Lore-id uniqueness',
    );
    expect(uniqueness).toBeDefined();
    expect(uniqueness!.status).toBe('ok');
    expect(uniqueness!.details).toEqual([]);
  });

  it('--all reports the Lore-id duplicated across refs', async () => {
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
      });
      await program.parseAsync(['node', 'lore', 'doctor', '--all']);
    } finally {
      console.log = log;
    }

    const uniqueness = parseChecks(outputs.join('\n')).find(
      (c) => c.name === 'Lore-id uniqueness (all refs)',
    );
    expect(uniqueness).toBeDefined();
    expect(uniqueness!.status).toBe('warning');
    expect(uniqueness!.details.some((d) => d.includes('deadbeef'))).toBe(true);
  });
});
