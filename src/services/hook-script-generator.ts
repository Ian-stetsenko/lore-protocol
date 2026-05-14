import type { LoreConfig } from '../types/config.js';

export const LORE_MARKER = '# LORE-MANAGED-HOOK';

const SAFE_PATTERN = /^[a-zA-Z0-9 ^$.*+?|[\]()\\/_-]+$/;
const SAFE_AUTHOR = /^[^"$`\\\n]+$/;

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

    // Skip patterns from config (validated for shell safety)
    for (const pattern of config.skipPatterns) {
      if (!SAFE_PATTERN.test(pattern)) continue;
      lines.push(
        `# Skip pattern: ${pattern}`,
        `if [[ "$COMMIT_MSG" =~ ${pattern} ]]; then`,
        '  exit 0',
        'fi',
        '',
      );
    }

    // Skip authors from config (validated for shell safety)
    const safeAuthors = config.skipAuthors.filter((a) => SAFE_AUTHOR.test(a));
    if (safeAuthors.length > 0) {
      lines.push('# Skip configured authors');
      lines.push('AUTHOR=$(git var GIT_AUTHOR_IDENT 2>/dev/null | sed \'s/>.*/>/\')');
      for (const author of safeAuthors) {
        lines.push(
          `if [[ "$AUTHOR" == *"${author}"* ]]; then`,
          '  exit 0',
          'fi',
        );
      }
      lines.push('');
    }

    // Run validation against the commit message file
    const strictFlag = config.enforce ? ' --strict' : '';
    lines.push(
      '# Run Lore protocol validation against the commit message file',
      'if command -v lore &> /dev/null; then',
      `  lore validate --commit-msg-file "$COMMIT_MSG_FILE"${strictFlag}`,
      'else',
      `  npx --yes lore-protocol validate --commit-msg-file "$COMMIT_MSG_FILE"${strictFlag}`,
      'fi',
      '',
    );

    return lines.join('\n');
  }
}
