import { formatEuro } from '../domain/money.js';
import { formatPct } from '../domain/trust.js';
import type { DashboardData, LogEntry } from './summary.js';
import { keyLabel } from './summary.js';

export type View = 'deals' | 'blocked' | 'market';

export interface PageOptions {
  view: View;
  dryRun: boolean;
  demo: boolean;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function ago(at: Date, now: Date): string {
  const min = Math.max(0, Math.round((now.getTime() - at.getTime()) / 60_000));
  if (min < 1) return 'gerade eben';
  if (min < 60) return `vor ${min} Min.`;
  const h = Math.floor(min / 60);
  if (h < 24) return `vor ${h} Std.`;
  return `vor ${Math.floor(h / 24)} Tg.`;
}

const TIER: Record<string, { label: string; cls: string }> = {
  SAFE: { label: 'Sicher-Deal', cls: 'safe' },
  GOOD: { label: 'Guter Deal', cls: 'good' },
  OFFER: { label: 'Preisvorschlag', cls: 'offer' },
  BLOCKED: { label: 'Blockiert', cls: 'blocked' },
};

function money(c: number | null): string {
  return c === null ? '–' : formatEuro(c);
}

function card(e: LogEntry, now: Date): string {
  const t = TIER[e.tier] ?? { label: e.tier, cls: 'none' };
  const variant = e.variant && e.grade ? keyLabel(`${e.variant}/${e.grade}`) : '';
  const value = e.resale ?? e.buyback;
  const ratio = e.profit !== null && e.cost > 0 ? ` (${Math.round((e.profit / e.cost) * 100)} %)` : '';
  const s = e.seller;
  const sellerBits = [`${s.feedbackScore ?? 0} Bewertungen`];
  if (s.feedbackPercent !== null) sellerBits.push(formatPct(s.feedbackPercent));
  if (s.accountType === 'BUSINESS') sellerBits.push('gewerblich');
  const trustCls = e.trust === 'TRUSTED' ? 'ok' : e.trust === 'BLOCKED' ? 'bad' : 'warn';

  const facts = [
    `<div><dt>Preis inkl. Versand</dt><dd>${money(e.cost)}</dd></div>`,
    `<div><dt>Wert (konservativ)</dt><dd>${money(value)}</dd></div>`,
    e.buyback !== null && e.resale !== null ? `<div><dt>Ankauf sicher</dt><dd>${money(e.buyback)}</dd></div>` : '',
    e.tier === 'OFFER' && e.offer !== null
      ? `<div><dt>Vorschlag bis</dt><dd class="hl">${money(e.offer)}</dd></div>`
      : `<div><dt>Erwarteter Gewinn</dt><dd class="hl">${e.profit === null ? '–' : `${money(e.profit)}${ratio}`}</dd></div>`,
  ].join('');

  const chips = [
    ...e.reasons.map((r) => `<li class="chip bad">${esc(r)}</li>`),
    ...e.warnings.map((w) => `<li class="chip warn">${esc(w)}</li>`),
  ].join('');

  return `<article class="card">
  <header>
    <span class="badge ${t.cls}">${t.label}</span>
    ${e.alerted ? '<span class="sent" title="Nachricht verschickt">gemeldet</span>' : ''}
    <time>${ago(new Date(e.at), now)}</time>
  </header>
  <h3><a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.title)}</a></h3>
  <p class="variant">${esc(variant)}</p>
  <dl>${facts}</dl>
  <p class="seller"><span class="dot ${trustCls}"></span>Verkäufer: ${esc(sellerBits.join(', '))}</p>
  ${chips ? `<ul class="chips">${chips}</ul>` : ''}
</article>`;
}

function marketTable(d: DashboardData): string {
  if (d.market.length === 0) {
    return '<p class="empty">Noch keine Marktdaten. Der Scanner sammelt sie ab dem ersten Durchlauf.</p>';
  }
  const rows = d.market
    .map(
      (m) => `<tr>
  <td>${esc(m.label)}</td>
  <td class="num">${m.activeCount}</td>
  <td class="num">${m.activeCount >= 5 ? money(m.activeP25) : '<span class="muted">zu wenig</span>'}</td>
  <td class="num">${m.auctionCount}</td>
  <td class="num">${m.auctionCount >= 3 ? money(m.auctionMedian) : '<span class="muted">zu wenig</span>'}</td>
</tr>`,
    )
    .join('');
  return `<p class="hint">Der Scanner nutzt einen Wert, sobald mindestens 5 Angebote bzw. 3 Auktionsenden vorliegen, und nimmt dann den niedrigeren.</p>
<div class="tablewrap"><table>
  <thead><tr><th>Variante</th><th class="num">Angebote</th><th class="num">Günstigstes Viertel</th><th class="num">Auktionsenden</th><th class="num">Mittelwert</th></tr></thead>
  <tbody>${rows}</tbody>
</table></div>`;
}

export function renderPage(d: DashboardData, opts: PageOptions): string {
  const now = d.generatedAt;
  const deals = d.byTier.SAFE ?? 0;
  const tabs: [View, string, number | null][] = [
    ['deals', 'Deals', d.deals.length],
    ['blocked', 'Blockiert', d.blocked.length],
    ['market', 'Marktpreise', d.market.length],
  ];
  const tabHtml = tabs
    .map(([v, label, n]) => `<a href="?view=${v}" class="tab${opts.view === v ? ' active' : ''}">${label}${n !== null ? ` <span>${n}</span>` : ''}</a>`)
    .join('');

  let body: string;
  if (opts.view === 'market') body = marketTable(d);
  else {
    const list = opts.view === 'blocked' ? d.blocked : d.deals;
    body = list.length
      ? `<div class="cards">${list.map((e) => card(e, now)).join('')}</div>`
      : `<p class="empty">${opts.view === 'blocked' ? 'Nichts blockiert in den letzten 24 Stunden.' : 'Noch keine Deals in den letzten 24 Stunden.'}</p>`;
  }

  const status = opts.demo
    ? '<span class="pill demo">Beispieldaten</span>'
    : opts.dryRun
      ? '<span class="pill">Probebetrieb</span>'
      : '<span class="pill live">Live</span>';

  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="60">
<title>Deal Scanner</title>
<style>
:root {
  --bg: #f6f7f9; --surface: #ffffff; --text: #16181d; --muted: #5d6470; --border: #e2e5ea;
  --accent: #2557d6; --safe: #13804a; --safe-bg: #e3f5eb; --good: #8a5a00; --good-bg: #fdf1d6;
  --offer: #4b3fb5; --offer-bg: #ebe8fb; --bad: #b42318; --bad-bg: #fde8e6; --warn: #9a5b00; --warn-bg: #fff3e0;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #111317; --surface: #1a1d23; --text: #e8eaee; --muted: #9aa1ad; --border: #2c313a;
    --accent: #7ea2ff; --safe: #5fd394; --safe-bg: #15301f; --good: #f2c063; --good-bg: #33290f;
    --offer: #b2a9ff; --offer-bg: #25213f; --bad: #ff8a80; --bad-bg: #3a1a18; --warn: #ffbf66; --warn-bg: #36260f;
  }
}
:root[data-theme="dark"] {
  --bg: #111317; --surface: #1a1d23; --text: #e8eaee; --muted: #9aa1ad; --border: #2c313a;
  --accent: #7ea2ff; --safe: #5fd394; --safe-bg: #15301f; --good: #f2c063; --good-bg: #33290f;
  --offer: #b2a9ff; --offer-bg: #25213f; --bad: #ff8a80; --bad-bg: #3a1a18; --warn: #ffbf66; --warn-bg: #36260f;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 1100px; margin: 0 auto; padding: 24px 16px 48px; }
.top { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin-bottom: 20px; }
.top h1 { font-size: 22px; margin: 0; }
.top .meta { color: var(--muted); font-size: 13px; margin-left: auto; }
.pill { font-size: 12px; font-weight: 600; padding: 3px 10px; border-radius: 999px; background: var(--warn-bg); color: var(--warn); }
.pill.live { background: var(--safe-bg); color: var(--safe); }
.pill.demo { background: var(--offer-bg); color: var(--offer); }
.kpis { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 24px; }
.kpi { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px; }
.kpi b { display: block; font-size: 26px; font-variant-numeric: tabular-nums; }
.kpi span { color: var(--muted); font-size: 13px; }
.tabs { display: flex; gap: 6px; margin-bottom: 16px; overflow-x: auto; }
.tab { text-decoration: none; color: var(--muted); padding: 8px 14px; border-radius: 8px; border: 1px solid transparent; white-space: nowrap; }
.tab span { font-size: 12px; opacity: .8; }
.tab.active { background: var(--surface); border-color: var(--border); color: var(--text); font-weight: 600; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 12px; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 14px 16px; min-width: 0; }
.card header { display: flex; align-items: center; gap: 8px; }
.card time { margin-left: auto; color: var(--muted); font-size: 12px; }
.badge { font-size: 12px; font-weight: 700; padding: 2px 8px; border-radius: 6px; }
.badge.safe { background: var(--safe-bg); color: var(--safe); }
.badge.good { background: var(--good-bg); color: var(--good); }
.badge.offer { background: var(--offer-bg); color: var(--offer); }
.badge.blocked { background: var(--bad-bg); color: var(--bad); }
.sent { font-size: 12px; color: var(--muted); }
.card h3 { font-size: 15px; margin: 10px 0 2px; overflow-wrap: anywhere; }
.card h3 a { color: var(--text); text-decoration: none; }
.card h3 a:hover { color: var(--accent); text-decoration: underline; }
.variant { margin: 0 0 10px; color: var(--muted); font-size: 13px; }
dl { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 12px; margin: 0 0 10px; }
dt { color: var(--muted); font-size: 12px; }
dd { margin: 0; font-weight: 600; font-variant-numeric: tabular-nums; }
dd.hl { color: var(--safe); }
.seller { margin: 0; font-size: 13px; color: var(--muted); display: flex; align-items: center; gap: 6px; }
.dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.dot.ok { background: var(--safe); } .dot.warn { background: var(--warn); } .dot.bad { background: var(--bad); }
.chips { list-style: none; padding: 0; margin: 10px 0 0; display: flex; flex-wrap: wrap; gap: 6px; }
.chip { font-size: 12px; padding: 2px 8px; border-radius: 6px; }
.chip.warn { background: var(--warn-bg); color: var(--warn); }
.chip.bad { background: var(--bad-bg); color: var(--bad); }
.empty, .hint { color: var(--muted); }
.tablewrap { overflow-x: auto; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; }
table { width: 100%; border-collapse: collapse; font-size: 14px; }
th, td { padding: 10px 14px; border-bottom: 1px solid var(--border); text-align: left; white-space: nowrap; }
th { color: var(--muted); font-weight: 600; font-size: 12px; }
tr:last-child td { border-bottom: 0; }
.num { text-align: right; font-variant-numeric: tabular-nums; }
.muted { color: var(--muted); font-weight: 400; }
@media (max-width: 720px) { .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); } .cards { grid-template-columns: 1fr; } .top .meta { margin-left: 0; width: 100%; } }
</style>
</head>
<body>
<main>
  <div class="top">
    <h1>iPhone-Deal-Scanner</h1>
    ${status}
    <span class="meta">${d.lastScanAt ? `Letzter Scan ${ago(d.lastScanAt, now)}` : 'Noch kein Scan'} · aktualisiert sich jede Minute</span>
  </div>
  <section class="kpis">
    <div class="kpi"><b>${d.checked}</b><span>iPhones bewertet (24 Std.)</span></div>
    <div class="kpi"><b>${(d.byTier.SAFE ?? 0) + (d.byTier.GOOD ?? 0) + (d.byTier.OFFER ?? 0)}</b><span>Deals gefunden, davon ${deals} sicher</span></div>
    <div class="kpi"><b>${d.byTier.BLOCKED ?? 0}</b><span>Deals blockiert (Risiko)</span></div>
    <div class="kpi"><b>${d.market.filter((m) => m.activeCount >= 5 || m.auctionCount >= 3).length}</b><span>Varianten mit Marktpreis</span></div>
  </section>
  <nav class="tabs">${tabHtml}</nav>
  ${body}
</main>
</body>
</html>`;
}
