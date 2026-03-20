import type { Command } from 'commander';
import type { IOutputFormatter } from '../interfaces/output-formatter.js';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { CONFIG_DIR, CONFIG_FILENAME } from '../util/constants.js';

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
`;

/**
 * Register the `lore init` command.
 * Creates .lore/config.toml with default content.
 * If the config file already exists, prints its content and exits.
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
