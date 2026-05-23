import { describe, it, expect, beforeEach } from 'vitest';
import { FlagsInputReader } from '../../../../src/services/readers/flags-input-reader.js';
import { DEFAULT_CONFIG } from '../../../../src/util/constants.js';
import { Protocol } from '../../../../src/services/protocol.js';
import type { CommitCommandOptions } from '../../../../src/services/commit-input-resolver.js';

describe('FlagsInputReader', () => {
  let protocol: Protocol;

  beforeEach(() => {
    protocol = new Protocol(DEFAULT_CONFIG);
  });

  it('should map all CLI options correctly', async () => {
    const options: CommitCommandOptions = {
      intent: 'feat: add auth',
      body: 'Detailed description',
      constraint: ['must be fast', 'no breaking changes'],
      rejected: ['approach A | too complex'],
      confidence: 'high',
      scopeRisk: 'wide',
      reversibility: 'clean',
      directive: ['Review in 3 months'],
      tested: ['Unit tests'],
      notTested: ['Edge cases'],
      supersedes: ['id1'],
      dependsOn: ['id2'],
      related: ['id3'],
    };

    const reader = new FlagsInputReader(options, protocol);
    const result = await reader.read();

    expect(result.intent).toBe('feat: add auth');
    expect(result.body).toBe('Detailed description');
    expect(result.trailers?.Constraint).toEqual(['must be fast', 'no breaking changes']);
    expect(result.trailers?.Rejected).toEqual(['approach A | too complex']);
    expect(result.trailers?.Confidence).toEqual(['high']);
    expect(result.trailers?.['Scope-risk']).toEqual(['wide']);
    expect(result.trailers?.Reversibility).toEqual(['clean']);
    expect(result.trailers?.Directive).toEqual(['Review in 3 months']);
    expect(result.trailers?.Tested).toEqual(['Unit tests']);
    expect(result.trailers?.['Not-tested']).toEqual(['Edge cases']);
    expect(result.trailers?.Supersedes).toEqual(['id1']);
    expect(result.trailers?.['Depends-on']).toEqual(['id2']);
    expect(result.trailers?.Related).toEqual(['id3']);
  });

  it('should default intent to empty string when undefined', async () => {
    const reader = new FlagsInputReader({}, protocol);
    const result = await reader.read();
    expect(result.intent).toBe('');
  });

  it('should leave body undefined when not provided', async () => {
    const reader = new FlagsInputReader({ intent: 't' }, protocol);
    const result = await reader.read();
    expect(result.body).toBeUndefined();
  });

  it('should leave array trailers undefined when not provided', async () => {
    const reader = new FlagsInputReader({ intent: 't' }, protocol);
    const result = await reader.read();
    expect(result.trailers?.Constraint).toBeUndefined();
  });

  it('should leave enum trailers undefined when not provided', async () => {
    const reader = new FlagsInputReader({ intent: 't' }, protocol);
    const result = await reader.read();
    expect(result.trailers?.Confidence).toBeUndefined();
  });

  it('should handle only intent and one trailer', async () => {
    const options: CommitCommandOptions = {
      intent: 'quick fix',
      confidence: 'low',
    };

    const reader = new FlagsInputReader(options, protocol);
    const result = await reader.read();

    expect(result.intent).toBe('quick fix');
    expect(result.trailers?.Confidence).toEqual(['low']);
    expect(result.trailers?.Constraint).toBeUndefined();
  });

  it('should parse custom trailers correctly', async () => {
    const options: CommitCommandOptions = {
      intent: 'feat',
      trailer: ['Team=Gamma', 'Ticket:123', 'Foo=Bar=Baz'],
    };

    const reader = new FlagsInputReader(options, protocol);
    const result = await reader.read();

    expect(result.trailers?.Team).toEqual(['Gamma']);
    expect(result.trailers?.Ticket).toEqual(['123']);
    expect(result.trailers?.Foo).toEqual(['Bar=Baz']);
  });

  it('should allow core trailers in the custom flag during parsing (validation caught later)', async () => {
    const options: CommitCommandOptions = {
      intent: 'feat',
      trailer: ['Confidence=high'],
    };

    const reader = new FlagsInputReader(options, protocol);
    const result = await reader.read();
    expect(result.trailers?.Confidence).toEqual(['high']);
  });

  it('should map core trailers dynamically using metadata', async () => {
    const options: any = {
      intent: 'dynamic',
      confidence: 'medium',
      reversibility: 'clean',
      constraint: ['c1'],
    };

    const reader = new FlagsInputReader(options, protocol);
    const result = await reader.read();

    expect(result.trailers?.Confidence).toEqual(['medium']);
    expect(result.trailers?.Reversibility).toEqual(['clean']);
    expect(result.trailers?.Constraint).toEqual(['c1']);
  });

  it('should map auto-generated flags for simple custom trailers', async () => {
    const config = {
      ...DEFAULT_CONFIG,
      trailers: { ...DEFAULT_CONFIG.trailers, custom: ['Squad', 'Team-Name'] },
    };
    const customProtocol = new Protocol(config);
    const options: any = {
      intent: 't',
      squad: ['Alpha'],
      teamName: ['Omega'],
    };

    const reader = new FlagsInputReader(options, customProtocol);
    const result = await reader.read();

    expect(result.trailers?.Squad).toEqual(['Alpha']);
    expect(result.trailers?.['Team-Name']).toEqual(['Omega']);
  });

  it('should prioritize explicit cli flags over automatic ones', async () => {
    const config = {
      ...DEFAULT_CONFIG,
      trailers: {
        ...DEFAULT_CONFIG.trailers,
        definitions: {
          Department: {
            description: 'dept',
            multivalue: false,
            validation: 'none' as const,
            cli: { flag: 'dept' },
          },
        },
      },
    };
    const customProtocol = new Protocol(config);
    const options: any = {
      intent: 't',
      dept: 'Eng',
    };

    const reader = new FlagsInputReader(options, customProtocol);
    const result = await reader.read();

    expect(result.trailers?.Department).toEqual(['Eng']);
  });

  it('should map case-insensitive flags for custom defined trailers', async () => {
    const config = {
      ...DEFAULT_CONFIG,
      trailers: {
        ...DEFAULT_CONFIG.trailers,
        definitions: {
          'Assisted-By': { // Pascal-Kebab canonical key
            description: 'A',
            multivalue: true,
            validation: 'none' as const,
          },
        },
      },
    };
    const customProtocol = new Protocol(config);
    const options: any = {
      intent: 't',
      assistedBy: ['Gemini'], // camelCase from kebab-case --assisted-by
    };

    const reader = new FlagsInputReader(options, customProtocol);
    const result = await reader.read();

    expect(result.trailers?.['Assisted-By']).toEqual(['Gemini']);
  });
});
