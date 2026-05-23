import type { ICommitInputReader } from '../../interfaces/commit-input-reader.js';
import type { CommitInput } from '../../types/commit.js';
import type { CommitCommandOptions } from '../commit-input-resolver.js';
import type { Protocol } from '../protocol.js';
import { LORE_ID_KEY } from '../../util/constants.js';

/**
 * Reads commit input from CLI flag values.
 * 
 * Maps flat CLI flags (e.g. --confidence) to the structured CommitInput model.
 * 
 * GRASP: Information Expert -- uses protocol metadata to dynamically map core and custom flags.
 * SOLID: SRP -- only responsible for mapping CLI flag options to CommitInput.
 */
export class FlagsInputReader implements ICommitInputReader {
  constructor(
    private readonly options: CommitCommandOptions,
    private readonly protocol: Protocol,
  ) {}

  async read(): Promise<CommitInput> {
    const trailers: Record<string, string[]> = {};
    const authorizedKeys = this.protocol.getAuthorizedKeys();

    // 1. Dynamically map all authorized trailers from registered flags
    for (const key of authorizedKeys) {
      if (key === LORE_ID_KEY) continue;

      const def = this.protocol.getDefinition(key);
      if (!def) continue;

      const flagName = def.cli?.flag || this.slugify(key);
      const camelName = this.camelCase(flagName);
      
      const flagValue = (this.options as Record<string, unknown>)[camelName] ?? (this.options as Record<string, unknown>)[flagName];
      if (flagValue !== undefined && flagValue !== null) {
        trailers[key] = Array.isArray(flagValue) 
          ? flagValue.map(v => String(v)) 
          : [String(flagValue)];
      }
    }

    // 2. Add custom trailers from the catch-all --trailer flag
    const catchAllMap = this.parseCustomTrailers(this.options.trailer);
    for (const [key, values] of catchAllMap) {
      // Re-authorize the key from the catch-all to ensure casing and permission rules
      const authorizedKey = this.protocol.authorize(key);
      if (authorizedKey) {
        const existing = trailers[authorizedKey] ?? [];
        trailers[authorizedKey] = [...existing, ...values];
      }
    }

    return {
      intent: this.options.intent ?? '',
      body: this.options.body,
      trailers: trailers as CommitInput['trailers'],
    };
  }

  private parseCustomTrailers(trailers?: string[]): Map<string, string[]> {
    const map = new Map<string, string[]>();
    if (!trailers || trailers.length === 0) {
      return map;
    }

    for (const t of trailers) {
      const parts = t.split(/[=:]/);
      if (parts.length >= 2) {
        const key = parts[0].trim();
        const value = parts.slice(1).join('=').trim();
        if (key && value) {
          const existing = map.get(key) ?? [];
          map.set(key, [...existing, value]);
        }
      }
    }

    return map;
  }

  private slugify(text: string): string {
    return text.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  }

  private camelCase(text: string): string {
    return text.replace(/-([a-z0-9])/g, (_, char) => char.toUpperCase());
  }
}
