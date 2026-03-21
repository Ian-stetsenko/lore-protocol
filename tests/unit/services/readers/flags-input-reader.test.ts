import { describe, it, expect } from 'vitest';
import { FlagsInputReader } from '../../../../src/services/readers/flags-input-reader.js';
import type { CommitCommandOptions } from '../../../../src/services/commit-input-resolver.js';

describe('FlagsInputReader', () => {
  it('should map all CLI options correctly', async () => {
    const options: CommitCommandOptions = {
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
    };

    const reader = new FlagsInputReader(options);
    const result = await reader.read();

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

  it('should default intent to empty string when undefined', async () => {
    const options: CommitCommandOptions = {};

    const reader = new FlagsInputReader(options);
    const result = await reader.read();

    expect(result.intent).toBe('');
  });

  it('should leave body undefined when not provided', async () => {
    const options: CommitCommandOptions = {
      intent: 'test intent',
    };

    const reader = new FlagsInputReader(options);
    const result = await reader.read();

    expect(result.body).toBeUndefined();
  });

  it('should leave array trailers undefined when not provided', async () => {
    const options: CommitCommandOptions = {
      intent: 'test intent',
    };

    const reader = new FlagsInputReader(options);
    const result = await reader.read();

    expect(result.trailers?.Constraint).toBeUndefined();
    expect(result.trailers?.Rejected).toBeUndefined();
    expect(result.trailers?.Directive).toBeUndefined();
    expect(result.trailers?.Tested).toBeUndefined();
    expect(result.trailers?.['Not-tested']).toBeUndefined();
    expect(result.trailers?.Supersedes).toBeUndefined();
    expect(result.trailers?.['Depends-on']).toBeUndefined();
    expect(result.trailers?.Related).toBeUndefined();
  });

  it('should leave enum trailers undefined when not provided', async () => {
    const options: CommitCommandOptions = {
      intent: 'test intent',
    };

    const reader = new FlagsInputReader(options);
    const result = await reader.read();

    expect(result.trailers?.Confidence).toBeUndefined();
    expect(result.trailers?.['Scope-risk']).toBeUndefined();
    expect(result.trailers?.Reversibility).toBeUndefined();
  });

  it('should handle only intent and one trailer', async () => {
    const options: CommitCommandOptions = {
      intent: 'quick fix',
      confidence: 'low',
    };

    const reader = new FlagsInputReader(options);
    const result = await reader.read();

    expect(result.intent).toBe('quick fix');
    expect(result.trailers?.Confidence).toBe('low');
    expect(result.trailers?.Constraint).toBeUndefined();
  });
});
