import { describe, expect, it } from 'vitest';
import type { ExternalListing, MarketplaceAdapter, SearchRequest } from '../src/adapters/types.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { ConsoleNotifier, formatAlert } from '../src/notify/telegram.js';
import { parseReferenceCsv, referenceLookup } from '../src/reference.js';
import { Scanner } from '../src/scanner.js';
import { memoryStore } from '../src/store.js';
import { evaluate } from '../src/domain/evaluate.js';
import { listing, NOW } from './helpers.js';

const CSV = `# test
model,storage_gb,grade,buyback_eur,market_eur,source,updated
15-pro,256,USED,520,640,rebuy,2026-10-01
`;

class FakeAdapter implements MarketplaceAdapter {
  readonly key = 'ebay-de';
  detailCalls = 0;
  constructor(public items: ExternalListing[]) {}
  async search(req: SearchRequest) {
    return req.kind === 'NEWLY_LISTED' ? this.items.map((i) => ({ ...i, detailed: false })) : [];
  }
  async getDetails(l: ExternalListing) {
    this.detailCalls++;
    return { ...l, detailed: true, seller: { ...l.seller, accountType: 'INDIVIDUAL' as const } };
  }
}

function setup(items: ExternalListing[]) {
  const store = memoryStore();
  const adapter = new FakeAdapter(items);
  const notifier = new ConsoleNotifier();
  const scanner = new Scanner({
    adapter,
    refs: referenceLookup(parseReferenceCsv(CSV), store),
    store,
    notifier,
    config: DEFAULT_CONFIG,
    maxDetailsPerCycle: 3,
    now: () => NOW,
  });
  return { store, adapter, notifier, scanner };
}

describe('Scanner', () => {
  it('alerts a deal once, loads details first, and re-alerts only on a price drop', async () => {
    const deal = listing({ externalId: 'deal', priceCents: 480_00 });
    const meh = listing({ externalId: 'meh', priceCents: 700_00 });
    const accessory = listing({ externalId: 'acc', title: 'Hülle für iPhone 15 Pro', priceCents: 9_00 });
    const { adapter, notifier, scanner } = setup([deal, meh, accessory]);

    const first = await scanner.runCycle();
    expect(first.alerts).toBe(1);
    expect(adapter.detailCalls).toBe(1);
    expect(notifier.sent[0]!.text).toContain('Sicher-Deal');

    const second = await scanner.runCycle();
    expect(second.alerts).toBe(0);
    expect(adapter.detailCalls).toBe(1); // cached

    adapter.items[0] = { ...deal, priceCents: 450_00 };
    const third = await scanner.runCycle();
    expect(third.alerts).toBe(1);
  });

  it('records own market observations, excluding accessories and unknown storage', async () => {
    const { store, scanner } = setup([
      listing({ externalId: 'a', priceCents: 700_00 }),
      listing({ externalId: 'b', title: 'iPhone 15 Pro schwarz', priceCents: 690_00 }),
      listing({ externalId: 'c', title: 'Hülle für iPhone 15 Pro 256GB', priceCents: 9_00 }),
    ]);
    await scanner.runCycle();
    expect(store.activePrices('15-pro/256/USED').map((o) => o.priceCents)).toEqual([706_00]);
  });
});

describe('formatAlert', () => {
  it('matches the plan example', () => {
    const l = listing({ priceCents: 470_00, text: 'Akku 91 %, ohne OVP', buyingOptions: ['FIXED_PRICE'] });
    const refs = referenceLookup(parseReferenceCsv(CSV), memoryStore());
    const d = evaluate(l, refs, DEFAULT_CONFIG, NOW);
    const msg = formatAlert(l, d, NOW);
    expect(msg.text).toContain('🟢 Sicher-Deal · iPhone 15 Pro 256 GB · Gebraucht · Akku 91 %');
    expect(msg.text).toContain('Preis 470 € + 6 € Versand (Sofort-Kaufen)');
    expect(msg.text).toContain('✅ Verkäufer: 312 Bewertungen, 99,6 %');
    expect(msg.text).toContain('⚠️ Keine OVP');
    expect(msg.replyMarkup.inline_keyboard[0]![0]!.url).toBe(l.url);
  });
});

describe('market observations', () => {
  it('pools all used grades and ignores refurbished and business listings', async () => {
    const { observe } = await import('../src/scanner.js');
    const store = memoryStore();
    observe(listing({ externalId: 'a', title: 'iPhone 15 Pro 256GB wie neu' }), store, DEFAULT_CONFIG, NOW);
    observe(listing({ externalId: 'b', title: 'iPhone 15 Pro 256GB' }), store, DEFAULT_CONFIG, NOW);
    observe(listing({ externalId: 'c', conditionId: 2020 }), store, DEFAULT_CONFIG, NOW);
    observe(
      listing({ externalId: 'd', seller: { username: 'shop', feedbackScore: 9000, feedbackPercent: 99.9, accountType: 'BUSINESS' } }),
      store,
      DEFAULT_CONFIG,
      NOW,
    );
    expect(store.marketKeys()).toEqual(['15-pro/256/USED']);
    expect(store.activePrices('15-pro/256/USED').map((o) => o.priceCents).sort()).toEqual([606_00, 606_00]);
  });
});
