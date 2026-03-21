import { describe, it, expect, vi } from 'vitest';
import { MultiValueTrailerCollector } from '../../../../../src/services/readers/collectors/multi-value-trailer-collector.js';
import type { IPrompt } from '../../../../../src/interfaces/prompt.js';

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

describe('MultiValueTrailerCollector', () => {
  const config = {
    key: 'Constraint' as const,
    confirmMessage: 'Add a Constraint?',
    inputMessage: 'Constraint:',
  };

  it('should return undefined when user declines immediately', async () => {
    const prompt = createMockPrompt({
      askConfirm: vi.fn().mockResolvedValue(false),
    });

    const collector = new MultiValueTrailerCollector(config);
    const result = await collector.collect(prompt);

    expect(result.key).toBe('Constraint');
    expect(result.value).toBeUndefined();
  });

  it('should collect one value when user adds one then declines', async () => {
    let confirmIndex = 0;
    const confirmResponses = [true, false];

    const prompt = createMockPrompt({
      askConfirm: vi.fn().mockImplementation(() => {
        const response = confirmResponses[confirmIndex] ?? false;
        confirmIndex++;
        return Promise.resolve(response);
      }),
      askText: vi.fn().mockResolvedValue('must be fast'),
    });

    const collector = new MultiValueTrailerCollector(config);
    const result = await collector.collect(prompt);

    expect(result.key).toBe('Constraint');
    expect(result.value).toEqual(['must be fast']);
  });

  it('should collect multiple values when user adds several', async () => {
    let confirmIndex = 0;
    const confirmResponses = [true, true, true, false];

    let textIndex = 0;
    const textResponses = ['constraint one', 'constraint two', 'constraint three'];

    const prompt = createMockPrompt({
      askConfirm: vi.fn().mockImplementation(() => {
        const response = confirmResponses[confirmIndex] ?? false;
        confirmIndex++;
        return Promise.resolve(response);
      }),
      askText: vi.fn().mockImplementation(() => {
        const response = textResponses[textIndex] ?? '';
        textIndex++;
        return Promise.resolve(response);
      }),
    });

    const collector = new MultiValueTrailerCollector(config);
    const result = await collector.collect(prompt);

    expect(result.key).toBe('Constraint');
    expect(result.value).toEqual(['constraint one', 'constraint two', 'constraint three']);
  });

  it('should skip whitespace-only values', async () => {
    let confirmIndex = 0;
    const confirmResponses = [true, true, false];

    let textIndex = 0;
    const textResponses = ['valid value', '   '];

    const prompt = createMockPrompt({
      askConfirm: vi.fn().mockImplementation(() => {
        const response = confirmResponses[confirmIndex] ?? false;
        confirmIndex++;
        return Promise.resolve(response);
      }),
      askText: vi.fn().mockImplementation(() => {
        const response = textResponses[textIndex] ?? '';
        textIndex++;
        return Promise.resolve(response);
      }),
    });

    const collector = new MultiValueTrailerCollector(config);
    const result = await collector.collect(prompt);

    expect(result.key).toBe('Constraint');
    expect(result.value).toEqual(['valid value']);
  });

  it('should trim values', async () => {
    let confirmIndex = 0;
    const confirmResponses = [true, false];

    const prompt = createMockPrompt({
      askConfirm: vi.fn().mockImplementation(() => {
        const response = confirmResponses[confirmIndex] ?? false;
        confirmIndex++;
        return Promise.resolve(response);
      }),
      askText: vi.fn().mockResolvedValue('  padded value  '),
    });

    const collector = new MultiValueTrailerCollector(config);
    const result = await collector.collect(prompt);

    expect(result.value).toEqual(['padded value']);
  });

  it('should return undefined when all entered values are whitespace', async () => {
    let confirmIndex = 0;
    const confirmResponses = [true, true, false];

    const prompt = createMockPrompt({
      askConfirm: vi.fn().mockImplementation(() => {
        const response = confirmResponses[confirmIndex] ?? false;
        confirmIndex++;
        return Promise.resolve(response);
      }),
      askText: vi.fn().mockResolvedValue('   '),
    });

    const collector = new MultiValueTrailerCollector(config);
    const result = await collector.collect(prompt);

    expect(result.key).toBe('Constraint');
    expect(result.value).toBeUndefined();
  });

  it('should pass correct messages to prompt', async () => {
    const askConfirm = vi.fn().mockResolvedValue(false);
    const prompt = createMockPrompt({ askConfirm });

    const collector = new MultiValueTrailerCollector(config);
    await collector.collect(prompt);

    expect(askConfirm).toHaveBeenCalledWith('Add a Constraint?', false);
  });
});
