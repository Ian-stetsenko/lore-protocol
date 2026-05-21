import { resolve, relative } from 'node:path';
import type { QueryTarget } from '../types/query.js';

const LINE_RANGE_PATTERN = /^(.+):(\d+)-(\d+)$/;
const SINGLE_LINE_PATTERN = /^(.+):(\d+)$/;
const GLOB_CHARS_PATTERN = /[*?]/;

/**
 * Resolves a CLI target argument into a QueryTarget and converts to git args.
 *
 * GRASP: Information Expert -- knows path classification rules.
 * SRP: Only target -> git-args translation.
 */
export class PathResolver {
  constructor(
    private readonly cwd: string,
    private readonly loreRoot: string,
  ) {}

  /**
   * Parse a raw target string into a QueryTarget.
   *
   * Classification rules:
   * - `file.ts:45-80` -> line-range (file + start + end)
   * - `file.ts:45` -> line-range (file + start, end = start)
   * - Trailing slash or looks like directory -> directory
   * - Contains * or ? -> glob
   * - Everything else -> file
   */
  parseTarget(raw: string): QueryTarget {
    // Try line-range with start-end (e.g., file.ts:45-80)
    const rangeMatch = LINE_RANGE_PATTERN.exec(raw);
    if (rangeMatch) {
      const filePath = this.normalizePath(rangeMatch[1]);
      const lineStart = parseInt(rangeMatch[2], 10);
      const lineEnd = parseInt(rangeMatch[3], 10);
      return {
        raw,
        type: 'line-range',
        filePath,
        lineStart,
        lineEnd,
      };
    }

    // Try single-line (e.g., file.ts:45)
    const singleMatch = SINGLE_LINE_PATTERN.exec(raw);
    if (singleMatch) {
      const filePath = this.normalizePath(singleMatch[1]);
      const lineStart = parseInt(singleMatch[2], 10);
      return {
        raw,
        type: 'line-range',
        filePath,
        lineStart,
        lineEnd: lineStart,
      };
    }

    // Check for glob pattern (contains * or ?)
    if (GLOB_CHARS_PATTERN.test(raw)) {
      return {
        raw,
        type: 'glob',
        filePath: this.normalizePath(raw),
        lineStart: null,
        lineEnd: null,
      };
    }

    // Check for directory (trailing slash)
    if (raw.endsWith('/')) {
      return {
        raw,
        type: 'directory',
        filePath: this.normalizePath(raw),
        lineStart: null,
        lineEnd: null,
      };
    }

    // Default: file
    return {
      raw,
      type: 'file',
      filePath: this.normalizePath(raw),
      lineStart: null,
      lineEnd: null,
    };
  }

  /**
   * Normalize a path relative to the loreRoot.
   */
  private normalizePath(rawPath: string): string {
    // 1. Resolve to an absolute path based on CWD
    const absolutePath = resolve(this.cwd, rawPath);

    // 2. Compute relative path from loreRoot
    let relPath = relative(this.loreRoot, absolutePath);

    // 3. Normalize to POSIX separators and handle empty/root case
    if (relPath === '') {
      relPath = '.';
    }
    
    let normalized = relPath.replace(/\\/g, '/');

    // 4. Preserve trailing slash if present in raw input
    if (rawPath.endsWith('/') && !normalized.endsWith('/')) {
      normalized += '/';
    }

    return normalized;
  }

  /**
   * Convert multiple raw path strings into a combined git log argument array.
   * Normalizes all paths relative to loreRoot.
   */
  toGitLogArgsMulti(rawPaths: string[]): readonly string[] {
    if (rawPaths.length === 0) return [];

    const normalized = rawPaths.map((p) => this.normalizePath(p));
    return ['--', ...normalized];
  }

  /**
   * Convert a QueryTarget into git log arguments.
   *
   * - file: ['--', filePath]
   * - directory: ['--', filePath]
   * - glob: ['--', filePath]
   * - line-range: ['-L', 'start,end:filePath'] -- uses git log -L for
   *   function-level tracking
   */
  toGitLogArgs(target: QueryTarget): readonly string[] {
    switch (target.type) {
      case 'file':
      case 'directory':
      case 'glob':
        return ['--', target.filePath];

      case 'line-range':
        return [
          `-L`,
          `${target.lineStart},${target.lineEnd}:${target.filePath}`,
        ];
    }
  }

  /**
   * Convert a QueryTarget into git blame arguments.
   * Only valid for line-range targets. For file targets, blames the entire file.
   *
   * Returns { file, lineStart, lineEnd } for use with
   * `git blame -L lineStart,lineEnd file`.
   */
  toGitBlameArgs(target: QueryTarget): { file: string; lineStart: number; lineEnd: number } {
    if (target.type === 'line-range' && target.lineStart !== null && target.lineEnd !== null) {
      return {
        file: target.filePath,
        lineStart: target.lineStart,
        lineEnd: target.lineEnd,
      };
    }

    // For non-line-range targets, blame the whole file (line 1 to end)
    return {
      file: target.filePath,
      lineStart: 1,
      lineEnd: -1, // Sentinel meaning "end of file"
    };
  }
}
