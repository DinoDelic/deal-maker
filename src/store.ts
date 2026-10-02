import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Cents } from './domain/money.js';
import type { PriceObservation } from './domain/valuation.js';

/**
 * Scanner state. V1 keeps it in a JSON file so the dry run needs no database;
 * the interface stays the same when we move to PostgreSQL.
 */
export interface Store {
  recordActivePrice(key: string, itemId: string, priceCents: Cents, at: Date): void;
  recordAuctionClose(key: string, itemId: string, priceCents: Cents, at: Date): void;
  activePrices(key: string, excludeId?: string): PriceObservation[];
  auctionCloses(key: string): PriceObservation[];
  /** Last price we alerted for this item, if any. */
  alertedPrice(itemId: string): Cents | null;
  markAlerted(itemId: string, priceCents: Cents): void;
  logDecision(entry: Record<string, unknown>): void;
  flush(): void;
}

interface Obs {
  p: Cents;
  t: string;
}

interface State {
  active: Record<string, Record<string, Obs>>;
  auctions: Record<string, Record<string, Obs>>;
  alerted: Record<string, Cents>;
}

const KEEP_DAYS = 45;

export class JsonFileStore implements Store {
  private state: State;

  constructor(
    private readonly path: string | null,
    private readonly logPath: string | null = null,
  ) {
    this.state = path && existsSync(path)
      ? (JSON.parse(readFileSync(path, 'utf8')) as State)
      : { active: {}, auctions: {}, alerted: {} };
  }

  recordActivePrice(key: string, itemId: string, priceCents: Cents, at: Date): void {
    (this.state.active[key] ??= {})[itemId] = { p: priceCents, t: at.toISOString() };
  }

  recordAuctionClose(key: string, itemId: string, priceCents: Cents, at: Date): void {
    (this.state.auctions[key] ??= {})[itemId] = { p: priceCents, t: at.toISOString() };
  }

  activePrices(key: string, excludeId?: string): PriceObservation[] {
    return Object.entries(this.state.active[key] ?? {})
      .filter(([id]) => id !== excludeId)
      .map(([, o]) => ({ priceCents: o.p, observedAt: new Date(o.t) }));
  }

  auctionCloses(key: string): PriceObservation[] {
    return Object.values(this.state.auctions[key] ?? {}).map((o) => ({ priceCents: o.p, observedAt: new Date(o.t) }));
  }

  /** All variant/grade keys with observations (for the dashboard). */
  marketKeys(): string[] {
    return [...new Set([...Object.keys(this.state.active), ...Object.keys(this.state.auctions)])].sort();
  }

  alertedPrice(itemId: string): Cents | null {
    return this.state.alerted[itemId] ?? null;
  }

  markAlerted(itemId: string, priceCents: Cents): void {
    this.state.alerted[itemId] = priceCents;
  }

  logDecision(entry: Record<string, unknown>): void {
    if (!this.logPath) return;
    mkdirSync(dirname(this.logPath), { recursive: true });
    appendFileSync(this.logPath, JSON.stringify(entry) + '\n');
  }

  flush(): void {
    const cutoff = Date.now() - KEEP_DAYS * 86_400_000;
    for (const bucket of [this.state.active, this.state.auctions]) {
      for (const [key, items] of Object.entries(bucket)) {
        for (const [id, o] of Object.entries(items)) if (Date.parse(o.t) < cutoff) delete items[id];
        if (Object.keys(items).length === 0) delete bucket[key];
      }
    }
    if (!this.path) return;
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(this.state));
  }
}

/** In-memory store for tests and the quick check. */
export function memoryStore(): JsonFileStore {
  return new JsonFileStore(null);
}
