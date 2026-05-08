import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AtomCache, NullAtomCache } from '../../../src/services/atom-cache.js';
import { rm, mkdir, access } from 'node:fs/promises';
import { join } from 'node:path';

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
    await cache.setFiles('emptyhash', []);
    expect(await cache.getFiles('emptyhash')).toEqual([]);
  });
});

describe('NullAtomCache', () => {
  it('should always return null and ignore sets', async () => {
    const cache = new NullAtomCache();
    await cache.setFiles('hash', ['file.txt']);
    expect(await cache.getFiles('hash')).toBeNull();
  });
});
