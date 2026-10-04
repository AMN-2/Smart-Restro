import { describe, expect, it } from 'vitest';
import { compareNatural, sortByNaturalName } from './naturalSort';

describe('natural table order', () => {
  it('counts numbers instead of comparing digits', () => {
    const names = ['10', '2', '1', '3', '4'];
    expect([...names].sort(compareNatural)).toEqual(['1', '2', '3', '4', '10']);
  });

  it('orders prefixed names and ignores case', () => {
    const rows = ['T10', 't2', 'T1', 'Table 11', 'Table 9'].map((name) => ({ name }));
    expect(sortByNaturalName(rows).map((r) => r.name)).toEqual(['T1', 't2', 'T10', 'Table 9', 'Table 11']);
  });

  it('does not mutate its input and accepts a key', () => {
    const rows = [{ room: 'B' }, { room: 'A' }];
    expect(sortByNaturalName(rows, (r) => r.room).map((r) => r.room)).toEqual(['A', 'B']);
    expect(rows[0].room).toBe('B');
  });
});
