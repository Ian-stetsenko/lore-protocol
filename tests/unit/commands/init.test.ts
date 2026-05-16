import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Command } from 'commander';
import { registerInitCommand } from '../../../src/commands/init.js';
import type { IOutputFormatter } from '../../../src/interfaces/output-formatter.js';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { CONFIG_DIR, CONFIG_FILENAME } from '../../../src/util/constants.js';

vi.mock('node:fs/promises');

describe('registerInitCommand', () => {
  const formatter: IOutputFormatter = {
    formatSuccess: vi.fn((msg) => `SUCCESS: ${msg}`),
    formatError: vi.fn((code, messages) => `ERROR: ${messages[0].message} (code ${code})`),
    formatQueryResult: vi.fn(),
    formatValidationResult: vi.fn(),
    formatStalenessResult: vi.fn(),
    formatTraceResult: vi.fn(),
    formatDoctorResult: vi.fn(),
  };

  let consoleLogSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    // Default: file does not exist
    vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it('creates a new config file if one does not exist', async () => {
    const program = new Command();
    registerInitCommand(program, { getFormatter: () => formatter });

    await program.parseAsync(['node', 'lore', 'init']);

    expect(fs.mkdir).toHaveBeenCalledWith(expect.stringContaining(CONFIG_DIR), { recursive: true });
    expect(fs.writeFile).toHaveBeenCalledWith(
      expect.stringContaining(join(CONFIG_DIR, CONFIG_FILENAME)),
      expect.stringContaining('[protocol]'),
      'utf-8'
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Created .lore/config.toml'));
  });

  it('reports an existing valid config with no gaps', async () => {
    const fullConfig = `[protocol]
version = "1.0"
[trailers]
required = []
custom = []
[validation]
strict = false
max_message_lines = 50
intent_max_length = 72
[stale]
older_than = "6m"
drift_threshold = 20
[output]
default_format = "text"
[follow]
max_depth = 3
[cli]
update_check = true
`;
    vi.mocked(fs.access).mockResolvedValue(undefined);
    vi.mocked(fs.readFile).mockResolvedValue(fullConfig);

    const program = new Command();
    registerInitCommand(program, { getFormatter: () => formatter });

    await program.parseAsync(['node', 'lore', 'init']);

    expect(fs.writeFile).not.toHaveBeenCalled();
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Config already exists'));
    // Should NOT have warning about missing options
    expect(consoleLogSpy).not.toHaveBeenCalledWith(expect.stringContaining('WARNING: Your configuration is missing new options:'));
  });

  it('reports missing options and suggests safe reset if no customizations exist', async () => {
    const minimalConfig = `[protocol]
  version = "1.0"
  `;
    vi.mocked(fs.access).mockResolvedValue(undefined);
    vi.mocked(fs.readFile).mockResolvedValue(minimalConfig);

    const program = new Command();
    registerInitCommand(program, { getFormatter: () => formatter });

    await program.parseAsync(['node', 'lore', 'init']);

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('SUCCESS: Your configuration is missing new options:'));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('- [trailers] section'));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Notice: You are using default settings. You can safely reset your config'));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('rm .lore/config.toml && lore init'));
  });

  it('reports missing options and suggests manual merge if customizations exist', async () => {
    const customizedConfig = `[protocol]
  version = "1.0"
  [validation]
  strict = true
  `;
    vi.mocked(fs.access).mockResolvedValue(undefined);
    vi.mocked(fs.readFile).mockResolvedValue(customizedConfig);

    const program = new Command();
    registerInitCommand(program, { getFormatter: () => formatter });

    await program.parseAsync(['node', 'lore', 'init']);

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('SUCCESS: Your configuration is missing new options:'));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('- [trailers] section'));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('Notice: You have customized the following options:'));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('- validation.strict'));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('To update: Rename your current config'));
  });

  it('reports individual missing keys when section exists', async () => {

    const configWithMissingKey = `[protocol]
    version = "1.0"
    [trailers]
    required = []
    custom = []
    [validation]
    strict = false
    max_message_lines = 50
    intent_max_length = 72
    [stale]
    older_than = "6m"
    drift_threshold = 20
    [output]
    default_format = "text"
    [follow]
    # max_depth is missing
    [cli]
    update_check = true
    `;
    vi.mocked(fs.access).mockResolvedValue(undefined);
    vi.mocked(fs.readFile).mockResolvedValue(configWithMissingKey);

    const program = new Command();
    registerInitCommand(program, { getFormatter: () => formatter });

    await program.parseAsync(['node', 'lore', 'init']);

    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('SUCCESS: Your configuration is missing new options:'));
    expect(consoleLogSpy).toHaveBeenCalledWith(expect.stringContaining('- follow.max_depth'));
    });

    it('reports corruption if the existing config is invalid TOML', async () => {
      const corruptedConfig = `[protocol]
    version = "1.0
    invalid = [missing bracket
    `;
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockResolvedValue(corruptedConfig);

      const program = new Command();
      program.exitOverride();
      registerInitCommand(program, { getFormatter: () => formatter });

      await expect(program.parseAsync(['node', 'lore', 'init']))
        .rejects.toThrow(/Your configuration file is corrupted/);
    });

});
