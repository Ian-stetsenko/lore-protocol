import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UpdateChecker } from '../../../src/services/update-checker.js';
import * as fs from 'node:fs';
import * as https from 'node:https';
import type { IncomingMessage, ClientRequest } from 'node:http';
import { EventEmitter } from 'node:events';

vi.mock('node:fs');
vi.mock('node:https');

function makeStderr(isTTY = true) {
  const output: string[] = [];
  return {
    isTTY,
    write(s: string) { output.push(s); return true; },
    output,
  };
}

function makeEnv(overrides: Record<string, string> = {}): Record<string, string | undefined> {
  return { ...overrides };
}

function makeFreshCache(latestVersion: string): string {
  return JSON.stringify({
    currentVersion: '0.1.0',
    latestVersion,
    lastChecked: Date.now(),
  });
}

function makeStaleCache(latestVersion: string): string {
  return JSON.stringify({
    currentVersion: '0.1.0',
    latestVersion,
    lastChecked: Date.now() - 25 * 60 * 60 * 1000, // 25 hours ago
  });
}

function mockHttpResponse(statusCode: number, body: string): void {
  const res = new EventEmitter() as EventEmitter & IncomingMessage;
  (res as any).statusCode = statusCode;
  res.setEncoding = vi.fn().mockReturnThis() as any;
  res.resume = vi.fn() as any;

  const req = new EventEmitter() as EventEmitter & ClientRequest;
  req.end = vi.fn() as any;
  req.destroy = vi.fn() as any;

  vi.mocked(https.request).mockImplementation((_url: any, _opts: any, cb: any) => {
    const callback = typeof _opts === 'function' ? _opts : cb;
    process.nextTick(() => {
      callback(res);
      if (statusCode === 200) {
        process.nextTick(() => {
          res.emit('data', body);
          res.emit('end');
        });
      }
    });
    return req as any;
  });
}

function mockHttpError(): void {
  const req = new EventEmitter() as EventEmitter & ClientRequest;
  req.end = vi.fn() as any;
  req.destroy = vi.fn() as any;

  vi.mocked(https.request).mockImplementation(() => {
    process.nextTick(() => req.emit('error', new Error('network failure')));
    return req as any;
  });
}

