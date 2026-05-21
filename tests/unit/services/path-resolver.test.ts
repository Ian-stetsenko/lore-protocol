import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { PathResolver } from '../../../src/services/path-resolver.js';

describe('PathResolver', () => {
  // Base configuration: Lore root is the same as CWD
  const baseLoreRoot = resolve('/work/project');
  const baseCwd = baseLoreRoot;
  const baseResolver = new PathResolver(baseCwd, baseLoreRoot);

  // Cross-platform normalization for test assertions
  const normalizeResult = (p: string) => p.replace(/\\/g, '/');

  describe('parseTarget', () => {
    describe('Normalization (Lore-root centric)', () => {
      const nestedLoreRoot = resolve('/work/project');
      const nestedCwd = resolve('/work/project/src');
      const nestedResolver = new PathResolver(nestedCwd, nestedLoreRoot);

      it('should normalize CWD-relative file to Lore-root relative', () => {
        // CWD is /work/project/src, Target is main.ts
        // Result should be src/main.ts
        const result = nestedResolver.parseTarget('main.ts');
        expect(normalizeResult(result.filePath)).toBe('src/main.ts');
      });

      it('should handle parent directory references from CWD', () => {
        // Target is ../README.md from /work/project/src
        // Result should be README.md
        const result = nestedResolver.parseTarget('../README.md');
        expect(normalizeResult(result.filePath)).toBe('README.md');
      });

      it('should handle absolute paths inside the lore root', () => {
        const absPath = resolve(nestedLoreRoot, 'package.json');
        const result = nestedResolver.parseTarget(absPath);
        expect(normalizeResult(result.filePath)).toBe('package.json');
      });

      it('should handle paths outside the lore root using parent references', () => {
        const result = nestedResolver.parseTarget('../../other/file.txt');
        expect(normalizeResult(result.filePath)).toBe('../other/file.txt');
      });
    });

    describe('line-range targets', () => {
      it('should parse file:start-end as line-range', () => {
        const result = baseResolver.parseTarget('src/utils.ts:45-80');
        expect(result.type).toBe('line-range');
        expect(normalizeResult(result.filePath)).toBe('src/utils.ts');
        expect(result.lineStart).toBe(45);
        expect(result.lineEnd).toBe(80);
        expect(result.raw).toBe('src/utils.ts:45-80');
      });

      it('should parse file:line as line-range with start === end', () => {
        const result = baseResolver.parseTarget('src/utils.ts:45');
        expect(result.type).toBe('line-range');
        expect(normalizeResult(result.filePath)).toBe('src/utils.ts');
        expect(result.lineStart).toBe(45);
        expect(result.lineEnd).toBe(45);
      });

      it('should handle line 1', () => {
        const result = baseResolver.parseTarget('file.ts:1');
        expect(result.type).toBe('line-range');
        expect(result.lineStart).toBe(1);
        expect(result.lineEnd).toBe(1);
      });

      it('should handle large line numbers', () => {
        const result = baseResolver.parseTarget('file.ts:10000-20000');
        expect(result.type).toBe('line-range');
        expect(result.lineStart).toBe(10000);
        expect(result.lineEnd).toBe(20000);
      });

      it('should parse deeply nested file with line range', () => {
        const result = baseResolver.parseTarget('src/services/db/connection.ts:10-20');
        expect(result.type).toBe('line-range');
        expect(normalizeResult(result.filePath)).toBe('src/services/db/connection.ts');
        expect(result.lineStart).toBe(10);
        expect(result.lineEnd).toBe(20);
      });
    });

    describe('directory targets', () => {
      it('should classify trailing slash as directory', () => {
        const result = baseResolver.parseTarget('src/');
        expect(result.type).toBe('directory');
        expect(normalizeResult(result.filePath)).toBe('src/');
        expect(result.lineStart).toBeNull();
        expect(result.lineEnd).toBeNull();
      });

      it('should classify nested path with trailing slash as directory', () => {
        const result = baseResolver.parseTarget('src/services/db/');
        expect(result.type).toBe('directory');
        expect(normalizeResult(result.filePath)).toBe('src/services/db/');
      });

      it('should classify root-relative directory', () => {
        const result = baseResolver.parseTarget('./src/');
        expect(result.type).toBe('directory');
        expect(normalizeResult(result.filePath)).toBe('src/');
      });
    });

    describe('glob targets', () => {
      it('should classify patterns with * as glob', () => {
        const result = baseResolver.parseTarget('**/*.ts');
        expect(result.type).toBe('glob');
        expect(normalizeResult(result.filePath)).toBe('**/*.ts');
        expect(result.lineStart).toBeNull();
        expect(result.lineEnd).toBeNull();
      });

      it('should classify patterns with ? as glob', () => {
        const result = baseResolver.parseTarget('src/file?.ts');
        expect(result.type).toBe('glob');
        expect(normalizeResult(result.filePath)).toBe('src/file?.ts');
      });

      it('should classify *.js as glob', () => {
        const result = baseResolver.parseTarget('*.js');
        expect(result.type).toBe('glob');
        expect(normalizeResult(result.filePath)).toBe('*.js');
      });

      it('should classify src/**/*.test.ts as glob', () => {
        const result = baseResolver.parseTarget('src/**/*.test.ts');
        expect(result.type).toBe('glob');
        expect(normalizeResult(result.filePath)).toBe('src/**/*.test.ts');
      });
    });

    describe('file targets', () => {
      it('should classify a plain file path as file', () => {
        const result = baseResolver.parseTarget('src/main.ts');
        expect(result.type).toBe('file');
        expect(normalizeResult(result.filePath)).toBe('src/main.ts');
        expect(result.lineStart).toBeNull();
        expect(result.lineEnd).toBeNull();
      });

      it('should classify a file without extension as file', () => {
        const result = baseResolver.parseTarget('Makefile');
        expect(result.type).toBe('file');
        expect(normalizeResult(result.filePath)).toBe('Makefile');
      });

      it('should classify a dotfile as file', () => {
        const result = baseResolver.parseTarget('.gitignore');
        expect(result.type).toBe('file');
        expect(normalizeResult(result.filePath)).toBe('.gitignore');
      });

      it('should classify a deeply nested file as file', () => {
        const result = baseResolver.parseTarget('src/services/db/connection.ts');
        expect(result.type).toBe('file');
        expect(normalizeResult(result.filePath)).toBe('src/services/db/connection.ts');
      });

      it('should classify a file with spaces as file', () => {
        const result = baseResolver.parseTarget('my file.ts');
        expect(result.type).toBe('file');
        expect(normalizeResult(result.filePath)).toBe('my file.ts');
      });

      it('should classify a relative path as file', () => {
        const result = baseResolver.parseTarget('./src/main.ts');
        expect(result.type).toBe('file');
        expect(normalizeResult(result.filePath)).toBe('src/main.ts');
      });
    });

    describe('raw field', () => {
      it('should always preserve the original raw input', () => {
        const inputs = [
          'src/main.ts',
          'src/main.ts:42',
          'src/main.ts:10-20',
          'src/',
          '**/*.ts',
        ];
        for (const input of inputs) {
          expect(baseResolver.parseTarget(input).raw).toBe(input);
        }
      });
    });
  });

  describe('toGitLogArgs', () => {
    it('should produce -- filePath for file targets', () => {
      const target = baseResolver.parseTarget('src/main.ts');
      const args = baseResolver.toGitLogArgs(target);
      expect(args).toEqual(['--', 'src/main.ts']);
    });

    it('should produce -- filePath for directory targets', () => {
      const target = baseResolver.parseTarget('src/services/');
      const args = baseResolver.toGitLogArgs(target);
      expect(args).toEqual(['--', 'src/services/']);
    });

    it('should produce -- filePath for glob targets', () => {
      const target = baseResolver.parseTarget('**/*.ts');
      const args = baseResolver.toGitLogArgs(target);
      expect(args).toEqual(['--', '**/*.ts']);
    });

    it('should produce -L start,end:file for line-range targets', () => {
      const target = baseResolver.parseTarget('src/main.ts:10-20');
      const args = baseResolver.toGitLogArgs(target);
      expect(args).toEqual(['-L', '10,20:src/main.ts']);
    });

    it('should produce -L line,line:file for single-line targets', () => {
      const target = baseResolver.parseTarget('src/main.ts:42');
      const args = baseResolver.toGitLogArgs(target);
      expect(args).toEqual(['-L', '42,42:src/main.ts']);
    });
  });

  describe('toGitLogArgsMulti', () => {
    it('should normalize and combine multiple paths', () => {
      const nestedLoreRoot = resolve('/work/project');
      const nestedCwd = resolve('/work/project/src');
      const nestedResolver = new PathResolver(nestedCwd, nestedLoreRoot);

      const args = nestedResolver.toGitLogArgsMulti(['main.ts', '../README.md']);
      expect(args).toEqual(['--', 'src/main.ts', 'README.md']);
    });

    it('should return empty array for empty input', () => {
      expect(baseResolver.toGitLogArgsMulti([])).toEqual([]);
    });
  });

  describe('toGitBlameArgs', () => {
    it('should return file, lineStart, lineEnd for line-range targets', () => {
      const target = baseResolver.parseTarget('src/main.ts:10-20');
      const args = baseResolver.toGitBlameArgs(target);
      expect(args).toEqual({
        file: 'src/main.ts',
        lineStart: 10,
        lineEnd: 20,
      });
    });

    it('should return file, line, line for single-line targets', () => {
      const target = baseResolver.parseTarget('src/main.ts:42');
      const args = baseResolver.toGitBlameArgs(target);
      expect(args).toEqual({
        file: 'src/main.ts',
        lineStart: 42,
        lineEnd: 42,
      });
    });

    it('should return file with lineStart=1 and lineEnd=-1 for file targets', () => {
      const target = baseResolver.parseTarget('src/main.ts');
      const args = baseResolver.toGitBlameArgs(target);
      expect(args).toEqual({
        file: 'src/main.ts',
        lineStart: 1,
        lineEnd: -1,
      });
    });

    it('should return file with lineStart=1 and lineEnd=-1 for directory targets', () => {
      const target = baseResolver.parseTarget('src/');
      const args = baseResolver.toGitBlameArgs(target);
      expect(args).toEqual({
        file: 'src/',
        lineStart: 1,
        lineEnd: -1,
      });
    });

    it('should return file with lineStart=1 and lineEnd=-1 for glob targets', () => {
      const target = baseResolver.parseTarget('**/*.ts');
      const args = baseResolver.toGitBlameArgs(target);
      expect(args).toEqual({
        file: '**/*.ts',
        lineStart: 1,
        lineEnd: -1,
      });
    });
  });
});
