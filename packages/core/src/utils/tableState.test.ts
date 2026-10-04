import { describe, expect, it } from 'vitest';
import { formatElapsed, minutesSince, tableVisualState } from './tableState';

const at = (h: number, m: number) => new Date(2026, 9, 4, h, m, 0);

describe('table state', () => {
  it('measures minutes since a time today', () => {
    expect(minutesSince('12:15:00', at(13, 20))).toBe(65);
    expect(minutesSince('12:15:30.123456', at(12, 16))).toBe(0);
  });

  it('wraps past midnight', () => {
    expect(minutesSince('23:50:00', at(0, 10))).toBe(20);
  });

  it('formats h:mm', () => {
    expect(formatElapsed(65)).toBe('1:05');
    expect(formatElapsed(null)).toBe('0:00');
  });

  it('classifies free, occupied and attention', () => {
    const now = at(13, 0);
    expect(tableVisualState({ occupied: 0 }, 30, now)).toBe('free');
    expect(tableVisualState({ occupied: 1, latest_invoice_time: '12:45:00' }, 30, now)).toBe('occupied');
    expect(tableVisualState({ occupied: 1, latest_invoice_time: '12:00:00' }, 30, now)).toBe('attention');
    expect(tableVisualState({ occupied: 1, latest_invoice_time: '09:00:00' }, 0, now)).toBe('occupied');
  });
});
