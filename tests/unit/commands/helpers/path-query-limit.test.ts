import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executePathQuery } from '../../../../src/commands/helpers/path-query.js';
import type { PathQueryDeps, PathQueryCommandOptions } from '../../../../src/commands/helpers/path-query.js';
import type { LoreAtom, LoreTrailers, SupersessionStatus } from '../../../../src/types/domain.js';
import type { LoreConfig } from '../../../../src/types/config.js';
import { DEFAULT_CONFIG } from '../../../../src/types/config.js';
import { CustomTrailerCollection } from '../../../../src/types/custom-trailer-collection.js';

function makeTrailers(loreId: string): LoreTrailers {
  return {
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
  };
}

function makeAtom(id: string, supersedes: string[] = []): LoreAtom {
  const trailers = makeTrailers(id);
  if (supersedes.length > 0) {
    (trailers as any).Supersedes = supersedes;
  }
  return {
    loreId: id,
    commitHash: `hash_${id}`,
    date: new Date('2025-01-01'),
    author: 'test@example.com',
    intent: `feat: ${id}`,
    body: '',
    trailers,
    filesChanged: ['src/test.ts'],
  };
}

describe('executePathQuery — --limit as post-supersession result cap', () => {
  let deps: PathQueryDeps;
  let mockFindByTarget: ReturnType<typeof vi.fn>;
  let mockResolve: ReturnType<typeof vi.fn>;
  let mockFilterActive: ReturnType<typeof vi.fn>;
  let formattedOutput: string;

  beforeEach(() => {
    mockFindByTarget = vi.fn();
    mockResolve = vi.fn();
    mockFilterActive = vi.fn();
    formattedOutput = '';

    deps = {
      atomRepository: {
        findByTarget: mockFindByTarget,
        findByScope: vi.fn(),
        resolveFollowLinks: vi.fn(),
      } as any,
      supersessionResolver: {
        resolve: mockResolve,
        filterActive: mockFilterActive,
      } as any,
      pathResolver: {
        parseTarget: vi.fn().mockReturnValue({
          raw: 'src/test.ts',
          type: 'file',
          filePath: 'src/test.ts',
          lineStart: null,
          lineEnd: null,
        }),
        toGitLogArgs: vi.fn().mockReturnValue(['--', 'src/test.ts']),
      } as any,
      getFormatter: () => ({
        formatQueryResult: vi.fn().mockImplementation((data) => {
          formattedOutput = JSON.stringify({
            atoms: data.result.atoms.length,
            filteredAtoms: data.result.meta.filteredAtoms,
          });
          return formattedOutput;
        }),
      }) as any,
      config: DEFAULT_CONFIG,
    };
  });

  it('should apply --limit after supersession filtering', async () => {
    // 5 atoms from git, 2 are superseded, limit 2
    const atoms = [
      makeAtom('aaaa1111'),
      makeAtom('bbbb2222'),
      makeAtom('cccc3333', ['aaaa1111']),  // supersedes aaaa1111
      makeAtom('dddd4444', ['bbbb2222']),  // supersedes bbbb2222
      makeAtom('eeee5555'),
    ];

    mockFindByTarget.mockResolvedValue(atoms);

    const supersessionMap = new Map<string, SupersessionStatus>([
      ['aaaa1111', { superseded: true, supersededBy: 'cccc3333' }],
      ['bbbb2222', { superseded: true, supersededBy: 'dddd4444' }],
      ['cccc3333', { superseded: false, supersededBy: null }],
      ['dddd4444', { superseded: false, supersededBy: null }],
      ['eeee5555', { superseded: false, supersededBy: null }],
    ]);
    mockResolve.mockReturnValue(supersessionMap);

    // filterActive returns only 3 non-superseded atoms
    const activeAtoms = [atoms[2], atoms[3], atoms[4]];
    mockFilterActive.mockReturnValue(activeAtoms);

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const options: PathQueryCommandOptions = { limit: 2 };
    await executePathQuery('src/test.ts', options, deps, 'context', 'all');

    // The output should have exactly 2 atoms (limit applied after supersession)
    const output = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(output.atoms).toBe(2);
    expect(output.filteredAtoms).toBe(2);

    consoleSpy.mockRestore();
  });

  it('should not pass limit to atomRepository (only maxCommits)', async () => {
    mockFindByTarget.mockResolvedValue([]);
    mockResolve.mockReturnValue(new Map());
    mockFilterActive.mockReturnValue([]);
    vi.spyOn(console, 'log').mockImplementation(() => {});

    const options: PathQueryCommandOptions = { limit: 5, maxCommits: 100 };
    await executePathQuery('src/test.ts', options, deps, 'context', 'all');

    // Verify findByTarget received maxCommits in PathQueryOptions
    const queryOptions = mockFindByTarget.mock.calls[0][1];
    expect(queryOptions.maxCommits).toBe(100);
    // limit is in the options but should NOT affect git scan
    expect(queryOptions.limit).toBe(5);

    vi.mocked(console.log).mockRestore();
  });

  it('should return all atoms when limit is not specified', async () => {
    const atoms = [makeAtom('aaaa1111'), makeAtom('bbbb2222'), makeAtom('cccc3333')];

    mockFindByTarget.mockResolvedValue(atoms);
    mockResolve.mockReturnValue(new Map());
    mockFilterActive.mockReturnValue(atoms);

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const options: PathQueryCommandOptions = {};
    await executePathQuery('src/test.ts', options, deps, 'context', 'all');

    const output = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(output.atoms).toBe(3);

    consoleSpy.mockRestore();
  });

  it('should treat limit 0 as no limit', async () => {
    const atoms = [makeAtom('aaaa1111'), makeAtom('bbbb2222')];

    mockFindByTarget.mockResolvedValue(atoms);
    mockResolve.mockReturnValue(new Map());
    mockFilterActive.mockReturnValue(atoms);

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    const options: PathQueryCommandOptions = { limit: 0 };
    await executePathQuery('src/test.ts', options, deps, 'context', 'all');

    const output = JSON.parse(consoleSpy.mock.calls[0][0]);
    expect(output.atoms).toBe(2);

    consoleSpy.mockRestore();
  });
});
