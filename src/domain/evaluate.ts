import type { ExternalListing } from '../adapters/types.js';
import type { ScannerConfig } from '../config.js';
import { GRADE_LABEL, variantKey, type Grade, type Variant } from './catalog.js';
import { hardExclusions, offPlatformPayment, softWarnings } from './filters.js';
import type { Cents } from './money.js';
import { parseListing } from './parse.js';
import { sellerTrust, type TrustResult } from './trust.js';
import {
  adjustments,
  applyAdjustments,
  estimateMarket,
  expectedProfit,
  maxCostForGoodDeal,
  valueForGrade,
  type MarketInputs,
} from './valuation.js';

/**
 * SAFE  = "Sicher-Deal": cost clearly below the buy-back price.
 * GOOD  = "Guter Deal": expected profit above both thresholds.
 * OFFER = would be a good deal with a best offer at `suggestedOfferCents`.
 * NONE  = valid phone, but not cheap enough (logged only).
 * BLOCKED = would be a deal but failed a safety check (logged only).
 * SKIPPED = not a relevant listing (accessory, defect, out of scope ...).
 */
export type Tier = 'SAFE' | 'GOOD' | 'OFFER' | 'NONE' | 'BLOCKED' | 'SKIPPED';

export interface Decision {
  tier: Tier;
  variant: Variant | null;
  grade: Grade | null;
  costCents: Cents;
  buybackCents: Cents | null;
  resaleCents: Cents | null;
  profitCents: Cents | null;
  profitRatio: number | null;
  suggestedOfferCents: Cents | null;
  trust: TrustResult | null;
  /** Why it was skipped or blocked. */
  reasons: string[];
  /** Shown in the alert. */
  warnings: string[];
  /** Where the values come from. */
  notes: string[];
  batteryPercent: number | null;
}

export interface ReferenceLookup {
  /** Buy-back prices per grade for a variant (manual table). */
  buyback(variant: Variant): Partial<Record<Grade, Cents>>;
  /** Market inputs for a variant + grade, excluding the listing itself. */
  market(variant: Variant, grade: Grade, excludeId: string): MarketInputs;
}

function skipped(reasons: string[], partial: Partial<Decision> = {}): Decision {
  return {
    tier: 'SKIPPED',
    variant: null,
    grade: null,
    costCents: 0,
    buybackCents: null,
    resaleCents: null,
    profitCents: null,
    profitRatio: null,
    suggestedOfferCents: null,
    trust: null,
    reasons,
    warnings: [],
    notes: [],
    batteryPercent: null,
    ...partial,
  };
}

