import type { LoreConfig } from '../types/config.js';

export interface IConfigLoader {
  loadForPath(targetPath: string): Promise<LoreConfig>;
  loadFromFile(configPath: string): Promise<LoreConfig>;
  findConfigPath(startPath: string): Promise<string | null>;
}
