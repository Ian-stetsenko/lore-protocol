/**
 * Determine whether the atom cache should be bypassed.
 * Respects command-line flags, environment variables, and project configuration.
 */
export function shouldBypassCache(configCache: boolean | undefined): boolean {
  if (process.argv.includes('--no-cache')) return true;

  const env = process.env;
  if (['1', 'true'].includes(env['LORE_NO_CACHE'] ?? '')) return true;

  if (configCache === false) return true;

  return false;
}
