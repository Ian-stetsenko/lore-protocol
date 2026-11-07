import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerDoctorCommand } from '../../../src/commands/doctor.js';
import { SupersessionResolver } from '../../../src/services/supersession-resolver.js';
import { StalenessDetector } from '../../../src/services/staleness-detector.js';
import type { IGitClient } from '../../../src/interfaces/git-client.js';
import type { LoreConfig } from '../../../src/types/config.js';
import { STALE_SIGNAL } from '../../../src/util/constants.js';
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
      supersessionResolver: new SupersessionResolver(),
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

describe('doctor command — superseded dependency check resolves supersession chains (subtractive)', () => {
  /**
   * Local fixture builder for dependency-check fixtures: unlike the shared
   * makeAtom helper, this one can carry Supersedes / Depends-on trailers.
   */
  function makeAtomWith(
    loreId: LoreId,
    options: { supersedes?: readonly LoreId[]; dependsOn?: readonly LoreId[] } = {},
  ): LoreAtom {
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
        Supersedes: [...(options.supersedes ?? [])],
        'Depends-on': [...(options.dependsOn ?? [])],
        Related: [],
        custom: CustomTrailerCollection.empty(),
      },
      filesChanged: [],
    };
  }

  function repositoryReturning(atoms: LoreAtom[]): AtomRepository {
    return { findAll: vi.fn(async () => atoms) } as unknown as AtomRepository;
  }

  function supersededCheck(
    output: string,
  ): { name: string; status: string; message: string; details: string[] } {
    const check = parseChecks(output).find((c) => c.name === 'Superseded dependencies');
    expect(check).toBeDefined();
    return check!;
  }

  it('a transferred dependency (superseded target, live successor) is silent', async () => {
    const atoms = [
      makeAtomWith('11111111', { dependsOn: ['22222222'] }),
      makeAtomWith('22222222'),
      makeAtomWith('33333333', { supersedes: ['22222222'] }),
    ];

    const output = await runDoctor(repositoryReturning(atoms));

    const check = supersededCheck(output);
    expect(check.status).toBe('ok');
    expect(check.details).toEqual([]);
  });

  it('an edge whose target sits at the head of a chain resolves to the live tail and is silent', async () => {
    // Chain: 22222222 (head) is superseded by 33333333, which is superseded
    // by the live 44444444 — the edge resolves all the way to the live tail.
    const atoms = [
      makeAtomWith('11111111', { dependsOn: ['22222222'] }),
      makeAtomWith('22222222'),
      makeAtomWith('33333333', { supersedes: ['22222222'] }),
      makeAtomWith('44444444', { supersedes: ['33333333'] }),
    ];

    const output = await runDoctor(repositoryReturning(atoms));

    expect(supersededCheck(output).status).toBe('ok');
  });

  it('a side-branch-only target is silent in this check (absent from the scanned set)', async () => {
    // 55555555 lives only on another ref: no scanned atom carries that id.
    // Missing targets are the reference-resolution check's business; this
    // check stays silent even though a scanned atom supersedes the id.
    const atoms = [
      makeAtomWith('11111111', { dependsOn: ['55555555'] }),
      makeAtomWith('66666666', { supersedes: ['55555555'] }),
    ];

    const output = await runDoctor(repositoryReturning(atoms));

    const check = supersededCheck(output);
    expect(check.status).toBe('ok');
    expect(check.details).toEqual([]);
  });

  it('where multiple superseders claim one target, the last-writer-wins successor is accepted (silent)', async () => {
    const atoms = [
      makeAtomWith('11111111', { dependsOn: ['22222222'] }),
      makeAtomWith('22222222'),
      makeAtomWith('33333333', { supersedes: ['22222222'] }),
      makeAtomWith('44444444', { supersedes: ['22222222'] }),
    ];

    const output = await runDoctor(repositoryReturning(atoms));

    expect(supersededCheck(output).status).toBe('ok');
  });

  it('a supersession cycle keeps the existing info line and never fails the command', async () => {
    // 22222222 and 33333333 supersede each other: the chain cycles without
    // reaching a live atom, so the edge stays unresolved. The walk carries
    // its own visited set and must terminate safely.
    const atoms = [
      makeAtomWith('11111111', { dependsOn: ['22222222'] }),
      makeAtomWith('22222222', { supersedes: ['33333333'] }),
      makeAtomWith('33333333', { supersedes: ['22222222'] }),
    ];

    const exitCodeBefore = process.exitCode;
    const output = await runDoctor(repositoryReturning(atoms));

    const check = supersededCheck(output);
    expect(check.status).toBe('info');
    expect(check.details).toEqual([
      'Atom 11111111 depends on 22222222, which has been superseded',
    ]);
    // Info never fails the command: the exit code stays untouched.
    expect(process.exitCode).toBe(exitCodeBefore);
    // JSON shape unchanged: exactly one superseded-dependencies check.
    expect(
      parseChecks(output).filter((c) => c.name === 'Superseded dependencies'),
    ).toHaveLength(1);
  });

  it('a self-supersession keeps the existing info line', async () => {
    const atoms = [
      makeAtomWith('11111111', { dependsOn: ['22222222'] }),
      makeAtomWith('22222222', { supersedes: ['22222222'] }),
    ];

    const output = await runDoctor(repositoryReturning(atoms));

    const check = supersededCheck(output);
    expect(check.status).toBe('info');
    expect(check.details).toEqual([
      'Atom 11111111 depends on 22222222, which has been superseded',
    ]);
  });

  it('a zero-finding corpus yields status ok with empty details (the OK line is expected output)', async () => {
    const output = await runDoctor(repositoryReturning([]));

    const check = supersededCheck(output);
    expect(check.status).toBe('ok');
    expect(check.message).toBe('No superseded dependencies found');
    expect(check.details).toEqual([]);
  });

  it('guard: the staleness detector still flags the transferred edge through the service seam (author backstop intact)', async () => {
    // Doctor goes subtractive (silent on transferred edges); `lore stale`
    // must keep flagging them as the author backstop. The seam: the
    // resolver's map over the same fixture → active filter → staleness
    // detector (bare mocked git client, minimal stale config).
    const atoms = [
      makeAtomWith('11111111', { dependsOn: ['22222222'] }),
      makeAtomWith('22222222'),
      makeAtomWith('33333333', { supersedes: ['22222222'] }),
    ];

    const resolver = new SupersessionResolver();
    const supersessionMap = resolver.resolve(atoms);
    const activeAtoms = resolver.filterActive(atoms, supersessionMap);

    const gitClient: IGitClient = {
      log: vi.fn(async () => []),
      blame: vi.fn(async () => []),
      commit: vi.fn(async () => ({ hash: 'abc123', success: true })),
      hasStagedChanges: vi.fn(async () => false),
      getRepoRoot: vi.fn(async () => '/repo'),
      isInsideRepo: vi.fn(async () => true),
      getFilesChanged: vi.fn(async () => []),
      countCommitsSince: vi.fn(async () => 0),
      resolveRef: vi.fn(async () => 'abc123'),
    };
    const config: LoreConfig = {
      protocol: { version: '1.0' },
      trailers: { required: [], custom: [] },
      validation: { strict: false, maxMessageLines: 50, intentMaxLength: 72 },
      stale: { olderThan: '6m', driftThreshold: 20 },
      output: { defaultFormat: 'text' },
      follow: { maxDepth: 3 },
    };

    const detector = new StalenessDetector(gitClient, config);
    const reports = await detector.analyze(activeAtoms, supersessionMap);

    const dependent = reports.find((report) => report.atom.loreId === '11111111');
    expect(dependent).toBeDefined();
    expect(
      dependent!.reasons.some(
        (reason) => reason.signal === STALE_SIGNAL.ORPHANED_DEP,
      ),
    ).toBe(true);
  });
});
