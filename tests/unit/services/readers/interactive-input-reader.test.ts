import { describe, it, expect, vi } from 'vitest';
import { InteractiveInputReader } from '../../../../src/services/readers/interactive-input-reader.js';
import { createTrailerCollectors } from '../../../../src/services/readers/collectors/trailer-collector-registry.js';
import type { IPrompt } from '../../../../src/interfaces/prompt.js';

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

describe('InteractiveInputReader', () => {
  describe('full flow', () => {
    it('should collect all fields when user accepts everything', async () => {
      let confirmCallIndex = 0;
      const confirmResponses = [
        true,   // Add a body?
        true,   // Add a Constraint? (yes)
        false,  // Add another Constraint? (no)
        true,   // Add a Rejected? (yes)
        false,  // Add another Rejected? (no)
        true,   // Set Confidence?
        true,   // Set Scope-risk?
        true,   // Set Reversibility?
        true,   // Add a Directive? (yes)
        false,  // Add another Directive? (no)
        true,   // Add a Tested? (yes)
        false,  // Add another Tested? (no)
        true,   // Add a Not-tested? (yes)
        false,  // Add another Not-tested? (no)
        true,   // Add a Supersedes? (yes)
        false,  // Add another Supersedes? (no)
        true,   // Add a Depends-on? (yes)
        false,  // Add another Depends-on? (no)
        true,   // Add a Related? (yes)
        false,  // Add another Related? (no)
      ];

      let textCallIndex = 0;
      const textResponses = [
        'refactor auth module',   // intent
        'must be fast',           // Constraint value
        'approach A | too slow',  // Rejected value
        'use new API',            // Directive value
        'unit tests pass',        // Tested value
        'load testing',           // Not-tested value
        'abcd1234',               // Supersedes value
        'dead0000',               // Depends-on value
        'beef1234',               // Related value
      ];

      let choiceCallIndex = 0;
      const choiceResponses = ['high', 'wide', 'clean'];

      const prompt = createMockPrompt({
        askText: vi.fn().mockImplementation(() => {
          const response = textResponses[textCallIndex] ?? '';
          textCallIndex++;
          return Promise.resolve(response);
        }),
        askMultiline: vi.fn().mockResolvedValue('This is the body text.'),
        askConfirm: vi.fn().mockImplementation(() => {
          const response = confirmResponses[confirmCallIndex] ?? false;
          confirmCallIndex++;
          return Promise.resolve(response);
        }),
        askChoice: vi.fn().mockImplementation(() => {
          const response = choiceResponses[choiceCallIndex] ?? 'low';
          choiceCallIndex++;
          return Promise.resolve(response);
        }),
        close: vi.fn(),
      });

      const reader = new InteractiveInputReader(prompt, createTrailerCollectors());
      const result = await reader.read();

      expect(result.intent).toBe('refactor auth module');
      expect(result.body).toBe('This is the body text.');
      expect(result.trailers?.Constraint).toEqual(['must be fast']);
      expect(result.trailers?.Rejected).toEqual(['approach A | too slow']);
      expect(result.trailers?.Confidence).toBe('high');
      expect(result.trailers?.['Scope-risk']).toBe('wide');
      expect(result.trailers?.Reversibility).toBe('clean');
      expect(result.trailers?.Directive).toEqual(['use new API']);
      expect(result.trailers?.Tested).toEqual(['unit tests pass']);
      expect(result.trailers?.['Not-tested']).toEqual(['load testing']);
      expect(result.trailers?.Supersedes).toEqual(['abcd1234']);
      expect(result.trailers?.['Depends-on']).toEqual(['dead0000']);
      expect(result.trailers?.Related).toEqual(['beef1234']);
      expect(prompt.close).toHaveBeenCalled();
    });
  });

  describe('minimal flow', () => {
    it('should return intent only when user declines everything', async () => {
      const prompt = createMockPrompt({
        askText: vi.fn().mockResolvedValue('minimal intent'),
        askConfirm: vi.fn().mockResolvedValue(false),
        close: vi.fn(),
      });

      const reader = new InteractiveInputReader(prompt, createTrailerCollectors());
      const result = await reader.read();

      expect(result.intent).toBe('minimal intent');
      expect(result.body).toBeUndefined();
      expect(result.trailers?.Constraint).toBeUndefined();
      expect(result.trailers?.Rejected).toBeUndefined();
      expect(result.trailers?.Confidence).toBeUndefined();
      expect(result.trailers?.['Scope-risk']).toBeUndefined();
      expect(result.trailers?.Reversibility).toBeUndefined();
      expect(result.trailers?.Directive).toBeUndefined();
      expect(result.trailers?.Tested).toBeUndefined();
      expect(result.trailers?.['Not-tested']).toBeUndefined();
      expect(result.trailers?.Supersedes).toBeUndefined();
      expect(result.trailers?.['Depends-on']).toBeUndefined();
      expect(result.trailers?.Related).toBeUndefined();
      expect(prompt.close).toHaveBeenCalled();
    });
  });

  describe('multiple values collection', () => {
    it('should collect multiple constraints', async () => {
      let confirmCallIndex = 0;
      const confirmResponses = [
        false,  // Add a body? (no)
        true,   // Add a Constraint? (yes)
        true,   // Add another Constraint? (yes)
        true,   // Add another Constraint? (yes)
        false,  // Add another Constraint? (no)
        false,  // Add a Rejected? (no)
        false,  // Set Confidence? (no)
        false,  // Set Scope-risk? (no)
        false,  // Set Reversibility? (no)
        false,  // Add a Directive? (no)
        false,  // Add a Tested? (no)
        false,  // Add a Not-tested? (no)
        false,  // Add a Supersedes? (no)
        false,  // Add a Depends-on? (no)
        false,  // Add a Related? (no)
      ];

      let textCallIndex = 0;
      const textResponses = [
        'test intent',          // intent
        'constraint one',       // first constraint
        'constraint two',       // second constraint
        'constraint three',     // third constraint
      ];

      const prompt = createMockPrompt({
        askText: vi.fn().mockImplementation(() => {
          const response = textResponses[textCallIndex] ?? '';
          textCallIndex++;
          return Promise.resolve(response);
        }),
        askConfirm: vi.fn().mockImplementation(() => {
          const response = confirmResponses[confirmCallIndex] ?? false;
          confirmCallIndex++;
          return Promise.resolve(response);
        }),
        close: vi.fn(),
      });

      const reader = new InteractiveInputReader(prompt, createTrailerCollectors());
      const result = await reader.read();

      expect(result.trailers?.Constraint).toEqual([
        'constraint one',
        'constraint two',
        'constraint three',
      ]);
    });

    it('should skip empty/whitespace-only values', async () => {
      let confirmCallIndex = 0;
      const confirmResponses = [
        false,  // Add a body? (no)
        true,   // Add a Constraint? (yes)
        true,   // Add another Constraint? (yes -- but value is empty)
        false,  // Add another Constraint? (no)
        false,  // Add a Rejected? (no)
        false,  // Set Confidence? (no)
        false,  // Set Scope-risk? (no)
        false,  // Set Reversibility? (no)
        false,  // Add a Directive? (no)
        false,  // Add a Tested? (no)
        false,  // Add a Not-tested? (no)
        false,  // Add a Supersedes? (no)
        false,  // Add a Depends-on? (no)
        false,  // Add a Related? (no)
      ];

      let textCallIndex = 0;
      const textResponses = [
        'test intent',    // intent
        'valid value',    // first constraint
        '   ',            // second constraint (whitespace only, should be skipped)
      ];

      const prompt = createMockPrompt({
        askText: vi.fn().mockImplementation(() => {
          const response = textResponses[textCallIndex] ?? '';
          textCallIndex++;
          return Promise.resolve(response);
        }),
        askConfirm: vi.fn().mockImplementation(() => {
          const response = confirmResponses[confirmCallIndex] ?? false;
          confirmCallIndex++;
          return Promise.resolve(response);
        }),
        close: vi.fn(),
      });

      const reader = new InteractiveInputReader(prompt, createTrailerCollectors());
      const result = await reader.read();

      expect(result.trailers?.Constraint).toEqual(['valid value']);
    });
  });

  describe('prompt.close on error', () => {
    it('should call prompt.close even when askText throws', async () => {
      const prompt = createMockPrompt({
        askText: vi.fn().mockRejectedValue(new Error('prompt error')),
        close: vi.fn(),
      });

      const reader = new InteractiveInputReader(prompt, createTrailerCollectors());

      await expect(reader.read()).rejects.toThrow('prompt error');
      expect(prompt.close).toHaveBeenCalled();
    });

    it('should call prompt.close even when askConfirm throws', async () => {
      const prompt = createMockPrompt({
        askText: vi.fn().mockResolvedValue('test intent'),
        askConfirm: vi.fn().mockRejectedValue(new Error('confirm error')),
        close: vi.fn(),
      });

      const reader = new InteractiveInputReader(prompt, createTrailerCollectors());

      await expect(reader.read()).rejects.toThrow('confirm error');
      expect(prompt.close).toHaveBeenCalled();
    });
  });
});
