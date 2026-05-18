import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { shouldBypassCache } from '../../src/util/cache-check.js';

describe('shouldBypassCache', () => {
  const originalEnv = { ...process.env };
  const originalArgv = [...process.argv];

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.argv = ['node', 'lore', 'log'];
    delete process.env['LORE_NO_CACHE'];
  });

  afterEach(() => {
    process.env = originalEnv;
    process.argv = originalArgv;
  });

  it('returns false by default (caching enabled)', () => {
    expect(shouldBypassCache(true)).toBe(false);
    expect(shouldBypassCache(undefined)).toBe(false);
  });

  it('bypasses when --no-cache is in argv', () => {
    process.argv = ['node', 'lore', 'log', '--no-cache'];
    expect(shouldBypassCache(true)).toBe(true);
  });

  it('bypasses when LORE_NO_CACHE is "1"', () => {
    process.env['LORE_NO_CACHE'] = '1';
    expect(shouldBypassCache(true)).toBe(true);
  });

  it('bypasses when LORE_NO_CACHE is "true"', () => {
    process.env['LORE_NO_CACHE'] = 'true';
    expect(shouldBypassCache(true)).toBe(true);
  });

  it('bypasses when config cache is false', () => {
    expect(shouldBypassCache(false)).toBe(true);
  });

  it('returns false when LORE_NO_CACHE is "0" or "false"', () => {
    process.env['LORE_NO_CACHE'] = 'false';
    expect(shouldBypassCache(true)).toBe(false);
    
    process.env['LORE_NO_CACHE'] = '0';
    expect(shouldBypassCache(true)).toBe(false);
  });

  it('bypasses if flag is set even if config says true', () => {
    process.argv = ['node', 'lore', 'log', '--no-cache'];
    expect(shouldBypassCache(true)).toBe(true);
  });

  it('bypasses if env is set even if config says true', () => {
    process.env['LORE_NO_CACHE'] = '1';
    expect(shouldBypassCache(true)).toBe(true);
  });
});
