import type { LoreConfig, CustomTrailerDefinition, TrailerUiKind, TrailerUiColor, ValueDefinition } from '../types/config.js';
import { CORE_TRAILER_DEFINITIONS, LORE_ID_KEY } from '../util/constants.js';
import type { TrailerKey } from '../types/domain.js';
import type { FormattableTrailerDefinition } from '../types/output.js';

/**
 * Metadata for a protocol trailer, including its origin (core vs custom).
 */
export interface AuthorizedTrailerDefinition extends CustomTrailerDefinition {
  readonly key: string;
  readonly isCore: boolean;
}

/**
 * The central engine for Lore Protocol rules.
 * Merges built-in core trailers with project-specific custom configuration.
 * Provides lookup and authorization services for builders and formatters.
 */
export class Protocol {
  private readonly definitions = new Map<string, AuthorizedTrailerDefinition>();
  private readonly caseMap = new Map<string, string>();

  constructor(private readonly config: LoreConfig) {
    this.loadDefinitions();
  }

  private loadDefinitions(): void {
    // 1. Load Core Trailers
    for (const [key, def] of Object.entries(CORE_TRAILER_DEFINITIONS)) {
      this.addDefinition(key, { ...def, key, isCore: true });
    }

    // 2. Load Configured Custom Trailers (definitions)
    for (const [key, def] of Object.entries(this.config.trailers.definitions)) {
      const existing = this.definitions.get(key);
      const isCore = existing?.isCore ?? false;
      this.addDefinition(key, { ...def, key, isCore });
    }

    // 3. Load Simple Custom Trailers (from custom list)
    for (const key of this.config.trailers.custom) {
      if (!this.definitions.has(key)) {
        this.addDefinition(key, {
          key,
          description: `Custom project trailer: ${key}`,
          multivalue: true,
          validation: 'none',
          isCore: false,
        });
      }
    }

    // 4. Apply 'required' status from the required list (unification)
    for (const key of this.config.trailers.required) {
      const authorizedKey = this.authorize(key);
      if (authorizedKey) {
        const def = this.definitions.get(authorizedKey);
        if (def) {
          this.definitions.set(authorizedKey, { ...def, required: true });
        }
      }
    }
  }

  private addDefinition(key: string, def: AuthorizedTrailerDefinition): void {
    this.definitions.set(key, def);
    this.caseMap.set(key.toLowerCase(), key);
  }

  /**
   * Authorizes a trailer key for use.
   * Returns the canonical casing of the key if authorized, otherwise null.
   */
  authorize(key: string): TrailerKey | string | null {
    // 1. Case-insensitive match against known definitions
    const canonicalKey = this.caseMap.get(key.toLowerCase());
    if (canonicalKey) {
      return canonicalKey as TrailerKey;
    }

    // 2. If not defined, check permissive mode
    if (this.config.trailers.permissive) {
      return key;
    }

    return null;
  }

  /**
   * Returns the metadata definition for a key.
   */
  getDefinition(key: string): AuthorizedTrailerDefinition | null {
    const canonicalKey = this.caseMap.get(key.toLowerCase());
    return canonicalKey ? this.definitions.get(canonicalKey) || null : null;
  }

  /**
   * Returns all authorized keys (Core + Custom) sorted by prompt priority.
   */
  getAuthorizedKeys(): string[] {
    return Array.from(this.definitions.values())
      .sort((a, b) => (a.prompt?.order ?? 1000) - (b.prompt?.order ?? 1000))
      .map((d) => d.key);
  }

  /**
   * Returns all keys that are defined as scalar (single-value).
   */
  getScalarKeys(): string[] {
    return Array.from(this.definitions.values())
      .filter((d) => !d.multivalue)
      .map((d) => d.key);
  }

  /**
   * Returns all keys that are defined as lists (multi-value).
   */
  getListKeys(): string[] {
    return Array.from(this.definitions.values())
      .filter((d) => d.multivalue)
      .map((d) => d.key);
  }

  /**
   * Returns all keys that reference other atoms.
   */
  getReferenceKeys(): string[] {
    return Array.from(this.definitions.values())
      .filter((d) => d.ui?.kind === 'reference')
      .map((d) => d.key);
  }

  /**
   * Returns true if the key belongs to the core Lore protocol.
   */
  isCore(key: string): boolean {
    return this.getDefinition(key)?.isCore ?? false;
  }

  /**
   * Returns the semantic UI kind for a trailer.
   */
  getUiKind(key: string): TrailerUiKind {
    return this.getDefinition(key)?.ui?.kind || 'custom';
  }

  /**
   * Returns the semantic color for a trailer.
   */
  getUiColor(key: string): TrailerUiColor {
    return this.getDefinition(key)?.ui?.color || 'cyan';
  }

  /**
   * Returns a unified view of all trailer definitions for UI rendering.
   */
  getFormattableDefinitions(): Record<string, FormattableTrailerDefinition> {
    const result: Record<string, FormattableTrailerDefinition> = {};
    for (const [key, def] of this.definitions.entries()) {
      result[key] = {
        description: def.description,
        multivalue: def.multivalue,
        validation: def.validation,
        values: this.normalizeValues(def.values),
        pattern: def.pattern,
        required: def.required,
        directives: def.directives ?? [],
        ui: def.ui,
      };
    }
    return result;
  }

  private normalizeValues(
    values?: Record<string, string | ValueDefinition>,
  ): Record<string, ValueDefinition> | undefined {
    if (!values) return undefined;

    const result: Record<string, ValueDefinition> = {};
    for (const [key, value] of Object.entries(values)) {
      if (typeof value === 'string') {
        result[key] = { description: value };
      } else {
        result[key] = value;
      }
    }
    return result;
  }
}
