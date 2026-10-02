import { eurosToCents } from '../../domain/money.js';
import type { BuyingOption, ExternalListing } from '../types.js';

/** Subset of the Browse API ItemSummary / Item we use. */
export interface EbayAmount {
  value: string;
  currency: string;
}

export interface EbayItemLike {
  itemId: string;
  title: string;
  itemWebUrl?: string;
  shortDescription?: string;
  description?: string;
  price?: EbayAmount;
  currentBidPrice?: EbayAmount;
  bidCount?: number;
  shippingOptions?: { shippingCost?: EbayAmount; shippingCostType?: string }[];
  conditionId?: string;
  buyingOptions?: string[];
  itemEndDate?: string;
  itemCreationDate?: string;
  itemLocation?: { country?: string; postalCode?: string };
  seller?: {
    username?: string;
    feedbackPercentage?: string;
    feedbackScore?: number;
    sellerAccountType?: string;
  };
  image?: { imageUrl?: string };
  localizedAspects?: { name: string; value: string }[];
}

function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function amount(a: EbayAmount | undefined): number | null {
  if (!a) return null;
  if (a.currency !== 'EUR') return null;
  return eurosToCents(a.value);
}

export function mapEbayItem(item: EbayItemLike, detailed: boolean): ExternalListing | null {
  const options = (item.buyingOptions ?? []).filter((o): o is BuyingOption =>
    ['FIXED_PRICE', 'AUCTION', 'BEST_OFFER'].includes(o),
  );
  const isAuction = options.includes('AUCTION') && !options.includes('FIXED_PRICE');
  const priceCents = isAuction ? amount(item.currentBidPrice) ?? amount(item.price) : amount(item.price);
  if (priceCents === null) return null; // non-EUR or missing price

  const ship = item.shippingOptions?.[0];
  const shippingCents =
    ship?.shippingCostType === 'CALCULATED' || !ship?.shippingCost ? null : amount(ship.shippingCost);

  const pct = item.seller?.feedbackPercentage ? Number(item.seller.feedbackPercentage) : null;
  const accountType = item.seller?.sellerAccountType;

  return {
    marketplace: 'ebay-de',
    externalId: item.itemId,
    url: item.itemWebUrl ?? `https://www.ebay.de/itm/${item.itemId}`,
    title: item.title,
    text: stripHtml(item.description ?? item.shortDescription ?? ''),
    priceCents,
    shippingCents,
    conditionId: item.conditionId ? Number(item.conditionId) : null,
    buyingOptions: options,
    bidCount: item.bidCount ?? null,
    endsAt: item.itemEndDate ? new Date(item.itemEndDate) : null,
    createdAt: item.itemCreationDate ? new Date(item.itemCreationDate) : null,
    country: item.itemLocation?.country ?? null,
    seller: {
      username: item.seller?.username ?? '?',
      feedbackScore: item.seller?.feedbackScore ?? null,
      feedbackPercent: pct !== null && Number.isFinite(pct) ? pct : null,
      accountType: accountType === 'BUSINESS' || accountType === 'INDIVIDUAL' ? accountType : null,
    },
    imageUrl: item.image?.imageUrl ?? null,
    aspects: Object.fromEntries((item.localizedAspects ?? []).map((a) => [a.name, a.value])),
    detailed,
  };
}