export function evaluate(
  listing: ExternalListing,
  refs: ReferenceLookup,
  cfg: ScannerConfig,
  now: Date,
): Decision {
  const parsed = parseListing(listing);
  if (!parsed.variant) return skipped([parsed.rejectReason ?? 'nicht zuordenbar']);
  const { variant, grade } = parsed;
  const base = { variant, grade, batteryPercent: parsed.batteryPercent };

  if (grade === 'PARTS') return skipped(['als defekt eingestellt'], base);
  const exclusions = hardExclusions(listing.title, listing.text);
  if (exclusions.length) return skipped(exclusions.map((e) => e.label), base);
  if (listing.country && listing.country !== 'DE') return skipped([`Standort ${listing.country}`], base);

  const isAuction = listing.buyingOptions.includes('AUCTION') && !listing.buyingOptions.includes('FIXED_PRICE');
  if (isAuction) {
    const minutesLeft = listing.endsAt ? (listing.endsAt.getTime() - now.getTime()) / 60_000 : Infinity;
    if (minutesLeft > cfg.auctionWindowMinutes || minutesLeft < 0) return skipped(['Auktion nicht kurz vor Ende'], base);
  }

  const warnings: string[] = [];
  const notes: string[] = [];
  const shipping = listing.shippingCents ?? 0;
  if (listing.shippingCents === null) warnings.push('Versandkosten unklar');
  const costCents = listing.priceCents + shipping;
  if (costCents > cfg.maxCostCents) return skipped(['über Budget'], { ...base, costCents });

  const adj = adjustments(parsed);
  const bb = valueForGrade(refs.buyback(variant), grade);
  const buybackCents = bb ? applyAdjustments(bb.valueCents, adj) : null;
  if (bb && !bb.exact) notes.push(`Ankaufpreis aus anderer Zustandsstufe umgerechnet`);

  const market = estimateMarket(refs.market(variant, grade, listing.externalId), now, cfg.market);
  const resaleCents = market ? applyAdjustments(market.valueCents, adj) : null;
  if (market) notes.push(`Markt: ${market.sources.join(', ')}`);
  for (const a of adj) notes.push(`Abschlag ${a.label}`);

  const profitCents =
    resaleCents !== null
      ? expectedProfit({
          costCents,
          resaleValueCents: resaleCents,
          resaleFeeRatio: cfg.resaleFeeRatio,
          outboundShippingCents: cfg.outboundShippingCents,
        })
      : null;
  const profitRatio = profitCents !== null && costCents > 0 ? profitCents / costCents : null;

  let tier: Tier = 'NONE';
  let suggestedOfferCents: Cents | null = null;
  if (buybackCents !== null && costCents <= buybackCents - cfg.minSafeMarginCents) {
    tier = 'SAFE';
  } else if (profitCents !== null && profitCents >= cfg.minProfitCents && profitRatio! >= cfg.minProfitRatio) {
    tier = 'GOOD';
  } else if (resaleCents !== null && listing.buyingOptions.includes('BEST_OFFER')) {
    const maxCost = maxCostForGoodDeal(resaleCents, cfg);
    const offer = maxCost - shipping;
    if (offer > 0 && offer >= listing.priceCents * (1 - cfg.maxOfferDiscountRatio)) {
      tier = 'OFFER';
      suggestedOfferCents = Math.floor(offer / 100) * 100;
    }
  }

  const result: Decision = {
    tier,
    ...base,
    costCents,
    buybackCents,
    resaleCents,
    profitCents,
    profitRatio,
    suggestedOfferCents,
    trust: null,
    reasons: [],
    warnings,
    notes,
  };
  if (tier === 'NONE') return result;

  // Safety checks only for potential deals.
  const reasons: string[] = [];
  const reference = resaleCents ?? buybackCents;
  if (!isAuction && reference !== null && listing.priceCents < reference * cfg.baitPriceRatio) {
    reasons.push('Lockpreis (unter 40 % des Werts)');
  }
  if (offPlatformPayment(listing.title, listing.text)) reasons.push('Zahlung außerhalb von eBay erwähnt');
  const trust = sellerTrust(listing.seller, costCents, cfg.trust);
  result.trust = trust;
  if (trust.level === 'BLOCKED') reasons.push(`Verkäufer: ${trust.reasons.join(', ')}`);
  if (trust.level === 'WARN') warnings.push(`Verkäufer: ${trust.reasons.join(', ')}`);

  for (const w of softWarnings(listing.title, listing.text)) warnings.push(w.label);
  if (parsed.storageAssumed) warnings.push('Speicher nicht angegeben (kleinste Größe angenommen)');
  if (parsed.batteryPercent === null && (grade === 'LIKE_NEW' || grade === 'GOOD')) {
    warnings.push(`Akkuzustand fehlt (bei „${GRADE_LABEL[grade]}“ nachfragen)`);
  }
  if (parsed.noBox) warnings.push('Keine OVP');
  if (isAuction) warnings.push('Auktion: Preis ist aktuelles Gebot');

  if (reasons.length) {
    result.tier = 'BLOCKED';
    result.reasons = reasons;
  }
  return result;
}

export function decisionKey(d: Decision): string | null {
  return d.variant ? `${variantKey(d.variant)}/${d.grade}` : null;
}
