import { readFile, access, stat } from 'node:fs/promises';
import { join, dirname, resolve, parse as parsePath } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import type { IConfigLoader } from '../interfaces/config-loader.js';
import type { LoreConfig } from '../types/config.js';
import { DEFAULT_CONFIG } from '../types/config.js';
import { CONFIG_DIR, CONFIG_FILENAME, GIT_MARKER } from '../util/constants.js';

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
  cli: {
    updateCheck: 'update_check',
  },
  hooks: {
    allowFixup: 'allow_fixup',
    skipAuthors: 'skip_authors',
    skipPatterns: 'skip_patterns',
  },
};

const VALID_OUTPUT_FORMATS = new Set(['text', 'json']);

/**
 * Loads and merges .lore/config.toml files.
 * Walks up the directory tree for monorepo support, stopping at the git
 * work-tree root (the nearest ancestor holding a `.git` entry).
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
   * Collect .lore/config.toml paths within the discovery boundary.
   * Returns nearest-first order. Stops after first match when stopAtFirst is true.
   */
  private async walkConfigPaths(startPath: string, stopAtFirst = false): Promise<string[]> {
    const paths: string[] = [];

    for (const dir of await this.collectSearchDirs(startPath)) {
      const configPath = join(dir, CONFIG_DIR, CONFIG_FILENAME);
      if (await this.pathExists(configPath)) {
        paths.push(configPath);
        if (stopAtFirst) break;
      }
    }

    return paths;
  }

  /**
   * Directories searched for config, nearest-first: the start directory up
   * to and including the nearest ancestor holding a `.git` entry. The entry
   * may be a directory or a file, so worktrees and submodules bound the walk
   * at their own root. With no `.git` anywhere above, only the start
   * directory is searched -- config from unrelated ancestors (e.g. a home
   * directory) never leaks into a non-repo invocation.
   */
  private async collectSearchDirs(startPath: string): Promise<string[]> {
    const startDir = await this.resolveStartDir(startPath);
    const dirs: string[] = [];
    let dir = startDir;

    while (true) {
      dirs.push(dir);
      if (await this.pathExists(join(dir, GIT_MARKER))) return dirs;

      const parentDir = dirname(dir);
      if (parentDir === dir) return [startDir];
      dir = parentDir;
    }
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

  /** True when any filesystem entry (file or directory) exists at the path. */
  private async pathExists(entryPath: string): Promise<boolean> {
    try {
      await access(entryPath);
      return true;
    } catch {
      return false;
    }
  }
}
