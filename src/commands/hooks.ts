import type { Command } from 'commander';
import type { IGitClient } from '../interfaces/git-client.js';
import type { IOutputFormatter } from '../interfaces/output-formatter.js';
import type { IHookInstaller } from '../interfaces/hook-installer.js';

/**
 * Register the `lore hooks` command group.
 * Subcommands: install, uninstall.
 */
export function registerHooksCommand(
  program: Command,
  deps: {
    hookInstaller: IHookInstaller;
    gitClient: IGitClient;
    getFormatter: () => IOutputFormatter;
  },
): void {
  const hooks = program
    .command('hooks')
    .description('Manage git hooks for Lore protocol enforcement');

  hooks
    .command('install')
    .description('Install commit-msg hook for Lore validation')
    .option('--force', 'Overwrite existing non-Lore hooks (backs up to .bak)')
    .action(async (options: { force?: boolean }) => {
      const { hookInstaller, gitClient, getFormatter } = deps;
      const formatter = getFormatter();

      let repoRoot: string;
      try {
        repoRoot = await gitClient.getRepoRoot();
      } catch {
        console.error(formatter.formatError(1, [
          { severity: 'error', message: 'Not inside a git repository' },
        ]));
        process.exitCode = 1;
        return;
      }

      const result = await hookInstaller.install(repoRoot, { force: options.force ?? false });

      if (!result.installed) {
        console.error(formatter.formatError(1, [
          { severity: 'error', message: `Hook already exists at ${result.hookPath}. Use --force to overwrite (existing hook will be backed up to .bak).` },
        ]));
        process.exitCode = 1;
        return;
      }

      if (result.backedUp) {
        console.log(formatter.formatSuccess(`Existing hook backed up to ${result.backedUp}`));
      }

      if (result.alreadyInstalled) {
        console.log(formatter.formatSuccess('Lore commit-msg hook updated.'));
      } else {
        console.log(formatter.formatSuccess(`Lore commit-msg hook installed at ${result.hookPath}`));
      }
    });

  hooks
    .command('uninstall')
    .description('Remove Lore-managed commit-msg hook')
    .action(async () => {
      const { hookInstaller, gitClient, getFormatter } = deps;
      const formatter = getFormatter();

      let repoRoot: string;
      try {
        repoRoot = await gitClient.getRepoRoot();
      } catch {
        console.error(formatter.formatError(1, [
          { severity: 'error', message: 'Not inside a git repository' },
        ]));
        process.exitCode = 1;
        return;
      }

      const result = await hookInstaller.uninstall(repoRoot);

      if (result.notLoreHook) {
        console.error(formatter.formatError(1, [
          { severity: 'error', message: `Hook at ${result.hookPath} was not installed by Lore. Remove it manually if needed.` },
        ]));
        process.exitCode = 1;
        return;
      }

      if (!result.removed) {
        console.log(formatter.formatSuccess('No commit-msg hook found. Nothing to remove.'));
        return;
      }

      console.log(formatter.formatSuccess('Lore commit-msg hook removed.'));
    });
}
