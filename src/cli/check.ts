/**
 * Schnell-Check (plan section 8) for Kleinanzeigen and anything else you find yourself.
 *
 *   npm run check -- --title "iPhone 15 Pro 256GB Akku 91%" --price 489 --ship 6 [--text "Anzeigentext"]
 *       [--condition used|new|likenew|good] [--ratings 120 --percent 99.5] [--business]
 *
 * Nothing is fetched: you paste what you see.
 */
import { parseArgs } from 'node:util';
import type { ExternalListing } from '../adapters/types.js';
import { DEFAULT_CONFIG } from '../config.js';
import { GRADE_LABEL, variantName } from '../domain/catalog.js';
import { evaluate } from '../domain/evaluate.js';
import { eurosToCents, formatEuro } from '../domain/money.js';
import { loadReferenceCsv, referenceLookup } from '../reference.js';
import { memoryStore } from '../store.js';

const { values } = parseArgs({
  options: {
    title: { type: 'string' },
    text: { type: 'string', default: '' },
    price: { type: 'string' },
    ship: { type: 'string', default: '0' },
    condition: { type: 'string', default: 'used' },
    ratings: { type: 'string' },
    percent: { type: 'string' },
    business: { type: 'boolean', default: false },
  },
});

if (!values.title || !values.price) {
  console.error('Bitte mindestens --title und --price angeben.');
  process.exit(1);
}

const CONDITION_IDS: Record<string, number> = { new: 1000, likenew: 2010, good: 2020, used: 3000 };
const listing: ExternalListing = {
  marketplace: 'manual',
  externalId: 'check',
  url: '-',
  title: values.title,
  text: values.text ?? '',
  priceCents: eurosToCents(values.price),
  shippingCents: eurosToCents(values.ship ?? '0'),
  conditionId: CONDITION_IDS[values.condition ?? 'used'] ?? 3000,
  buyingOptions: ['FIXED_PRICE'],
  bidCount: null,
  endsAt: null,
  createdAt: null,
  country: 'DE',
  seller: {
    username: '-',
    // Kleinanzeigen has no comparable rating; without input, the seller check is neutral.
    feedbackScore: values.ratings ? Number(values.ratings) : 999,
    feedbackPercent: values.percent ? Number(values.percent) : null,
    accountType: values.business ? 'BUSINESS' : 'INDIVIDUAL',
  },
  imageUrl: null,
  aspects: {},
  detailed: true,
};

const refs = referenceLookup(loadReferenceCsv(process.env.REFERENCE_CSV ?? 'data/reference-prices.csv'), memoryStore());
const d = evaluate(listing, refs, DEFAULT_CONFIG, new Date());
const LABEL = { SAFE: '🟢 Sicher-Deal', GOOD: '🟡 Guter Deal', OFFER: '💬 Mit Preisvorschlag ein Deal', NONE: '⚪ Kein Deal', BLOCKED: '🔴 Blockiert', SKIPPED: '⚫ Nicht bewertet' };

console.log(LABEL[d.tier]);
if (d.variant && d.grade) console.log(`${variantName(d.variant)} · ${GRADE_LABEL[d.grade]}`);
if (d.tier !== 'SKIPPED') console.log(`Einstand: ${formatEuro(d.costCents)}`);
if (d.buybackCents !== null) console.log(`Ankauf sicher: ${formatEuro(d.buybackCents)}`);
if (d.resaleCents !== null) console.log(`Markt (konservativ): ${formatEuro(d.resaleCents)}`);
if (d.profitCents !== null) console.log(`Erwarteter Gewinn: ${formatEuro(d.profitCents)}`);
if (d.suggestedOfferCents !== null) console.log(`Preisvorschlag bis: ${formatEuro(d.suggestedOfferCents)}`);
for (const r of d.reasons) console.log(`Grund: ${r}`);
for (const w of d.warnings) console.log(`⚠️ ${w}`);
if (d.tier !== 'SKIPPED' && d.buybackCents === null && d.resaleCents === null && d.variant) {
  console.log('Hinweis: Für diese Variante fehlen noch Referenzpreise in data/reference-prices.csv.');
}
