import { readFile, access } from 'node:fs/promises';
import { join, dirname, resolve, parse as parsePath } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import type { IConfigLoader } from '../interfaces/config-loader.js';
import type { LoreConfig } from '../types/config.js';
import { DEFAULT_CONFIG } from '../types/config.js';

type MutableLoreConfig = { -readonly [K in keyof LoreConfig]: { -readonly [P in keyof LoreConfig[K]]: LoreConfig[K][P] } };
import { CONFIG_DIR, CONFIG_FILENAME } from '../util/constants.js';

/**
 * Loads and merges .lore/config.toml files.
 * Walks up the directory tree for monorepo support.
 *
 * GRASP: Pure Fabrication -- filesystem access abstracted from domain.
 * SOLID: LSP -- implements IConfigLoader, substitutable in tests.
 *
 * Merge strategy: shallow merge at the section level.
 * Child values replace parent values completely at the section level.
 * The final result is merged with DEFAULT_CONFIG so that all fields are present.
 */
export class ConfigLoader implements IConfigLoader {
  /**
   * Load config for a given path by walking up the directory tree
   * to find .lore/config.toml files. Multiple config files are merged
   * with child overriding parent.
   */
  async loadForPath(targetPath: string): Promise<LoreConfig> {
    const resolvedPath = resolve(targetPath);
    const configPaths = await this.findAllConfigPaths(resolvedPath);

    if (configPaths.length === 0) {
      return { ...DEFAULT_CONFIG };
    }

    // Config files are ordered from nearest (child) to farthest (parent).
    // We merge parent-first so child overrides parent.
    const reversed = [...configPaths].reverse();

    let merged: Partial<MutableLoreConfig> = {};
    for (const configPath of reversed) {
      const parsed = await this.parseConfigFile(configPath);
      merged = this.mergeConfigs(merged, parsed);
    }

    return this.mergeWithDefaults(merged);
  }

  /**
   * Load config from a specific file path and merge with defaults.
   */
  async loadFromFile(configPath: string): Promise<LoreConfig> {
    const parsed = await this.parseConfigFile(configPath);
    return this.mergeWithDefaults(parsed);
  }

  /**
   * Walk up directories looking for the nearest .lore/config.toml.
   * Returns the path to the config file, or null if none found.
   */
  async findConfigPath(startPath: string): Promise<string | null> {
    const resolvedPath = resolve(startPath);
    let currentDir = resolvedPath;

    // Check if startPath is a file or directory
    try {
      const parsed = parsePath(resolvedPath);
      if (parsed.ext) {
        // Looks like a file path; start from its directory
        currentDir = dirname(resolvedPath);
      }
    } catch {
      // If parsing fails, just use as-is
    }

    const root = parsePath(currentDir).root;

    while (true) {
      const configPath = join(currentDir, CONFIG_DIR, CONFIG_FILENAME);
      if (await this.fileExists(configPath)) {
        return configPath;
      }

      const parentDir = dirname(currentDir);
      if (parentDir === currentDir || currentDir === root) {
        break;
      }
      currentDir = parentDir;
    }

    return null;
  }

  /**
   * Find all config files from the target path up to the filesystem root.
   * Returns paths ordered from nearest (child) to farthest (parent).
   */
  private async findAllConfigPaths(startPath: string): Promise<string[]> {
    const paths: string[] = [];
    let currentDir = startPath;

    // Check if startPath is a file or directory
    try {
      const parsed = parsePath(startPath);
      if (parsed.ext) {
        currentDir = dirname(startPath);
      }
    } catch {
      // Use as-is
    }

    const root = parsePath(currentDir).root;

    while (true) {
      const configPath = join(currentDir, CONFIG_DIR, CONFIG_FILENAME);
      if (await this.fileExists(configPath)) {
        paths.push(configPath);
      }

      const parentDir = dirname(currentDir);
      if (parentDir === currentDir || currentDir === root) {
        break;
      }
      currentDir = parentDir;
    }

    return paths;
  }

  /**
   * Parse a single TOML config file into a partial LoreConfig.
   */
  private async parseConfigFile(configPath: string): Promise<Partial<MutableLoreConfig>> {
    const content = await readFile(configPath, 'utf-8');
    const parsed = parseToml(content);
    return this.toPartialConfig(parsed);
  }

