import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { request } from 'node:https';
import type { IUpdateChecker, UpdateCheckCache } from '../interfaces/update-checker.js';
import { isNewerVersion } from '../util/semver.js';
import {
  UPDATE_CHECK_CACHE_FILENAME,
  UPDATE_CHECK_INTERVAL_MS,
  NPM_REGISTRY_BASE_URL,
  UPDATE_CHECK_TIMEOUT_MS,
} from '../util/constants.js';

function isValidCache(value: unknown): value is UpdateCheckCache {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj['latestVersion'] === 'string' &&
    typeof obj['lastChecked'] === 'number'
  );
}

interface UpdateCheckerOptions {
  readonly stderr?: { readonly isTTY?: boolean; write(s: string): boolean };
  readonly env?: Record<string, string | undefined>;
  readonly configUpdateCheck?: boolean;
}

/**
 * Checks for newer versions of the CLI on the npm registry.
 *
 * - showCachedNotification(): sync read of cache file, write to stderr
 * - checkForUpdateAsync(): fire-and-forget HTTPS fetch, write cache
 *
 * All errors are silently swallowed. Update checking must NEVER
 * interfere with normal CLI operation.
 *
 * GRASP: Pure Fabrication (infrastructure, not domain)
 * SOLID: SRP (one concern: update notifications)
 */
export class UpdateChecker implements IUpdateChecker {
  private readonly cachePath: string;
  private readonly stderr: { readonly isTTY?: boolean; write(s: string): boolean };
  private readonly env: Record<string, string | undefined>;
  private readonly configUpdateCheck: boolean;

  constructor(
    private readonly packageName: string,
    private readonly currentVersion: string,
    cacheDir: string,
    options?: UpdateCheckerOptions,
  ) {
    this.cachePath = join(cacheDir, UPDATE_CHECK_CACHE_FILENAME);
    this.stderr = options?.stderr ?? process.stderr;
    this.env = options?.env ?? (process.env as Record<string, string | undefined>);
    this.configUpdateCheck = options?.configUpdateCheck ?? true;
  }

  showCachedNotification(): boolean {
    if (this.shouldSkip()) return false;

    try {
      const raw = readFileSync(this.cachePath, 'utf-8');
      const parsed: unknown = JSON.parse(raw);

      if (!isValidCache(parsed)) return false;

      if (isNewerVersion(this.currentVersion, parsed.latestVersion)) {
        const msg =
          `\n  Update available: ${this.currentVersion} \u2192 ${parsed.latestVersion}\n` +
          `  Run \`npm install -g ${this.packageName}\` to update.\n\n`;
        this.stderr.write(msg);
        return true;
      }
    } catch {
      // Cache doesn't exist or is corrupt — silently skip
    }

    return false;
  }

  checkForUpdateAsync(): void {
    if (this.shouldSkip()) return;

    try {
      const raw = readFileSync(this.cachePath, 'utf-8');
      const parsed: unknown = JSON.parse(raw);
      if (
        isValidCache(parsed) &&
        Date.now() - parsed.lastChecked < UPDATE_CHECK_INTERVAL_MS
      ) {
        return;
      }
    } catch {
      // No cache or corrupt — proceed to fetch
    }

    this.fetchLatestVersion().then(
      (latestVersion) => {
        if (latestVersion) {
          this.writeCache(latestVersion);
        }
      },
      () => {
        // Silently swallow network errors
      },
    );
  }

  private shouldSkip(): boolean {
    if (!this.stderr.isTTY) return true;
    if (this.env['CI']) return true;
    if (this.env['NO_UPDATE_NOTIFIER']) return true;
    if (this.env['LORE_NO_UPDATE_CHECK']) return true;
    if (!this.configUpdateCheck) return true;
    return false;
  }

  private async fetchLatestVersion(): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      const url = `${NPM_REGISTRY_BASE_URL}/${encodeURIComponent(this.packageName)}/latest`;

      const req = request(url, { timeout: UPDATE_CHECK_TIMEOUT_MS }, (res) => {
        if (!res.statusCode || res.statusCode !== 200) {
          resolve(null);
          res.resume();
          return;
        }

        let data = '';
        res.setEncoding('utf-8');
        res.on('data', (chunk: string) => { data += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data) as { version?: string };
            resolve(parsed.version ?? null);
          } catch {
            resolve(null);
          }
        });
      });

      req.on('error', () => resolve(null));
      req.on('timeout', () => {
        req.destroy();
        resolve(null);
      });

      req.end();
    });
  }

  private writeCache(latestVersion: string): void {
    try {
      const cache: UpdateCheckCache = {
        currentVersion: this.currentVersion,
        latestVersion,
        lastChecked: Date.now(),
      };
      mkdirSync(dirname(this.cachePath), { recursive: true });
      writeFileSync(this.cachePath, JSON.stringify(cache), 'utf-8');
    } catch {
      // Silently swallow write errors
    }
  }
}
