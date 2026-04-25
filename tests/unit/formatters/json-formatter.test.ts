import { describe, it, expect } from 'vitest';
import { JsonFormatter } from '../../../src/formatters/json-formatter.js';
import type { LoreAtom, LoreTrailers, SupersessionStatus } from '../../../src/types/domain.js';
import type {
  FormattableQueryResult,
  FormattableValidationResult,
  FormattableStalenessResult,
  FormattableTraceResult,
  FormattableDoctorResult,
} from '../../../src/types/output.js';
import { CustomTrailerCollection } from '../../../src/types/custom-trailer-collection.js';

function makeTrailers(overrides: Partial<LoreTrailers> = {}): LoreTrailers {
  return {
    'Lore-id': overrides['Lore-id'] ?? 'a1b2c3d4',
    Constraint: overrides.Constraint ?? [],
    Rejected: overrides.Rejected ?? [],
    Confidence: overrides.Confidence ?? null,
    'Scope-risk': overrides['Scope-risk'] ?? null,
    Reversibility: overrides.Reversibility ?? null,
    Directive: overrides.Directive ?? [],
    Tested: overrides.Tested ?? [],
    'Not-tested': overrides['Not-tested'] ?? [],
    Supersedes: overrides.Supersedes ?? [],
    'Depends-on': overrides['Depends-on'] ?? [],
    Related: overrides.Related ?? [],
    custom: overrides.custom ?? CustomTrailerCollection.empty(),
  };
}

function makeAtom(overrides: Partial<LoreAtom> = {}): LoreAtom {
  return {
    loreId: overrides.loreId ?? 'a1b2c3d4',
    commitHash: overrides.commitHash ?? 'abc1234567890',
    date: overrides.date ?? new Date('2025-01-15T10:00:00Z'),
    author: overrides.author ?? 'alice@example.com',
    intent: overrides.intent ?? 'feat(auth): add login flow',
    body: overrides.body ?? '',
    trailers: overrides.trailers ?? makeTrailers(),
    filesChanged: overrides.filesChanged ?? ['src/auth.ts'],
  };
}

