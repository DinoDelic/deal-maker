import type { ScannerConfig } from '../config.js';
import { GRADES, type Grade } from './catalog.js';
import type { Cents } from './money.js';

/**
 * Value of a grade relative to GOOD, used only when no price exists for the exact grade.
 * Rough starting values; replace with learned values once we have our own data.
 */
export const GRADE_FACTOR: Record<Grade, number> = {
  NEW: 1.15,
  LIKE_NEW: 1.05,
  GOOD: 1.0,
  USED: 0.9,
  PARTS: 0,
};

export interface PriceObservation {
  priceCents: Cents;
  observedAt: Date;
}

/** p in [0,1], linear interpolation between closest ranks. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) throw new Error('percentile of empty list');
  const s = [...values].sort((a, b) => a - b);
  const idx = (s.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return Math.round(s[lo]! + (s[hi]! - s[lo]!) * (idx - lo));
}

export interface MarketInputs {
  /** Manually maintained market value, if any. */
  manualCents: Cents | null;
  /** Our own observations of active Buy-It-Now prices for the same variant + grade. */
  activePrices: PriceObservation[];
  /** Our own captured auction closing prices for the same variant + grade. */
  auctionCloses: PriceObservation[];
}

export interface MarketEstimate {
  valueCents: Cents;
  sources: string[];
}

/**
 * Conservative market value (plan section 6): the lowest of the available signals
 * (manual value, P25 of active Buy-It-Now listings, median of auction closes).
 */
export function estimateMarket(inp: MarketInputs, now: Date, cfg: ScannerConfig['market']): MarketEstimate | null {
  const day = 86_400_000;
  const candidates: { value: Cents; source: string }[] = [];
  if (inp.manualCents) candidates.push({ value: inp.manualCents, source: 'manuell' });

  const active = inp.activePrices
    .filter((o) => now.getTime() - o.observedAt.getTime() <= cfg.activeWindowDays * day)
    .map((o) => o.priceCents);
  if (active.length >= cfg.minActiveComps) {
    candidates.push({
      value: percentile(active, cfg.activePercentile),
      source: `eBay Angebote P${Math.round(cfg.activePercentile * 100)} (n=${active.length})`,
    });
  }

  const closes = inp.auctionCloses
    .filter((o) => now.getTime() - o.observedAt.getTime() <= cfg.auctionWindowDays * day)
    .map((o) => o.priceCents);
  if (closes.length >= cfg.minAuctionComps) {
    candidates.push({ value: percentile(closes, 0.5), source: `Auktionsenden (n=${closes.length})` });
  }

  if (candidates.length === 0) return null;
  const min = candidates.reduce((a, b) => (b.value < a.value ? b : a));
  return { valueCents: min.value, sources: candidates.map((c) => c.source) };
}

/** Scales a value known for one grade to another grade. */
export function convertGrade(valueCents: Cents, from: Grade, to: Grade): Cents {
  if (from === to) return valueCents;
  return Math.round((valueCents * GRADE_FACTOR[to]) / GRADE_FACTOR[from]);
}

/** Picks the value for `grade`, falling back to the nearest grade with a value. */
export function valueForGrade(
  byGrade: Partial<Record<Grade, Cents>>,
  grade: Grade,
): { valueCents: Cents; exact: boolean } | null {
  if (byGrade[grade]) return { valueCents: byGrade[grade]!, exact: true };
  const i = GRADES.indexOf(grade);
  const order = [...GRADES]
    .filter((g) => g !== 'PARTS' && byGrade[g])
    .sort((a, b) => Math.abs(GRADES.indexOf(a) - i) - Math.abs(GRADES.indexOf(b) - i));
  const from = order[0];
  if (!from) return null;
  return { valueCents: convertGrade(byGrade[from]!, from, grade), exact: false };
}

export interface Adjustment {
  label: string;
  factor: number;
}

/** Listing-specific deductions (plan section 6). */
export function adjustments(opts: { batteryPercent: number | null; noBox: boolean; storageAssumed: boolean }): Adjustment[] {
  const out: Adjustment[] = [];
  if (opts.batteryPercent !== null && opts.batteryPercent < 80) out.push({ label: `Akku ${opts.batteryPercent} %`, factor: 0.9 });
  else if (opts.batteryPercent !== null && opts.batteryPercent < 85) out.push({ label: `Akku ${opts.batteryPercent} %`, factor: 0.95 });
  if (opts.noBox) out.push({ label: 'keine OVP', factor: 0.97 });
  return out;
}

export function applyAdjustments(valueCents: Cents, adj: Adjustment[]): Cents {
  return Math.round(adj.reduce((v, a) => v * a.factor, valueCents));
}

export interface ProfitInputs {
  costCents: Cents;
  resaleValueCents: Cents;
  resaleFeeRatio: number;
  outboundShippingCents: Cents;
}

export function expectedProfit(p: ProfitInputs): Cents {
  const fee = Math.round(p.resaleValueCents * p.resaleFeeRatio);
  return p.resaleValueCents - fee - p.outboundShippingCents - p.costCents;
}

/**
 * Highest total cost (price + shipping) at which the listing would still be a "Guter Deal".
 * profit >= minProfit  and  profit >= ratio * cost.
 */
export function maxCostForGoodDeal(
  resaleValueCents: Cents,
  cfg: Pick<ScannerConfig, 'resaleFeeRatio' | 'outboundShippingCents' | 'minProfitCents' | 'minProfitRatio'>,
): Cents {
  const net = resaleValueCents - Math.round(resaleValueCents * cfg.resaleFeeRatio) - cfg.outboundShippingCents;
  return Math.floor(Math.min(net - cfg.minProfitCents, net / (1 + cfg.minProfitRatio)));
}
