import type { Command } from 'commander';
import type { IOutputFormatter } from '../interfaces/output-formatter.js';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { CONFIG_DIR, CONFIG_FILENAME } from '../util/constants.js';
import { DEFAULT_CONFIG, type LoreConfig } from '../types/config.js';
import { LoreError } from '../util/errors.js';

const DEFAULT_CONFIG_CONTENT = `[protocol]
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

/**
 * Register the `lore init` command.
 * Creates .lore/config.toml with default content.
 * If the config file already exists, checks for corruption and missing options.
 */
export function registerInitCommand(
  program: Command,
  deps: {
    getFormatter: () => IOutputFormatter;
  },
): void {
  program
    .command('init')
    .description('Initialize .lore/ config in repository')
    .action(async () => {
      const formatter = deps.getFormatter();
      const configDir = join(process.cwd(), CONFIG_DIR);
      const configPath = join(configDir, CONFIG_FILENAME);

      // Check if config already exists
      let exists = false;
      try {
        await access(configPath);
        exists = true;
      } catch {
        // File does not exist
      }

      if (exists) {
        const content = await readFile(configPath, 'utf-8');
        console.log(formatter.formatSuccess(
          `Config already exists at ${CONFIG_DIR}/${CONFIG_FILENAME}:`,
        ));
        console.log(content);

        let parsed: Record<string, unknown>;
        try {
          parsed = parseToml(content) as Record<string, unknown>;
        } catch (err) {
          const message = `Your configuration file is corrupted and cannot be parsed: ${err instanceof Error ? err.message : String(err)}\n\nPlease fix the TOML syntax or reset your config.\nExample: mv ${CONFIG_DIR}/${CONFIG_FILENAME} ${CONFIG_DIR}/${CONFIG_FILENAME}.corrupted && lore init`;
          throw new LoreError(message, 1);
        }

        const { missing, customized } = findConfigDiff(parsed);

        if (missing.length > 0) {
          console.log('\n' + formatter.formatSuccess(
            'Your configuration is missing new options:',
          ));
          for (const item of missing) {
            console.log(`  - ${item}`);
          }

          if (customized.length === 0) {
            console.log('\nNotice: You are using default settings. You can safely reset your config to get the latest options.');
            console.log(`Example: rm ${CONFIG_DIR}/${CONFIG_FILENAME} && lore init`);
          } else {
            console.log('\nNotice: You have customized the following options:');
            for (const item of customized) {
              console.log(`  - ${item}`);
            }
            console.log('\nTo update: Rename your current config, run `lore init` again, and manually merge your changes.');
            console.log(`Example: mv ${CONFIG_DIR}/${CONFIG_FILENAME} ${CONFIG_DIR}/${CONFIG_FILENAME}.bak && lore init`);
          }
        }
        return;
      }

      // Create directory and write config
      await mkdir(configDir, { recursive: true });
      await writeFile(configPath, DEFAULT_CONFIG_CONTENT, 'utf-8');

      console.log(formatter.formatSuccess(
        `Created ${CONFIG_DIR}/${CONFIG_FILENAME} with protocol version 1.0`,
      ));
    });
}

function findConfigDiff(parsed: Record<string, unknown>): { missing: string[]; customized: string[] } {
  const missing: string[] = [];
  const customized: string[] = [];

  const configKeys = Object.keys(DEFAULT_CONFIG) as (keyof LoreConfig)[];

  for (const section of configKeys) {
    const defaults = DEFAULT_CONFIG[section] as Record<string, unknown>;
    const userSection = parsed[section];

    if (!userSection || typeof userSection !== 'object') {
      missing.push(`[${section}] section`);
      continue;
    }

    const sectionData = userSection as Record<string, unknown>;
    for (const [key, defaultValue] of Object.entries(defaults)) {
      // Convert camelCase from LoreConfig type to snake_case for TOML comparison
      const snakeKey = key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
      const userValue = sectionData[snakeKey] ?? sectionData[key];

      if (userValue === undefined) {
        missing.push(`${section}.${snakeKey}`);
      } else if (JSON.stringify(userValue) !== JSON.stringify(defaultValue)) {
        customized.push(`${section}.${snakeKey}`);
      }
    }
  }

  return { missing, customized };
}

