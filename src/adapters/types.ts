import type { Cents } from '../domain/money.js';

/** Marketplace-neutral listing. Adapters map raw API answers to this; nothing else sees raw data. */
export interface ExternalListing {
  marketplace: string;
  externalId: string;
  url: string;
  title: string;
  /** Short description or full description text when fetched; used for keyword checks. */
  text: string;
  /** Buy-It-Now price, or current bid for auctions. */
  priceCents: Cents;
  /** Shipping to the buyer; null when unknown (e.g. pickup only or calculated). */
  shippingCents: Cents | null;
  /** Marketplace condition id (eBay: 1000 new, 3000 used, 7000 for parts ...). */
  conditionId: number | null;
  buyingOptions: BuyingOption[];
  bidCount: number | null;
  endsAt: Date | null;
  createdAt: Date | null;
  country: string | null;
  seller: SellerInfo;
  imageUrl: string | null;
  /** Structured attributes when available, e.g. { 'Speicherkapazität': '256 GB' }. */
  aspects: Record<string, string>;
  /** True once the full item (description, account type) was fetched. */
  detailed: boolean;
}

export type BuyingOption = 'FIXED_PRICE' | 'AUCTION' | 'BEST_OFFER';

export interface SellerInfo {
  username: string;
  feedbackScore: number | null;
  feedbackPercent: number | null;
  accountType: 'BUSINESS' | 'INDIVIDUAL' | null;
}

export interface SearchRequest {
  kind: 'NEWLY_LISTED' | 'ENDING_AUCTIONS';
  maxPriceCents: Cents;
  limit: number;
}

export interface MarketplaceAdapter {
  readonly key: string;
  search(req: SearchRequest): Promise<ExternalListing[]>;
  /** Full item incl. description and seller account type. */
  getDetails(listing: ExternalListing): Promise<ExternalListing>;
}
