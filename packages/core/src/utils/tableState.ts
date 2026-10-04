/**
 * How a table looks on every floor screen (cashier, captain, manager): one
 * place decides free / occupied / needs-attention, so a table is never green
 * on one screen and red on another.
 */
export type TableVisualState = 'free' | 'occupied' | 'attention';

export interface TableStateInput {
  occupied?: number | boolean | null;
  /** URY Table.latest_invoice_time — a Time field, "HH:MM:SS". */
  latest_invoice_time?: string | null;
}

const MINUTES_PER_DAY = 24 * 60;

/**
 * Minutes since `time` ("HH:MM[:SS]", today), or null when it cannot be read.
 * A time later than now is taken as yesterday, so an order opened at 23:50
 * reads as 20 minutes at 00:10 instead of a negative number.
 */
export function minutesSince(time: string | null | undefined, now: Date = new Date()): number | null {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec((time ?? '').trim().split(' ').pop() ?? '');
  if (!match) return null;
  const then = Number(match[1]) * 60 + Number(match[2]) + Number(match[3] ?? 0) / 60;
  const current = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  let diff = Math.floor(current - then);
  if (diff < 0) diff += MINUTES_PER_DAY;
  return diff;
}

/** `h:mm`, the way a floor reads a running clock. */
export function formatElapsed(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes) || minutes < 0) return '0:00';
  return `${Math.floor(minutes / 60)}:${String(Math.floor(minutes % 60)).padStart(2, '0')}`;
}

/**
 * Free, occupied, or occupied for longer than the POS profile's
 * "table attention time". A threshold of 0 or less turns attention off.
 */
export function tableVisualState(
  table: TableStateInput,
  attentionMinutes?: number | null,
  now: Date = new Date()
): TableVisualState {
  if (!(table.occupied === 1 || table.occupied === true)) return 'free';
  const limit = Number(attentionMinutes) || 0;
  if (limit > 0) {
    const elapsed = minutesSince(table.latest_invoice_time, now);
    if (elapsed != null && elapsed > limit) return 'attention';
  }
  return 'occupied';
}
