import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerDoctorCommand } from '../../../src/commands/doctor.js';
import type { AtomRepository } from '../../../src/services/atom-repository.js';
import type { IConfigLoader } from '../../../src/interfaces/config-loader.js';
import type { LoreAtom, LoreId } from '../../../src/types/domain.js';
import { CustomTrailerCollection } from '../../../src/types/custom-trailer-collection.js';
import { JsonFormatter } from '../../../src/formatters/json-formatter.js';

/**
 * Doctor command wiring for issue #57: cross-ref Lore-id duplicates are
 * reported only with --all; the default stays current-branch only.
 */

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

function createMockConfigLoader(): IConfigLoader {
  return {
    loadForPath: vi.fn(async () => ({}) as Awaited<ReturnType<IConfigLoader['loadForPath']>>),
    loadFromFile: vi.fn(async () => ({}) as Awaited<ReturnType<IConfigLoader['loadFromFile']>>),
    findConfigPath: vi.fn(async () => null),
  };
}

async function runDoctor(
  atomRepository: AtomRepository,
  ...argv: string[]
): Promise<string> {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    const program = new Command();
    registerDoctorCommand(program, {
      atomRepository,
      configLoader: createMockConfigLoader(),
      getFormatter: () => new JsonFormatter(),
    });
    await program.parseAsync(['node', 'lore', 'doctor', ...argv]);
    return log.mock.calls.map((args) => args.join(' ')).join('\n');
  } finally {
    log.mockRestore();
  }
}

function parseChecks(output: string): Array<{ name: string; status: string; message: string; details: string[] }> {
  return JSON.parse(output).checks;
}

describe('doctor command', () => {
  let findAll: ReturnType<typeof vi.fn>;
  let atomRepository: AtomRepository;
  let originalExitCode: string | number | undefined;

  beforeEach(() => {
    originalExitCode = process.exitCode;
    findAll = vi.fn(async () => []);
    atomRepository = { findAll } as unknown as AtomRepository;
  });

  afterEach(() => {
    process.exitCode = originalExitCode;
  });

  it('scans only the current branch by default', async () => {
    const output = await runDoctor(atomRepository);

    expect(findAll).toHaveBeenCalledTimes(1);
    expect(findAll).toHaveBeenCalledWith({ maxCommits: 10000 });
    const uniqueness = parseChecks(output).find((c) => c.name.startsWith('Lore-id uniqueness'));
    expect(uniqueness).toBeDefined();
    expect(uniqueness!.name).toBe('Lore-id uniqueness');
    expect(uniqueness!.status).toBe('ok');
  });

  it('--all scans every ref and reports cross-ref duplicate Lore-ids (issue #57)', async () => {
    findAll.mockImplementation(async (options: { allRefs?: boolean }) =>
      options?.allRefs
        ? [
            // Two atoms sharing one Lore-id: one on the branch, one on a ref.
            makeAtom('deadbeef'),
            makeAtom('deadbeef'),
          ]
        : [makeAtom('deadbeef')],
    );

    const output = await runDoctor(atomRepository, '--all');

    expect(findAll).toHaveBeenCalledTimes(2);
    expect(findAll).toHaveBeenNthCalledWith(1, { maxCommits: 10000 });
    expect(findAll).toHaveBeenNthCalledWith(2, { maxCommits: 10000, allRefs: true });

    const uniqueness = parseChecks(output).find((c) => c.name === 'Lore-id uniqueness (all refs)');
    expect(uniqueness).toBeDefined();
    expect(uniqueness!.status).toBe('warning');
    expect(uniqueness!.details).toContain('Lore-id "deadbeef" appears 2 times');
  });

  it('--all with no cross-ref duplicates stays ok', async () => {
    findAll.mockImplementation(async () => [makeAtom('deadbeef')]);

    const output = await runDoctor(atomRepository, '--all');

    const uniqueness = parseChecks(output).find((c) => c.name === 'Lore-id uniqueness (all refs)');
    expect(uniqueness).toBeDefined();
    expect(uniqueness!.status).toBe('ok');
  });
});
