import { readFile, writeFile, mkdir, rename, unlink, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import type { IHookInstaller, IHookScriptGenerator, HookInstallResult, HookUninstallResult } from '../interfaces/hook-installer.js';
import type { LoreConfig } from '../types/config.js';
import { LORE_MARKER } from './hook-script-generator.js';

/**
 * Installs and uninstalls Lore-managed git hooks.
 *
 * GRASP: Pure Fabrication — filesystem infrastructure for hook management.
 * SOLID: SRP — only manages hook file operations. Script generation is
 *        delegated to HookScriptGenerator.
 */
export class HookInstaller implements IHookInstaller {
  constructor(
    private readonly scriptGenerator: IHookScriptGenerator,
    private readonly hooksConfig: LoreConfig['hooks'],
  ) {}

  async install(repoRoot: string, options: { force: boolean }): Promise<HookInstallResult> {
    const hooksDir = join(repoRoot, '.git', 'hooks');
    const hookPath = join(hooksDir, 'commit-msg');

    await mkdir(hooksDir, { recursive: true });

    let existingContent: string | null = null;
    try {
      existingContent = await readFile(hookPath, 'utf-8');
    } catch {
      // No existing hook
    }

    if (existingContent !== null) {
      if (this.isLoreHook(existingContent)) {
        // Lore-managed hook — overwrite silently (upgrade)
      } else if (!options.force) {
        // Non-Lore hook exists, no --force — refuse
        return { installed: false, hookPath, alreadyInstalled: false };
      } else {
        // Non-Lore hook exists with --force — back up then install
        const backupPath = `${hookPath}.bak`;
        await rename(hookPath, backupPath);
        await this.writeHook(hookPath);
        return { installed: true, hookPath, backedUp: backupPath, alreadyInstalled: false };
      }
    }

    await this.writeHook(hookPath);
    return {
      installed: true,
      hookPath,
      alreadyInstalled: existingContent !== null && this.isLoreHook(existingContent),
    };
  }

  async uninstall(repoRoot: string): Promise<HookUninstallResult> {
    const hookPath = join(repoRoot, '.git', 'hooks', 'commit-msg');

    let content: string;
    try {
      content = await readFile(hookPath, 'utf-8');
    } catch {
      return { removed: false, hookPath, notLoreHook: false };
    }

    if (!this.isLoreHook(content)) {
      return { removed: false, hookPath, notLoreHook: true };
    }

    await unlink(hookPath);
    return { removed: true, hookPath, notLoreHook: false };
  }

  private async writeHook(hookPath: string): Promise<void> {
    const script = this.scriptGenerator.generateCommitMsgHook(this.hooksConfig);
    await writeFile(hookPath, script, 'utf-8');
    await chmod(hookPath, 0o755);
  }

  private isLoreHook(content: string): boolean {
    return content.includes(LORE_MARKER);
  }
}
