import { describe, it, expect } from 'vitest';
import { HookScriptGenerator } from '../../../src/services/hook-script-generator.js';
import { DEFAULT_CONFIG } from '../../../src/types/config.js';

describe('HookScriptGenerator', () => {
  const generator = new HookScriptGenerator();

  it('generates a valid bash script with shebang and marker', () => {
    const script = generator.generateCommitMsgHook(DEFAULT_CONFIG.hooks);

    expect(script).toMatch(/^#!\/usr\/bin\/env bash/);
    expect(script).toContain('LORE-MANAGED-HOOK');
  });

  it('reads commit message from $1 argument', () => {
    const script = generator.generateCommitMsgHook(DEFAULT_CONFIG.hooks);

    expect(script).toContain('COMMIT_MSG_FILE="$1"');
    expect(script).toContain('COMMIT_MSG=$(cat "$COMMIT_MSG_FILE")');
  });

  it('validates via --commit-msg-file with --strict when enforce is true', () => {
    const script = generator.generateCommitMsgHook({ ...DEFAULT_CONFIG.hooks, enforce: true });

    expect(script).toContain('lore validate --commit-msg-file "$COMMIT_MSG_FILE" --strict');
  });

  it('validates via --commit-msg-file without --strict when enforce is false', () => {
    const script = generator.generateCommitMsgHook({ ...DEFAULT_CONFIG.hooks, enforce: false });

    expect(script).toContain('lore validate --commit-msg-file "$COMMIT_MSG_FILE"');
    expect(script).not.toContain('--strict');
  });

  it('includes fixup/squash skip when allowFixup is true', () => {
    const script = generator.generateCommitMsgHook({ ...DEFAULT_CONFIG.hooks, allowFixup: true });

    expect(script).toContain('fixup|squash');
  });

  it('omits fixup/squash skip when allowFixup is false', () => {
    const script = generator.generateCommitMsgHook({ ...DEFAULT_CONFIG.hooks, allowFixup: false });

    expect(script).not.toContain('fixup|squash');
  });

  it('includes safe skip patterns from config', () => {
    const script = generator.generateCommitMsgHook({
      ...DEFAULT_CONFIG.hooks,
      skipPatterns: ['^Merge ', '^Revert '],
    });

    expect(script).toContain('^Merge ');
    expect(script).toContain('^Revert ');
  });

  it('filters out unsafe skip patterns', () => {
    const script = generator.generateCommitMsgHook({
      ...DEFAULT_CONFIG.hooks,
      skipPatterns: ['^Merge ', '"]]; rm -rf / #'],
    });

    expect(script).toContain('^Merge ');
    expect(script).not.toContain('rm -rf');
  });

  it('includes safe skip authors from config', () => {
    const script = generator.generateCommitMsgHook({
      ...DEFAULT_CONFIG.hooks,
      skipAuthors: ['dependabot[bot]', 'renovate[bot]'],
    });

    expect(script).toContain('dependabot[bot]');
    expect(script).toContain('renovate[bot]');
    expect(script).toContain('GIT_AUTHOR_IDENT');
  });

  it('filters out unsafe skip authors', () => {
    const script = generator.generateCommitMsgHook({
      ...DEFAULT_CONFIG.hooks,
      skipAuthors: ['good-bot', 'evil"; rm -rf / #'],
    });

    expect(script).toContain('good-bot');
    expect(script).not.toContain('rm -rf');
  });

  it('omits author check when skipAuthors is empty', () => {
    const script = generator.generateCommitMsgHook({
      ...DEFAULT_CONFIG.hooks,
      skipAuthors: [],
    });

    expect(script).not.toContain('GIT_AUTHOR_IDENT');
  });

  it('includes fallback from lore to npx', () => {
    const script = generator.generateCommitMsgHook(DEFAULT_CONFIG.hooks);

    expect(script).toContain('command -v lore');
    expect(script).toContain('npx --yes lore-protocol');
  });

  it('handles empty skipPatterns', () => {
    const script = generator.generateCommitMsgHook({
      ...DEFAULT_CONFIG.hooks,
      skipPatterns: [],
    });

    expect(script).not.toContain('# Skip pattern:');
  });
});
