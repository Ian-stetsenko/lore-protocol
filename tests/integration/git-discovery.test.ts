import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { rmSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SearchFilter } from "../../src/services/search-filter.js";
import { AtomRepository } from '../../src/services/atom-repository.js';
import { GitClient } from '../../src/services/git-client.js';
import { TrailerParser } from '../../src/services/trailer-parser.js';

describe('AtomRepository Git Integration', () => {
  const testDir = realpathSync(tmpdir()) + '/lore-git-test-' + Math.random().toString(36).slice(2);
  let repo: AtomRepository;

  beforeAll(() => {
    // Setup a clean git repo
    rmSync(testDir, { recursive: true, force: true });
    mkdirSync(testDir, { recursive: true });
    
    const run = (cmd: string) => execSync(cmd, { cwd: testDir });
    
    run('git init -b main');
    run('git config user.name "Test User"');
    run('git config user.email "test@example.com"');

    // 1. Valid Lore Atom
    writeFileSync(join(testDir, 'file1.txt'), 'content1');
    run('git add .');
    run('git commit -m "feat(auth): login feature\n\nLore-id: 00000001\nConfidence: high"');
    
    // Add delay to ensure distinct timestamps for --since tests
    run('sleep 1.1');

    // 2. Another Valid Lore Atom (different scope/author)
    run('git config user.name "Other User"');
    writeFileSync(join(testDir, 'file2.txt'), 'content2');
    run('git add .');
    run('git commit -m "fix(ui): layout\n\nLore-id: 00000002\nConfidence: low"');

    // 3. Non-Lore Commit (Should be filtered by discovery mode)
    run('sleep 1.1');
    writeFileSync(join(testDir, 'file3.txt'), 'content3');
    run('git add .');
    run('git commit -m "chore: just a cleanup"');

    // 4. False Positive (Has Lore-id in body, but not formatted as trailer)
    // Actually, our Discovery Mode regex is '^Lore-id: ', so we'll test that.
    writeFileSync(join(testDir, 'file4.txt'), 'content4');
    run('git add .');
    run('git commit -m "feat: fake\n\nNot really a Lore-id: 12345678"');

    const gitClient = new GitClient(testDir);
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

  it('Discovery Mode: should only return commits with valid Lore-id trailers', async () => {
    const result = await repo.findAll({});
    // Should find #1 and #2, but not #3 (chore) or #4 (fake trailer)
    expect(result).toHaveLength(2);
    const ids = result.map(a => a.loreId);
    expect(ids).toContain('00000001');
    expect(ids).toContain('00000002');
  });

  it('Coarse Filtering: should correctly filter by author at Git level', async () => {
    const result = await repo.findAll({ author: 'test@example.com' });
    expect(result).toHaveLength(2); // Both lore atoms have same email
  });

  it('Coarse Filtering: should correctly filter by scope at Git level', async () => {
    const result = await repo.findAll({ scope: 'auth' });
    expect(result).toHaveLength(1);
    expect(result[0].loreId).toBe('00000001');
  });

  it('Coarse Filtering: should handle AND logic (all-match) at Git level', async () => {
    // Search for author "test@example.com" AND scope "ui" (should be 1)
    const result2 = await repo.findAll({ author: 'test@example.com', scope: 'ui' });
    expect(result2).toHaveLength(1);
    expect(result2[0].loreId).toBe('00000002');
  });

  it('Coarse Filtering: should handle date-based filtering (since/until)', async () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const resultFuture = await repo.findAll({ since: tomorrow.toISOString() });
    expect(resultFuture).toHaveLength(0);

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const resultPast = await repo.findAll({ since: yesterday.toISOString() });
    expect(resultPast).toHaveLength(2);
  });

  it('Coarse Filtering: should handle relative dates (e.g., "1 hour ago")', async () => {
    const result = await repo.findAll({ since: '1 hour ago' });
    // Since we just created the commits in beforeAll, they should be found.
    expect(result).toHaveLength(2);
  });

  it('Coarse Filtering: should handle commit references (e.g., "HEAD~2")', async () => {
    // In our setup:
    // HEAD   = #4 (Fake)
    // HEAD~1 = #3 (Chore)
    // HEAD~2 = #2 (Atom 00000002) - Date of this commit
    // HEAD~3 = #1 (Atom 00000001) - Date of this commit
    
    // Everything since the date of Atom 00000002 (inclusive)
    const result = await repo.findAll({ since: 'HEAD~2' });
    expect(result).toHaveLength(1);
    expect(result[0].loreId).toBe('00000002');
  });

  it('Coarse Filtering: should handle until filtering with refs (e.g., "HEAD~1")', async () => {
    // HEAD~1 is the chore commit (#3). 
    // Everything UNTIL chore commit should include both atoms #1 and #2.
    const result = await repo.findAll({ until: 'HEAD~1' });
    expect(result).toHaveLength(2);
    const ids = result.map(a => a.loreId);
    expect(ids).toContain('00000001');
    expect(ids).toContain('00000002');
  });

  it('Coarse Filtering: should handle commit hashes', async () => {
    // Get the hash of Atom 00000002
    const atoms = await repo.findAll({});
    const atom2 = atoms.find(a => a.loreId === '00000002')!;
    const hash = atom2.commitHash;

    // since that hash should include it
    const resultSince = await repo.findAll({ since: hash });
    expect(resultSince.map(a => a.loreId)).toContain('00000002');

    // short hash should also work
    const resultShort = await repo.findAll({ since: hash.substring(0, 7) });
    expect(resultShort.map(a => a.loreId)).toContain('00000002');
  });

  it('Coarse Filtering: should handle garbage date strings gracefully', async () => {
    // Git resolves garbage to "now", so --since="garbage" should return nothing.
    const result = await repo.findAll({ since: 'not-a-date-at-all' });
    expect(result).toHaveLength(0);

    // Git resolves garbage to "now", so --until="garbage" should return everything 
    // up to the current second (which is all commits in this test setup).
    const resultUntil = await repo.findAll({ until: 'garbage-date' });
    expect(resultUntil).toHaveLength(2);
  });
});
