import { LORE_TRAILER_KEYS } from '../util/constants.js';

const KNOWN_KEYS = new Set<string>(LORE_TRAILER_KEYS);

export class CustomTrailerCollection {
  private readonly map: ReadonlyMap<string, readonly string[]>;
  private readonly _lineCount: number;
  private _record: Readonly<Record<string, readonly string[]>> | null = null;

  constructor(entries: ReadonlyMap<string, readonly string[]>) {
    this.map = new Map(entries);
    let count = 0;
    for (const values of this.map.values()) {
      count += values.length;
    }
    this._lineCount = count;
  }

  static empty(): CustomTrailerCollection {
    return EMPTY_INSTANCE;
  }

  /**
   * Extract custom trailers from a raw key-value record.
   * Filters out known Lore trailer keys.
   * Coerces single strings to [string] arrays.
   */
  static fromRaw(raw: Readonly<Record<string, unknown>>): CustomTrailerCollection {
    const entries = new Map<string, readonly string[]>();
    for (const key of Object.keys(raw)) {
      if (KNOWN_KEYS.has(key)) continue;
      const arr = toStringArray(raw[key]);
      if (arr && arr.length > 0) {
        entries.set(key, arr);
      }
    }
    return entries.size > 0 ? new CustomTrailerCollection(entries) : CustomTrailerCollection.empty();
  }

  has(key: string): boolean {
    const values = this.map.get(key);
    return values !== undefined && values.length > 0;
  }

  get(key: string): readonly string[] | undefined {
    return this.map.get(key);
  }

  get lineCount(): number {
    return this._lineCount;
  }

  get size(): number {
    return this.map.size;
  }

  get isEmpty(): boolean {
    return this.map.size === 0;
  }

  [Symbol.iterator](): IterableIterator<[string, readonly string[]]> {
    return this.map[Symbol.iterator]();
  }

  toRecord(): Readonly<Record<string, readonly string[]>> {
    if (!this._record) {
      this._record = Object.fromEntries(this.map);
    }
    return this._record;
  }
}

function toStringArray(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string');
  }
  if (typeof value === 'string') {
    return [value];
  }
  return undefined;
}

const EMPTY_INSTANCE = new CustomTrailerCollection(new Map());
