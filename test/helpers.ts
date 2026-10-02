import type { ExternalListing } from '../src/adapters/types.js';

export const NOW = new Date('2026-10-02T20:00:00Z');

export function listing(over: Partial<ExternalListing> = {}): ExternalListing {
  return {
    marketplace: 'ebay-de',
    externalId: 'item-1',
    url: 'https://www.ebay.de/itm/1',
    title: 'Apple iPhone 15 Pro 256GB Schwarz Titan',
    text: '',
    priceCents: 600_00,
    shippingCents: 6_00,
    conditionId: 3000,
    buyingOptions: ['FIXED_PRICE'],
    bidCount: null,
    endsAt: null,
    createdAt: NOW,
    country: 'DE',
    seller: { username: 'seller', feedbackScore: 312, feedbackPercent: 99.6, accountType: 'INDIVIDUAL' },
    imageUrl: null,
    aspects: {},
    detailed: true,
    ...over,
  };
}
