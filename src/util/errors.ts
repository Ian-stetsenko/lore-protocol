import type { ValidationIssue } from '../types/output.js';

export class LoreError extends Error {
  constructor(
    message: string,
    readonly exitCode: number,
  ) {
    super(message);
    this.name = 'LoreError';
  }
}

export class ValidationError extends LoreError {
  constructor(
    message: string,
    readonly issues: readonly ValidationIssue[],
  ) {
    super(message, 1);
    this.name = 'ValidationError';
  }
}

export class GitError extends LoreError {
  constructor(message: string) {
    super(message, 2);
    this.name = 'GitError';
  }
}

export class NoStagedChangesError extends LoreError {
  constructor() {
    super('No staged changes. Stage files with `git add` before running `lore commit`.', 3);
    this.name = 'NoStagedChangesError';
  }
}