describe('UpdateChecker', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('showCachedNotification', () => {
    it('returns false when cache file does not exist', () => {
      vi.mocked(fs.readFileSync).mockImplementation(() => { throw new Error('ENOENT'); });
      const stderr = makeStderr();
      const checker = new UpdateChecker('lore-protocol', '0.1.0', '/tmp/.lore', { stderr, env: makeEnv() });

      expect(checker.showCachedNotification()).toBe(false);
      expect(stderr.output).toHaveLength(0);
    });

    it('returns false when cache is corrupt JSON', () => {
      vi.mocked(fs.readFileSync).mockReturnValue('not json');
      const stderr = makeStderr();
      const checker = new UpdateChecker('lore-protocol', '0.1.0', '/tmp/.lore', { stderr, env: makeEnv() });

      expect(checker.showCachedNotification()).toBe(false);
    });

    it('returns false when cached version equals current', () => {
      vi.mocked(fs.readFileSync).mockReturnValue(makeFreshCache('0.1.0'));
      const stderr = makeStderr();
      const checker = new UpdateChecker('lore-protocol', '0.1.0', '/tmp/.lore', { stderr, env: makeEnv() });

      expect(checker.showCachedNotification()).toBe(false);
    });

    it('returns false when cached version is older', () => {
      vi.mocked(fs.readFileSync).mockReturnValue(makeFreshCache('0.0.9'));
      const stderr = makeStderr();
      const checker = new UpdateChecker('lore-protocol', '0.1.0', '/tmp/.lore', { stderr, env: makeEnv() });

      expect(checker.showCachedNotification()).toBe(false);
    });

    it('shows notification and returns true when cached version is newer', () => {
      vi.mocked(fs.readFileSync).mockReturnValue(makeFreshCache('1.0.0'));
      const stderr = makeStderr();
      const checker = new UpdateChecker('lore-protocol', '0.1.0', '/tmp/.lore', { stderr, env: makeEnv() });

      expect(checker.showCachedNotification()).toBe(true);
      expect(stderr.output[0]).toContain('Update available');
      expect(stderr.output[0]).toContain('0.1.0');
      expect(stderr.output[0]).toContain('1.0.0');
    });

    it('includes install command with package name', () => {
      vi.mocked(fs.readFileSync).mockReturnValue(makeFreshCache('2.0.0'));
      const stderr = makeStderr();
      const checker = new UpdateChecker('lore-protocol', '0.1.0', '/tmp/.lore', { stderr, env: makeEnv() });

      checker.showCachedNotification();
      expect(stderr.output[0]).toContain('npm install -g lore-protocol');
    });
  });

  describe('skip conditions', () => {
    it('skips when stderr is not a TTY', () => {
      vi.mocked(fs.readFileSync).mockReturnValue(makeFreshCache('2.0.0'));
      const stderr = makeStderr(false);
      const checker = new UpdateChecker('lore-protocol', '0.1.0', '/tmp/.lore', { stderr, env: makeEnv() });

      expect(checker.showCachedNotification()).toBe(false);
    });

    it('skips when CI env var is set', () => {
      vi.mocked(fs.readFileSync).mockReturnValue(makeFreshCache('2.0.0'));
      const stderr = makeStderr();
      const checker = new UpdateChecker('lore-protocol', '0.1.0', '/tmp/.lore', { stderr, env: makeEnv({ CI: 'true' }) });

      expect(checker.showCachedNotification()).toBe(false);
    });

    it('skips when NO_UPDATE_NOTIFIER env var is set', () => {
      vi.mocked(fs.readFileSync).mockReturnValue(makeFreshCache('2.0.0'));
      const stderr = makeStderr();
      const checker = new UpdateChecker('lore-protocol', '0.1.0', '/tmp/.lore', { stderr, env: makeEnv({ NO_UPDATE_NOTIFIER: '1' }) });

      expect(checker.showCachedNotification()).toBe(false);
    });

    it('skips when LORE_NO_UPDATE_CHECK env var is set', () => {
      vi.mocked(fs.readFileSync).mockReturnValue(makeFreshCache('2.0.0'));
      const stderr = makeStderr();
      const checker = new UpdateChecker('lore-protocol', '0.1.0', '/tmp/.lore', { stderr, env: makeEnv({ LORE_NO_UPDATE_CHECK: '1' }) });

      expect(checker.showCachedNotification()).toBe(false);
    });

    it('skips when config updateCheck is false', () => {
      vi.mocked(fs.readFileSync).mockReturnValue(makeFreshCache('2.0.0'));
      const stderr = makeStderr();
      const checker = new UpdateChecker('lore-protocol', '0.1.0', '/tmp/.lore', {
        stderr,
        env: makeEnv(),
        configUpdateCheck: false,
      });

      expect(checker.showCachedNotification()).toBe(false);
    });
  });

  describe('checkForUpdateAsync', () => {
    it('does not fetch when cache is fresh', () => {
      vi.mocked(fs.readFileSync).mockReturnValue(makeFreshCache('0.1.0'));
      const stderr = makeStderr();
      const checker = new UpdateChecker('lore-protocol', '0.1.0', '/tmp/.lore', { stderr, env: makeEnv() });

      checker.checkForUpdateAsync();

      expect(https.request).not.toHaveBeenCalled();
    });

    it('fetches when cache is stale', async () => {
      vi.mocked(fs.readFileSync).mockReturnValue(makeStaleCache('0.1.0'));
      vi.mocked(fs.writeFileSync).mockImplementation(() => {});
      vi.mocked(fs.mkdirSync).mockImplementation(() => '' as any);
      mockHttpResponse(200, JSON.stringify({ version: '2.0.0' }));

      const stderr = makeStderr();
      const checker = new UpdateChecker('lore-protocol', '0.1.0', '/tmp/.lore', { stderr, env: makeEnv() });

      checker.checkForUpdateAsync();

      // Wait for async operations
      await new Promise((r) => setTimeout(r, 50));

      expect(https.request).toHaveBeenCalledTimes(1);
      expect(fs.writeFileSync).toHaveBeenCalledTimes(1);

      const written = JSON.parse(vi.mocked(fs.writeFileSync).mock.calls[0][1] as string);
      expect(written.latestVersion).toBe('2.0.0');
    });

    it('fetches when cache does not exist', async () => {
      vi.mocked(fs.readFileSync).mockImplementation(() => { throw new Error('ENOENT'); });
      vi.mocked(fs.writeFileSync).mockImplementation(() => {});
      vi.mocked(fs.mkdirSync).mockImplementation(() => '' as any);
      mockHttpResponse(200, JSON.stringify({ version: '1.0.0' }));

      const stderr = makeStderr();
      const checker = new UpdateChecker('lore-protocol', '0.1.0', '/tmp/.lore', { stderr, env: makeEnv() });

      checker.checkForUpdateAsync();
      await new Promise((r) => setTimeout(r, 50));

      expect(https.request).toHaveBeenCalledTimes(1);
      expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
    });

    it('silently handles network errors', async () => {
      vi.mocked(fs.readFileSync).mockImplementation(() => { throw new Error('ENOENT'); });
      mockHttpError();

      const stderr = makeStderr();
      const checker = new UpdateChecker('lore-protocol', '0.1.0', '/tmp/.lore', { stderr, env: makeEnv() });

      checker.checkForUpdateAsync();
      await new Promise((r) => setTimeout(r, 50));

      expect(stderr.output).toHaveLength(0);
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it('silently handles non-200 response', async () => {
      vi.mocked(fs.readFileSync).mockImplementation(() => { throw new Error('ENOENT'); });
      mockHttpResponse(404, 'not found');

      const stderr = makeStderr();
      const checker = new UpdateChecker('lore-protocol', '0.1.0', '/tmp/.lore', { stderr, env: makeEnv() });

      checker.checkForUpdateAsync();
      await new Promise((r) => setTimeout(r, 50));

      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it('silently handles invalid JSON response', async () => {
      vi.mocked(fs.readFileSync).mockImplementation(() => { throw new Error('ENOENT'); });
      vi.mocked(fs.mkdirSync).mockImplementation(() => '' as any);
      mockHttpResponse(200, 'not json');

      const stderr = makeStderr();
      const checker = new UpdateChecker('lore-protocol', '0.1.0', '/tmp/.lore', { stderr, env: makeEnv() });

      checker.checkForUpdateAsync();
      await new Promise((r) => setTimeout(r, 50));

      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it('silently handles cache write failures', async () => {
      vi.mocked(fs.readFileSync).mockImplementation(() => { throw new Error('ENOENT'); });
      vi.mocked(fs.mkdirSync).mockImplementation(() => '' as any);
      vi.mocked(fs.writeFileSync).mockImplementation(() => { throw new Error('EACCES'); });
      mockHttpResponse(200, JSON.stringify({ version: '2.0.0' }));

      const stderr = makeStderr();
      const checker = new UpdateChecker('lore-protocol', '0.1.0', '/tmp/.lore', { stderr, env: makeEnv() });

      // Should not throw
      checker.checkForUpdateAsync();
      await new Promise((r) => setTimeout(r, 50));

      expect(stderr.output).toHaveLength(0);
    });

    it('skips entirely when disabled', () => {
      const stderr = makeStderr();
      const checker = new UpdateChecker('lore-protocol', '0.1.0', '/tmp/.lore', {
        stderr,
        env: makeEnv({ CI: 'true' }),
      });

      checker.checkForUpdateAsync();

      expect(fs.readFileSync).not.toHaveBeenCalled();
      expect(https.request).not.toHaveBeenCalled();
    });
  });
});
