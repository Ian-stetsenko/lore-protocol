import { readFile, access, stat } from 'node:fs/promises';
import { join, dirname, resolve, parse as parsePath } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import type { IConfigLoader } from '../interfaces/config-loader.js';
import type { LoreConfig } from '../types/config.js';
import { DEFAULT_CONFIG } from '../types/config.js';
import { CONFIG_DIR, CONFIG_FILENAME } from '../util/constants.js';

type ConfigSection = keyof LoreConfig;

/**
 * Maps TOML snake_case keys to LoreConfig camelCase keys per section.
 */
const KEY_ALIASES: Record<string, Record<string, string>> = {
  validation: {
    max_message_lines: 'maxMessageLines',
    intent_max_length: 'intentMaxLength',
  },
  stale: {
    older_than: 'olderThan',
    drift_threshold: 'driftThreshold',
  },
  output: {
    default_format: 'defaultFormat',
  },
  follow: {
    max_depth: 'maxDepth',
  },
};

/**
 * Loads and merges .lore/config.toml files.
 * Walks up the directory tree for monorepo support.
 *
 * GRASP: Pure Fabrication -- filesystem access abstracted from domain.
 * SOLID: OCP -- adding a new config section requires only a DEFAULT_CONFIG entry
 *        and optionally a KEY_ALIASES entry, not new if-blocks.
 */
export class ConfigLoader implements IConfigLoader {
  async loadForPath(targetPath: string): Promise<LoreConfig> {
    const resolvedPath = resolve(targetPath);
    const configPaths = await this.findAllConfigPaths(resolvedPath);

    if (configPaths.length === 0) {
      return { ...DEFAULT_CONFIG };
    }

    const reversed = [...configPaths].reverse();

    let merged: Record<string, unknown> = {};
    for (const configPath of reversed) {
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
    let dir = await this.resolveStartDir(startPath);
    const root = parsePath(dir).root;

    while (true) {
      const configPath = join(dir, CONFIG_DIR, CONFIG_FILENAME);
      if (await this.fileExists(configPath)) {
        return configPath;
      }

      const parentDir = dirname(dir);
      if (parentDir === dir || dir === root) break;
      dir = parentDir;
    }

    return null;
  }

  /**
   * Find all config files from the target path up to the filesystem root.
   * Returns paths ordered from nearest (child) to farthest (parent).
   */
  private async findAllConfigPaths(startPath: string): Promise<string[]> {
    const paths: string[] = [];
    let dir = await this.resolveStartDir(startPath);
    const root = parsePath(dir).root;

    while (true) {
      const configPath = join(dir, CONFIG_DIR, CONFIG_FILENAME);
      if (await this.fileExists(configPath)) {
        paths.push(configPath);
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
        const parsed = parsePath(resolvedPath);
        return parsed.ext ? dirname(resolvedPath) : resolvedPath;
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
   * and fills missing values from defaults. No per-section if-blocks.
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
      const aliases = KEY_ALIASES[section] ?? {};
      const built: Record<string, unknown> = {};

      for (const [key, defaultValue] of Object.entries(defaults)) {
        const snakeKey = Object.entries(aliases).find(([, camel]) => camel === key)?.[0];
        const rawValue = (snakeKey ? sectionData[snakeKey] : undefined) ?? sectionData[key];

        if (Array.isArray(defaultValue)) {
          built[key] = Array.isArray(rawValue) ? rawValue : defaultValue;
        } else {
          built[key] = rawValue !== undefined && typeof rawValue === typeof defaultValue
            ? rawValue
            : defaultValue;
        }
      }

      // output.defaultFormat must be 'text' or 'json'
      if (section === 'output' && built['defaultFormat'] !== 'text' && built['defaultFormat'] !== 'json') {
        built['defaultFormat'] = DEFAULT_CONFIG.output.defaultFormat;
      }

      result[section] = built;
    }

    return result as unknown as LoreConfig;
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
