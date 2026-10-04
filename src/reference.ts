import { readFileSync } from 'node:fs';
import { GRADES, isModelKey, variantKey, type Grade, type Variant } from './domain/catalog.js';
import type { ReferenceLookup } from './domain/evaluate.js';
import { eurosToCents, type Cents } from './domain/money.js';
import { valueForGrade } from './domain/valuation.js';
import type { Store } from './store.js';

/**
 * Manually maintained reference prices (plan section 3): buy-back price from rebuy/wirkaufens/
 * Back Market and an optional manual market value, per variant and grade.
 *
 * CSV columns: model,storage_gb,grade,buyback_eur,market_eur,source,updated
 * Empty cells are allowed. Lines starting with # are comments.
 */
export interface ReferenceRow {
  variant: Variant;
  grade: Grade;
  buybackCents: Cents | null;
  marketCents: Cents | null;
}

export function parseReferenceCsv(csv: string): ReferenceRow[] {
  const rows: ReferenceRow[] = [];
  const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  const [header, ...data] = lines;
  if (!header?.startsWith('model,')) throw new Error('reference CSV: header must start with "model,"');
  data.forEach((line, i) => {
    const [model, storage, grade, buyback, market] = line.split(',').map((c) => c.trim());
    if (!model || !isModelKey(model)) throw new Error(`reference CSV line ${i + 2}: unknown model "${model}"`);
    if (!GRADES.includes(grade as Grade)) throw new Error(`reference CSV line ${i + 2}: unknown grade "${grade}"`);
    rows.push({
      variant: { model, storageGb: Number(storage) },
      grade: grade as Grade,
      buybackCents: buyback ? eurosToCents(buyback) : null,
      marketCents: market ? eurosToCents(market) : null,
    });
  });
  return rows;
}

export function loadReferenceCsv(path: string): ReferenceRow[] {
  return parseReferenceCsv(readFileSync(path, 'utf8'));
}

/**
 * Market bucket: NEW on its own, every used grade together. Summaries carry no description, so
 * a finer grade split would compare a described private phone against title-only comps.
 */
export function marketBucket(grade: Grade): 'NEW' | 'USED' {
  return grade === 'NEW' ? 'NEW' : 'USED';
}

export function marketKey(variant: Variant, grade: Grade): string {
  return `${variantKey(variant)}/${marketBucket(grade)}`;
}

/** Combines the manual table with the store's own observations. */
export function referenceLookup(rows: ReferenceRow[], store: Store): ReferenceLookup {
  const byVariant = new Map<string, ReferenceRow[]>();
  for (const r of rows) {
    const k = variantKey(r.variant);
    byVariant.set(k, [...(byVariant.get(k) ?? []), r]);
  }
  return {
    buyback(variant) {
      const out: Partial<Record<Grade, Cents>> = {};
      for (const r of byVariant.get(variantKey(variant)) ?? []) if (r.buybackCents) out[r.grade] = r.buybackCents;
      return out;
    },
    market(variant, grade, excludeId) {
      const manualByGrade: Partial<Record<Grade, Cents>> = {};
      for (const r of byVariant.get(variantKey(variant)) ?? []) if (r.marketCents) manualByGrade[r.grade] = r.marketCents;
      const manual = valueForGrade(manualByGrade, grade)?.valueCents ?? null;
      const key = marketKey(variant, grade);
      return {
        manualCents: manual,
        activePrices: store.activePrices(key, excludeId),
        auctionCloses: store.auctionCloses(key),
      };
    },
  };
}
