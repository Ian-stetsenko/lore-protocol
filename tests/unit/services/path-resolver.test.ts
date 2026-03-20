import { describe, it, expect } from 'vitest';
import { PathResolver } from '../../../src/services/path-resolver.js';

describe('PathResolver', () => {
  const resolver = new PathResolver();

  describe('parseTarget', () => {
    describe('line-range targets', () => {
      it('should parse file:start-end as line-range', () => {
        const result = resolver.parseTarget('src/utils.ts:45-80');
        expect(result.type).toBe('line-range');
        expect(result.filePath).toBe('src/utils.ts');
        expect(result.lineStart).toBe(45);
        expect(result.lineEnd).toBe(80);
        expect(result.raw).toBe('src/utils.ts:45-80');
      });

      it('should parse file:line as line-range with start === end', () => {
        const result = resolver.parseTarget('src/utils.ts:45');
        expect(result.type).toBe('line-range');
        expect(result.filePath).toBe('src/utils.ts');
        expect(result.lineStart).toBe(45);
        expect(result.lineEnd).toBe(45);
      });

      it('should handle line 1', () => {
        const result = resolver.parseTarget('file.ts:1');
        expect(result.type).toBe('line-range');
        expect(result.lineStart).toBe(1);
        expect(result.lineEnd).toBe(1);
      });

      it('should handle large line numbers', () => {
        const result = resolver.parseTarget('file.ts:10000-20000');
        expect(result.type).toBe('line-range');
        expect(result.lineStart).toBe(10000);
        expect(result.lineEnd).toBe(20000);
      });

      it('should parse deeply nested file with line range', () => {
        const result = resolver.parseTarget('src/services/db/connection.ts:10-20');
        expect(result.type).toBe('line-range');
        expect(result.filePath).toBe('src/services/db/connection.ts');
        expect(result.lineStart).toBe(10);
        expect(result.lineEnd).toBe(20);
      });
    });

    describe('directory targets', () => {
      it('should classify trailing slash as directory', () => {
        const result = resolver.parseTarget('src/');
        expect(result.type).toBe('directory');
        expect(result.filePath).toBe('src/');
        expect(result.lineStart).toBeNull();
        expect(result.lineEnd).toBeNull();
      });

      it('should classify nested path with trailing slash as directory', () => {
        const result = resolver.parseTarget('src/services/db/');
        expect(result.type).toBe('directory');
        expect(result.filePath).toBe('src/services/db/');
      });

      it('should classify root-relative directory', () => {
        const result = resolver.parseTarget('./src/');
        expect(result.type).toBe('directory');
      });
    });

    describe('glob targets', () => {
      it('should classify patterns with * as glob', () => {
        const result = resolver.parseTarget('**/*.ts');
        expect(result.type).toBe('glob');
        expect(result.filePath).toBe('**/*.ts');
        expect(result.lineStart).toBeNull();
        expect(result.lineEnd).toBeNull();
      });

      it('should classify patterns with ? as glob', () => {
        const result = resolver.parseTarget('src/file?.ts');
        expect(result.type).toBe('glob');
        expect(result.filePath).toBe('src/file?.ts');
      });

      it('should classify *.js as glob', () => {
        const result = resolver.parseTarget('*.js');
        expect(result.type).toBe('glob');
      });

      it('should classify src/**/*.test.ts as glob', () => {
        const result = resolver.parseTarget('src/**/*.test.ts');
        expect(result.type).toBe('glob');
      });
    });

    describe('file targets', () => {
      it('should classify a plain file path as file', () => {
        const result = resolver.parseTarget('src/main.ts');
        expect(result.type).toBe('file');
        expect(result.filePath).toBe('src/main.ts');
        expect(result.lineStart).toBeNull();
        expect(result.lineEnd).toBeNull();
      });

      it('should classify a file without extension as file', () => {
        const result = resolver.parseTarget('Makefile');
        expect(result.type).toBe('file');
        expect(result.filePath).toBe('Makefile');
      });

      it('should classify a dotfile as file', () => {
        const result = resolver.parseTarget('.gitignore');
        expect(result.type).toBe('file');
      });

      it('should classify a deeply nested file as file', () => {
        const result = resolver.parseTarget('src/services/db/connection.ts');
        expect(result.type).toBe('file');
      });

      it('should classify a file with spaces as file', () => {
        const result = resolver.parseTarget('my file.ts');
        expect(result.type).toBe('file');
      });

      it('should classify a relative path as file', () => {
        const result = resolver.parseTarget('./src/main.ts');
        expect(result.type).toBe('file');
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
          expect(resolver.parseTarget(input).raw).toBe(input);
        }
      });
    });
  });

  describe('toGitLogArgs', () => {
    it('should produce -- filePath for file targets', () => {
      const target = resolver.parseTarget('src/main.ts');
      const args = resolver.toGitLogArgs(target);
      expect(args).toEqual(['--', 'src/main.ts']);
    });

    it('should produce -- filePath for directory targets', () => {
      const target = resolver.parseTarget('src/services/');
      const args = resolver.toGitLogArgs(target);
      expect(args).toEqual(['--', 'src/services/']);
    });

    it('should produce -- filePath for glob targets', () => {
      const target = resolver.parseTarget('**/*.ts');
      const args = resolver.toGitLogArgs(target);
      expect(args).toEqual(['--', '**/*.ts']);
    });

    it('should produce -L start,end:file for line-range targets', () => {
      const target = resolver.parseTarget('src/main.ts:10-20');
      const args = resolver.toGitLogArgs(target);
      expect(args).toEqual(['-L', '10,20:src/main.ts']);
    });

    it('should produce -L line,line:file for single-line targets', () => {
      const target = resolver.parseTarget('src/main.ts:42');
      const args = resolver.toGitLogArgs(target);
      expect(args).toEqual(['-L', '42,42:src/main.ts']);
    });
  });

  describe('toGitBlameArgs', () => {
    it('should return file, lineStart, lineEnd for line-range targets', () => {
      const target = resolver.parseTarget('src/main.ts:10-20');
      const args = resolver.toGitBlameArgs(target);
      expect(args).toEqual({
        file: 'src/main.ts',
        lineStart: 10,
        lineEnd: 20,
      });
    });

    it('should return file, line, line for single-line targets', () => {
      const target = resolver.parseTarget('src/main.ts:42');
      const args = resolver.toGitBlameArgs(target);
      expect(args).toEqual({
        file: 'src/main.ts',
        lineStart: 42,
        lineEnd: 42,
      });
    });

    it('should return file with lineStart=1 and lineEnd=-1 for file targets', () => {
      const target = resolver.parseTarget('src/main.ts');
      const args = resolver.toGitBlameArgs(target);
      expect(args).toEqual({
        file: 'src/main.ts',
        lineStart: 1,
        lineEnd: -1,
      });
    });

    it('should return file with lineStart=1 and lineEnd=-1 for directory targets', () => {
      const target = resolver.parseTarget('src/');
      const args = resolver.toGitBlameArgs(target);
      expect(args).toEqual({
        file: 'src/',
        lineStart: 1,
        lineEnd: -1,
      });
    });

    it('should return file with lineStart=1 and lineEnd=-1 for glob targets', () => {
      const target = resolver.parseTarget('**/*.ts');
      const args = resolver.toGitBlameArgs(target);
      expect(args).toEqual({
        file: '**/*.ts',
        lineStart: 1,
        lineEnd: -1,
      });
    });
  });
});
