import type { ExternalListing, MarketplaceAdapter } from './adapters/types.js';
import type { ScannerConfig } from './config.js';
import { variantKey } from './domain/catalog.js';
import { evaluate, type Decision, type ReferenceLookup } from './domain/evaluate.js';
import { hardExclusions } from './domain/filters.js';
import { parseListing } from './domain/parse.js';
import { formatAlert, type Notifier } from './notify/telegram.js';
import { marketKey } from './reference.js';
import type { Store } from './store.js';

export interface CycleStats {
  fetched: number;
  evaluated: number;
  detailCalls: number;
  alerts: number;
  byTier: Record<string, number>;
}

export interface ScannerDeps {
  adapter: MarketplaceAdapter;
  refs: ReferenceLookup;
  store: Store;
  notifier: Notifier;
  config: ScannerConfig;
  /** Upper bound of detail calls per cycle (API quota). */
  maxDetailsPerCycle: number;
  now?: () => Date;
}

const ALERT_TIERS = new Set(['SAFE', 'GOOD', 'OFFER']);

/** eBay refurbished condition ids: retail prices with warranty, not what we can resell for privately. */
const REFURBISHED_CONDITION_IDS = new Set([2000, 2010, 2020, 2030, 2500]);

function isAuctionOnly(l: ExternalListing): boolean {
  return l.buyingOptions.includes('AUCTION') && !l.buyingOptions.includes('FIXED_PRICE');
}

/** Feeds our own market data: active Buy-It-Now prices and auction prices shortly before the end. */
export function observe(l: ExternalListing, store: Store, cfg: ScannerConfig, now: Date): void {
  if (l.country && l.country !== 'DE') return;
  if (l.conditionId !== null && REFURBISHED_CONDITION_IDS.has(l.conditionId)) return;
  if (l.seller.accountType === 'BUSINESS') return;
  const parsed = parseListing(l);
  if (!parsed.variant || parsed.grade === 'PARTS' || parsed.storageAssumed) return;
  if (hardExclusions(l.title, l.text).length) return;
  const key = marketKey(parsed.variant, parsed.grade);
  const total = l.priceCents + (l.shippingCents ?? 0);
  if (isAuctionOnly(l)) {
    const minutesLeft = l.endsAt ? (l.endsAt.getTime() - now.getTime()) / 60_000 : Infinity;
    if ((l.bidCount ?? 0) > 0 && minutesLeft >= 0 && minutesLeft <= cfg.auctionCloseCaptureMinutes) {
      store.recordAuctionClose(key, l.externalId, total, now);
    }
  } else {
    store.recordActivePrice(key, l.externalId, total, now);
  }
}

export class Scanner {
  private detailCache = new Map<string, ExternalListing>();
  /** Last logged tier and price per listing, so the log only grows when something changes. */
  private lastLogged = new Map<string, string>();

  constructor(private readonly deps: ScannerDeps) {}

  async runCycle(): Promise<CycleStats> {
    const { adapter, store, config } = this.deps;
    const now = this.deps.now?.() ?? new Date();
    const stats: CycleStats = { fetched: 0, evaluated: 0, detailCalls: 0, alerts: 0, byTier: {} };

    const [fresh, auctions] = await Promise.all([
      adapter.search({ kind: 'NEWLY_LISTED', maxPriceCents: config.maxCostCents, limit: 200 }),
      adapter.search({ kind: 'ENDING_AUCTIONS', maxPriceCents: config.maxCostCents, limit: 200 }),
    ]);
    const listings = [...new Map([...fresh, ...auctions].map((l) => [l.externalId, l])).values()];
    stats.fetched = listings.length;

    for (const l of listings) observe(l, store, config, now);

    for (const summary of listings) {
      let listing = summary;
      let decision = evaluate(listing, this.deps.refs, config, now);
      stats.evaluated++;

      // Potential deal: load description and seller account type, then decide again.
      if (ALERT_TIERS.has(decision.tier) || decision.tier === 'BLOCKED') {
        const cacheKey = `${listing.externalId}:${listing.priceCents}`;
        const cached = this.detailCache.get(cacheKey);
        if (cached) {
          listing = { ...cached, priceCents: summary.priceCents, bidCount: summary.bidCount };
        } else if (stats.detailCalls < this.deps.maxDetailsPerCycle) {
          stats.detailCalls++;
          try {
            listing = await adapter.getDetails(summary);
            this.detailCache.set(cacheKey, listing);
          } catch (err) {
            console.warn(`details for ${summary.externalId} failed: ${(err as Error).message}`);
          }
        }
        if (listing !== summary) decision = evaluate(listing, this.deps.refs, config, now);
      }

      stats.byTier[decision.tier] = (stats.byTier[decision.tier] ?? 0) + 1;

      let alerted = false;
      if (ALERT_TIERS.has(decision.tier) && listing.detailed && this.shouldAlert(listing)) {
        await this.deps.notifier.send(formatAlert(listing, decision, now));
        store.markAlerted(listing.externalId, listing.priceCents);
        stats.alerts++;
        alerted = true;
      }
      const signature = `${decision.tier}:${listing.priceCents}`;
      if (decision.tier !== 'SKIPPED' && (alerted || this.lastLogged.get(listing.externalId) !== signature)) {
        this.log(listing, decision, now, alerted);
        this.lastLogged.set(listing.externalId, signature);
      }
    }

    if (this.detailCache.size > 5000) this.detailCache.clear();
    if (this.lastLogged.size > 20000) this.lastLogged.clear();
    store.flush();
    return stats;
  }

  /** Each listing once; again only if the price dropped. */
  private shouldAlert(l: ExternalListing): boolean {
    const last = this.deps.store.alertedPrice(l.externalId);
    return last === null || l.priceCents < last;
  }

  private log(l: ExternalListing, d: Decision, now: Date, alerted: boolean): void {
    this.deps.store.logDecision({
      at: now.toISOString(),
      id: l.externalId,
      url: l.url,
      title: l.title,
      tier: d.tier,
      variant: d.variant ? variantKey(d.variant) : null,
      grade: d.grade,
      cost: d.costCents,
      buyback: d.buybackCents,
      resale: d.resaleCents,
      profit: d.profitCents,
      offer: d.suggestedOfferCents,
      trust: d.trust?.level ?? null,
      // No username: we keep no eBay user data (Marketplace Account Deletion opt-out).
      seller: { feedbackScore: l.seller.feedbackScore, feedbackPercent: l.seller.feedbackPercent, accountType: l.seller.accountType },
      reasons: d.reasons,
      warnings: d.warnings,
      alerted,
    });
  }
}
