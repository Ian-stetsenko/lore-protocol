import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HookInstaller } from '../../../src/services/hook-installer.js';
import { HookScriptGenerator, LORE_MARKER } from '../../../src/services/hook-script-generator.js';
import { DEFAULT_CONFIG } from '../../../src/types/config.js';
import * as fs from 'node:fs/promises';

vi.mock('node:fs/promises');

describe('HookInstaller', () => {
  let installer: HookInstaller;
  const repoRoot = '/repo';
  const hookPath = '/repo/.git/hooks/commit-msg';

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(fs.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.chmod).mockResolvedValue(undefined);
    vi.mocked(fs.rename).mockResolvedValue(undefined);
    vi.mocked(fs.unlink).mockResolvedValue(undefined);

    const generator = new HookScriptGenerator();
    installer = new HookInstaller(generator, DEFAULT_CONFIG.hooks);
  });

  describe('install', () => {
    it('installs hook when no existing hook exists', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));

      const result = await installer.install(repoRoot, { force: false });

      expect(result.installed).toBe(true);
      expect(result.hookPath).toBe(hookPath);
      expect(result.alreadyInstalled).toBe(false);
      expect(fs.mkdir).toHaveBeenCalledWith('/repo/.git/hooks', { recursive: true });
      expect(fs.writeFile).toHaveBeenCalledWith(hookPath, expect.stringContaining(LORE_MARKER), 'utf-8');
      expect(fs.chmod).toHaveBeenCalledWith(hookPath, 0o755);
    });

    it('overwrites existing Lore-managed hook silently', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(`#!/bin/bash\n${LORE_MARKER}\nold content`);

      const result = await installer.install(repoRoot, { force: false });

      expect(result.installed).toBe(true);
      expect(result.alreadyInstalled).toBe(true);
      expect(fs.rename).not.toHaveBeenCalled();
    });

    it('refuses to overwrite non-Lore hook without --force', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('#!/bin/bash\nsome other hook');

      const result = await installer.install(repoRoot, { force: false });

      expect(result.installed).toBe(false);
      expect(fs.writeFile).not.toHaveBeenCalled();
    });

    it('backs up non-Lore hook and installs with --force', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('#!/bin/bash\nsome other hook');

      const result = await installer.install(repoRoot, { force: true });

      expect(result.installed).toBe(true);
      expect(result.backedUp).toBe(`${hookPath}.bak`);
      expect(fs.rename).toHaveBeenCalledWith(hookPath, `${hookPath}.bak`);
      expect(fs.writeFile).toHaveBeenCalled();
    });

    it('creates .git/hooks/ directory if missing', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));

      await installer.install(repoRoot, { force: false });

      expect(fs.mkdir).toHaveBeenCalledWith('/repo/.git/hooks', { recursive: true });
    });

    it('sets executable permission on hook file', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));

      await installer.install(repoRoot, { force: false });

      expect(fs.chmod).toHaveBeenCalledWith(hookPath, 0o755);
    });
  });

  describe('uninstall', () => {
    it('removes Lore-managed hook', async () => {
      vi.mocked(fs.readFile).mockResolvedValue(`#!/bin/bash\n${LORE_MARKER}\ncontent`);

      const result = await installer.uninstall(repoRoot);

      expect(result.removed).toBe(true);
      expect(fs.unlink).toHaveBeenCalledWith(hookPath);
    });

    it('refuses to remove non-Lore hook', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('#!/bin/bash\nsome other hook');

      const result = await installer.uninstall(repoRoot);

      expect(result.removed).toBe(false);
      expect(result.notLoreHook).toBe(true);
      expect(fs.unlink).not.toHaveBeenCalled();
    });

    it('handles missing hook gracefully', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));

      const result = await installer.uninstall(repoRoot);

      expect(result.removed).toBe(false);
      expect(result.notLoreHook).toBe(false);
    });
  });
});
