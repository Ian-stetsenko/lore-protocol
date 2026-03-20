import { describe, it, expect } from 'vitest';
import { LoreIdGenerator } from '../../../src/services/lore-id-generator.js';
import { LORE_ID_PATTERN, LORE_ID_LENGTH } from '../../../src/util/constants.js';

describe('LoreIdGenerator', () => {
  const generator = new LoreIdGenerator();

  describe('generate', () => {
    it('should return an 8-character string', () => {
      const id = generator.generate();
      expect(id).toHaveLength(LORE_ID_LENGTH);
    });

    it('should return only lowercase hex characters', () => {
      const id = generator.generate();
      expect(id).toMatch(LORE_ID_PATTERN);
    });

    it('should generate unique IDs across multiple calls', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generator.generate());
      }
      // With 4 bytes of randomness (2^32 possibilities), 100 IDs should all be unique
      expect(ids.size).toBe(100);
    });

    it('should match the LORE_ID_PATTERN constant', () => {
      for (let i = 0; i < 50; i++) {
        const id = generator.generate();
        expect(LORE_ID_PATTERN.test(id)).toBe(true);
      }
    });

    it('should not contain uppercase characters', () => {
      for (let i = 0; i < 50; i++) {
        const id = generator.generate();
        expect(id).toBe(id.toLowerCase());
      }
    });

    it('should produce different IDs on consecutive calls', () => {
      const id1 = generator.generate();
      const id2 = generator.generate();
      expect(id1).not.toBe(id2);
    });

    it('should be a string type', () => {
      const id = generator.generate();
      expect(typeof id).toBe('string');
    });
  });
});
