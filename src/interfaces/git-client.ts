export interface RawCommit {
  readonly hash: string;
  readonly date: string;
  readonly author: string;
  readonly subject: string;
  readonly body: string;
  readonly trailers: string;
}

export interface BlameLine {
  readonly commitHash: string;
  readonly lineNumber: number;
  readonly content: string;
}

export interface CommitResult {
  readonly hash: string;
  readonly success: boolean;
}

export interface IGitClient {
  log(args: readonly string[]): Promise<readonly RawCommit[]>;
  blame(file: string, lineStart: number, lineEnd: number): Promise<readonly BlameLine[]>;
  commit(message: string): Promise<CommitResult>;
  hasStagedChanges(): Promise<boolean>;
  getRepoRoot(): Promise<string>;
  isInsideRepo(): Promise<boolean>;
  getFilesChanged(commitHash: string): Promise<readonly string[]>;
  countCommitsSince(path: string, sinceCommitHash: string): Promise<number>;
  resolveRef(ref: string): Promise<string>;
}
