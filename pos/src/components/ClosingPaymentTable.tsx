import React, { useState } from 'react';
import { Calculator } from 'lucide-react';
import { ClosingPaymentSummary } from '../lib/pos-closing-api';
import { Button, Input } from '@ury/ui';
import { usePOSStore } from '../store/pos-store';
import { useCashModes } from '../hooks/useCashModes';
import DenominationCounter from './DenominationCounter';
import { formatCurrency } from '@ury/core';
import { cn } from '@ury/ui';
import { t } from '../i18n';

interface ClosingPaymentTableProps {
  rows: ClosingPaymentSummary[];
  /** Modes the cashier has explicitly entered a closing amount for (see Fix 2). */
  touchedModes: Set<string>;
  onChange: (modeOfPayment: string, closingAmount: number) => void;
}

const ClosingPaymentTable: React.FC<ClosingPaymentTableProps> = ({
  rows,
  touchedModes,
  onChange,
}) => {
  const currency = usePOSStore((state) => state.posProfile?.currency || state.currency);
  const cashModes = useCashModes();
  // Note counts per cash mode, kept while the dialog is open so closing and
  // reopening the counter does not lose a half-counted drawer.
  const [counts, setCounts] = useState<Record<string, Record<number, number>>>({});
  const [counting, setCounting] = useState<string | null>(null);

  const handleClosingAmountChange = (modeOfPayment: string, value: string) => {
    const parsed = parseFloat(value);
    // Clamp to non-negative in JS -- the HTML `min="0"` attribute alone does
    // not stop programmatic or pasted negative input.
    const closingAmount = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
    onChange(modeOfPayment, closingAmount);
  };

  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-gray-300 bg-gray-50">
            <th className="text-start py-3 px-4 font-semibold text-gray-900">{t('pos.opening.payment_mode')}</th>
            <th className="text-end py-3 px-4 font-semibold text-gray-900">{t('pos_closing.col_opening')}</th>
            <th className="text-end py-3 px-4 font-semibold text-gray-900">
              <span
                title={t('pos_closing.help_expected')}
                className="inline-flex items-center gap-1 cursor-help"
              >{t('pos_closing.col_expected')}<span
                  aria-hidden="true"
                  className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-gray-400 text-[10px] leading-none text-gray-500"
                >
                  i
                </span>
              </span>
            </th>
            <th className="text-center py-3 px-4 font-semibold text-gray-900">
              <span
                title={t('pos_closing.help_closing')}
                className="inline-flex items-center gap-1 cursor-help"
              >{t('pos_closing.col_closing')}<span
                  aria-hidden="true"
                  className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-gray-400 text-[10px] leading-none text-gray-500"
                >
                  i
                </span>
              </span>
            </th>
            <th className="text-end py-3 px-4 font-semibold text-gray-900">
              <span
                title={t('pos_closing.help_difference')}
                className="inline-flex items-center gap-1 cursor-help"
              >{t('pos_closing.col_difference')}<span
                  aria-hidden="true"
                  className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-gray-400 text-[10px] leading-none text-gray-500"
                >
                  i
                </span>
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            // Positive = overage (cashier has more than expected), negative
            // = shortage. Must match the sign convention used in the submit
            // payload built by POSClosingDialog.handleSubmit.
            const difference = row.closing_amount - row.expected_amount;
            const hasDifference = Math.abs(difference) > 0.001;
            const isTouched = touchedModes.has(row.mode_of_payment);

            const isCash = cashModes.has(row.mode_of_payment);
            const isCounting = counting === row.mode_of_payment;

            return (
              <React.Fragment key={row.mode_of_payment}>
              <tr
                className={cn(
                  'border-b border-gray-200 hover:bg-gray-50 transition-colors',
                  !isTouched && 'bg-amber-50/60'
                )}
              >
                <td className="py-3 px-4 text-gray-900 font-medium">
                  {row.mode_of_payment}
                </td>
                <td className="py-3 px-4 text-end text-gray-700">
                  {formatCurrency(row.opening_amount)}
                </td>
                <td className="py-3 px-4 text-end text-gray-700">
                  {formatCurrency(row.expected_amount)}
                </td>
                <td className="py-3 px-4">
                  <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={row.closing_amount > 0 ? String(row.closing_amount) : ''}
                    onChange={(e) =>
                      handleClosingAmountChange(row.mode_of_payment, e.target.value)
                    }
                    placeholder="0.00"
                    className={cn('w-full text-center', !isTouched && 'border-amber-400')}
                    size="sm"
                  />
                  {isCash && (
                    <Button
                      type="button"
                      variant={isCounting ? 'default' : 'outline'}
                      size="icon-sm"
                      className="shrink-0"
                      aria-expanded={isCounting}
                      aria-label={t('pos_closing.count_notes')}
                      title={t('pos_closing.count_notes')}
                      onClick={() => setCounting(isCounting ? null : row.mode_of_payment)}
                    >
                      <Calculator className="h-4 w-4" />
                    </Button>
                  )}
                  </div>
                </td>
                <td
                  className={cn(
                    'py-3 px-4 text-end font-medium',
                    hasDifference ? 'text-red-600' : 'text-green-600'
                  )}
                >
                  {formatCurrency(difference)}
                </td>
              </tr>
              {isCash && isCounting && (
                <tr className="border-b border-gray-200 bg-gray-50">
                  <td colSpan={5} className="px-4 py-3">
                    <DenominationCounter
                      currency={currency}
                      counts={counts[row.mode_of_payment] || {}}
                      onChange={(next, total) => {
                        setCounts((prev) => ({ ...prev, [row.mode_of_payment]: next }));
                        onChange(row.mode_of_payment, total);
                      }}
                    />
                  </td>
                </tr>
              )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default ClosingPaymentTable;
