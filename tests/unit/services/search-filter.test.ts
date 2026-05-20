import { describe, it, expect } from 'vitest';
import { SearchFilter } from '../../../src/services/search-filter.js';
import type { LoreAtom } from '../../../src/types/domain.js';
import { CustomTrailerCollection } from '../../../src/types/custom-trailer-collection.js';

describe('SearchFilter', () => {
  const filter = new SearchFilter();

  const mockAtoms: LoreAtom[] = [
    {
      loreId: 'abc12345',
      commitHash: 'h1',
      date: new Date('2026-05-01T12:00:00Z'),
      author: 'cole@example.com',
      intent: 'feat(auth): valid login',
      body: 'Body text here',
      trailers: {
        'Lore-id': 'abc12345',
        Confidence: 'high',
        'Scope-risk': 'narrow',
        Reversibility: 'clean',
        Constraint: ['c1'],
        Rejected: [],
        Directive: [],
        Tested: [],
        'Not-tested': [],
        Supersedes: [],
        'Depends-on': [],
        Related: [],
        custom: CustomTrailerCollection.empty(),
      },
      filesChanged: ['f1.ts'],
    },
    {
      loreId: 'def67890',
      commitHash: 'h2',
      date: new Date('2026-05-10T12:00:00Z'),
      author: 'ivan@example.com',
      intent: 'fix(ui): layout bug',
      body: 'Body text here',
      trailers: {
        'Lore-id': 'def67890',
        Confidence: 'low',
        'Scope-risk': 'wide',
        Reversibility: 'migration-needed',
        Constraint: [],
        Rejected: ['r1'],
        Directive: [],
        Tested: [],
        'Not-tested': [],
        Supersedes: [],
        'Depends-on': [],
        Related: [],
        custom: CustomTrailerCollection.empty(),
      },
      filesChanged: ['f2.ts'],
    },
  ];

  it('should filter by scope', () => {
    const results = filter.applyFilters(mockAtoms, { scope: 'auth' });
    expect(results).toHaveLength(1);
    expect(results[0].loreId).toBe('abc12345');
  });

  it('should filter by author', () => {
    const results = filter.applyFilters(mockAtoms, { author: 'ivan' });
    expect(results).toHaveLength(1);
    expect(results[0].loreId).toBe('def67890');
  });

  it('should filter by date range (since)', () => {
    const results = filter.applyFilters(mockAtoms, { 
      since: '2026-05-05',
      sinceDate: new Date('2026-05-05') 
    });
    expect(results).toHaveLength(1);
    expect(results[0].loreId).toBe('def67890');
  });

  it('should filter by trailer presence (has)', () => {
    const results = filter.applyFilters(mockAtoms, { has: 'Constraint' });
    expect(results).toHaveLength(1);
    expect(results[0].loreId).toBe('abc12345');
  });

  it('should filter by confidence', () => {
    const results = filter.applyFilters(mockAtoms, { confidence: 'high' });
    expect(results).toHaveLength(1);
    expect(results[0].loreId).toBe('abc12345');
  });

  it('should filter by full-text search', () => {
    const results = filter.applyFilters(mockAtoms, { text: 'layout' });
    expect(results).toHaveLength(1);
    expect(results[0].loreId).toBe('def67890');
  });
});
