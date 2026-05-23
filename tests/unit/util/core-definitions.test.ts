import { describe, it, expect } from 'vitest';
import { 
  CORE_TRAILER_DEFINITIONS, 
  LORE_TRAILER_KEYS,
  ARRAY_TRAILER_KEYS,
  ENUM_TRAILER_KEYS,
  CONFIDENCE_VALUES,
  SCOPE_RISK_VALUES,
  REVERSIBILITY_VALUES,
  LORE_ID_KEY
} from '../../../src/util/core-definitions.js';

describe('CORE_TRAILER_DEFINITIONS', () => {
  it(`should have CLI metadata for all standard trailers except ${LORE_ID_KEY}`, () => {
    for (const [key, def] of Object.entries(CORE_TRAILER_DEFINITIONS)) {
      if (key === LORE_ID_KEY) continue;
      
      expect(def.cli, `Trailer "${key}" is missing CLI flag metadata`).toBeDefined();
      expect(def.cli?.flag, `Trailer "${key}" is missing a flag name`).toBeDefined();
    }
  });

  it(`should have prompt metadata for all standard trailers except ${LORE_ID_KEY}`, () => {
    for (const [key, def] of Object.entries(CORE_TRAILER_DEFINITIONS)) {
      if (key === LORE_ID_KEY) continue;
      
      expect(def.prompt, `Trailer "${key}" is missing prompt metadata`).toBeDefined();
      expect(def.prompt?.confirm, `Trailer "${key}" is missing a confirm message`).toBeDefined();
      
      if (def.validation === 'values') {
        expect(def.prompt?.choice, `Enum trailer "${key}" is missing a choice message`).toBeDefined();
      } else {
        expect(def.prompt?.input, `Input trailer "${key}" is missing an input message`).toBeDefined();
      }
    }
  });

  it('should have UI kinds and colors for all standard trailers', () => {
    for (const [key, def] of Object.entries(CORE_TRAILER_DEFINITIONS)) {
      expect(def.ui, `Trailer "${key}" is missing UI metadata`).toBeDefined();
      expect(def.ui?.color, `Trailer "${key}" is missing a UI color`).toBeDefined();
      expect(def.ui?.kind, `Trailer "${key}" is missing a UI kind`).toBeDefined();
    }
  });

  describe('derivation logic', () => {
    it('should derive LORE_TRAILER_KEYS from metadata', () => {
      const keys = Object.keys(CORE_TRAILER_DEFINITIONS);
      expect(LORE_TRAILER_KEYS).toEqual(keys);
    });

    it('should correctly identify ARRAY_TRAILER_KEYS', () => {
      expect(ARRAY_TRAILER_KEYS).toContain('Constraint');
      expect(ARRAY_TRAILER_KEYS).toContain('Rejected');
      expect(ARRAY_TRAILER_KEYS).not.toContain('Confidence');
    });

    it('should correctly identify ENUM_TRAILER_KEYS', () => {
      expect(ENUM_TRAILER_KEYS).toContain('Confidence');
      expect(ENUM_TRAILER_KEYS).toContain('Scope-risk');
      expect(ENUM_TRAILER_KEYS).not.toContain('Constraint');
    });

    it('should derive enum values from metadata options', () => {
      expect(CONFIDENCE_VALUES).toEqual(['low', 'medium', 'high']);
      expect(SCOPE_RISK_VALUES).toEqual(['narrow', 'moderate', 'wide']);
      expect(REVERSIBILITY_VALUES).toEqual(['clean', 'migration-needed', 'irreversible']);
    });
  });
});
