import React, { useMemo } from 'react';
import { Minus, Plus } from 'lucide-react';
import { formatCurrency, getIntlLocale } from '@ury/core';
import { Button, Input } from '@ury/ui';
import { countTotal, denominationsFor } from '../lib/cash-denominations';
import { t } from '../i18n';

interface DenominationCounterProps {
  currency: string;
  counts: Record<number, number>;
  onChange: (counts: Record<number, number>, total: number) => void;
}

/**
 * Counting the drawer note by note at close: how many of each, and the
 * total goes into the closing amount. Largest notes first, as they come out
 * of the drawer.
 */
const DenominationCounter: React.FC<DenominationCounterProps> = ({ currency, counts, onChange }) => {
  const notes = useMemo(() => [...denominationsFor(currency)].sort((a, b) => b - a), [currency]);
  const compact = useMemo(() => new Intl.NumberFormat(getIntlLocale(), { maximumFractionDigits: 2 }), []);
  const total = countTotal(counts);

  const setCount = (note: number, qty: number) => {
    const next = { ...counts, [note]: Math.max(0, Math.floor(qty) || 0) };
    onChange(next, countTotal(next));
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {notes.map((note) => {
          const qty = counts[note] || 0;
          return (
            <div key={note} className="flex items-center gap-2">
              <span className="w-20 shrink-0 text-end text-sm font-semibold tabular-nums text-gray-900">
                {compact.format(note)}
              </span>
              <span className="text-gray-400">×</span>
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                aria-label={t('pos_closing.note_less', { note: compact.format(note) })}
                disabled={qty === 0}
                onClick={() => setCount(note, qty - 1)}
              >
                <Minus className="h-3.5 w-3.5" />
              </Button>
              <Input
                type="number"
                inputMode="numeric"
                min="0"
                step="1"
                value={qty ? String(qty) : ''}
                placeholder="0"
                onChange={(e) => setCount(note, Number(e.target.value))}
                className="w-16 text-center tabular-nums"
                size="sm"
                aria-label={t('pos_closing.note_count', { note: compact.format(note) })}
              />
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                aria-label={t('pos_closing.note_more', { note: compact.format(note) })}
                onClick={() => setCount(note, qty + 1)}
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
              <span className="ms-auto text-sm tabular-nums text-gray-600">{qty ? formatCurrency(note * qty) : '—'}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-gray-100 pt-2">
        <Button type="button" variant="ghost" size="xs" disabled={total === 0} onClick={() => onChange({}, 0)}>
          {t('pos_closing.clear_count')}
        </Button>
        <span className="text-sm font-semibold text-gray-900">
          {t('pos_closing.counted_total')}: <span className="tabular-nums">{formatCurrency(total)}</span>
        </span>
      </div>
    </div>
  );
};

export default DenominationCounter;
