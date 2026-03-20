import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import type { IGitClient, RawCommit, BlameLine, CommitResult } from '../interfaces/git-client.js';
import { GitError } from '../util/errors.js';

const execFile = promisify(execFileCb);

/**
 * Field separator: null byte.
 * Used to delimit fields within a single commit record.
 */
const FIELD_SEP = '\x00';

/**
 * Record separator: double null byte.
 * Used to delimit separate commit records in git log output.
 */
const RECORD_SEP = `${FIELD_SEP}${FIELD_SEP}`;

/**
 * Git log format string.
 * Fields: hash, ISO date, author email, subject, body, trailers.
 * Each field separated by a null byte, each record ends with double null.
 */
const LOG_FORMAT = `%H${FIELD_SEP}%aI${FIELD_SEP}%ae${FIELD_SEP}%s${FIELD_SEP}%b${FIELD_SEP}%(trailers:only,unfold)${RECORD_SEP}`;

/**
 * Blame porcelain line pattern.
 * Matches the commit hash at the start of each blame output block.
 */
const BLAME_HASH_PATTERN = /^([0-9a-f]{40})\s/;

/**
 * Real git interaction layer using child_process.execFile.
 *
 * GoF: Adapter -- adapts the volatile git CLI to a stable domain interface.
 * SOLID: DIP -- services depend on IGitClient, not child_process.
 */
export class GitClient implements IGitClient {
  private readonly cwd: string;

  constructor(cwd?: string) {
    this.cwd = cwd ?? process.cwd();
  }

  async log(args: readonly string[]): Promise<readonly RawCommit[]> {
    const hasLFlag = args.some(arg => arg.startsWith('-L'));

    const baseArgs = hasLFlag
      ? ['log', ...args]
      : ['log', `--format=${LOG_FORMAT}`, ...args];

    const stdout = await this.exec(baseArgs);

    if (hasLFlag) {
      return this.parseLFlagOutput(stdout);
    }

    return this.parseLogOutput(stdout);
  }

  async blame(file: string, lineStart: number, lineEnd: number): Promise<readonly BlameLine[]> {
    const lineRange = lineEnd === -1
      ? `${lineStart},`
      : `${lineStart},${lineEnd}`;

    const stdout = await this.exec([
      'blame',
      '--porcelain',
      `-L`,
      lineRange,
      file,
    ]);

    return this.parseBlameOutput(stdout);
  }

  async commit(message: string): Promise<CommitResult> {
    const stdout = await this.exec(['commit', '-m', message]);

    // Extract the commit hash from git commit output.
    // Git outputs something like: [main abc1234] commit message
    const hashMatch = /\[[\w/-]+\s+([0-9a-f]+)\]/.exec(stdout);
    const hash = hashMatch ? hashMatch[1] : '';

    return { hash, success: true };
  }

  async hasStagedChanges(): Promise<boolean> {
    try {
      const stdout = await this.exec(['diff', '--cached', '--name-only']);
      return stdout.trim().length > 0;
    } catch {
      return false;
    }
  }

  async getRepoRoot(): Promise<string> {
    const stdout = await this.exec(['rev-parse', '--show-toplevel']);
    return stdout.trim();
  }

  async isInsideRepo(): Promise<boolean> {
    try {
      await this.exec(['rev-parse', '--is-inside-work-tree']);
      return true;
    } catch {
      return false;
    }
  }

  async getFilesChanged(commitHash: string): Promise<readonly string[]> {
    const stdout = await this.exec([
      'diff-tree',
      '--no-commit-id',
      '--name-only',
      '-r',
      commitHash,
    ]);
    return stdout.trim().split('\n').filter(line => line.length > 0);
  }

  async countCommitsSince(path: string, sinceCommitHash: string): Promise<number> {
    const stdout = await this.exec([
      'rev-list',
      '--count',
      `${sinceCommitHash}..HEAD`,
      '--',
      path,
    ]);
    return parseInt(stdout.trim(), 10);
  }

  async resolveRef(ref: string): Promise<string> {
    const stdout = await this.exec(['rev-parse', ref]);
    return stdout.trim();
  }

  /**
   * Parse the standard git log output with our custom format.
   * Records are separated by double null bytes; fields within a record
   * by single null bytes.
   */
  private parseLogOutput(stdout: string): readonly RawCommit[] {
    if (!stdout.trim()) {
      return [];
    }

    const records = stdout.split(RECORD_SEP).filter(r => r.trim().length > 0);
    const commits: RawCommit[] = [];

    for (const record of records) {
      const fields = record.split(FIELD_SEP);
      if (fields.length < 6) {
        continue;
      }

      commits.push({
        hash: fields[0].trim(),
        date: fields[1].trim(),
        author: fields[2].trim(),
        subject: fields[3].trim(),
        body: fields[4].trim(),
        trailers: fields[5].trim(),
      });
    }

    return commits;
  }

