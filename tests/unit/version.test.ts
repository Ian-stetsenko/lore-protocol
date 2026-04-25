import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..', '..');

const require = createRequire(import.meta.url);
const { version } = require('../../package.json') as { version: string };

describe('--version flag', () => {
  it('should match package.json version', () => {
    const output = execFileSync(process.execPath, ['dist/main.js', '--version'], {
      cwd: projectRoot,
      encoding: 'utf-8',
    }).trim();

    expect(output).toBe(version);
  });
});
