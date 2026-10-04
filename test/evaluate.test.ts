import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/config.js';
import type { Grade, Variant } from '../src/domain/catalog.js';
import { evaluate, type ReferenceLookup } from '../src/domain/evaluate.js';
import type { Cents } from '../src/domain/money.js';
import { maxCostForGoodDeal, percentile, estimateMarket } from '../src/domain/valuation.js';
import { listing, NOW } from './helpers.js';

function refs(buyback: Partial<Record<Grade, Cents>>, manualMarket: Cents | null): ReferenceLookup {
  return {
    buyback: (_v: Variant) => buyback,
    market: () => ({ manualCents: manualMarket, activePrices: [], auctionCloses: [] }),
  };
}

const cfg = DEFAULT_CONFIG;

describe('evaluate', () => {
  it('SAFE when cost is clearly below the buy-back price', () => {
    const d = evaluate(listing({ priceCents: 480_00 }), refs({ USED: 520_00 }, 640_00), cfg, NOW);
    expect(d.tier).toBe('SAFE');
    expect(d.costCents).toBe(486_00);
    expect(d.profitCents).toBe(640_00 - 6_00 - 486_00);
  });

  it('GOOD when profit >= 50 EUR and >= 15 %', () => {
    const d = evaluate(listing({ priceCents: 540_00 }), refs({ USED: 450_00 }, 650_00), cfg, NOW);
    expect(d.tier).toBe('GOOD');
    expect(d.profitCents).toBe(650_00 - 6_00 - 546_00);
  });

  it('NONE when not cheap enough', () => {
    const d = evaluate(listing({ priceCents: 600_00 }), refs({ USED: 450_00 }, 650_00), cfg, NOW);
    expect(d.tier).toBe('NONE');
  });

  it('OFFER with a suggested price when best offer is possible', () => {
    const d = evaluate(
      listing({ priceCents: 600_00, buyingOptions: ['FIXED_PRICE', 'BEST_OFFER'] }),
      refs({}, 650_00),
      cfg,
      NOW,
    );
    expect(d.tier).toBe('OFFER');
    // max cost = min(644 - 50, 644 / 1.15) = 560 -> offer 554 -> rounded down to 554
    expect(d.suggestedOfferCents).toBe(554_00);
  });

  it('applies battery and box deductions', () => {
    const d = evaluate(listing({ text: 'Akku 82%, ohne OVP' }), refs({}, 1000_00), cfg, NOW);
    expect(d.resaleCents).toBe(Math.round(1000_00 * 0.95 * 0.97));
  });

  it('blocks bait prices, off-platform payment and untrusted sellers', () => {
    const r = refs({ USED: 520_00 }, 640_00);
    expect(evaluate(listing({ priceCents: 200_00 }), r, cfg, NOW).reasons[0]).toMatch(/Lockpreis/);
    expect(evaluate(listing({ priceCents: 480_00, text: 'Nur Überweisung' }), r, cfg, NOW).tier).toBe('BLOCKED');
    const newSeller = listing({ priceCents: 480_00, seller: { username: 'x', feedbackScore: 0, feedbackPercent: null, accountType: null } });
    expect(evaluate(newSeller, r, cfg, NOW).tier).toBe('BLOCKED');
  });

  it('warns for mid-trust sellers and missing details', () => {
    const d = evaluate(
      listing({ priceCents: 480_00, title: 'iPhone 15 Pro wie neu', seller: { username: 'x', feedbackScore: 12, feedbackPercent: 100, accountType: null } }),
      refs({ LIKE_NEW: 560_00 }, null),
      cfg,
      NOW,
    );
    expect(d.tier).toBe('SAFE');
    expect(d.warnings.join(' ')).toMatch(/wenige Bewertungen/);
    expect(d.warnings.join(' ')).toMatch(/Speicher nicht angegeben/);
    expect(d.warnings.join(' ')).toMatch(/Akkuzustand fehlt/);
  });

  it('skips accessories, defects, abroad, over budget and running auctions', () => {
    const r = refs({ USED: 520_00 }, 640_00);
    expect(evaluate(listing({ title: 'Hülle für iPhone 15 Pro' }), r, cfg, NOW).tier).toBe('SKIPPED');
    expect(evaluate(listing({ conditionId: 7000 }), r, cfg, NOW).tier).toBe('SKIPPED');
    expect(evaluate(listing({ country: 'PL' }), r, cfg, NOW).tier).toBe('SKIPPED');
    expect(evaluate(listing({ priceCents: 950_00 }), r, cfg, NOW).tier).toBe('SKIPPED');
    const auction = listing({ buyingOptions: ['AUCTION'], priceCents: 300_00, endsAt: new Date(NOW.getTime() + 3 * 3600_000) });
    expect(evaluate(auction, r, cfg, NOW).reasons).toEqual(['Auktion nicht kurz vor Ende']);
  });

  it('evaluates auctions shortly before the end without the bait rule', () => {
    const auction = listing({ buyingOptions: ['AUCTION'], priceCents: 240_00, bidCount: 3, endsAt: new Date(NOW.getTime() + 5 * 60_000) });
    const d = evaluate(auction, refs({ USED: 520_00 }, 640_00), cfg, NOW);
    expect(d.tier).toBe('SAFE');
    expect(d.warnings).toContain('Auktion: Preis ist aktuelles Gebot');
  });

  it('converts a buy-back price from another grade', () => {
    const d = evaluate(listing({ priceCents: 400_00 }), refs({ GOOD: 500_00 }, null), cfg, NOW);
    expect(d.buybackCents).toBe(450_00);
    expect(d.notes.join(' ')).toMatch(/umgerechnet/);
  });
});

describe('valuation helpers', () => {
  it('percentile', () => {
    expect(percentile([100, 200, 300, 400, 500], 0.25)).toBe(200);
    expect(percentile([100, 200], 0.5)).toBe(150);
  });

  it('market = lowest of manual, active P25 and auction median', () => {
    const obs = (p: number[]) => p.map((priceCents) => ({ priceCents, observedAt: NOW }));
    const m = estimateMarket(
      { manualCents: 700_00, activePrices: obs([600_00, 610_00, 650_00, 660_00, 700_00, 710_00, 720_00, 750_00, 780_00, 800_00]), auctionCloses: obs([620_00, 630_00, 640_00]) },
      NOW,
      DEFAULT_CONFIG.market,
    );
    expect(m?.valueCents).toBe(630_00);
    expect(m?.sources).toHaveLength(3);
  });

  it('ignores too few or too old observations', () => {
    const old = new Date(NOW.getTime() - 40 * 86_400_000);
    const m = estimateMarket(
      { manualCents: null, activePrices: [{ priceCents: 1, observedAt: NOW }], auctionCloses: [1, 2, 3].map(() => ({ priceCents: 1, observedAt: old })) },
      NOW,
      DEFAULT_CONFIG.market,
    );
    expect(m).toBeNull();
  });

  it('maxCostForGoodDeal', () => {
    expect(maxCostForGoodDeal(650_00, DEFAULT_CONFIG)).toBe(560_00);
  });
});
