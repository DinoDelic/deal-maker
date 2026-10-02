import type { ExternalListing } from '../adapters/types.js';
import { GRADE_LABEL, variantName } from '../domain/catalog.js';
import type { Decision } from '../domain/evaluate.js';
import { formatEuro } from '../domain/money.js';
import { formatPct } from '../domain/trust.js';

export interface TelegramMessage {
  text: string;
  replyMarkup: { inline_keyboard: { text: string; url?: string; callback_data?: string }[][] };
}

const HEADER: Partial<Record<Decision['tier'], string>> = {
  SAFE: '🟢 Sicher-Deal',
  GOOD: '🟡 Guter Deal',
  OFFER: '💬 Deal mit Preisvorschlag',
};

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function timeLeft(endsAt: Date, now: Date): string {
  const min = Math.max(0, Math.round((endsAt.getTime() - now.getTime()) / 60_000));
  return min < 60 ? `${min} Min.` : `${Math.floor(min / 60)} Std. ${min % 60} Min.`;
}

/** Alert text in Telegram HTML format (plan section 9). */
export function formatAlert(listing: ExternalListing, d: Decision, now: Date): TelegramMessage {
  const header = HEADER[d.tier];
  if (!header || !d.variant || !d.grade) throw new Error(`No alert for tier ${d.tier}`);

  const head = [header, variantName(d.variant), GRADE_LABEL[d.grade]];
  if (d.batteryPercent !== null) head.push(`Akku ${d.batteryPercent} %`);

  const shipping = listing.shippingCents === null ? 'Versand ?' : `${formatEuro(listing.shippingCents)} Versand`;
  const format = listing.buyingOptions.includes('AUCTION') && !listing.buyingOptions.includes('FIXED_PRICE')
    ? `Auktion, endet in ${listing.endsAt ? timeLeft(listing.endsAt, now) : '?'}, ${listing.bidCount ?? 0} Gebote`
    : listing.buyingOptions.includes('BEST_OFFER')
      ? 'Sofort-Kaufen oder Preisvorschlag'
      : 'Sofort-Kaufen';

  const lines = [
    `<b>${esc(head.join(' · '))}</b>`,
    `Preis ${formatEuro(listing.priceCents)} + ${shipping} (${format})`,
  ];
  if (d.tier === 'OFFER' && d.suggestedOfferCents !== null) {
    lines.push(`👉 Preisvorschlag bis <b>${formatEuro(d.suggestedOfferCents)}</b> wäre ein guter Deal`);
  }
  const values: string[] = [];
  if (d.buybackCents !== null) values.push(`Ankauf sicher: ${formatEuro(d.buybackCents)}`);
  if (d.resaleCents !== null) values.push(`Markt (konservativ): ${formatEuro(d.resaleCents)}`);
  if (values.length) lines.push(values.join(' · '));
  if (d.profitCents !== null && d.profitRatio !== null && d.tier !== 'OFFER') {
    lines.push(`Erwarteter Gewinn: ~${formatEuro(d.profitCents)} (${Math.round(d.profitRatio * 100)} %)`);
  }

  const s = listing.seller;
  const sellerBits = [`${s.feedbackScore ?? 0} Bewertungen`];
  if (s.feedbackPercent !== null) sellerBits.push(formatPct(s.feedbackPercent));
  if (s.accountType === 'BUSINESS') sellerBits.push('gewerblich');
  const trustIcon = d.trust?.level === 'TRUSTED' ? '✅' : '🟠';
  lines.push(`${trustIcon} Verkäufer: ${sellerBits.join(', ')}`);

  for (const w of d.warnings) lines.push(`⚠️ ${esc(w)}`);
  lines.push(`<i>${esc(listing.title)}</i>`);

  return {
    text: lines.join('\n'),
    replyMarkup: {
      inline_keyboard: [
        [{ text: 'Angebot öffnen', url: listing.url }],
        [
          { text: '👍 guter Tipp', callback_data: `fb:up:${listing.marketplace}:${listing.externalId}` },
          { text: '👎 kein Deal', callback_data: `fb:down:${listing.marketplace}:${listing.externalId}` },
        ],
      ],
    },
  };
}

export interface Notifier {
  send(msg: TelegramMessage): Promise<void>;
}

export class TelegramNotifier implements Notifier {
  constructor(
    private readonly token: string,
    private readonly chatId: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async send(msg: TelegramMessage): Promise<void> {
    const res = await this.fetchFn(`https://api.telegram.org/bot${this.token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: this.chatId,
        text: msg.text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
        reply_markup: msg.replyMarkup,
      }),
    });
    if (!res.ok) throw new Error(`Telegram sendMessage failed: ${res.status} ${await res.text()}`);
  }
}

/** Dry run: prints instead of sending (plan step 3, "Probebetrieb"). */
export class ConsoleNotifier implements Notifier {
  readonly sent: TelegramMessage[] = [];
  async send(msg: TelegramMessage): Promise<void> {
    this.sent.push(msg);
    console.log(`\n--- Alarm (Probebetrieb) ---\n${msg.text.replace(/<[^>]+>/g, '')}\n`);
  }
}
