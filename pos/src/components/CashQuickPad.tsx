import React, { useMemo, useState } from 'react';
import { Banknote, Eraser } from 'lucide-react';
import { formatCurrency, getIntlLocale } from '@ury/core';
import { Button } from '@ury/ui';
import { denominationsFor, suggestedAmounts } from '../lib/cash-denominations';
import { t } from '../i18n';

interface CashQuickPadProps {
  /** What is still due in cash once the other modes are counted. */
  due: number;
  value: string;
  onChange: (value: string) => void;
  currency: string;
  disabled?: boolean;
}

/**
 * Banknote shortcuts for the cash amount. The round figures fill in what the
 * guest hands over in one tap; the notes add up a handful of mixed notes.
 * The change due is shown by the payment dialog as before.
 */
const CashQuickPad: React.FC<CashQuickPadProps> = ({ due, value, onChange, currency, disabled }) => {
  const notes = useMemo(() => denominationsFor(currency), [currency]);
  const compact = useMemo(() => new Intl.NumberFormat(getIntlLocale(), { maximumFractionDigits: 2 }), []);
  const suggestions = useMemo(() => suggestedAmounts(due, notes), [due, notes]);
  // The first note replaces the auto-filled exact amount; the rest add to it.
  const [adding, setAdding] = useState(false);
  const current = parseFloat(value) || 0;

  const set = (amount: number) => {
    setAdding(false);
    onChange(String(amount));
  };
  const addNote = (note: number) => {
    const base = adding ? current : 0;
    setAdding(true);
    onChange(String(Number((base + note).toFixed(2))));
  };

  const chip = (active: boolean) =>
    `h-10 min-w-[4.5rem] flex-1 px-2 tabular-nums font-semibold ${active ? 'border-primary bg-primary/10 text-primary' : ''}`;

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50/60 p-3" aria-label={t('payment.cash_pad')}>
      <div className="flex flex-wrap gap-2">
        {due > 0 && (
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            className={chip(!adding && Math.abs(current - due) < 0.005)}
            onClick={() => set(due)}
          >
            {t('payment.exact_amount')}
          </Button>
        )}
        {suggestions.map((amount) => (
          <Button
            key={amount}
            type="button"
            variant="outline"
            disabled={disabled}
            className={chip(!adding && Math.abs(current - amount) < 0.005)}
            onClick={() => set(amount)}
          >
            {formatCurrency(amount)}
          </Button>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-xs font-medium text-gray-500">
        <Banknote className="h-3.5 w-3.5" />
        {t('payment.add_notes')}
      </div>
      <div className="mt-1.5 grid grid-cols-4 gap-1.5 sm:grid-cols-7">
        {notes.map((note) => (
          <Button
            key={note}
            type="button"
            variant="secondary"
            size="sm"
            disabled={disabled}
            className="h-10 px-1 tabular-nums font-semibold"
            onClick={() => addNote(note)}
            aria-label={t('payment.add_note', { amount: formatCurrency(note) })}
          >
            +{compact.format(note)}
          </Button>
        ))}
      </div>
      {adding && (
        <div className="mt-2 flex justify-end">
          <Button type="button" variant="ghost" size="xs" className="gap-1 text-gray-600" disabled={disabled} onClick={() => set(due)}>
            <Eraser className="h-3.5 w-3.5" />
            {t('payment.reset_cash')}
          </Button>
        </div>
      )}
    </div>
  );
};

export default CashQuickPad;
