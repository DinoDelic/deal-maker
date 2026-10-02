/**
 * Demo data for the dashboard: runs the real scanner pipeline against made-up listings,
 * so the page can be viewed before the eBay keys exist. All prices are fictional.
 */
import { rmSync } from 'node:fs';
import type { ExternalListing, MarketplaceAdapter, SearchRequest } from '../adapters/types.js';
import { DEFAULT_CONFIG } from '../config.js';
import { MODELS, type ModelKey } from '../domain/catalog.js';
import type { Notifier } from '../notify/telegram.js';
import { parseReferenceCsv, referenceLookup } from '../reference.js';
import { Scanner } from '../scanner.js';
import { JsonFileStore } from '../store.js';

/** Fictional "used, good" base prices in euros for the smallest storage. */
const BASE: Record<ModelKey, number> = {
  '14': 330, '14-plus': 370, '14-pro': 430, '14-pro-max': 490,
  '15': 430, '15-plus': 470, '15-pro': 540, '15-pro-max': 620,
  '16': 540, '16-plus': 590, '16-pro': 690, '16-pro-max': 780, '16e': 410,
  '17': 700, '17-pro': 860, '17-pro-max': 900, air: 780,
};

function rng(seed: number): () => number {
  let s = seed;
  return () => ((s = (s * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
}

const EXTRAS = [
  '', '', '', ' Akku 91%', ' Akku 86%', ' wie neu', ' sehr guter Zustand', ' OVP', ' ohne OVP', ' Akku 82%',
];
const COLORS = ['Schwarz', 'Weiß', 'Blau', 'Titan Natur', 'Rosa', 'Grün'];
const TEXTS = [
  'Privatverkauf, keine Garantie. iCloud abgemeldet.',
  'Gerät funktioniert einwandfrei, keine Kratzer.',
  'Display wurde getauscht, sonst alles top.',
  'Zahlung gerne per Überweisung.',
  'Leichte Gebrauchsspuren am Rahmen.',
];

class DemoAdapter implements MarketplaceAdapter {
  readonly key = 'ebay-de';
  private n = 0;
  constructor(private readonly rand: () => number) {}

  private make(now: Date, auction: boolean): ExternalListing {
    const r = this.rand;
    const models = MODELS.filter((m) => m.key !== '17-pro-max');
    const m = models[Math.floor(r() * models.length)]!;
    const si = Math.floor(r() * m.storagesGb.length);
    const storage = m.storagesGb[si]!;
    const base = BASE[m.key] * (1 + si * 0.12);
    // Most listings around market price, some well below.
    const factor = r() < 0.12 ? 0.7 + r() * 0.12 : 0.95 + r() * 0.25;
    const price = Math.min(895, Math.round(base * factor));
    const extra = EXTRAS[Math.floor(r() * EXTRAS.length)]!;
    const size = storage >= 1024 ? `${storage / 1024}TB` : `${storage}GB`;
    const id = `demo-${++this.n}`;
    const feedback = r() < 0.15 ? Math.floor(r() * 30) : 50 + Math.floor(r() * 900);
    return {
      marketplace: 'ebay-de',
      externalId: id,
      url: 'https://www.ebay.de/sch/i.html?_nkw=iphone',
      title: `Apple ${m.name} ${size} ${COLORS[Math.floor(r() * COLORS.length)]}${extra}`,
      text: TEXTS[Math.floor(r() * TEXTS.length)]!,
      priceCents: price * 100,
      shippingCents: r() < 0.5 ? 0 : 599,
      conditionId: r() < 0.1 ? 2010 : 3000,
      buyingOptions: auction ? ['AUCTION'] : r() < 0.4 ? ['FIXED_PRICE', 'BEST_OFFER'] : ['FIXED_PRICE'],
      bidCount: auction ? 1 + Math.floor(r() * 12) : null,
      endsAt: auction ? new Date(now.getTime() + (1 + r() * 10) * 60_000) : null,
      createdAt: now,
      country: 'DE',
      seller: {
        username: `demo${Math.floor(r() * 1000)}`,
        feedbackScore: feedback,
        feedbackPercent: feedback === 0 ? null : r() < 0.08 ? 94 + r() * 3 : 98 + r() * 2,
        accountType: r() < 0.2 ? 'BUSINESS' : 'INDIVIDUAL',
      },
      imageUrl: null,
      aspects: {},
      detailed: false,
    };
  }

  now = new Date();
  async search(req: SearchRequest): Promise<ExternalListing[]> {
    const count = req.kind === 'NEWLY_LISTED' ? 30 : 8;
    return Array.from({ length: count }, () => this.make(this.now, req.kind === 'ENDING_AUCTIONS'));
  }
  async getDetails(l: ExternalListing): Promise<ExternalListing> {
    return { ...l, detailed: true };
  }
}

const silent: Notifier = { send: async () => {} };

/** Writes demo state and log into `dir` covering the last 24 hours. */
export async function buildDemo(dir: string): Promise<void> {
  rmSync(dir, { recursive: true, force: true });
  const store = new JsonFileStore(`${dir}/state.json`, `${dir}/decisions.jsonl`);
  const rows = MODELS.flatMap((m) =>
    m.storagesGb.map((s, si) => `${m.key},${s},GOOD,${Math.round(BASE[m.key] * (1 + si * 0.12) * 0.8)},,demo,`),
  );
  const csv = 'model,storage_gb,grade,buyback_eur,market_eur,source,updated\n' + rows.join('\n');
  const adapter = new DemoAdapter(rng(42));
  const end = Date.now();
  let now = new Date(end - 24 * 3_600_000);
  const scanner = new Scanner({
    adapter,
    refs: referenceLookup(parseReferenceCsv(csv), store),
    store,
    notifier: silent,
    config: DEFAULT_CONFIG,
    maxDetailsPerCycle: 50,
    now: () => now,
  });
  for (let i = 0; i < 48; i++) {
    now = new Date(end - (47 - i) * 30 * 60_000);
    adapter.now = now;
    await scanner.runCycle();
  }
}
