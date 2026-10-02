import type { Cents } from './domain/money.js';

/** Defaults from the plan (iphone-scanner-plan.md). All tunable. */
export interface ScannerConfig {
  /** Max purchase price incl. shipping (plan: 900 €). */
  maxCostCents: Cents;
  /** "Guter Deal": expected profit at least this much ... */
  minProfitCents: Cents;
  /** ... and at least this share of the cost. */
  minProfitRatio: number;
  /**
   * "Sicher-Deal": cost must be at least this far below the buy-back price,
   * so that the trip to a buy-back portal is still worth it.
   */
  minSafeMarginCents: Cents;
  /** Resale fee share: 0 for private sellers on eBay.de, 0.05 for commercial used goods. */
  resaleFeeRatio: number;
  /** Our shipping cost when reselling. */
  outboundShippingCents: Cents;
  /** Listings cheaper than this share of market value are treated as bait. */
  baitPriceRatio: number;
  /** Best offer: only suggest offers down to this share of the asking price. */
  maxOfferDiscountRatio: number;
  /** Only evaluate auctions that end within this many minutes. */
  auctionWindowMinutes: number;
  /** Record auction price as a "closing price" within this many minutes of the end. */
  auctionCloseCaptureMinutes: number;
  /** Seller trust thresholds (plan section 7a). */
  trust: {
    minFeedbackForExpensive: number;
    expensiveFromCents: Cents;
    blockBelowPercent: number;
    trustedMinFeedback: number;
    trustedMinPercent: number;
  };
  /** Market estimation from our own observations. */
  market: {
    activeWindowDays: number;
    auctionWindowDays: number;
    minActiveComps: number;
    minAuctionComps: number;
    /** Percentile of active Buy-It-Now prices used as conservative market price. */
    activePercentile: number;
  };
}

export const DEFAULT_CONFIG: ScannerConfig = {
  maxCostCents: 900_00,
  minProfitCents: 50_00,
  minProfitRatio: 0.15,
  minSafeMarginCents: 20_00,
  resaleFeeRatio: 0,
  outboundShippingCents: 6_00,
  baitPriceRatio: 0.4,
  maxOfferDiscountRatio: 0.2,
  auctionWindowMinutes: 15,
  auctionCloseCaptureMinutes: 3,
  trust: {
    minFeedbackForExpensive: 5,
    expensiveFromCents: 300_00,
    blockBelowPercent: 95,
    trustedMinFeedback: 50,
    trustedMinPercent: 98,
  },
  market: {
    activeWindowDays: 14,
    auctionWindowDays: 30,
    minActiveComps: 5,
    minAuctionComps: 3,
    activePercentile: 0.25,
  },
};
