import type { LoreConfig } from '../types/config.js';

export interface IHookScriptGenerator {
  generateCommitMsgHook(config: LoreConfig['hooks']): string;
}

export interface HookInstallResult {
  readonly installed: boolean;
  readonly hookPath: string;
  readonly backedUp?: string;
  readonly alreadyInstalled: boolean;
}

export interface HookUninstallResult {
  readonly removed: boolean;
  readonly hookPath: string;
  readonly notLoreHook: boolean;
}

export interface IHookInstaller {
  install(repoRoot: string, options: { force: boolean }): Promise<HookInstallResult>;
  uninstall(repoRoot: string): Promise<HookUninstallResult>;
}
