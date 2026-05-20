import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { execSync } from 'node:child_process';
import { rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SearchFilter } from "../../src/services/search-filter.js";
import { AtomRepository } from '../../src/services/atom-repository.js';
import { GitClient } from '../../src/services/git-client.js';
import { TrailerParser } from '../../src/services/trailer-parser.js';

describe('AtomRepository False Positive Repro', () => {
  const testDir = join(process.cwd(), 'tests/tmp-repro-test');
  let repo: AtomRepository;
  let gitClient: GitClient;

  beforeAll(() => {
    rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });
    
    const run = (cmd: string) => execSync(cmd, { cwd: testDir });
    
    run('git init -b main');
    run('git config user.name "Test User"');
    run('git config user.email "test@example.com"');

    // 1. Valid Lore Atom
    writeFileSync(join(testDir, 'file1.txt'), 'content1');
    run('git add .');
    run('git commit -m "feat: valid\n\nLore-id: 00000001"');

    // 2. False Positive (Lore-id in the middle of the body)
    writeFileSync(join(testDir, 'file2.txt'), 'content2');
    run('git add .');
    run('git commit -m "feat: false positive\n\nMentioning Lore-id: 12345678 in the middle of a sentence."');

    gitClient = new GitClient(testDir);
    const trailerParser = new TrailerParser();
    
    const searchFilter = new SearchFilter();
    repo = new AtomRepository(
      gitClient,
      trailerParser, searchFilter,
    );
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('findByLoreId should use an anchored grep (repro failure)', async () => {
    const logSpy = vi.spyOn(gitClient, 'log');
    
    // Searching for the false positive ID
    const result = await repo.findByLoreId('12345678');
    
    // Correctness check: result should be null because it's not a real trailer
    expect(result).toBeNull();
    
    // Precision check: Git should NOT have returned any commits if we used anchors.
    // But currently we don't, so Git WILL return the false positive commit,
    // and parseRawCommits will have to filter it out.
    // If we were using anchors, logSpy.mock.results[0].value (the RawCommit array) would be empty.
    
    const matchedCommits = await logSpy.mock.results[0].value;
    // DESIRED: Git should NOT have returned any commits if we used anchors.
    expect(matchedCommits).toHaveLength(0); 
    
    logSpy.mockRestore();
  });

  it('findAll should use an anchored grep (repro failure)', async () => {
    const logSpy = vi.spyOn(gitClient, 'log');
    
    await repo.findAll({});
    
    const matchedCommits = await logSpy.mock.results[0].value;
    // DESIRED: It should only match 1 commit (the valid one).
    expect(matchedCommits).toHaveLength(1);
    
    logSpy.mockRestore();
  });
});
