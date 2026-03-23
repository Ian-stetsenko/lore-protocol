import { readFile, access, stat } from 'node:fs/promises';
import { join, dirname, resolve, parse as parsePath } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import type { IConfigLoader } from '../interfaces/config-loader.js';
import type { LoreConfig } from '../types/config.js';
import { DEFAULT_CONFIG } from '../types/config.js';
import { CONFIG_DIR, CONFIG_FILENAME } from '../util/constants.js';

type ConfigSection = keyof LoreConfig;

/**
 * Maps camelCase config keys to their TOML snake_case equivalents per section.
 * Direction: camelCase -> snake_case (the lookup we actually perform).
 */
const CAMEL_TO_SNAKE: Record<string, Record<string, string>> = {
  validation: {
    maxMessageLines: 'max_message_lines',
    intentMaxLength: 'intent_max_length',
  },
  stale: {
    olderThan: 'older_than',
    driftThreshold: 'drift_threshold',
  },
  output: {
    defaultFormat: 'default_format',
  },
  follow: {
    maxDepth: 'max_depth',
  },
};

const VALID_OUTPUT_FORMATS = new Set(['text', 'json']);

/**
 * Loads and merges .lore/config.toml files.
 * Walks up the directory tree for monorepo support.
 *
 * GRASP: Pure Fabrication -- filesystem access abstracted from domain.
 * SOLID: OCP -- adding a new config section requires only a DEFAULT_CONFIG entry
 *        and optionally a CAMEL_TO_SNAKE entry, not new if-blocks.
 */
export class ConfigLoader implements IConfigLoader {
  async loadForPath(targetPath: string): Promise<LoreConfig> {
    const configPaths = await this.walkConfigPaths(resolve(targetPath));

    if (configPaths.length === 0) {
      return { ...DEFAULT_CONFIG };
    }

    // Merge parent-first so child overrides parent
    let merged: Record<string, unknown> = {};
    for (const configPath of [...configPaths].reverse()) {
      const parsed = await this.parseConfigFile(configPath);
      merged = { ...merged, ...parsed };
    }

    return this.buildConfig(merged);
  }

  async loadFromFile(configPath: string): Promise<LoreConfig> {
    const parsed = await this.parseConfigFile(configPath);
    return this.buildConfig(parsed);
  }

  async findConfigPath(startPath: string): Promise<string | null> {
    const paths = await this.walkConfigPaths(resolve(startPath), true);
    return paths[0] ?? null;
  }

  /**
   * Walk up directories collecting .lore/config.toml paths.
   * Returns nearest-first order. Stops after first match when stopAtFirst is true.
   */
  private async walkConfigPaths(startPath: string, stopAtFirst = false): Promise<string[]> {
    const paths: string[] = [];
    let dir = await this.resolveStartDir(startPath);
    const root = parsePath(dir).root;

    while (true) {
      const configPath = join(dir, CONFIG_DIR, CONFIG_FILENAME);
      if (await this.fileExists(configPath)) {
        paths.push(configPath);
        if (stopAtFirst) return paths;
      }

      const parentDir = dirname(dir);
      if (parentDir === dir || dir === root) break;
      dir = parentDir;
    }

    return paths;
  }

  /**
   * Resolve a start path to the directory to begin walking from.
   * Uses stat() for reliable file/directory detection,
   * falling back to extension heuristic for non-existent paths.
   */
  private async resolveStartDir(startPath: string): Promise<string> {
    const resolvedPath = resolve(startPath);

    try {
      const stats = await stat(resolvedPath);
      return stats.isFile() ? dirname(resolvedPath) : resolvedPath;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return parsePath(resolvedPath).ext ? dirname(resolvedPath) : resolvedPath;
      }
      return resolvedPath;
    }
  }

  private async parseConfigFile(configPath: string): Promise<Record<string, unknown>> {
    const content = await readFile(configPath, 'utf-8');
    return parseToml(content) as Record<string, unknown>;
  }

  /**
   * Build a LoreConfig from raw TOML data.
   * Iterates DEFAULT_CONFIG sections, resolves snake_case/camelCase aliases,
   * and fills missing values from defaults.
   */
  private buildConfig(parsed: Record<string, unknown>): LoreConfig {
    const sections = Object.keys(DEFAULT_CONFIG) as ConfigSection[];
    const result: Record<string, unknown> = {};

    for (const section of sections) {
      const rawSection = parsed[section];
      if (!rawSection || typeof rawSection !== 'object') {
        result[section] = DEFAULT_CONFIG[section];
        continue;
      }

      const sectionData = rawSection as Record<string, unknown>;
      const defaults = DEFAULT_CONFIG[section] as Record<string, unknown>;
      const aliases = CAMEL_TO_SNAKE[section] ?? {};
      const built: Record<string, unknown> = {};

      for (const [key, defaultValue] of Object.entries(defaults)) {
        built[key] = this.resolveFieldValue(sectionData, key, aliases[key], defaultValue);
      }

      if (section === 'output' && !VALID_OUTPUT_FORMATS.has(built['defaultFormat'] as string)) {
        built['defaultFormat'] = DEFAULT_CONFIG.output.defaultFormat;
      }

      result[section] = built;
    }

    return result as unknown as LoreConfig;
  }

  /**
   * Resolve a single field value from TOML data.
   * Checks snake_case alias first, then camelCase key, then falls back to default.
   */
  private resolveFieldValue(
    sectionData: Record<string, unknown>,
    camelKey: string,
    snakeKey: string | undefined,
    defaultValue: unknown,
  ): unknown {
    const rawValue = (snakeKey ? sectionData[snakeKey] : undefined) ?? sectionData[camelKey];

    if (rawValue === undefined) return defaultValue;
    if (Array.isArray(defaultValue)) return Array.isArray(rawValue) ? rawValue : defaultValue;
    return typeof rawValue === typeof defaultValue ? rawValue : defaultValue;
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}
