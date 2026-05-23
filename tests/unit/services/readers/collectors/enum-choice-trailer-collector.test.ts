import { describe, it, expect, vi } from 'vitest';
import { EnumChoiceTrailerCollector } from '../../../../../src/services/readers/collectors/enum-choice-trailer-collector.js';
import type { IPrompt } from '../../../../../src/interfaces/prompt.js';

describe('EnumChoiceTrailerCollector', () => {
  it('should return undefined when user declines', async () => {
    const askConfirm = vi.fn().mockResolvedValue(false);
    const prompt = { askConfirm } as any;

    const collector = new EnumChoiceTrailerCollector({
      key: 'Confidence',
      confirmMessage: 'Set Confidence?',
      choiceMessage: 'Confidence:',
      values: ['low', 'medium', 'high'],
    });

    const result = await collector.collect(prompt);

    expect(result).toEqual({ key: 'Confidence', value: undefined });
    expect(askConfirm).toHaveBeenCalled();
  });

  it('should return chosen value when user accepts', async () => {
    const askConfirm = vi.fn().mockResolvedValue(true);
    const askChoice = vi.fn().mockResolvedValue('medium');
    const prompt = { askConfirm, askChoice } as any;

    const collector = new EnumChoiceTrailerCollector({
      key: 'Confidence',
      confirmMessage: 'Set Confidence?',
      choiceMessage: 'Confidence:',
      values: ['low', 'medium', 'high'],
    });

    const result = await collector.collect(prompt);

    expect(result).toEqual({ key: 'Confidence', value: 'medium' });
    expect(askChoice).toHaveBeenCalled();
  });

  it('should pass correct messages and values to prompt', async () => {
    const askConfirm = vi.fn().mockResolvedValue(true);
    const askChoice = vi.fn().mockResolvedValue('high');
    const prompt = { askConfirm, askChoice } as any;

    const collector = new EnumChoiceTrailerCollector({
      key: 'Confidence',
      confirmMessage: 'Set Confidence?',
      choiceMessage: 'Confidence:',
      values: ['low', 'medium', 'high'],
    });

    await collector.collect(prompt);

    expect(askConfirm).toHaveBeenCalledWith('Set Confidence?', false);
    expect(askChoice).toHaveBeenCalledWith('Confidence:', ['low', 'medium', 'high']);
  });

  it('should not call askChoice when user declines', async () => {
    const askConfirm = vi.fn().mockResolvedValue(false);
    const askChoice = vi.fn();
    const prompt = { askConfirm, askChoice } as any;

    const collector = new EnumChoiceTrailerCollector({
      key: 'Confidence',
      confirmMessage: 'Set Confidence?',
      choiceMessage: 'Confidence:',
      values: ['low', 'medium', 'high'],
    });

    await collector.collect(prompt);

    expect(askChoice).not.toHaveBeenCalled();
  });

  it('should work with Scope-risk config', async () => {
    const askConfirm = vi.fn().mockResolvedValue(true);
    const askChoice = vi.fn().mockResolvedValue('narrow');
    const prompt = { askConfirm, askChoice } as any;

    const collector = new EnumChoiceTrailerCollector({
      key: 'Scope-risk',
      confirmMessage: 'Set Scope-risk?',
      choiceMessage: 'Scope-risk:',
      values: ['narrow', 'moderate', 'wide'],
    });

    const result = await collector.collect(prompt);

    expect(result).toEqual({ key: 'Scope-risk', value: 'narrow' });
    expect(askChoice).toHaveBeenCalledWith('Scope-risk:', ['narrow', 'moderate', 'wide']);
  });
});
