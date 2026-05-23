import { describe, it, expect } from 'vitest';
import { TrailerCollectorRegistry } from '../../../../../src/services/readers/collectors/trailer-collector-registry.js';
import { DEFAULT_CONFIG } from '../../../../../src/util/constants.js';
import { Protocol } from '../../../../../src/services/protocol.js';

describe('TrailerCollectorRegistry', () => {
  it('should create default collectors for core trailers', () => {
    const protocol = new Protocol(DEFAULT_CONFIG);
    const registry = new TrailerCollectorRegistry(protocol);
    const collectors = registry.getCollectors();
    
    // Default core trailers count (11, excluding Lore-id)
    expect(collectors.length).toBe(11);
    expect(collectors.map(c => c.key)).toContain('Constraint');
    expect(collectors.map(c => c.key)).toContain('Confidence');
  });

  it('should add custom collectors from definitions', () => {
    const config = {
      ...DEFAULT_CONFIG,
      trailers: {
        ...DEFAULT_CONFIG.trailers,
        definitions: {
          'Project': { description: 'Project name', multivalue: false, validation: 'none' as const },
          'Squad': { description: 'Squad name', multivalue: true, validation: 'none' as const }
        }
      }
    };
    const protocol = new Protocol(config);
    const registry = new TrailerCollectorRegistry(protocol);
    const collectors = registry.getCollectors();
    
    expect(collectors.length).toBe(13); // 11 core + 2 custom
    expect(collectors.map(c => c.key)).toContain('Project');
    expect(collectors.map(c => c.key)).toContain('Squad');
  });

  it('should handle multi-value enum collectors', () => {
    const config = {
      ...DEFAULT_CONFIG,
      trailers: {
        ...DEFAULT_CONFIG.trailers,
        definitions: {
          'Features': { 
            description: 'Features', 
            multivalue: true, 
            validation: 'options' as const,
            options: { f1: 'f1', f2: 'f2' }
          },
        }
      }
    };
    const protocol = new Protocol(config);
    const registry = new TrailerCollectorRegistry(protocol);
    const collectors = registry.getCollectors();
    const featureCollector = collectors.find(c => c.key === 'Features');
    
    expect(featureCollector).toBeDefined();
    // Multi-value enums use MultiValueTrailerCollector
    expect(featureCollector?.constructor.name).toBe('MultiValueTrailerCollector');
  });

  it('should create collectors for simple custom trailers', () => {
    const config = {
      ...DEFAULT_CONFIG,
      trailers: {
        ...DEFAULT_CONFIG.trailers,
        custom: ['Team'],
        definitions: {
          'Project': { description: 'Project name', multivalue: false, validation: 'none' as const }
        }
      }
    };
    const protocol = new Protocol(config);
    const registry = new TrailerCollectorRegistry(protocol);
    const collectors = registry.getCollectors();
    
    // 11 core + 1 rich def (Project) + 1 simple list (Team) = 13
    expect(collectors.length).toBe(13);
    expect(collectors.map(c => c.key)).toContain('Team');
  });

  it('should sort collectors based on metadata order', () => {
    const config = {
      ...DEFAULT_CONFIG,
      trailers: {
        ...DEFAULT_CONFIG.trailers,
        definitions: {
          'First': { description: 'f', multivalue: false, validation: 'none' as const, prompt: { order: 1 } },
          'Last': { description: 'l', multivalue: false, validation: 'none' as const, prompt: { order: 10000 } }
        }
      }
    };
    const protocol = new Protocol(config);
    const registry = new TrailerCollectorRegistry(protocol);
    const collectors = registry.getCollectors();
    const keys = collectors.map(c => c.key);

    expect(keys[0]).toBe('First');
    expect(keys[keys.length - 1]).toBe('Last');
  });
});
