import { describe, it, expect, vi } from 'vitest';
import { EnumChoiceTrailerCollector } from '../../../../../src/services/readers/collectors/enum-choice-trailer-collector.js';
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

describe('EnumChoiceTrailerCollector', () => {
  const config = {
    key: 'Confidence' as const,
    confirmMessage: 'Set Confidence?',
    choiceMessage: 'Confidence:',
    values: ['low', 'medium', 'high'] as const,
  };

  it('should return undefined when user declines', async () => {
    const prompt = createMockPrompt({
      askConfirm: vi.fn().mockResolvedValue(false),
    });

    const collector = new EnumChoiceTrailerCollector(config);
    const result = await collector.collect(prompt);

    expect(result.key).toBe('Confidence');
    expect(result.value).toBeUndefined();
  });

  it('should return chosen value when user accepts', async () => {
    const prompt = createMockPrompt({
      askConfirm: vi.fn().mockResolvedValue(true),
      askChoice: vi.fn().mockResolvedValue('high'),
    });

    const collector = new EnumChoiceTrailerCollector(config);
    const result = await collector.collect(prompt);

    expect(result.key).toBe('Confidence');
    expect(result.value).toBe('high');
  });

  it('should pass correct messages and values to prompt', async () => {
    const askConfirm = vi.fn().mockResolvedValue(true);
    const askChoice = vi.fn().mockResolvedValue('medium');
    const prompt = createMockPrompt({ askConfirm, askChoice });

    const collector = new EnumChoiceTrailerCollector(config);
    await collector.collect(prompt);

    expect(askConfirm).toHaveBeenCalledWith('Set Confidence?', false);
    expect(askChoice).toHaveBeenCalledWith('Confidence:', ['low', 'medium', 'high']);
  });

  it('should not call askChoice when user declines', async () => {
    const askChoice = vi.fn();
    const prompt = createMockPrompt({
      askConfirm: vi.fn().mockResolvedValue(false),
      askChoice,
    });

    const collector = new EnumChoiceTrailerCollector(config);
    await collector.collect(prompt);

    expect(askChoice).not.toHaveBeenCalled();
  });

  it('should work with Scope-risk config', async () => {
    const scopeRiskConfig = {
      key: 'Scope-risk' as const,
      confirmMessage: 'Set Scope-risk?',
      choiceMessage: 'Scope-risk:',
      values: ['narrow', 'moderate', 'wide'] as const,
    };

    const prompt = createMockPrompt({
      askConfirm: vi.fn().mockResolvedValue(true),
      askChoice: vi.fn().mockResolvedValue('wide'),
    });

    const collector = new EnumChoiceTrailerCollector(scopeRiskConfig);
    const result = await collector.collect(prompt);

    expect(result.key).toBe('Scope-risk');
    expect(result.value).toBe('wide');
  });
});
