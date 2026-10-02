import type { SellerInfo } from '../adapters/types.js';
import { GRADE_LABEL, getModel, isModelKey, type Grade } from '../domain/catalog.js';
import type { Tier } from '../domain/evaluate.js';
import type { Cents } from '../domain/money.js';
import { percentile } from '../domain/valuation.js';
import type { JsonFileStore } from '../store.js';

/** One line of data/state/decisions.jsonl as written by the scanner. */
export interface LogEntry {
  at: string;
  id: string;
  url: string;
  title: string;
  tier: Tier;
  variant: string | null;
  grade: Grade | null;
  cost: Cents;
  buyback: Cents | null;
  resale: Cents | null;
  profit: Cents | null;
  offer: Cents | null;
  trust: 'BLOCKED' | 'WARN' | 'TRUSTED' | null;
  seller: SellerInfo;
  reasons: string[];
  warnings: string[];
  alerted?: boolean;
}

export interface MarketRow {
  key: string;
  label: string;
  activeCount: number;
  activeP25: Cents | null;
  auctionCount: number;
  auctionMedian: Cents | null;
}

export interface DashboardData {
  generatedAt: Date;
  windowHours: number;
  checked: number;
  byTier: Record<string, number>;
  alerts: number;
  deals: LogEntry[];
  blocked: LogEntry[];
  market: MarketRow[];
  lastScanAt: Date | null;
}

export function parseLog(jsonl: string): LogEntry[] {
  const out: LogEntry[] = [];
  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line) as LogEntry);
    } catch {
      // ignore a partially written last line
    }
  }
  return out;
}

/** "15-pro/256/GOOD" -> "iPhone 15 Pro 256 GB · Gut" */
export function keyLabel(key: string): string {
  const [model, storage, grade] = key.split('/');
  if (!model || !isModelKey(model)) return key;
  const gb = Number(storage);
  const size = gb >= 1024 ? `${gb / 1024} TB` : `${gb} GB`;
  const g = grade && grade in GRADE_LABEL ? ` · ${GRADE_LABEL[grade as Grade]}` : '';
  return `${getModel(model).name} ${size}${g}`;
}

const DEAL_TIERS = new Set<Tier>(['SAFE', 'GOOD', 'OFFER']);

export function summarize(entries: LogEntry[], store: JsonFileStore, now: Date, windowHours = 24): DashboardData {
  const since = now.getTime() - windowHours * 3_600_000;
  const recent = entries.filter((e) => Date.parse(e.at) >= since);

  // The scanner logs a listing on every cycle; keep only the latest decision per listing.
  const latest = new Map<string, LogEntry>();
  for (const e of recent) latest.set(e.id, e);
  const unique = [...latest.values()];

  const byTier: Record<string, number> = {};
  for (const e of unique) byTier[e.tier] = (byTier[e.tier] ?? 0) + 1;

  const newestFirst = (a: LogEntry, b: LogEntry) => Date.parse(b.at) - Date.parse(a.at);
  const market = store.marketKeys().map((key) => {
    const active = store.activePrices(key).map((o) => o.priceCents);
    const closes = store.auctionCloses(key).map((o) => o.priceCents);
    return {
      key,
      label: keyLabel(key),
      activeCount: active.length,
      activeP25: active.length ? percentile(active, 0.25) : null,
      auctionCount: closes.length,
      auctionMedian: closes.length ? percentile(closes, 0.5) : null,
    };
  });

  return {
    generatedAt: now,
    windowHours,
    checked: unique.length,
    byTier,
    alerts: recent.filter((e) => e.alerted).length,
    deals: unique.filter((e) => DEAL_TIERS.has(e.tier)).sort(newestFirst).slice(0, 100),
    blocked: unique.filter((e) => e.tier === 'BLOCKED').sort(newestFirst).slice(0, 50),
    market,
    lastScanAt: entries.length ? new Date(entries[entries.length - 1]!.at) : null,
  };
}
