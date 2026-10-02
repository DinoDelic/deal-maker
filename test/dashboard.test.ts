import { describe, expect, it } from 'vitest';
import { renderPage } from '../src/dashboard/page.js';
import { parseLog, summarize, keyLabel, type LogEntry } from '../src/dashboard/summary.js';
import { memoryStore } from '../src/store.js';
import { NOW } from './helpers.js';

const entry = (over: Partial<LogEntry>): LogEntry => ({
  at: NOW.toISOString(),
  id: 'a',
  url: 'https://www.ebay.de/itm/1',
  title: 'iPhone 15 Pro 256GB <script>',
  tier: 'GOOD',
  variant: '15-pro/256',
  grade: 'GOOD',
  cost: 500_00,
  buyback: null,
  resale: 640_00,
  profit: 134_00,
  offer: null,
  trust: 'TRUSTED',
  seller: { username: 's', feedbackScore: 300, feedbackPercent: 99.5, accountType: null },
  reasons: [],
  warnings: ['Keine OVP'],
  alerted: true,
  ...over,
});

describe('dashboard', () => {
  it('keeps the latest decision per listing within 24 hours', () => {
    const old = new Date(NOW.getTime() - 30 * 3_600_000).toISOString();
    const log = [
      entry({ id: 'a', tier: 'NONE', alerted: false }),
      entry({ id: 'a', tier: 'GOOD' }),
      entry({ id: 'b', tier: 'BLOCKED', reasons: ['Lockpreis'], alerted: false }),
      entry({ id: 'c', at: old }),
    ].map((e) => JSON.stringify(e)).join('\n') + '\n{"broken';
    const d = summarize(parseLog(log), memoryStore(), NOW);
    expect(d.checked).toBe(2);
    expect(d.deals.map((e) => e.id)).toEqual(['a']);
    expect(d.blocked.map((e) => e.id)).toEqual(['b']);
    expect(d.alerts).toBe(1);
  });

  it('summarizes market observations per variant', () => {
    const store = memoryStore();
    for (const [i, p] of [600, 620, 640, 660, 700].entries()) store.recordActivePrice('15-pro/256/GOOD', `x${i}`, p * 100, NOW);
    const d = summarize([], store, NOW);
    expect(d.market[0]).toMatchObject({ label: 'iPhone 15 Pro 256 GB · Gut', activeCount: 5, activeP25: 620_00 });
  });

  it('renders escaped html with the tier badge', () => {
    const d = summarize([entry({})], memoryStore(), NOW);
    const html = renderPage(d, { view: 'deals', dryRun: true, demo: false });
    expect(html).toContain('Guter Deal');
    expect(html).toContain('Probebetrieb');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(keyLabel('17-pro-max/2048/NEW')).toBe('iPhone 17 Pro Max 2 TB · Neu');
  });
});
