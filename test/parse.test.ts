import { describe, expect, it } from 'vitest';
import { parseBattery, parseListing, parseModel, parseStorages } from '../src/domain/parse.js';

describe('parseModel', () => {
  it.each([
    ['Apple iPhone 15 Pro 256GB Schwarz', '15-pro'],
    ['iPhone 15 Pro Max 512 GB', '15-pro-max'],
    ['IPHONE15PROMAX 256gb', '15-pro-max'],
    ['iPhone 16e 128GB weiß', '16e'],
    ['Apple iPhone Air 256 GB Himmelblau', 'air'],
    ['iPhone 14 Plus 128GB', '14-plus'],
    ['i Phone 17 Pro 1TB', '17-pro'],
    ['iPhone 17 256GB Lavendel', '17'],
  ])('%s -> %s', (title, model) => {
    expect(parseModel(title).model).toBe(model);
  });

  it('rejects out-of-scope and contradictory titles', () => {
    expect(parseModel('iPhone 13 mini 128GB').model).toBeNull();
    expect(parseModel('iPhone 12 Pro').model).toBeNull();
    expect(parseModel('iPhone 14 Pro wie iPhone 15 Pro').reason).toBe('mehrere Modelle im Titel');
    expect(parseModel('Samsung Galaxy S24').reason).toBe('kein iPhone-Modell erkannt');
  });
});

describe('storage and battery', () => {
  it('reads GB and TB', () => {
    expect(parseStorages('iPhone 15 Pro 256GB')).toEqual([256]);
    expect(parseStorages('iPhone 16 Pro 1 TB')).toEqual([1024]);
    expect(parseStorages('iPhone 15 128 gb / 256 gb')).toEqual([128, 256]);
  });

  it('reads battery health', () => {
    expect(parseBattery('Akkuzustand 91%')).toBe(91);
    expect(parseBattery('Akku: 87 %')).toBe(87);
    expect(parseBattery('100% Akku')).toBe(100);
    expect(parseBattery('Batteriezustand liegt bei 84%')).toBe(84);
    expect(parseBattery('20% Rabatt')).toBeNull();
  });
});

describe('parseListing', () => {
  it('assumes the smallest storage when none is given', () => {
    const p = parseListing({ title: 'iPhone 15 Pro Max blau', text: '', conditionId: 3000, aspects: {} });
    expect(p.variant).toEqual({ model: '15-pro-max', storageGb: 256 });
    expect(p.storageAssumed).toBe(true);
  });

  it('uses the storage aspect from the full item', () => {
    const p = parseListing({ title: 'iPhone 15', text: '', conditionId: 3000, aspects: { Speicherkapazität: '512 GB' } });
    expect(p.variant?.storageGb).toBe(512);
    expect(p.storageAssumed).toBe(false);
  });

  it('rejects conflicting storage', () => {
    const p = parseListing({ title: 'iPhone 15 128GB', text: '', conditionId: 3000, aspects: { Speicherkapazität: '256 GB' } });
    expect(p.variant).toBeNull();
  });

  it('grades used listings from text, conservatively', () => {
    expect(parseListing({ title: 'iPhone 15 128GB wie neu', text: '', conditionId: 3000, aspects: {} }).grade).toBe('LIKE_NEW');
    expect(parseListing({ title: 'iPhone 15 128GB', text: '', conditionId: 3000, aspects: {} }).grade).toBe('USED');
    expect(parseListing({ title: 'iPhone 15 128GB', text: '', conditionId: 7000, aspects: {} }).grade).toBe('PARTS');
    expect(parseListing({ title: 'iPhone 15 128GB', text: 'ohne OVP', conditionId: 3000, aspects: {} }).noBox).toBe(true);
  });
});
