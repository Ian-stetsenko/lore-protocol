import { describe, it, expect } from 'vitest';
import { isNewerVersion } from '../../../src/util/semver.js';

describe('isNewerVersion', () => {
  it('returns true when latest has higher major', () => {
    expect(isNewerVersion('1.0.0', '2.0.0')).toBe(true);
  });

  it('returns true when latest has higher minor', () => {
    expect(isNewerVersion('1.0.0', '1.1.0')).toBe(true);
  });

  it('returns true when latest has higher patch', () => {
    expect(isNewerVersion('1.0.0', '1.0.1')).toBe(true);
  });

  it('returns false when versions are equal', () => {
    expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false);
  });

  it('returns false when current is newer (major)', () => {
    expect(isNewerVersion('2.0.0', '1.0.0')).toBe(false);
  });

  it('returns false when current is newer (minor)', () => {
    expect(isNewerVersion('1.2.0', '1.1.0')).toBe(false);
  });

  it('returns false when current is newer (patch)', () => {
    expect(isNewerVersion('1.0.2', '1.0.1')).toBe(false);
  });

  it('strips prerelease suffixes before comparing', () => {
    expect(isNewerVersion('1.0.0-beta.1', '1.0.1')).toBe(true);
  });

  it('strips v prefix', () => {
    expect(isNewerVersion('v1.0.0', 'v1.0.1')).toBe(true);
  });

  it('returns false for malformed current', () => {
    expect(isNewerVersion('not-a-version', '1.0.0')).toBe(false);
  });

  it('returns false for malformed latest', () => {
    expect(isNewerVersion('1.0.0', 'bad')).toBe(false);
  });

  it('returns false for empty strings', () => {
    expect(isNewerVersion('', '')).toBe(false);
  });

  it('returns false for incomplete versions', () => {
    expect(isNewerVersion('1.0', '1.0.1')).toBe(false);
  });

  it('handles large version numbers', () => {
    expect(isNewerVersion('1.0.0', '1.0.100')).toBe(true);
  });
});
