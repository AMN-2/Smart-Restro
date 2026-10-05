/**
 * Banknotes and coins in everyday use, per currency: the shortcuts the
 * cashier taps instead of typing an amount, at payment and when counting
 * the drawer at close. Only what actually changes hands at a till.
 */
const DENOMINATIONS: Record<string, number[]> = {
  IQD: [250, 500, 1000, 5000, 10000, 25000, 50000],
  USD: [1, 5, 10, 20, 50, 100],
  EUR: [5, 10, 20, 50, 100, 200],
  GBP: [5, 10, 20, 50],
  SAR: [1, 5, 10, 50, 100, 200, 500],
  AED: [5, 10, 20, 50, 100, 200, 500],
  KWD: [0.25, 0.5, 1, 5, 10, 20],
  JOD: [1, 5, 10, 20, 50],
  TRY: [5, 10, 20, 50, 100, 200],
  INR: [10, 20, 50, 100, 200, 500],
  EGP: [5, 10, 20, 50, 100, 200],
};

const FALLBACK = [1, 5, 10, 20, 50, 100];

export function denominationsFor(currency: string | null | undefined): number[] {
  return DENOMINATIONS[(currency || '').toUpperCase()] ?? FALLBACK;
}

/**
 * Amounts a guest is likely to hand over for `total`: the next round figure
 * at each note size, above the exact amount. 18,750 IQD gives 19,000,
 * 20,000, 25,000 and 50,000.
 */
export function suggestedAmounts(total: number, denominations: number[], limit = 4): number[] {
  if (!(total > 0)) return [];
  const out = new Set<number>();
  for (const note of denominations) {
    const rounded = Math.ceil(total / note - 1e-9) * note;
    if (rounded > total + 1e-9) out.add(Number(rounded.toFixed(2)));
  }
  return [...out].sort((a, b) => a - b).slice(0, limit);
}

/** Sum of a note count, e.g. { 25000: 4, 1000: 12 } → 112,000. */
export function countTotal(counts: Record<number, number>): number {
  return Number(
    Object.entries(counts)
      .reduce((sum, [note, qty]) => sum + Number(note) * (qty || 0), 0)
      .toFixed(2),
  );
}
