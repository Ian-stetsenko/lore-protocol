import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConfigLoader } from '../../../src/services/config-loader.js';
import { DEFAULT_CONFIG } from '../../../src/types/config.js';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('ConfigLoader', () => {
  let loader: ConfigLoader;
  let tempDir: string;

  beforeEach(async () => {
    loader = new ConfigLoader();
    tempDir = await mkdtemp(join(tmpdir(), 'lore-config-test-'));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  /**
   * Helper to create a .lore/config.toml file in a directory.
   */
  async function createConfigFile(dir: string, content: string): Promise<string> {
    const loreDir = join(dir, '.lore');
    await mkdir(loreDir, { recursive: true });
    const configPath = join(loreDir, 'config.toml');
    await writeFile(configPath, content, 'utf-8');
    return configPath;
  }

  describe('loadFromFile', () => {
    it('should parse a valid TOML config file', async () => {
      const configPath = await createConfigFile(tempDir, `
[protocol]
version = "2.0"

[trailers]
required = ["Constraint", "Confidence"]
custom = ["Team"]

[validation]
strict = true
maxMessageLines = 100
intentMaxLength = 80

[stale]
olderThan = "1y"
driftThreshold = 50

[output]
defaultFormat = "json"

[follow]
maxDepth = 5
`);

      const config = await loader.loadFromFile(configPath);

      expect(config.protocol.version).toBe('2.0');
      expect(config.trailers.required).toEqual(['Constraint', 'Confidence']);
      expect(config.trailers.custom).toEqual(['Team']);
      expect(config.validation.strict).toBe(true);
      expect(config.validation.maxMessageLines).toBe(100);
      expect(config.validation.intentMaxLength).toBe(80);
      expect(config.stale.olderThan).toBe('1y');
      expect(config.stale.driftThreshold).toBe(50);
      expect(config.output.defaultFormat).toBe('json');
      expect(config.follow.maxDepth).toBe(5);
    });

    it('should merge partial config with defaults', async () => {
      const configPath = await createConfigFile(tempDir, `
[protocol]
version = "1.5"
`);

      const config = await loader.loadFromFile(configPath);

      expect(config.protocol.version).toBe('1.5');
      // All other sections should come from defaults
      expect(config.trailers).toEqual(DEFAULT_CONFIG.trailers);
      expect(config.validation).toEqual(DEFAULT_CONFIG.validation);
      expect(config.stale).toEqual(DEFAULT_CONFIG.stale);
      expect(config.output).toEqual(DEFAULT_CONFIG.output);
      expect(config.follow).toEqual(DEFAULT_CONFIG.follow);
    });

    it('should use defaults for empty config file', async () => {
      const configPath = await createConfigFile(tempDir, '');

      const config = await loader.loadFromFile(configPath);

      expect(config).toEqual(DEFAULT_CONFIG);
    });

    it('should handle only stale section', async () => {
      const configPath = await createConfigFile(tempDir, `
[stale]
olderThan = "30d"
driftThreshold = 10
`);

      const config = await loader.loadFromFile(configPath);

      expect(config.stale.olderThan).toBe('30d');
      expect(config.stale.driftThreshold).toBe(10);
      expect(config.protocol).toEqual(DEFAULT_CONFIG.protocol);
    });

    it('should throw on invalid TOML syntax', async () => {
      const configPath = await createConfigFile(tempDir, 'not valid toml [[[');

      await expect(loader.loadFromFile(configPath)).rejects.toThrow();
    });

    it('should parse snake_case TOML keys (canonical TOML format)', async () => {
      const configPath = await createConfigFile(tempDir, `
[protocol]
version = "2.0"

[validation]
strict = true
max_message_lines = 100
intent_max_length = 80

[stale]
older_than = "1y"
drift_threshold = 50

[output]
default_format = "json"

[follow]
max_depth = 5
`);

      const config = await loader.loadFromFile(configPath);

      expect(config.protocol.version).toBe('2.0');
      expect(config.validation.strict).toBe(true);
      expect(config.validation.maxMessageLines).toBe(100);
      expect(config.validation.intentMaxLength).toBe(80);
      expect(config.stale.olderThan).toBe('1y');
      expect(config.stale.driftThreshold).toBe(50);
      expect(config.output.defaultFormat).toBe('json');
      expect(config.follow.maxDepth).toBe(5);
    });

    it('should prefer snake_case over camelCase when both are present', async () => {
      const configPath = await createConfigFile(tempDir, `
[validation]
max_message_lines = 100
maxMessageLines = 50
`);

      const config = await loader.loadFromFile(configPath);

      expect(config.validation.maxMessageLines).toBe(100);
    });

    it('should handle output format validation', async () => {
      const configPath = await createConfigFile(tempDir, `
[output]
defaultFormat = "invalid"
`);

      const config = await loader.loadFromFile(configPath);

      // Invalid format should fall back to default
      expect(config.output.defaultFormat).toBe('text');
    });
  });

  describe('findConfigPath', () => {
    it('should find config in the same directory', async () => {
      await createConfigFile(tempDir, '[protocol]\nversion = "1.0"');

      const result = await loader.findConfigPath(tempDir);

      expect(result).toBe(join(tempDir, '.lore', 'config.toml'));
    });

    it('should find config in a parent directory', async () => {
      await createConfigFile(tempDir, '[protocol]\nversion = "1.0"');

      const childDir = join(tempDir, 'subdir', 'nested');
      await mkdir(childDir, { recursive: true });

      const result = await loader.findConfigPath(childDir);

      expect(result).toBe(join(tempDir, '.lore', 'config.toml'));
    });

    it('should return null when no config exists', async () => {
      const result = await loader.findConfigPath(tempDir);

      expect(result).toBeNull();
    });

    it('should find the nearest config when multiple exist', async () => {
      // Parent config
      await createConfigFile(tempDir, '[protocol]\nversion = "parent"');

      // Child config (closer to the start path)
      const childDir = join(tempDir, 'packages', 'app');
      await createConfigFile(childDir, '[protocol]\nversion = "child"');

      const result = await loader.findConfigPath(childDir);

      expect(result).toBe(join(childDir, '.lore', 'config.toml'));
    });
  });

  describe('loadForPath', () => {
    it('should return defaults when no config file exists', async () => {
      const config = await loader.loadForPath(tempDir);

      expect(config).toEqual(DEFAULT_CONFIG);
    });

    it('should load config from the nearest .lore/config.toml', async () => {
      await createConfigFile(tempDir, `
[protocol]
version = "2.0"

[stale]
olderThan = "1y"
`);

      const config = await loader.loadForPath(tempDir);

      expect(config.protocol.version).toBe('2.0');
      expect(config.stale.olderThan).toBe('1y');
    });

    it('should merge child config over parent config', async () => {
      // Parent config: sets protocol and stale
      await createConfigFile(tempDir, `
[protocol]
version = "1.0"

[stale]
olderThan = "1y"
driftThreshold = 50
`);

      // Child config: overrides stale only
      const childDir = join(tempDir, 'packages', 'app');
      await createConfigFile(childDir, `
[stale]
olderThan = "30d"
driftThreshold = 10
`);

      const config = await loader.loadForPath(childDir);

      // Child stale overrides parent stale completely
      expect(config.stale.olderThan).toBe('30d');
      expect(config.stale.driftThreshold).toBe(10);
      // Parent protocol section is preserved
      expect(config.protocol.version).toBe('1.0');
    });

    it('should handle three-level config hierarchy', async () => {
      // Grandparent: protocol
      await createConfigFile(tempDir, `
[protocol]
version = "1.0"

[stale]
olderThan = "1y"
driftThreshold = 100
`);

      // Parent: validation
      const parentDir = join(tempDir, 'packages');
      await createConfigFile(parentDir, `
[validation]
strict = true
maxMessageLines = 80
intentMaxLength = 60
`);

      // Child: stale (overrides grandparent stale)
      const childDir = join(parentDir, 'app');
      await createConfigFile(childDir, `
[stale]
olderThan = "7d"
driftThreshold = 5
`);

      const config = await loader.loadForPath(childDir);

      // Grandparent protocol
      expect(config.protocol.version).toBe('1.0');
      // Parent validation
      expect(config.validation.strict).toBe(true);
      expect(config.validation.maxMessageLines).toBe(80);
      // Child stale overrides grandparent stale
      expect(config.stale.olderThan).toBe('7d');
      expect(config.stale.driftThreshold).toBe(5);
    });

    it('should use shallow merge at section level', async () => {
      // Parent: full trailers section
      await createConfigFile(tempDir, `
[trailers]
required = ["Constraint", "Confidence"]
custom = ["Team", "Sprint"]
`);

      // Child: partial trailers section (overrides entire section)
      const childDir = join(tempDir, 'app');
      await createConfigFile(childDir, `
[trailers]
required = ["Lore-id"]
custom = []
`);

      const config = await loader.loadForPath(childDir);

      // Child replaces the entire trailers section, not individual fields
      expect(config.trailers.required).toEqual(['Lore-id']);
      expect(config.trailers.custom).toEqual([]);
    });

    it('should handle subdirectory that is deeper than config', async () => {
      await createConfigFile(tempDir, `
[protocol]
version = "1.5"
`);

      const deepDir = join(tempDir, 'a', 'b', 'c', 'd');
      await mkdir(deepDir, { recursive: true });

      const config = await loader.loadForPath(deepDir);

      expect(config.protocol.version).toBe('1.5');
    });
  });
});
