import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AtomCache, NullAtomCache } from '../../../src/services/atom-cache.js';
import { rm, mkdir, access, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';

describe('AtomCache', () => {
  const cacheDir = join(process.cwd(), '.lore-test-cache');

  beforeEach(async () => {
    await mkdir(cacheDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(cacheDir, { recursive: true, force: true });
  });

  it('should return null for miss', async () => {
    const cache = new AtomCache(cacheDir);
    expect(await cache.getFiles('abc123')).toBeNull();
  });

  it('should round-trip files without .txt extension', async () => {
    const cache = new AtomCache(cacheDir);
    const files = ['src/a.ts', 'src/b.ts'];
    const hash = 'abc123456789';
    
    await cache.setFiles(hash, files);
    const result = await cache.getFiles(hash);
    
    expect(result).toEqual(files);

    // Verify file exists at sharded path without .txt
    const shard = hash.substring(0, 2);
    const rest = hash.substring(2);
    const expectedPath = join(cacheDir, shard, rest);
    await expect(access(expectedPath)).resolves.toBeUndefined();
  });

  it('should handle empty file list', async () => {
    const cache = new AtomCache(cacheDir);
    const hash = 'aabbccdd11223344';
    await cache.setFiles(hash, []);
    expect(await cache.getFiles(hash)).toEqual([]);
  });

  it('should reject invalid hashes', async () => {
    const cache = new AtomCache(cacheDir);
    expect(await cache.getFiles('../../../etc/passwd')).toBeNull();
    expect(await cache.getFiles('not-a-hash!')).toBeNull();
  });

  it('should return null for corrupted cache files', async () => {
    const cache = new AtomCache(cacheDir);
    const hash = 'corrupt123';
    const shard = hash.substring(0, 2);
    const rest = hash.substring(2);
    const path = join(cacheDir, shard, rest);

    await mkdir(dirname(path), { recursive: true });

    // Case 1: NUL bytes
    await writeFile(path, Buffer.from([0, 1, 2, 3]));
    expect(await cache.getFiles(hash)).toBeNull();

    // Case 2: Empty file
    await writeFile(path, '');
    expect(await cache.getFiles(hash)).toBeNull();

    // Case 3: Only whitespace
    await writeFile(path, '   \n  ');
    expect(await cache.getFiles(hash)).toBeNull();
  });

  it('should recover from and overwrite corrupted cache files', async () => {
    const cache = new AtomCache(cacheDir);
    const hash = 'abc12345';
    const shard = hash.substring(0, 2);
    const rest = hash.substring(2);
    const path = join(cacheDir, shard, rest);

    await mkdir(dirname(path), { recursive: true });

    // 1. Create a corrupted file (with NUL bytes)
    await writeFile(path, Buffer.from([0, 0, 0]));
    
    // 2. Verify it's detected as a miss (returns null)
    expect(await cache.getFiles(hash)).toBeNull();

    // 3. Overwrite it with valid data
    const validFiles = ['file1.ts', 'file2.ts'];
    await cache.setFiles(hash, validFiles);

    // 4. Verify it's now a hit with the correct data
    expect(await cache.getFiles(hash)).toEqual(validFiles);
  });
});

describe('NullAtomCache', () => {
  it('should always return null and ignore sets', async () => {
    const cache = new NullAtomCache();
    await cache.setFiles('hash', ['file.txt']);
    expect(await cache.getFiles('hash')).toBeNull();
  });
});
