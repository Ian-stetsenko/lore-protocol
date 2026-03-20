import { describe, it, expect } from 'vitest';
import { TextFormatter } from '../../../src/formatters/text-formatter.js';
import type { LoreAtom, LoreTrailers, SupersessionStatus } from '../../../src/types/domain.js';
import type {
  FormattableQueryResult,
  FormattableValidationResult,
  FormattableStalenessResult,
  FormattableTraceResult,
  FormattableDoctorResult,
} from '../../../src/types/output.js';

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
    custom: overrides.custom ?? new Map(),
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

describe('TextFormatter', () => {
  const formatter = new TextFormatter({ color: false });

  describe('formatQueryResult', () => {
    it('should show "No lore atoms found" when empty', () => {
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
      expect(output).toContain('No lore atoms found');
    });

    it('should format atoms with header and trailers', () => {
      const atom = makeAtom({
        trailers: makeTrailers({
          Constraint: ['Must use OAuth2'],
          Confidence: 'high',
        }),
      });
      const data: FormattableQueryResult = {
        result: {
          command: 'constraints',
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
      expect(output).toContain('a1b2c3d4');
      expect(output).toContain('2025-01-15');
      expect(output).toContain('alice@example.com');
      expect(output).toContain('Constraint:');
      expect(output).toContain('Must use OAuth2');
      expect(output).toContain('Confidence:');
      expect(output).toContain('high');
    });

    it('should show supersession info for superseded atoms', () => {
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
      expect(output).toContain('superseded by e5f6a7b8');
    });

    it('should filter visible trailers', () => {
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
      expect(output).toContain('Constraint:');
      expect(output).toContain('Must use OAuth2');
      expect(output).not.toContain('Confidence:');
      expect(output).not.toContain('Rejected:');
    });

    it('should show body text when present', () => {
      const atom = makeAtom({ body: 'Detailed explanation here.' });
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
      expect(output).toContain('Detailed explanation here.');
    });

    it('should show meta summary at bottom', () => {
      const atom = makeAtom();
      const data: FormattableQueryResult = {
        result: {
          command: 'context',
          target: 'src/auth.ts',
          targetType: 'file',
          atoms: [atom],
          meta: { totalAtoms: 5, filteredAtoms: 1, oldest: atom.date, newest: atom.date },
        },
        supersessionMap: new Map(),
        visibleTrailers: 'all',
      };

      const output = formatter.formatQueryResult(data);
      expect(output).toContain('1 of 5 atoms shown');
    });
  });

  describe('formatValidationResult', () => {
    it('should show checkmark for valid commits', () => {
      const data: FormattableValidationResult = {
        valid: true,
        summary: { errors: 0, warnings: 0, commitsChecked: 1 },
        results: [
          {
            commit: 'abc1234567890',
            loreId: 'a1b2c3d4',
            valid: true,
            issues: [],
          },
        ],
      };

      const output = formatter.formatValidationResult(data);
      expect(output).toContain('\u2713');
      expect(output).toContain('a1b2c3d4');
      expect(output).toContain('all valid');
    });

    it('should show X marks for invalid commits', () => {
      const data: FormattableValidationResult = {
        valid: false,
        summary: { errors: 1, warnings: 1, commitsChecked: 1 },
        results: [
          {
            commit: 'abc1234567890',
            loreId: null,
            valid: false,
            issues: [
              { severity: 'error', rule: 'lore-id-present', message: 'Lore-id trailer is missing' },
              { severity: 'warning', rule: 'intent-length', message: 'Intent too long' },
            ],
          },
        ],
      };

      const output = formatter.formatValidationResult(data);
      expect(output).toContain('\u2717');
      expect(output).toContain('lore-id-present');
      expect(output).toContain('Lore-id trailer is missing');
      expect(output).toContain('\u26A0');
      expect(output).toContain('Intent too long');
      expect(output).toContain('1 errors');
      expect(output).toContain('1 warnings');
    });

    it('should use commit hash prefix when no lore-id', () => {
      const data: FormattableValidationResult = {
        valid: false,
        summary: { errors: 1, warnings: 0, commitsChecked: 1 },
        results: [
          {
            commit: 'abc1234567890',
            loreId: null,
            valid: false,
            issues: [
              { severity: 'error', rule: 'lore-id-present', message: 'Missing Lore-id' },
            ],
          },
        ],
      };

      const output = formatter.formatValidationResult(data);
      expect(output).toContain('abc12345');
    });
  });

  describe('formatStalenessResult', () => {
    it('should show message when no stale atoms', () => {
      const data: FormattableStalenessResult = { atoms: [] };
      const output = formatter.formatStalenessResult(data);
      expect(output).toContain('No stale atoms found');
    });

    it('should show STALE label with reasons', () => {
      const atom = makeAtom();
      const data: FormattableStalenessResult = {
        atoms: [
          {
            atom,
            reasons: ['Older than 6 months', 'Low confidence'],
          },
        ],
      };

      const output = formatter.formatStalenessResult(data);
      expect(output).toContain('STALE');
      expect(output).toContain('a1b2c3d4');
      expect(output).toContain('2025-01-15');
      expect(output).toContain('Older than 6 months');
      expect(output).toContain('Low confidence');
    });
  });

  describe('formatTraceResult', () => {
    it('should show root and edges with tree characters', () => {
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
      expect(output).toContain('aaaabbbb');
      expect(output).toContain('\u251C\u2500\u2500');
      expect(output).toContain('[Related]');
      expect(output).toContain('ccccdddd');
      expect(output).toContain('related change');
      expect(output).toContain('\u2514\u2500\u2500');
      expect(output).toContain('[Supersedes]');
      expect(output).toContain('eeeeffff');
      expect(output).toContain('(unresolved)');
    });

    it('should use last-item connector for single edge', () => {
      const root = makeAtom({ loreId: 'aaaabbbb' });
      const data: FormattableTraceResult = {
        root,
        edges: [
          { from: 'aaaabbbb', to: 'ccccdddd', relationship: 'Depends-on', targetAtom: null },
        ],
      };

      const output = formatter.formatTraceResult(data);
      expect(output).toContain('\u2514\u2500\u2500');
      expect(output).not.toContain('\u251C\u2500\u2500');
    });
  });

  describe('formatDoctorResult', () => {
    it('should show check statuses with colors', () => {
      const data: FormattableDoctorResult = {
        checks: [
          { name: 'git-version', status: 'ok', message: 'Git 2.40+ detected', details: [] },
          { name: 'config', status: 'warning', message: 'No config found', details: ['Using defaults'] },
          { name: 'duplicates', status: 'error', message: '2 duplicate Lore-ids', details: ['a1b2c3d4', 'e5f6a7b8'] },
        ],
        summary: { errors: 1, warnings: 1, info: 0 },
      };

      const output = formatter.formatDoctorResult(data);
      expect(output).toContain('OK');
      expect(output).toContain('git-version');
      expect(output).toContain('WARNING');
      expect(output).toContain('No config found');
      expect(output).toContain('Using defaults');
      expect(output).toContain('ERROR');
      expect(output).toContain('2 duplicate Lore-ids');
      expect(output).toContain('1 errors');
      expect(output).toContain('1 warnings');
    });

    it('should show "all checks passed" when no issues', () => {
      const data: FormattableDoctorResult = {
        checks: [
          { name: 'git-version', status: 'ok', message: 'OK', details: [] },
        ],
        summary: { errors: 0, warnings: 0, info: 0 },
      };

      const output = formatter.formatDoctorResult(data);
      expect(output).toContain('all checks passed');
    });
  });

  describe('formatSuccess', () => {
    it('should return the message', () => {
      const output = formatter.formatSuccess('Commit created: a1b2c3d4');
      expect(output).toContain('Commit created: a1b2c3d4');
    });
  });

  describe('formatError', () => {
    it('should show error messages with severity', () => {
      const output = formatter.formatError(1, [
        { severity: 'error', message: 'Something went wrong' },
        { severity: 'warning', field: 'intent', message: 'Too long' },
      ]);

      expect(output).toContain('error');
      expect(output).toContain('Something went wrong');
      expect(output).toContain('warning');
      expect(output).toContain('[intent]');
      expect(output).toContain('Too long');
      expect(output).toContain('exit code 1');
    });

    it('should not show exit code when code is 0', () => {
      const output = formatter.formatError(0, [
        { severity: 'warning', message: 'Minor issue' },
      ]);

      expect(output).not.toContain('exit code');
    });
  });

  describe('color support', () => {
    it('should produce output with color disabled', () => {
      const noColor = new TextFormatter({ color: false });
      const output = noColor.formatSuccess('OK');
      // With chalk level 0, no ANSI codes
      expect(output).not.toMatch(/\x1b\[/);
    });
  });
});
