import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';
import { registerCommitCommand } from '../../../src/commands/commit.js';
import { Protocol } from '../../../src/services/protocol.js';
import { DEFAULT_CONFIG } from '../../../src/util/constants.js';

describe('lore commit (dynamic flags)', () => {
  const mockDeps = {
    commitBuilder: { build: vi.fn(), validate: vi.fn(() => []) },
    gitClient: { commit: vi.fn().mockResolvedValue({ hash: 'h1' }), hasStagedChanges: vi.fn().mockResolvedValue(true) },
    getFormatter: () => ({ formatSuccess: vi.fn() }),
    commitInputResolver: { resolve: vi.fn().mockResolvedValue({ intent: 'i' }) },
    headLoreIdReader: { read: vi.fn() },
    config: DEFAULT_CONFIG,
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should register flags for custom trailers defined in config', async () => {
    const config = {
      ...DEFAULT_CONFIG,
      trailers: {
        ...DEFAULT_CONFIG.trailers,
        definitions: {
          Department: {
            description: 'Dept',
            multivalue: false,
            validation: 'none' as const,
            cli: { flag: 'dept' }
          }
        }
      }
    };
    const protocol = new Protocol(config);
    const program = new Command();
    
    registerCommitCommand(program, { ...mockDeps, config, protocol });
    
    const commitCmd = program.commands.find(c => c.name() === 'commit');
    expect(commitCmd).toBeDefined();
    
    const deptOption = commitCmd?.options.find(o => o.long === '--dept');
    expect(deptOption).toBeDefined();
    expect(deptOption?.description).toContain('Dept');
  });

  it('should automatically slugify custom trailer keys into flags', async () => {
    const config = {
      ...DEFAULT_CONFIG,
      trailers: {
        ...DEFAULT_CONFIG.trailers,
        definitions: {
          'Assisted-by': {
            description: 'A',
            multivalue: true,
            validation: 'none' as const
          }
        }
      }
    };
    const protocol = new Protocol(config);
    const program = new Command();
    
    registerCommitCommand(program, { ...mockDeps, config, protocol });
    
    const commitCmd = program.commands.find(c => c.name() === 'commit');
    const assistedOption = commitCmd?.options.find(o => o.long === '--assisted-by');
    expect(assistedOption).toBeDefined();
  });
});
