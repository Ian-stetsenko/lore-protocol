import { join, dirname } from 'node:path';
import type { IConfigLoader } from '../interfaces/config-loader.js';
import type { IGitClient } from '../interfaces/git-client.js';

/**
 * Resolves the root directory for Lore operations.
 * 
 * Logic:
 * 1. Walk up from CWD to find nearest .lore directory.
 * 2. If not found, try to find the git repository root.
 * 3. Fallback to process.cwd().
 */
export async function resolveLoreRoot(
  cwd: string,
  configLoader: IConfigLoader,
  gitClient: IGitClient,
): Promise<string> {
  try {
    const configPath = await configLoader.findConfigPath(cwd);
    if (configPath) {
      // configPath is /path/to/project/.lore/config.toml
      // dirname(configPath) is /path/to/project/.lore
      // dirname(dirname(configPath)) is /path/to/project
      return dirname(dirname(configPath));
    }

    if (await gitClient.isInsideRepo()) {
      return await gitClient.getRepoRoot();
    }
  } catch {
    // Best-effort; fallback to cwd
  }

  return cwd;
}
