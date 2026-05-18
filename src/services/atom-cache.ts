import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { IAtomCache } from '../interfaces/atom-cache.js';

const HEX_HASH = /^[0-9a-f]{7,64}$/i;

export class AtomCache implements IAtomCache {
  constructor(private readonly cacheDir: string) {}

  async getFiles(hash: string): Promise<readonly string[] | null> {
    if (!HEX_HASH.test(hash)) return null;
    const path = this.getCachePath(hash);
    try {
      const content = await readFile(path, 'utf8');

      // Corruption check: empty file or NUL bytes indicate a failed/partial write.
      if (!content || content.includes('\0')) {
        return null;
      }

      // We use a trailing newline as a sentinel for a valid write.
      // If the file is just whitespace (and not exactly a single newline), it's corrupt.
      if (content.trim() === '' && content !== '\n') {
        return null;
      }

      // If it's just a newline, it's a valid empty list (e.g. from --allow-empty commits)
      if (content === '\n') {
        return [];
      }

      // Remove exactly one trailing newline and split
      return content.replace(/\n$/, '').split('\n');
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  async setFiles(hash: string, files: readonly string[]): Promise<void> {
    if (!HEX_HASH.test(hash)) return;
    const path = this.getCachePath(hash);
    const tempPath = `${path}.tmp.${randomUUID()}`;

    await mkdir(dirname(path), { recursive: true });

    try {
      // Always ensure a newline so empty lists aren't 0-byte files.
      // Empty lists occur for commits created with --allow-empty.
      // Atomic write: write to unique temp file then rename to final destination.
      await writeFile(tempPath, files.join('\n') + '\n', 'utf8');
      await rename(tempPath, path);
    } catch (error: unknown) {
      // Clean up temp file on failure if it exists
      try {
        await unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }
      throw error;
    }
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
