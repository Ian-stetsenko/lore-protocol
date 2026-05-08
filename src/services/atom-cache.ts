import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { IAtomCache } from '../interfaces/atom-cache.js';

export class AtomCache implements IAtomCache {
  constructor(private readonly cacheDir: string) {}

  async getFiles(hash: string): Promise<readonly string[] | null> {
    const path = this.getCachePath(hash);
    try {
      const content = await readFile(path, 'utf8');
      return content.trim() ? content.split('\n') : [];
    } catch (error: any) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async setFiles(hash: string, files: readonly string[]): Promise<void> {
    const path = this.getCachePath(hash);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, files.join('\n'), 'utf8');
  }

  private getCachePath(hash: string): string {
    const shard = hash.substring(0, 2);
    const rest = hash.substring(2);
    return join(this.cacheDir, shard, rest);
  }
}

/**
 * Null Object implementation of IAtomCache.
 * Performs no caching; always returns null and ignores writes.
 */
export class NullAtomCache implements IAtomCache {
  async getFiles(_hash: string): Promise<readonly string[] | null> {
    return null;
  }

  async setFiles(_hash: string, _files: readonly string[]): Promise<void> {
    // No-op
  }
}
