import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/config.js';
import { sellerTrust } from '../src/domain/trust.js';

const cfg = DEFAULT_CONFIG.trust;
const seller = (feedbackScore: number, feedbackPercent: number | null, accountType: 'BUSINESS' | 'INDIVIDUAL' = 'INDIVIDUAL') =>
  ({ username: 's', feedbackScore, feedbackPercent, accountType });

describe('seller trust (plan 7a)', () => {
  it('blocks new accounts selling expensive phones', () => {
    expect(sellerTrust(seller(2, 100), 450_00, cfg).level).toBe('BLOCKED');
    expect(sellerTrust(seller(2, 100), 250_00, cfg).level).toBe('WARN');
  });

  it('blocks below 95 % positive', () => {
    expect(sellerTrust(seller(400, 94.5), 450_00, cfg).level).toBe('BLOCKED');
  });

  it('warns for few ratings or 95-98 %', () => {
    expect(sellerTrust(seller(20, 100), 450_00, cfg).level).toBe('WARN');
    expect(sellerTrust(seller(400, 97), 450_00, cfg).level).toBe('WARN');
  });

  it('trusts 50+ ratings with at least 98 %', () => {
    expect(sellerTrust(seller(50, 98), 450_00, cfg).level).toBe('TRUSTED');
  });

  it('moves business sellers up one level, never above trusted', () => {
    expect(sellerTrust(seller(20, 100, 'BUSINESS'), 450_00, cfg).level).toBe('TRUSTED');
    expect(sellerTrust(seller(400, 94, 'BUSINESS'), 450_00, cfg).level).toBe('WARN');
    expect(sellerTrust(seller(400, 99.9, 'BUSINESS'), 450_00, cfg).level).toBe('TRUSTED');
  });
});
