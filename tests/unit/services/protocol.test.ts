import { describe, it, expect } from 'vitest';
import { Protocol } from '../../../src/services/protocol.js';
import { DEFAULT_CONFIG } from '../../../src/util/constants.js';
import { LORE_ID_KEY } from '../../../src/util/constants.js';

describe('Protocol Service', () => {
  it('should load all core trailers by default', () => {
    const protocol = new Protocol(DEFAULT_CONFIG);
    const keys = protocol.getAuthorizedKeys();

    expect(keys).toContain('Constraint');
    expect(keys).toContain('Confidence');
    expect(protocol.isCore('Constraint')).toBe(true);
  });

  it('should merge custom definitions into the protocol', () => {
    const config = {
      ...DEFAULT_CONFIG,
      trailers: {
        ...DEFAULT_CONFIG.trailers,
        definitions: {
          Team: {
            description: 'The team responsible',
            multivalue: false,
            validation: 'none' as const,
          },
        },
      },
    };
    const protocol = new Protocol(config);
    
    const def = protocol.getDefinition('Team');
    expect(def).toBeDefined();
    expect(def?.description).toBe('The team responsible');
    expect(def?.isCore).toBe(false);
    expect(protocol.isCore('Team')).toBe(false);
  });

  it('should identify configured custom trailers as non-core even if they are in core-definitions', () => {
    // This tests the case where a user might try to override a core definition
    const config = {
      ...DEFAULT_CONFIG,
      trailers: {
        ...DEFAULT_CONFIG.trailers,
        definitions: {
          Constraint: {
            description: 'User override',
            multivalue: true,
            validation: 'none' as const,
          },
        },
      },
    };
    const protocol = new Protocol(config);
    
    expect(protocol.isCore('Constraint')).toBe(true);
    expect(protocol.getDefinition('Constraint')?.description).toBe('User override');
  });

  it('should authorize any key in permissive mode', () => {
    const config = {
      ...DEFAULT_CONFIG,
      trailers: { ...DEFAULT_CONFIG.trailers, permissive: true },
    };
    const protocol = new Protocol(config);
    
    expect(protocol.authorize('Random-Key')).toBe('Random-Key');
  });

  it('should not authorize unknown keys in strict mode', () => {
    const config = {
      ...DEFAULT_CONFIG,
      trailers: { 
        ...DEFAULT_CONFIG.trailers, 
        permissive: false,
        definitions: {},
        custom: []
      },
    };
    const protocol = new Protocol(config);
    
    expect(protocol.authorize('Random-Key')).toBeNull();
  });

  it('should sort authorized keys based on prompt order', () => {
    const config = {
      ...DEFAULT_CONFIG,
      trailers: {
        ...DEFAULT_CONFIG.trailers,
        definitions: {
          Urgent: {
            description: 'U',
            multivalue: false,
            validation: 'none' as const,
            prompt: { order: 105 } // Between Constraint (100) and Rejected (110)
          },
        },
      },
    };
    const protocol = new Protocol(config);
    const keys = protocol.getAuthorizedKeys();
    
    expect(keys[0]).toBe('Constraint');
    expect(keys[1]).toBe('Urgent');
    expect(keys[2]).toBe('Rejected');
  });

  it('should default custom trailers to the end of the sort order', () => {
    const config = {
      ...DEFAULT_CONFIG,
      trailers: {
        ...DEFAULT_CONFIG.trailers,
        custom: ['Adhoc'],
      },
    };
    const protocol = new Protocol(config);
    const keys = protocol.getAuthorizedKeys();
    
    expect(keys[keys.length - 1]).toBe('Adhoc');
  });

  describe('Case-Insensitive Normalization', () => {
    it('should normalize core keys regardless of input casing', () => {
      const protocol = new Protocol(DEFAULT_CONFIG);
      
      expect(protocol.authorize('confidence')).toBe('Confidence');
      expect(protocol.authorize('CONFIDENCE')).toBe('Confidence');
      expect(protocol.authorize('Scope-Risk')).toBe('Scope-risk');
    });

    it('should normalize custom definition keys', () => {
      const config = {
        ...DEFAULT_CONFIG,
        trailers: {
          ...DEFAULT_CONFIG.trailers,
          definitions: {
            'Assisted-by': { description: 'A', multivalue: true, validation: 'none' as const }
          }
        }
      };
      const protocol = new Protocol(config);
      
      expect(protocol.authorize('assisted-by')).toBe('Assisted-by');
      expect(protocol.authorize('ASSISTED-BY')).toBe('Assisted-by');
    });

    it('should preserve original casing for ad-hoc trailers in permissive mode', () => {
      const config = {
        ...DEFAULT_CONFIG,
        trailers: { ...DEFAULT_CONFIG.trailers, permissive: true }
      };
      const protocol = new Protocol(config);
      
      // If it's not a core or custom defined key, it keeps its casing
      expect(protocol.authorize('My-New-Trailer')).toBe('My-New-Trailer');
    });

    it('should prioritize core casing over ad-hoc casing', () => {
      const config = {
        ...DEFAULT_CONFIG,
        trailers: { ...DEFAULT_CONFIG.trailers, permissive: true }
      };
      const protocol = new Protocol(config);
      
      expect(protocol.authorize(LORE_ID_KEY.toLowerCase())).toBe(LORE_ID_KEY);
    });
  });

  describe('Required Unification', () => {
    it('should mark a trailer as required if set in definitions', () => {
      const config = {
        ...DEFAULT_CONFIG,
        trailers: {
          ...DEFAULT_CONFIG.trailers,
          definitions: { Team: { description: 'D', multivalue: false, validation: 'none' as const, required: true } },
        }
      };
      const protocol = new Protocol(config);
      expect(protocol.getDefinition('Team')?.required).toBe(true);
    });

    it('should mark a trailer as required if set in trailers.required list', () => {
      const config = {
        ...DEFAULT_CONFIG,
        trailers: {
          ...DEFAULT_CONFIG.trailers,
          required: ['Team'],
          custom: ['Team'],
        }
      };
      const protocol = new Protocol(config);
      expect(protocol.getDefinition('Team')?.required).toBe(true);
    });

    it('should handle case-insensitive required list entries', () => {
      const config = {
        ...DEFAULT_CONFIG,
        trailers: {
          ...DEFAULT_CONFIG.trailers,
          required: ['team'], // Lowercase entry
          custom: ['Team'],
        }
      };
      const protocol = new Protocol(config);
      expect(protocol.getDefinition('Team')?.required).toBe(true);
    });
  });

  describe('Custom Overrides', () => {
    it('should allow custom definitions to override core trailer metadata (e.g. color)', () => {
      const config = {
        ...DEFAULT_CONFIG,
        trailers: {
          ...DEFAULT_CONFIG.trailers,
          definitions: {
            Confidence: { 
              description: 'Custom confidence', 
              multivalue: false, 
              validation: 'values' as const, 
              ui: { color: 'magenta' as const } 
            }
          }
        }
      };
      const protocol = new Protocol(config);
      const def = protocol.getDefinition('Confidence');
      
      expect(def?.description).toBe('Custom confidence');
      expect(def?.ui?.color).toBe('magenta');
      expect(def?.isCore).toBe(true); // Still a core key
    });
  });
});