  /**
   * Parse git log -L output, which uses a different format.
   * The -L flag does not support --format, so we parse the default output.
   */
  private parseLFlagOutput(stdout: string): readonly RawCommit[] {
    if (!stdout.trim()) {
      return [];
    }

    const commits: RawCommit[] = [];
    // Split on commit lines -- each commit starts with "commit <hash>"
    const commitBlocks = stdout.split(/(?=^commit [0-9a-f]{40})/m);

    for (const block of commitBlocks) {
      if (!block.trim()) continue;

      const commitMatch = /^commit ([0-9a-f]{40})/.exec(block);
      if (!commitMatch) continue;

      const hash = commitMatch[1];

      const authorMatch = /^Author:\s+.*<(.+?)>/m.exec(block);
      const author = authorMatch ? authorMatch[1] : '';

      const dateMatch = /^Date:\s+(.+)$/m.exec(block);
      const date = dateMatch ? dateMatch[1].trim() : '';

      // The message starts after the header block (after the first blank line)
      const headerEndIndex = block.indexOf('\n\n');
      let subject = '';
      let body = '';
      let trailers = '';

      if (headerEndIndex !== -1) {
        // Everything after the header, but before the diff section
        const diffStart = block.indexOf('\ndiff --git');
        const messageEnd = diffStart !== -1 ? diffStart : block.length;
        const rawMessage = block.slice(headerEndIndex + 2, messageEnd).trim();

        // Undo the 4-space indent git applies to log messages
        const dedented = rawMessage.split('\n').map(l => l.replace(/^ {4}/, '')).join('\n');

        const msgLines = dedented.split('\n');
        subject = msgLines[0] ?? '';

        // Find the trailer block at the end
        const paragraphs = dedented.split(/\n\n+/);
        if (paragraphs.length > 1) {
          const lastParagraph = paragraphs[paragraphs.length - 1];
          const trailerLinePattern = /^[A-Za-z][A-Za-z0-9-]*:\s+/;
          const lastParaLines = lastParagraph.split('\n');
          const hasTrailers = lastParaLines.some(l => trailerLinePattern.test(l));

          if (hasTrailers) {
            trailers = lastParagraph;
            body = paragraphs.slice(1, -1).join('\n\n');
          } else {
            body = paragraphs.slice(1).join('\n\n');
          }
        }
      }

      commits.push({ hash, date, author, subject, body, trailers });
    }

    return commits;
  }

  /**
   * Parse git blame --porcelain output into BlameLine entries.
   */
  private parseBlameOutput(stdout: string): readonly BlameLine[] {
    if (!stdout.trim()) {
      return [];
    }

    const lines = stdout.split('\n');
    const results: BlameLine[] = [];
    let currentHash: string | null = null;
    let currentLineNumber: number | null = null;

    for (const line of lines) {
      // Lines starting with a hash (40 hex chars) start a new blame block
      const hashMatch = BLAME_HASH_PATTERN.exec(line);
      if (hashMatch) {
        currentHash = hashMatch[1];
        // The line format is: <hash> <orig-line> <final-line> [<num-lines>]
        const parts = line.split(/\s+/);
        currentLineNumber = parseInt(parts[2], 10);
        continue;
      }

      // Content line starts with a tab
      if (line.startsWith('\t') && currentHash !== null && currentLineNumber !== null) {
        results.push({
          commitHash: currentHash,
          lineNumber: currentLineNumber,
          content: line.slice(1), // remove leading tab
        });
        currentHash = null;
        currentLineNumber = null;
      }
    }

    return results;
  }

  /**
   * Execute a git command and return stdout.
   * Throws GitError on non-zero exit or other errors.
   */
  private async exec(args: readonly string[]): Promise<string> {
    try {
      const { stdout } = await execFile('git', args as string[], {
        cwd: this.cwd,
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer for large repos
        encoding: 'utf-8',
      });
      return stdout;
    } catch (error: unknown) {
      if (error instanceof Error) {
        const execError = error as { stderr?: string; code?: number };
        const stderr = execError.stderr ?? error.message;
        throw new GitError(`git ${args[0]} failed: ${stderr}`);
      }
      throw new GitError(`git ${args[0]} failed: unknown error`);
    }
  }
}
