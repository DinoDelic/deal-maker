/** All amounts are integer euro cents. */
export type Cents = number;

export function eurosToCents(value: string | number): Cents {
  const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
  if (!Number.isFinite(n)) throw new Error(`Invalid amount: ${value}`);
  return Math.round(n * 100);
}

/** "1.234 €" for whole euros, "12,50 €" otherwise (de-DE). */
export function formatEuro(cents: Cents): string {
  const euros = cents / 100;
  const whole = Number.isInteger(euros);
  return (
    euros.toLocaleString('de-DE', {
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: whole ? 0 : 2,
    }) + ' €'
  );
}
