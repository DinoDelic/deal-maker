import { describe, expect, it } from 'vitest';
import { EbayBrowseAdapter } from '../src/adapters/ebay/client.js';
import { mapEbayItem } from '../src/adapters/ebay/map.js';

const summary = {
  itemId: 'v1|1234|0',
  title: 'Apple iPhone 15 Pro 256GB Natur Titan',
  itemWebUrl: 'https://www.ebay.de/itm/1234',
  price: { value: '489.00', currency: 'EUR' },
  shippingOptions: [{ shippingCostType: 'FIXED', shippingCost: { value: '5.99', currency: 'EUR' } }],
  conditionId: '3000',
  buyingOptions: ['FIXED_PRICE', 'BEST_OFFER'],
  itemLocation: { country: 'DE', postalCode: '50*' },
  seller: { username: 'max', feedbackPercentage: '99.6', feedbackScore: 312 },
};

describe('mapEbayItem', () => {
  it('maps a search summary', () => {
    const l = mapEbayItem(summary, false)!;
    expect(l.priceCents).toBe(489_00);
    expect(l.shippingCents).toBe(5_99);
    expect(l.buyingOptions).toEqual(['FIXED_PRICE', 'BEST_OFFER']);
    expect(l.seller).toEqual({ username: 'max', feedbackScore: 312, feedbackPercent: 99.6, accountType: null });
    expect(l.detailed).toBe(false);
  });

  it('uses the current bid for auctions and strips description html', () => {
    const l = mapEbayItem(
      {
        ...summary,
        buyingOptions: ['AUCTION'],
        currentBidPrice: { value: '310.00', currency: 'EUR' },
        description: '<p>Akku <b>91%</b></p><script>x</script>',
        seller: { ...summary.seller, sellerAccountType: 'BUSINESS' },
        localizedAspects: [{ name: 'Speicherkapazität', value: '256 GB' }],
      },
      true,
    )!;
    expect(l.priceCents).toBe(310_00);
    expect(l.text).toBe('Akku 91%');
    expect(l.seller.accountType).toBe('BUSINESS');
    expect(l.aspects['Speicherkapazität']).toBe('256 GB');
  });

  it('treats calculated shipping as unknown and drops non-EUR prices', () => {
    expect(mapEbayItem({ ...summary, shippingOptions: [{ shippingCostType: 'CALCULATED' }] }, false)!.shippingCents).toBeNull();
    expect(mapEbayItem({ ...summary, price: { value: '1', currency: 'USD' } }, false)).toBeNull();
  });
});

describe('EbayBrowseAdapter', () => {
  it('requests a token once and searches EBAY_DE with filters', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      if (String(url).includes('oauth2/token')) {
        return new Response(JSON.stringify({ access_token: 'T', expires_in: 7200 }), { status: 200 });
      }
      return new Response(JSON.stringify({ itemSummaries: [summary] }), { status: 200 });
    }) as typeof fetch;

    const a = new EbayBrowseAdapter({ appId: 'a', certId: 'c' }, undefined, fakeFetch);
    await a.search({ kind: 'NEWLY_LISTED', maxPriceCents: 900_00, limit: 200 });
    const res = await a.search({ kind: 'ENDING_AUCTIONS', maxPriceCents: 900_00, limit: 200 });

    expect(res).toHaveLength(1);
    expect(calls.filter((c) => c.url.includes('oauth2/token'))).toHaveLength(1);
    const search = new URL(calls[1]!.url);
    expect(search.searchParams.get('sort')).toBe('newlyListed');
    expect(search.searchParams.get('filter')).toBe(
      'itemLocationCountry:DE,price:[..900],priceCurrency:EUR,buyingOptions:{FIXED_PRICE|BEST_OFFER}',
    );
    expect((calls[1]!.init!.headers as Record<string, string>)['x-ebay-c-marketplace-id']).toBe('EBAY_DE');
    expect(new URL(calls[2]!.url).searchParams.get('sort')).toBe('endingSoonest');
    expect(a.calls).toBe(2);
  });
});
