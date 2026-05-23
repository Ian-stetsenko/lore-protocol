import { describe, it, expect } from 'vitest';
import { FlagsInputReader } from '../../../src/services/readers/flags-input-reader.js';
import { JsonFormatter } from '../../../src/formatters/json-formatter.js';
import { DEFAULT_CONFIG } from '../../../src/util/constants.js';
import { Protocol } from '../../../src/services/protocol.js';
import { LORE_ID_KEY } from '../../../src/util/constants.js';
import type { CommitCommandOptions } from '../../../src/services/commit-input-resolver.js';
import type { FormattableQueryResult } from '../../../src/types/output.js';

/**
 * High-level integration tests for the Lore Protocol's architectural integrity.
 * Verifies that the metadata-driven design correctly flows data from the CLI
 * through to the formatted output.
 */
describe('Protocol Architectural Integrity', () => {
  it('should flow custom trailers from CLI flags to JSON output via metadata', async () => {
    // 1. Setup metadata in config
    const config = {
      ...DEFAULT_CONFIG,
      trailers: {
        ...DEFAULT_CONFIG.trailers,
        definitions: {
          'Ticket-ID': {
            description: 'Issue tracker reference',
            multivalue: true,
            validation: 'pattern' as const,
            pattern: '^[A-Z]+-[0-9]+$',
            ui: { kind: 'reference' as any, color: 'dim' as any },
          },
        },
      },
    };

    const protocol = new Protocol(config);
    const options: CommitCommandOptions = {
      intent: 'feat: add stuff',
      'ticket-id': ['PROJ-123', 'PROJ-456'],
    } as any;

    const reader = new FlagsInputReader(options, protocol);
    const input = await reader.read();

    // 2. Verify Reader mapped it correctly as a top-level property
    expect(input.trailers?.['Ticket-ID']).toEqual(['PROJ-123', 'PROJ-456']);

    // 3. Simulate Query Result (Core Logic)
    const atom = {
      loreId: 'atom-123',
      commitHash: 'abc',
      date: new Date(),
      author: 'alice',
      intent: input.intent,
      body: '',
      trailers: {
        [LORE_ID_KEY]: ['atom-123'],
        ...input.trailers,
      } as any,
      filesChanged: [],
    };

    const data: FormattableQueryResult = {
      result: {
        command: 'context',
        target: 't',
        targetType: 'file',
        atoms: [atom],
        meta: { totalAtoms: 1, filteredAtoms: 1, oldest: atom.date, newest: atom.date },
      },
      supersessionMap: new Map(),
      visibleTrailers: 'all',
      trailerDefinitions: protocol.getFormattableDefinitions(),
    };

    // 4. Verify Formatter serializes it correctly
    const formatter = new JsonFormatter();
    const output = JSON.parse(formatter.formatQueryResult(data));
    
    // Key should be snake_cased in JSON
    expect(output.results[0].trailers.ticket_id).toEqual(['PROJ-123', 'PROJ-456']);
  });

  it('should handle a hybrid flow of core and custom trailers simultaneously', async () => {
    const protocol = new Protocol(DEFAULT_CONFIG);
    const options: CommitCommandOptions = {
      intent: 'feat',
      confidence: 'high',
      trailer: ['Project-Code:LORE-001'],
    };

    const reader = new FlagsInputReader(options, protocol);
    const input = await reader.read();

    // Verify both are captured correctly at top level
    expect(input.trailers?.Confidence).toEqual(['high']);
    expect(input.trailers?.['Project-Code']).toEqual(['LORE-001']);
  });
});
