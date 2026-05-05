/**
 * Minimal semver comparison for update checking.
 * Compares major.minor.patch only; ignores prerelease/build metadata.
 *
 * @returns true if `latest` is strictly newer than `current`
 */
export function isNewerVersion(current: string, latest: string): boolean {
  const parse = (v: string): number[] | null => {
    const clean = v.replace(/^v/, '').split('-')[0];
    const parts = clean.split('.').map(Number);
    if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
    return parts;
  };

  const c = parse(current);
  const l = parse(latest);
  if (!c || !l) return false;

  for (let i = 0; i < 3; i++) {
    if (l[i] > c[i]) return true;
    if (l[i] < c[i]) return false;
  }
  return false;
}
