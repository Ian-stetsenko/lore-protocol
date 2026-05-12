import type { LoreConfig } from '../types/config.js';

const LORE_MARKER = '# LORE-MANAGED-HOOK';

/**
 * Generates shell script content for git hooks.
 *
 * GRASP: Information Expert — knows the structure of hook scripts.
 * SOLID: SRP — only generates script strings, no filesystem ops.
 */
export class HookScriptGenerator {
  generateCommitMsgHook(config: LoreConfig['hooks']): string {
    const lines: string[] = [
      '#!/usr/bin/env bash',
      `${LORE_MARKER} — do not edit manually. Reinstall with: lore hooks install`,
      '',
      'COMMIT_MSG_FILE="$1"',
      'COMMIT_MSG=$(cat "$COMMIT_MSG_FILE")',
      '',
    ];

    // Skip fixup/squash commits
    if (config.allowFixup) {
      lines.push(
        '# Skip fixup/squash commits (validated after squash)',
        'if [[ "$COMMIT_MSG" =~ ^(fixup|squash)! ]]; then',
        '  exit 0',
        'fi',
        '',
      );
    }

    // Skip patterns from config
    for (const pattern of config.skipPatterns) {
      lines.push(
        `# Skip pattern: ${pattern}`,
        `if [[ "$COMMIT_MSG" =~ ${pattern} ]]; then`,
        '  exit 0',
        'fi',
        '',
      );
    }

    // Skip authors from config
    if (config.skipAuthors.length > 0) {
      lines.push('# Skip configured authors');
      lines.push('AUTHOR=$(git var GIT_AUTHOR_IDENT 2>/dev/null | sed \'s/>.*/>/\')');
      for (const author of config.skipAuthors) {
        lines.push(
          `if [[ "$AUTHOR" == *"${author}"* ]]; then`,
          '  exit 0',
          'fi',
        );
      }
      lines.push('');
    }

    // Run validation
    const strictFlag = config.enforce ? ' --strict' : '';
    lines.push(
      '# Run Lore protocol validation',
      'if command -v lore &> /dev/null; then',
      `  lore validate --last 1${strictFlag}`,
      'else',
      `  npx --yes lore-protocol validate --last 1${strictFlag}`,
      'fi',
      '',
    );

    return lines.join('\n');
  }
}

export { LORE_MARKER };
