import { describe, expect, it } from 'vitest';
import { hardExclusions, offPlatformPayment, softWarnings } from '../src/domain/filters.js';

const codes = (title: string, text = '') => hardExclusions(title, text).map((h) => h.code);

describe('hard exclusions', () => {
  it.each([
    ['iPhone 15 Pro iCloud gesperrt', 'ICLOUD'],
    ['iPhone 15 Pro Bastler', 'DEFECT'],
    ['iPhone 15 Pro Displaybruch', 'DISPLAY_BROKEN'],
    ['iPhone 15 Pro nur OVP', 'BOX_ONLY'],
    ['iPhone 15 Pro Attrappe Dummy', 'DUMMY'],
    ['Hülle für iPhone 15 Pro', 'ACCESSORY'],
    ['Panzerglas iPhone 15 Pro 2 Stück', 'ACCESSORY'],
    ['iPhone 15 Pro Tausche gegen Samsung', 'TRADE'],
  ])('%s -> %s', (title, code) => {
    expect(codes(title)).toContain(code);
  });

  it('flags problems found in the description', () => {
    expect(codes('iPhone 15 Pro 256GB', 'Face ID funktioniert nicht')).toContain('FACE_ID');
    expect(codes('iPhone 15 Pro 256GB', 'Die Kamera geht nicht mehr')).toContain('DEFECT');
  });

  it('ignores negated mentions that good listings contain', () => {
    expect(codes('iPhone 15 Pro 256GB', 'Keine Defekte, keine Kratzer. iCloud abgemeldet, simlockfrei. Kein Tausch!')).toEqual([]);
    expect(codes('iPhone 15 Pro 256GB nicht gesperrt')).toEqual([]);
    expect(codes('iPhone 15 Pro 256GB inkl. Hülle und Panzerglas')).toEqual([]);
    expect(codes('iPhone 15 Pro 256GB mit MagSafe Case')).toEqual([]);
  });
});

describe('payment and soft warnings', () => {
  it('detects off-platform payment hints', () => {
    expect(offPlatformPayment('iPhone 15', 'Zahlung per Überweisung oder PayPal Freunde')).toBe(true);
    expect(offPlatformPayment('iPhone 15', 'Bitte über WhatsApp melden')).toBe(true);
    expect(offPlatformPayment('iPhone 15', 'Keine Überweisung, nur eBay-Zahlung')).toBe(false);
  });

  it('warns on replaced parts and pickup only', () => {
    const w = softWarnings('iPhone 15', 'Display wurde getauscht. Nur Abholung in Köln').map((x) => x.code);
    expect(w).toEqual(['PARTS_REPLACED', 'PICKUP_ONLY']);
  });
});
