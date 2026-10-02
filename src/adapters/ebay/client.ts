import type { ExternalListing, MarketplaceAdapter, SearchRequest } from '../types.js';
import { mapEbayItem, type EbayItemLike } from './map.js';

/**
 * eBay Browse API (official, buyer-side search) for EBAY_DE.
 * Docs: https://developer.ebay.com/api-docs/buy/browse/overview.html
 * Default quota: 5,000 calls/day; the scanner uses roughly 1,300–1,800.
 */
export interface EbayCredentials {
  appId: string;
  certId: string;
}

export interface EbayOptions {
  /** "Handys & Smartphones". Verify against the DE category tree before going live. */
  categoryId: string;
  query: string;
  baseUrl: string;
}

export const DEFAULT_EBAY_OPTIONS: EbayOptions = {
  categoryId: '9355',
  query: 'iphone',
  baseUrl: 'https://api.ebay.com',
};

export class EbayBrowseAdapter implements MarketplaceAdapter {
  readonly key = 'ebay-de';
  private token: { value: string; expiresAt: number } | null = null;
  /** Counts calls so the scanner can log usage against the daily quota. */
  calls = 0;

  constructor(
    private readonly creds: EbayCredentials,
    private readonly opts: EbayOptions = DEFAULT_EBAY_OPTIONS,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  private async accessToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expiresAt - 60_000) return this.token.value;
    const basic = Buffer.from(`${this.creds.appId}:${this.creds.certId}`).toString('base64');
    const res = await this.fetchFn(`${this.opts.baseUrl}/identity/v1/oauth2/token`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${basic}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        scope: 'https://api.ebay.com/oauth/api_scope',
      }).toString(),
    });
    if (!res.ok) throw new Error(`eBay token request failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
    return json.access_token;
  }

  private async get<T>(path: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${this.opts.baseUrl}${path}`);
    for (const [k, v] of Object.entries(params ?? {})) url.searchParams.set(k, v);
    this.calls++;
    const res = await this.fetchFn(url, {
      headers: {
        authorization: `Bearer ${await this.accessToken()}`,
        'x-ebay-c-marketplace-id': 'EBAY_DE',
        'accept-language': 'de-DE',
      },
    });
    if (res.status === 429) throw new Error('eBay rate limit reached (429)');
    if (!res.ok) throw new Error(`eBay GET ${url.pathname} failed: ${res.status} ${await res.text()}`);
    return (await res.json()) as T;
  }

  async search(req: SearchRequest): Promise<ExternalListing[]> {
    const maxEuros = Math.floor(req.maxPriceCents / 100);
    const filters = [
      'itemLocationCountry:DE',
      `price:[..${maxEuros}]`,
      'priceCurrency:EUR',
      req.kind === 'ENDING_AUCTIONS' ? 'buyingOptions:{AUCTION}' : 'buyingOptions:{FIXED_PRICE|BEST_OFFER}',
    ];
    const json = await this.get<{ itemSummaries?: EbayItemLike[] }>('/buy/browse/v1/item_summary/search', {
      q: this.opts.query,
      category_ids: this.opts.categoryId,
      filter: filters.join(','),
      sort: req.kind === 'ENDING_AUCTIONS' ? 'endingSoonest' : 'newlyListed',
      limit: String(Math.min(req.limit, 200)),
    });
    return (json.itemSummaries ?? [])
      .map((i) => mapEbayItem(i, false))
      .filter((l): l is ExternalListing => l !== null);
  }

  async getDetails(listing: ExternalListing): Promise<ExternalListing> {
    const item = await this.get<EbayItemLike>(`/buy/browse/v1/item/${encodeURIComponent(listing.externalId)}`);
    return mapEbayItem(item, true) ?? listing;
  }
}