describe('JsonFormatter', () => {
  const formatter = new JsonFormatter();

  describe('formatQueryResult', () => {
    it('should produce valid JSON with lore_version', () => {
      const atom = makeAtom();
      const data: FormattableQueryResult = {
        result: {
          command: 'context',
          target: 'src/auth.ts',
          targetType: 'file',
          atoms: [atom],
          meta: {
            totalAtoms: 1,
            filteredAtoms: 1,
            oldest: atom.date,
            newest: atom.date,
          },
        },
        supersessionMap: new Map(),
        visibleTrailers: 'all',
      };

      const output = formatter.formatQueryResult(data);
      const parsed = JSON.parse(output);

      expect(parsed.lore_version).toBe('1.0');
      expect(parsed.command).toBe('context');
      expect(parsed.target).toBe('src/auth.ts');
      expect(parsed.target_type).toBe('file');
    });

    it('should use snake_case field names', () => {
      const atom = makeAtom();
      const data: FormattableQueryResult = {
        result: {
          command: 'context',
          target: 'src/auth.ts',
          targetType: 'file',
          atoms: [atom],
          meta: {
            totalAtoms: 5,
            filteredAtoms: 1,
            oldest: atom.date,
            newest: atom.date,
          },
        },
        supersessionMap: new Map(),
        visibleTrailers: 'all',
      };

      const output = formatter.formatQueryResult(data);
      const parsed = JSON.parse(output);

      expect(parsed.meta.total_atoms).toBe(5);
      expect(parsed.meta.filtered_atoms).toBe(1);
      expect(parsed.results[0].lore_id).toBe('a1b2c3d4');
      expect(parsed.results[0].commit).toBe('abc1234567890');
      expect(parsed.results[0].files_changed).toEqual(['src/auth.ts']);
    });

    it('should format dates as ISO strings', () => {
      const atom = makeAtom({ date: new Date('2025-06-15T14:30:00Z') });
      const data: FormattableQueryResult = {
        result: {
          command: 'context',
          target: 'src/auth.ts',
          targetType: 'file',
          atoms: [atom],
          meta: {
            totalAtoms: 1,
            filteredAtoms: 1,
            oldest: atom.date,
            newest: atom.date,
          },
        },
        supersessionMap: new Map(),
        visibleTrailers: 'all',
      };

      const output = formatter.formatQueryResult(data);
      const parsed = JSON.parse(output);

      expect(parsed.results[0].date).toBe('2025-06-15T14:30:00.000Z');
      expect(parsed.meta.oldest).toBe('2025-06-15T14:30:00.000Z');
    });

    it('should include supersession status', () => {
      const atom = makeAtom();
      const supersessionMap = new Map<string, SupersessionStatus>([
        ['a1b2c3d4', { superseded: true, supersededBy: 'e5f6a7b8' }],
      ]);

      const data: FormattableQueryResult = {
        result: {
          command: 'context',
          target: 'src/auth.ts',
          targetType: 'file',
          atoms: [atom],
          meta: { totalAtoms: 1, filteredAtoms: 1, oldest: atom.date, newest: atom.date },
        },
        supersessionMap,
        visibleTrailers: 'all',
      };

      const output = formatter.formatQueryResult(data);
      const parsed = JSON.parse(output);

      expect(parsed.results[0].superseded).toBe(true);
      expect(parsed.results[0].superseded_by).toBe('e5f6a7b8');
    });

    it('should filter visible trailers in JSON output', () => {
      const atom = makeAtom({
        trailers: makeTrailers({
          Constraint: ['Must use OAuth2'],
          Confidence: 'high',
          Rejected: ['Session tokens'],
        }),
      });

      const data: FormattableQueryResult = {
        result: {
          command: 'constraints',
          target: 'src/auth.ts',
          targetType: 'file',
          atoms: [atom],
          meta: { totalAtoms: 1, filteredAtoms: 1, oldest: atom.date, newest: atom.date },
        },
        supersessionMap: new Map(),
        visibleTrailers: ['Constraint'],
      };

      const output = formatter.formatQueryResult(data);
      const parsed = JSON.parse(output);

      expect(parsed.results[0].trailers.constraint).toEqual(['Must use OAuth2']);
      expect(parsed.results[0].trailers.confidence).toBeUndefined();
      expect(parsed.results[0].trailers.rejected).toBeUndefined();
    });

    it('should handle empty atoms list', () => {
      const data: FormattableQueryResult = {
        result: {
          command: 'context',
          target: 'src/auth.ts',
          targetType: 'file',
          atoms: [],
          meta: { totalAtoms: 0, filteredAtoms: 0, oldest: null, newest: null },
        },
        supersessionMap: new Map(),
        visibleTrailers: 'all',
      };

      const output = formatter.formatQueryResult(data);
      const parsed = JSON.parse(output);

      expect(parsed.results).toEqual([]);
      expect(parsed.meta.oldest).toBeNull();
      expect(parsed.meta.newest).toBeNull();
    });

    it('should convert trailer keys to snake_case', () => {
      const atom = makeAtom({
        trailers: makeTrailers({
          'Scope-risk': 'wide',
          'Not-tested': ['edge cases'],
          'Depends-on': ['aabbccdd'],
        }),
      });

      const data: FormattableQueryResult = {
        result: {
          command: 'context',
          target: 'src/auth.ts',
          targetType: 'file',
          atoms: [atom],
          meta: { totalAtoms: 1, filteredAtoms: 1, oldest: atom.date, newest: atom.date },
        },
        supersessionMap: new Map(),
        visibleTrailers: 'all',
      };

      const output = formatter.formatQueryResult(data);
      const parsed = JSON.parse(output);

      expect(parsed.results[0].trailers.scope_risk).toBe('wide');
      expect(parsed.results[0].trailers.not_tested).toEqual(['edge cases']);
      expect(parsed.results[0].trailers.depends_on).toEqual(['aabbccdd']);
    });
  });

  describe('formatValidationResult', () => {
    it('should produce valid JSON with correct structure', () => {
      const data: FormattableValidationResult = {
        valid: true,
        summary: { errors: 0, warnings: 0, commitsChecked: 2 },
        results: [
          { commit: 'abc123', loreId: 'a1b2c3d4', valid: true, issues: [] },
          { commit: 'def456', loreId: 'e5f6a7b8', valid: true, issues: [] },
        ],
      };

      const output = formatter.formatValidationResult(data);
      const parsed = JSON.parse(output);

      expect(parsed.lore_version).toBe('1.0');
      expect(parsed.valid).toBe(true);
      expect(parsed.summary.commits_checked).toBe(2);
      expect(parsed.results).toHaveLength(2);
      expect(parsed.results[0].lore_id).toBe('a1b2c3d4');
    });

    it('should include issues in results', () => {
      const data: FormattableValidationResult = {
        valid: false,
        summary: { errors: 1, warnings: 0, commitsChecked: 1 },
        results: [
          {
            commit: 'abc123',
            loreId: null,
            valid: false,
            issues: [
              { severity: 'error', rule: 'lore-id-present', message: 'Missing Lore-id' },
            ],
          },
        ],
      };

      const output = formatter.formatValidationResult(data);
      const parsed = JSON.parse(output);

      expect(parsed.results[0].lore_id).toBeNull();
      expect(parsed.results[0].issues[0].severity).toBe('error');
      expect(parsed.results[0].issues[0].rule).toBe('lore-id-present');
    });
  });

  describe('formatStalenessResult', () => {
    it('should produce valid JSON with stale atoms', () => {
      const atom = makeAtom();
      const data: FormattableStalenessResult = {
        atoms: [{
          atom,
          reasons: [
            { signal: 'age', description: 'Too old' },
            { signal: 'low-confidence', description: 'Low confidence' },
          ],
        }],
      };

      const output = formatter.formatStalenessResult(data);
      const parsed = JSON.parse(output);

      expect(parsed.lore_version).toBe('1.0');
      expect(parsed.stale_atoms).toHaveLength(1);
      expect(parsed.stale_atoms[0].lore_id).toBe('a1b2c3d4');
      expect(parsed.stale_atoms[0].date).toBe('2025-01-15T10:00:00.000Z');
      expect(parsed.stale_atoms[0].reasons).toEqual([
        { signal: 'age', description: 'Too old' },
        { signal: 'low-confidence', description: 'Low confidence' },
      ]);
    });

    it('should produce empty array when no stale atoms', () => {
      const data: FormattableStalenessResult = { atoms: [] };
      const output = formatter.formatStalenessResult(data);
      const parsed = JSON.parse(output);

      expect(parsed.stale_atoms).toEqual([]);
    });
  });

  describe('formatTraceResult', () => {
    it('should produce valid JSON with root and edges', () => {
      const root = makeAtom({ loreId: 'aaaabbbb' });
      const targetAtom = makeAtom({ loreId: 'ccccdddd', intent: 'related change' });

      const data: FormattableTraceResult = {
        root,
        edges: [
          { from: 'aaaabbbb', to: 'ccccdddd', relationship: 'Related', targetAtom },
          { from: 'aaaabbbb', to: 'eeeeffff', relationship: 'Supersedes', targetAtom: null },
        ],
      };

      const output = formatter.formatTraceResult(data);
      const parsed = JSON.parse(output);

      expect(parsed.lore_version).toBe('1.0');
      expect(parsed.root.lore_id).toBe('aaaabbbb');
      expect(parsed.edges).toHaveLength(2);
      expect(parsed.edges[0].resolved).toBe(true);
      expect(parsed.edges[0].target_atom.lore_id).toBe('ccccdddd');
      expect(parsed.edges[1].resolved).toBe(false);
      expect(parsed.edges[1].target_atom).toBeNull();
    });
  });

  describe('formatDoctorResult', () => {
    it('should produce valid JSON with checks and summary', () => {
      const data: FormattableDoctorResult = {
        checks: [
          { name: 'git-version', status: 'ok', message: 'Git 2.40+ detected', details: [] },
          { name: 'config', status: 'warning', message: 'No config found', details: ['Using defaults'] },
        ],
        summary: { errors: 0, warnings: 1, info: 0 },
      };

      const output = formatter.formatDoctorResult(data);
      const parsed = JSON.parse(output);

      expect(parsed.lore_version).toBe('1.0');
      expect(parsed.checks).toHaveLength(2);
      expect(parsed.checks[0].name).toBe('git-version');
      expect(parsed.checks[0].status).toBe('ok');
      expect(parsed.checks[1].details).toEqual(['Using defaults']);
      expect(parsed.summary.warnings).toBe(1);
    });
  });

  describe('formatSuccess', () => {
    it('should produce valid JSON with success flag', () => {
      const output = formatter.formatSuccess('Commit created', { lore_id: 'a1b2c3d4' });
      const parsed = JSON.parse(output);

      expect(parsed.lore_version).toBe('1.0');
      expect(parsed.success).toBe(true);
      expect(parsed.message).toBe('Commit created');
      expect(parsed.lore_id).toBe('a1b2c3d4');
    });

    it('should work without extra data', () => {
      const output = formatter.formatSuccess('Done');
      const parsed = JSON.parse(output);

      expect(parsed.success).toBe(true);
      expect(parsed.message).toBe('Done');
    });
  });

  describe('formatError', () => {
    it('should produce valid JSON with error details', () => {
      const output = formatter.formatError(1, [
        { severity: 'error', message: 'Validation failed' },
        { severity: 'warning', field: 'intent', message: 'Too long' },
      ]);
      const parsed = JSON.parse(output);

      expect(parsed.lore_version).toBe('1.0');
      expect(parsed.error).toBe(true);
      expect(parsed.code).toBe(1);
      expect(parsed.messages).toHaveLength(2);
      expect(parsed.messages[0].severity).toBe('error');
      expect(parsed.messages[0].field).toBeNull();
      expect(parsed.messages[1].field).toBe('intent');
    });

    it('should include all validation issue details in JSON output', () => {
      const output = formatter.formatError(1, [
        { severity: 'error', message: 'Required trailer "Assisted-by" is missing' },
        { severity: 'warning', message: 'Intent exceeds 72 characters' },
      ]);
      const parsed = JSON.parse(output);

      expect(parsed.messages).toHaveLength(2);
      expect(parsed.messages[0].message).toBe('Required trailer "Assisted-by" is missing');
      expect(parsed.messages[0].severity).toBe('error');
      expect(parsed.messages[1].message).toBe('Intent exceeds 72 characters');
      expect(parsed.messages[1].severity).toBe('warning');
    });
  });

  describe('JSON format validity', () => {
    it('should always produce well-formed JSON with 2-space indentation', () => {
      const data: FormattableValidationResult = {
        valid: true,
        summary: { errors: 0, warnings: 0, commitsChecked: 0 },
        results: [],
      };

      const output = formatter.formatValidationResult(data);
      // Should be parseable
      expect(() => JSON.parse(output)).not.toThrow();
      // Should be indented
      expect(output).toContain('\n  ');
    });
  });
});
