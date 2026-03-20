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
    it('should resolve to interactive when --interactive is set', async () => {
      const prompt = createMockPrompt({
        askText: vi.fn().mockResolvedValue('test intent'),
        askConfirm: vi.fn().mockResolvedValue(false),
      });
      const resolver = new CommitInputResolver(prompt);

      const result = await resolver.resolve(emptyOptions({ interactive: true }));

      expect(result.intent).toBe('test intent');
      expect(prompt.askText).toHaveBeenCalled();
    });

    it('should resolve to file when --file is set (without --interactive)', async () => {
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

    it('should resolve to flags when --intent is set (without --interactive or --file)', async () => {
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

    it('should resolve to interactive when TTY with no flags set', async () => {
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

    it('should resolve to stdin when not a TTY and no flags set', async () => {
      Object.defineProperty(process.stdin, 'isTTY', {
        value: false,
        writable: true,
        configurable: true,
      });

      const prompt = createMockPrompt();
      const resolver = new CommitInputResolver(prompt);

      // Mock stdin to emit data then end
      const jsonInput = JSON.stringify({ intent: 'from stdin' });
      const originalOn = process.stdin.on.bind(process.stdin);
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
  });

  describe('interactive reader', () => {
    it('should return correct CommitInput from prompt answers', async () => {
      let confirmCallIndex = 0;
      const confirmResponses = [
        true,   // Add a body?
        false,  // Add a Constraint? (no)
        false,  // Add a Rejected? (no)
        true,   // Set Confidence?
        false,  // Set Scope-risk? (no)
        false,  // Set Reversibility? (no)
        false,  // Add a Directive? (no)
        false,  // Add a Tested? (no)
        false,  // Add a Not-tested? (no)
        false,  // Add a Supersedes? (no)
        false,  // Add a Depends-on? (no)
        false,  // Add a Related? (no)
      ];

      const prompt = createMockPrompt({
        askText: vi.fn().mockResolvedValue('refactor auth module'),
        askMultiline: vi.fn().mockResolvedValue('This is the body text.'),
        askConfirm: vi.fn().mockImplementation(() => {
          const response = confirmResponses[confirmCallIndex] ?? false;
          confirmCallIndex++;
          return Promise.resolve(response);
        }),
        askChoice: vi.fn().mockResolvedValue('high'),
        close: vi.fn(),
      });

      const resolver = new CommitInputResolver(prompt);
      const result = await resolver.resolve(emptyOptions({ interactive: true }));

      expect(result.intent).toBe('refactor auth module');
      expect(result.body).toBe('This is the body text.');
      expect(result.trailers?.Confidence).toBe('high');
      expect(prompt.close).toHaveBeenCalled();
    });
  });

  describe('file reader', () => {
    it('should parse valid JSON from file', async () => {
      const prompt = createMockPrompt();
      const resolver = new CommitInputResolver(prompt);

      const tmpPath = '/tmp/test-lore-valid.json';
      const { writeFileSync } = await import('node:fs');
      const input = {
        intent: 'fix bug in parser',
        body: 'Detailed explanation',
        trailers: {
          Constraint: ['must preserve backward compat'],
          Confidence: 'medium',
          'Scope-risk': 'narrow',
        },
      };
      writeFileSync(tmpPath, JSON.stringify(input));

      try {
        const result = await resolver.resolve(emptyOptions({ file: tmpPath }));
        expect(result.intent).toBe('fix bug in parser');
        expect(result.body).toBe('Detailed explanation');
        expect(result.trailers?.Constraint).toEqual(['must preserve backward compat']);
        expect(result.trailers?.Confidence).toBe('medium');
        expect(result.trailers?.['Scope-risk']).toBe('narrow');
      } finally {
        const { unlinkSync } = await import('node:fs');
        unlinkSync(tmpPath);
      }
    });

    it('should throw on invalid JSON', async () => {
      const prompt = createMockPrompt();
      const resolver = new CommitInputResolver(prompt);

      const tmpPath = '/tmp/test-lore-invalid.json';
      const { writeFileSync } = await import('node:fs');
      writeFileSync(tmpPath, 'not valid json {{{');

      try {
        await expect(resolver.resolve(emptyOptions({ file: tmpPath }))).rejects.toThrow();
      } finally {
        const { unlinkSync } = await import('node:fs');
        unlinkSync(tmpPath);
      }
    });
  });

  describe('flags reader', () => {
    it('should map all CLI options correctly', async () => {
      const prompt = createMockPrompt();
      const resolver = new CommitInputResolver(prompt);

      const result = await resolver.resolve(emptyOptions({
        intent: 'add feature X',
        body: 'Feature body text',
        constraint: ['must be fast', 'no breaking changes'],
        rejected: ['approach A | too complex'],
        confidence: 'high',
        scopeRisk: 'wide',
        reversibility: 'clean',
        directive: ['use new API'],
        tested: ['unit tests pass'],
        notTested: ['load testing'],
        supersedes: ['abcd1234'],
        dependsOn: ['dead0000'],
        related: ['beef1234'],
      }));

      expect(result.intent).toBe('add feature X');
      expect(result.body).toBe('Feature body text');
      expect(result.trailers?.Constraint).toEqual(['must be fast', 'no breaking changes']);
      expect(result.trailers?.Rejected).toEqual(['approach A | too complex']);
      expect(result.trailers?.Confidence).toBe('high');
      expect(result.trailers?.['Scope-risk']).toBe('wide');
      expect(result.trailers?.Reversibility).toBe('clean');
      expect(result.trailers?.Directive).toEqual(['use new API']);
      expect(result.trailers?.Tested).toEqual(['unit tests pass']);
      expect(result.trailers?.['Not-tested']).toEqual(['load testing']);
      expect(result.trailers?.Supersedes).toEqual(['abcd1234']);
      expect(result.trailers?.['Depends-on']).toEqual(['dead0000']);
      expect(result.trailers?.Related).toEqual(['beef1234']);
    });
  });

  describe('stdin reader', () => {
    it('should parse JSON from stdin', async () => {
      Object.defineProperty(process.stdin, 'isTTY', {
        value: false,
        writable: true,
        configurable: true,
      });

      const prompt = createMockPrompt();
      const resolver = new CommitInputResolver(prompt);

      const jsonInput = JSON.stringify({
        intent: 'stdin commit',
        trailers: {
          Confidence: 'low',
          Tested: ['integration test'],
        },
      });

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
        expect(result.intent).toBe('stdin commit');
        expect(result.trailers?.Confidence).toBe('low');
        expect(result.trailers?.Tested).toEqual(['integration test']);
      } finally {
        vi.restoreAllMocks();
      }
    });
  });
});
