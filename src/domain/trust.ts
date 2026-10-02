import type { SellerInfo } from '../adapters/types.js';
import type { ScannerConfig } from '../config.js';
import type { Cents } from './money.js';

export type TrustLevel = 'BLOCKED' | 'WARN' | 'TRUSTED';

export interface TrustResult {
  level: TrustLevel;
  reasons: string[];
}

const ORDER: TrustLevel[] = ['BLOCKED', 'WARN', 'TRUSTED'];

/**
 * Seller trust from feedback count and positive share (plan section 7a).
 * Business sellers move up one level (warranty, right of return), never above TRUSTED.
 */
export function sellerTrust(seller: SellerInfo, costCents: Cents, cfg: ScannerConfig['trust']): TrustResult {
  const score = seller.feedbackScore ?? 0;
  const pct = seller.feedbackPercent;
  const reasons: string[] = [];
  let level: TrustLevel = 'TRUSTED';

  if (score < cfg.minFeedbackForExpensive && costCents > cfg.expensiveFromCents) {
    level = 'BLOCKED';
    reasons.push(`nur ${score} Bewertungen bei teurem Gerät`);
  } else if (score > 0 && pct !== null && pct < cfg.blockBelowPercent) {
    level = 'BLOCKED';
    reasons.push(`nur ${formatPct(pct)} positiv`);
  } else {
    if (score < cfg.trustedMinFeedback) {
      level = 'WARN';
      reasons.push(`wenige Bewertungen (${score})`);
    }
    if (score > 0 && pct !== null && pct < cfg.trustedMinPercent) {
      level = 'WARN';
      reasons.push(`${formatPct(pct)} positiv`);
    }
  }

  if (seller.accountType === 'BUSINESS' && level !== 'TRUSTED') {
    level = ORDER[ORDER.indexOf(level) + 1]!;
    reasons.push('gewerblicher Verkäufer (Gewährleistung)');
  }
  return { level, reasons };
}

export function formatPct(p: number): string {
  return `${p.toLocaleString('de-DE', { maximumFractionDigits: 1 })} %`;
}
