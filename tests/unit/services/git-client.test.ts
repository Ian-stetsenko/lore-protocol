import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitClient } from '../../../src/services/git-client.js';

describe('GitClient.resolveDate', () => {
  let client: GitClient;

  beforeEach(() => {
    client = new GitClient();
    // We mock exec directly on the instance's private method if needed, 
    // but better to mock the class prototype for all tests.
  });

  it('should resolve ISO dates natively using JS', async () => {
    const isoDate = '2026-05-20T10:00:00.000Z';
    const input = '2026-05-20T10:00:00Z';
    const result = await client.resolveDate(input);
    
    expect(result).not.toBeNull();
    expect(result?.toISOString()).toBe(isoDate);
  });

  it('should resolve YYYY-MM-DD as local midnight', async () => {
    const input = '2026-05-20';
    const expected = new Date(2026, 4, 20); // May is 4
    const result = await client.resolveDate(input);
    
    expect(result?.getTime()).toBe(expected.getTime());
  });

  it('should resolve commit refs using git show', async () => {
    const ref = 'HEAD~5';
    const mockTimestamp = '1716200000';
    
    // Mock successful git show call
    const execSpy = vi.spyOn(client as any, 'exec').mockImplementation(async (args: string[]) => {
      if (args.includes('show') && args.includes(ref)) {
        return mockTimestamp;
      }
      throw new Error('Fallback to next strategy');
    });

    const result = await client.resolveDate(ref);

    expect(result).not.toBeNull();
    expect(result?.getTime()).toBe(parseInt(mockTimestamp) * 1000);
    expect(execSpy).toHaveBeenCalledWith(['show', '-s', '--format=%at', ref]);
  });

  it('should resolve short and full commit hashes', async () => {
    const fullHash = 'abc1234567890abcdef1234567890abcdef1234';
    const shortHash = 'abc1234';
    const mockTimestamp = '1716200000';

    const execSpy = vi.spyOn(client as any, 'exec').mockResolvedValue(mockTimestamp);

    const resultFull = await client.resolveDate(fullHash);
    expect(resultFull?.getTime()).toBe(parseInt(mockTimestamp) * 1000);
    expect(execSpy).toHaveBeenCalledWith(['show', '-s', '--format=%at', fullHash]);

    const resultShort = await client.resolveDate(shortHash);
    expect(resultShort?.getTime()).toBe(parseInt(mockTimestamp) * 1000);
    expect(execSpy).toHaveBeenCalledWith(['show', '-s', '--format=%at', shortHash]);
  });

  it('should resolve relative date strings using git rev-parse', async () => {
    const relative = '3 days ago';
    const mockTimestamp = '1715940800';
    
    const execSpy = vi.spyOn(client as any, 'exec').mockImplementation(async (args: string[]) => {
      if (args.includes('rev-parse') && args.some(a => a.includes(relative))) {
        return `--max-age=${mockTimestamp}`;
      }
      throw new Error('Failing fast passes');
    });

    const result = await client.resolveDate(relative);

    expect(result).not.toBeNull();
    expect(result?.getTime()).toBe(parseInt(mockTimestamp) * 1000);
    expect(execSpy).toHaveBeenCalledWith(['rev-parse', `--since=${relative}`]);
  });

  it('should return null if all resolution strategies fail', async () => {
    vi.spyOn(client as any, 'exec').mockRejectedValue(new Error('Git failure'));
    
    const result = await client.resolveDate('completely-invalid-garbage');
    
    expect(result).toBeNull();
  });

  it('should mirror git behavior for garbage strings (resolving to "now")', async () => {
    const garbage = 'not-a-date';
    const nowTs = Math.floor(Date.now() / 1000).toString();
    
    vi.spyOn(client as any, 'exec').mockImplementation(async (args: string[]) => {
      if (args.includes('rev-parse') && args.some(a => a.includes(garbage))) {
        return `--max-age=${nowTs}`;
      }
      throw new Error('Not found');
    });

    const result = await client.resolveDate(garbage);
    expect(result).not.toBeNull();
    // Should be within a small window of "now"
    expect(Math.abs(result!.getTime() - parseInt(nowTs) * 1000)).toBeLessThan(2000);
  });
});
