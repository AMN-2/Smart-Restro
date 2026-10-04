/**
 * Order names the way staff count them: "T2" before "T10", "1, 2, 3"
 * rather than "1, 10, 2". A plain `localeCompare` compares digit by digit,
 * which is what put table 10 between tables 1 and 2 on every floor list.
 */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function compareNatural(a: string | null | undefined, b: string | null | undefined): number {
  return collator.compare(a ?? '', b ?? '');
}

/** A copy of `rows` ordered naturally by `key` (a table's `name` by default). */
export function sortByNaturalName<T extends { name: string }>(rows: readonly T[]): T[];
export function sortByNaturalName<T>(rows: readonly T[], key: (row: T) => string | null | undefined): T[];
export function sortByNaturalName<T>(
  rows: readonly T[],
  key: (row: T) => string | null | undefined = (row) => (row as { name?: string }).name
): T[] {
  return [...rows].sort((a, b) => compareNatural(key(a), key(b)));
}
