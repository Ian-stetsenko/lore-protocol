export interface UpdateCheckCache {
  readonly currentVersion: string;
  readonly latestVersion: string;
  readonly lastChecked: number;
}

export interface IUpdateChecker {
  /**
   * Synchronously reads cached check result and writes a notification
   * to stderr if a newer version is available.
   */
  showCachedNotification(): boolean;

  /**
   * Fire-and-forget: fetches latest version from npm registry,
   * writes cache file. Caller should NOT await this.
   * Silently swallows all errors.
   */
  checkForUpdateAsync(): void;
}