  /**
   * Convert a raw TOML parse result into a Partial<MutableLoreConfig>.
   * Only includes sections that are present in the parsed TOML.
   */
  private toPartialConfig(parsed: Record<string, unknown>): Partial<MutableLoreConfig> {
    const config: Partial<MutableLoreConfig> = {};

    if (parsed.protocol && typeof parsed.protocol === 'object') {
      const proto = parsed.protocol as Record<string, unknown>;
      config.protocol = {
        version: typeof proto.version === 'string' ? proto.version : DEFAULT_CONFIG.protocol.version,
      };
    }

    if (parsed.trailers && typeof parsed.trailers === 'object') {
      const trailers = parsed.trailers as Record<string, unknown>;
      config.trailers = {
        required: Array.isArray(trailers.required) ? trailers.required as string[] : DEFAULT_CONFIG.trailers.required as string[],
        custom: Array.isArray(trailers.custom) ? trailers.custom as string[] : DEFAULT_CONFIG.trailers.custom as string[],
      };
    }

    if (parsed.validation && typeof parsed.validation === 'object') {
      const validation = parsed.validation as Record<string, unknown>;
      config.validation = {
        strict: typeof validation.strict === 'boolean' ? validation.strict : DEFAULT_CONFIG.validation.strict,
        maxMessageLines: typeof validation.max_message_lines === 'number'
          ? validation.max_message_lines
          : (typeof validation.maxMessageLines === 'number'
            ? validation.maxMessageLines
            : DEFAULT_CONFIG.validation.maxMessageLines),
        intentMaxLength: typeof validation.intent_max_length === 'number'
          ? validation.intent_max_length
          : (typeof validation.intentMaxLength === 'number'
            ? validation.intentMaxLength
            : DEFAULT_CONFIG.validation.intentMaxLength),
      };
    }

    if (parsed.stale && typeof parsed.stale === 'object') {
      const stale = parsed.stale as Record<string, unknown>;
      config.stale = {
        olderThan: typeof stale.older_than === 'string'
          ? stale.older_than
          : (typeof stale.olderThan === 'string'
            ? stale.olderThan
            : DEFAULT_CONFIG.stale.olderThan),
        driftThreshold: typeof stale.drift_threshold === 'number'
          ? stale.drift_threshold
          : (typeof stale.driftThreshold === 'number'
            ? stale.driftThreshold
            : DEFAULT_CONFIG.stale.driftThreshold),
      };
    }

    if (parsed.output && typeof parsed.output === 'object') {
      const output = parsed.output as Record<string, unknown>;
      const format = output.default_format ?? output.defaultFormat;
      config.output = {
        defaultFormat: (format === 'text' || format === 'json') ? format : DEFAULT_CONFIG.output.defaultFormat,
      };
    }

    if (parsed.follow && typeof parsed.follow === 'object') {
      const follow = parsed.follow as Record<string, unknown>;
      config.follow = {
        maxDepth: typeof follow.max_depth === 'number'
          ? follow.max_depth
          : (typeof follow.maxDepth === 'number'
            ? follow.maxDepth
            : DEFAULT_CONFIG.follow.maxDepth),
      };
    }

    return config;
  }

  /**
   * Merge two partial configs. Source overrides base at the section level.
   */
  private mergeConfigs(
    base: Partial<MutableLoreConfig>,
    source: Partial<MutableLoreConfig>,
  ): Partial<MutableLoreConfig> {
    const merged: Partial<MutableLoreConfig> = { ...base };

    if (source.protocol) {
      merged.protocol = source.protocol;
    }
    if (source.trailers) {
      merged.trailers = source.trailers;
    }
    if (source.validation) {
      merged.validation = source.validation;
    }
    if (source.stale) {
      merged.stale = source.stale;
    }
    if (source.output) {
      merged.output = source.output;
    }
    if (source.follow) {
      merged.follow = source.follow;
    }

    return merged;
  }

  /**
   * Merge a partial config with DEFAULT_CONFIG to ensure all fields are present.
   */
  private mergeWithDefaults(partial: Partial<MutableLoreConfig>): LoreConfig {
    return {
      protocol: partial.protocol ?? DEFAULT_CONFIG.protocol,
      trailers: partial.trailers ?? DEFAULT_CONFIG.trailers,
      validation: partial.validation ?? DEFAULT_CONFIG.validation,
      stale: partial.stale ?? DEFAULT_CONFIG.stale,
      output: partial.output ?? DEFAULT_CONFIG.output,
      follow: partial.follow ?? DEFAULT_CONFIG.follow,
    };
  }

  /**
   * Check if a file exists at the given path.
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}
