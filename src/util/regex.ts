/**
 * Escape special characters in a string for use in a regular expression.
 * Based on MDN implementation.
 */
export function escapeRegex(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}
