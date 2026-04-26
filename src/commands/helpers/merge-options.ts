import type { Command } from 'commander';

/**
 * Merge global program options with local subcommand options.
 * Local options take precedence over global options.
 *
 * Commander.js separates program-level options (--json, --format, --no-color)
 * from subcommand options (--limit, --since, --max-commits). This utility
 * reunifies them so handlers see a single merged view.
 *
 * GRASP: Pure Fabrication — CLI-framework integration concern.
 * SOLID: SRP — single responsibility of merging two option sources.
 */
export function mergeOptions<T>(command: Command): T {
  const globalOpts = command.parent?.opts() ?? {};
  const localOpts = command.opts();

  const merged: Record<string, unknown> = { ...globalOpts };
  for (const [key, value] of Object.entries(localOpts)) {
    if (value !== undefined) {
      merged[key] = value;
    }
  }

  // Trust boundary: Commander.js provides untyped option bags, so the cast
  // is unavoidable. Callers rely on Commander option definitions for correctness.
  return merged as T;
}
