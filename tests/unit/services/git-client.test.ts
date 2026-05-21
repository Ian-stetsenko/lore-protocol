import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitClient } from '../../../src/services/git-client.js';
import { execFile as execFileCb } from 'node:child_process';

vi.mock('node:util', async () => {
  const actual = await vi.importActual('node:util');
  return {
    ...actual,
    promisify: (fn: any) => fn, // Simplified mock
  };
});

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

describe('GitClient', () => {
  const client = new GitClient('/test/cwd');

  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('getFilesChanged', () => {
    it('should correctly parse git diff-tree output', async () => {
      const hashes = ['aaaa111122223333444455556666777788889999', 'bbbb111122223333444455556666777788889999'];
      const mockOutput = `${hashes[0]}\nfile1.ts\nfile2.ts\n${hashes[1]}\nfile3.ts\n`;
      
      vi.mocked(execFileCb).mockImplementation(((cmd: string, args: any, opts: any, callback: any) => {
        callback(null, mockOutput, '');
      }) as any);

      const result = await client.getFilesChanged(hashes);

      expect(result.get(hashes[0])).toEqual(['file1.ts', 'file2.ts']);
      expect(result.get(hashes[1])).toEqual(['file3.ts']);
    });

    it('should be robust against file paths that look like hashes', async () => {
      const hashes = ['aaaa111122223333444455556666777788889999'];
      // A file path that is exactly 40 chars and hexadecimal
      const sneakyPath = '1234567890123456789012345678901234567890'; 
      const mockOutput = `${hashes[0]}\n${sneakyPath}\nfile.ts\n`;

      vi.mocked(execFileCb).mockImplementation(((cmd: string, args: any, opts: any, callback: any) => {
        callback(null, mockOutput, '');
      }) as any);

      const result = await client.getFilesChanged(hashes);

      // The sneaky path should be treated as a file, not a new commit
      expect(result.get(hashes[0])).toEqual([sneakyPath, 'file.ts']);
    });

    it('should return an empty map for empty input', async () => {
      const result = await client.getFilesChanged([]);
      expect(result.size).toBe(0);
      expect(execFileCb).not.toHaveBeenCalled();
    });
  });
});
