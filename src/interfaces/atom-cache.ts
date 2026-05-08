export interface IAtomCache {
  /**
   * Get cached list of files changed for a commit hash.
   * Returns null if not in cache.
   */
  getFiles(hash: string): Promise<readonly string[] | null>;

  /**
   * Cache the list of files changed for a commit hash.
   */
  setFiles(hash: string, files: readonly string[]): Promise<void>;
}
