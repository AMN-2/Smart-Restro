import { describe, expect, it } from 'vitest';
import { countTotal, denominationsFor, suggestedAmounts } from './cash-denominations';

describe('cash denominations', () => {
  it('uses the notes of the profile currency, with a fallback', () => {
    expect(denominationsFor('IQD')).toContain(25000);
    expect(denominationsFor('iqd')).toContain(250);
    expect(denominationsFor('XYZ')).toEqual([1, 5, 10, 20, 50, 100]);
  });

  it('suggests the next round figures above the bill', () => {
    expect(suggestedAmounts(18750, denominationsFor('IQD'))).toEqual([19000, 20000, 25000, 50000]);
  });

  it('suggests nothing above an exact note, and nothing for an empty bill', () => {
    expect(suggestedAmounts(50000, denominationsFor('IQD'))).toEqual([]);
    expect(suggestedAmounts(0, denominationsFor('IQD'))).toEqual([]);
  });

  it('adds up a drawer count', () => {
    expect(countTotal({ 25000: 4, 10000: 7, 1000: 12, 250: 0 })).toBe(182000);
    expect(countTotal({ 0.25: 3, 1: 2 })).toBe(2.75);
  });
});
