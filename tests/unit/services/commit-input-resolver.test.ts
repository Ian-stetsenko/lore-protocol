import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CommitInputResolver } from '../../../src/services/commit-input-resolver.js';
import type { IPrompt } from '../../../src/interfaces/prompt.js';
import type { CommitCommandOptions } from '../../../src/services/commit-input-resolver.js';

/**
 * Creates a mock IPrompt for testing.
 */
function createMockPrompt(overrides: Partial<IPrompt> = {}): IPrompt {
  return {
    askText: vi.fn().mockResolvedValue(''),
    askMultiline: vi.fn().mockResolvedValue(''),
    askChoice: vi.fn().mockResolvedValue('low'),
    askConfirm: vi.fn().mockResolvedValue(false),
    close: vi.fn(),
    ...overrides,
  };
}

/**
 * Creates an empty set of commit command options.
 */
function emptyOptions(overrides: Partial<CommitCommandOptions> = {}): CommitCommandOptions {
  return { ...overrides };
}

describe('CommitInputResolver', () => {
  let originalIsTTY: boolean | undefined;

  beforeEach(() => {
    originalIsTTY = process.stdin.isTTY;
  });

  afterEach(() => {
    Object.defineProperty(process.stdin, 'isTTY', {
      value: originalIsTTY,
      writable: true,
      configurable: true,
    });
  });

  describe('mode resolution priority', () => {
    it('should dispatch to interactive reader when --interactive is set', async () => {
      const prompt = createMockPrompt({
        askText: vi.fn().mockResolvedValue('test intent'),
        askConfirm: vi.fn().mockResolvedValue(false),
      });
      const resolver = new CommitInputResolver(prompt);

      const result = await resolver.resolve(emptyOptions({ interactive: true }));

      expect(result.intent).toBe('test intent');
      expect(prompt.askText).toHaveBeenCalled();
    });

    it('should dispatch to file/JSON reader when --file is set', async () => {
      const prompt = createMockPrompt();
      const resolver = new CommitInputResolver(prompt);

      const tmpPath = '/tmp/test-lore-input.json';
      const { writeFileSync } = await import('node:fs');
      writeFileSync(tmpPath, JSON.stringify({ intent: 'from file', trailers: {} }));

      try {
        const result = await resolver.resolve(emptyOptions({ file: tmpPath }));
        expect(result.intent).toBe('from file');
        expect(prompt.askText).not.toHaveBeenCalled();
      } finally {
        const { unlinkSync } = await import('node:fs');
        unlinkSync(tmpPath);
      }
    });

    it('should dispatch to flags reader when --intent is set', async () => {
      const prompt = createMockPrompt();
      const resolver = new CommitInputResolver(prompt);

      const result = await resolver.resolve(emptyOptions({
        intent: 'from flags',
        confidence: 'high',
      }));

      expect(result.intent).toBe('from flags');
      expect(result.trailers?.Confidence).toBe('high');
      expect(prompt.askText).not.toHaveBeenCalled();
    });

    it('should dispatch to interactive reader when TTY with no flags set', async () => {
      Object.defineProperty(process.stdin, 'isTTY', {
        value: true,
        writable: true,
        configurable: true,
      });

      const prompt = createMockPrompt({
        askText: vi.fn().mockResolvedValue('tty interactive intent'),
        askConfirm: vi.fn().mockResolvedValue(false),
      });
      const resolver = new CommitInputResolver(prompt);

      const result = await resolver.resolve(emptyOptions());

      expect(result.intent).toBe('tty interactive intent');
      expect(prompt.askText).toHaveBeenCalled();
    });

    it('should dispatch to stdin/JSON reader when not a TTY and no flags set', async () => {
      Object.defineProperty(process.stdin, 'isTTY', {
        value: false,
        writable: true,
        configurable: true,
      });

      const prompt = createMockPrompt();
      const resolver = new CommitInputResolver(prompt);

      // Mock stdin to emit data then end
      const jsonInput = JSON.stringify({ intent: 'from stdin' });
      const onMock = vi.fn().mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
        if (event === 'data') {
          setTimeout(() => cb(Buffer.from(jsonInput)), 10);
        } else if (event === 'end') {
          setTimeout(() => cb(), 20);
        }
        return process.stdin;
      });
      vi.spyOn(process.stdin, 'on').mockImplementation(onMock);

      try {
        const result = await resolver.resolve(emptyOptions());
        expect(result.intent).toBe('from stdin');
      } finally {
        vi.restoreAllMocks();
      }
    });

    it('should prefer interactive over file when both are set', async () => {
      const prompt = createMockPrompt({
        askText: vi.fn().mockResolvedValue('interactive wins'),
        askConfirm: vi.fn().mockResolvedValue(false),
      });
      const resolver = new CommitInputResolver(prompt);

      const result = await resolver.resolve(emptyOptions({
        interactive: true,
        file: '/some/file.json',
      }));

      expect(result.intent).toBe('interactive wins');
      expect(prompt.askText).toHaveBeenCalled();
    });

    it('should prefer file over flags when both are set', async () => {
      const prompt = createMockPrompt();
      const resolver = new CommitInputResolver(prompt);

      const tmpPath = '/tmp/test-lore-file-over-flags.json';
      const { writeFileSync } = await import('node:fs');
      writeFileSync(tmpPath, JSON.stringify({ intent: 'file wins' }));

      try {
        const result = await resolver.resolve(emptyOptions({
          file: tmpPath,
          intent: 'flags intent',
        }));
        expect(result.intent).toBe('file wins');
      } finally {
        const { unlinkSync } = await import('node:fs');
        unlinkSync(tmpPath);
      }
    });

    it('should prefer flags over stdin when intent is set and not a TTY', async () => {
      Object.defineProperty(process.stdin, 'isTTY', {
        value: false,
        writable: true,
        configurable: true,
      });

      const prompt = createMockPrompt();
      const resolver = new CommitInputResolver(prompt);

      const result = await resolver.resolve(emptyOptions({
        intent: 'flags win',
      }));

      expect(result.intent).toBe('flags win');
    });
  });
});
