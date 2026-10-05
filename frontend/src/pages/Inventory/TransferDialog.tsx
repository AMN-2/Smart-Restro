import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeftRight, Plus, Search, Trash2 } from 'lucide-react';
import { getIntlLocale, parseFrappeError } from '@ury/core';
import { Button, Dialog, DialogContent, DialogHeader, DialogTitle, Field, Input, Select, SelectItem, Spinner, showToast } from '@ury/ui';
import { stockApprovalService, type ApprovalSetup, type Material } from '../../services/stockApprovals';
import { t } from '../../i18n';

/**
 * A raw-material transfer between two warehouses (main store to kitchen),
 * saved as a draft. Nothing moves until a manager approves it, so a typo
 * here never stops the kitchen and never needs a cancellation.
 */

interface Line {
  item_code: string;
  item_name: string;
  stock_uom: string;
  uoms: Material['uoms'];
  uom: string;
  qty: string;
  available_qty: number | null;
}

interface Props {
  open: boolean;
  setup: ApprovalSetup;
  onClose: () => void;
  onSaved: () => void;
}

export const TransferDialog: React.FC<Props> = ({ open, setup, onClose, onSaved }) => {
  const [from, setFrom] = useState(setup.default_from || '');
  const [to, setTo] = useState(setup.default_to || '');
  const [date, setDate] = useState(setup.today);
  const [remarks, setRemarks] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<Material[]>([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const searchId = useRef(0);
  const qtyFormat = new Intl.NumberFormat(getIntlLocale(), { maximumFractionDigits: 3 });

  useEffect(() => {
    if (!open) return;
    setFrom(setup.default_from || '');
    setTo(setup.default_to || '');
    setDate(setup.today);
    setRemarks('');
    setLines([]);
    setTerm('');
    setError('');
  }, [open, setup]);

  useEffect(() => {
    if (!open) return;
    const id = ++searchId.current;
    setSearching(true);
    const timer = window.setTimeout(() => {
      stockApprovalService
        .searchMaterials(term.trim(), from || undefined)
        .then((rows) => id === searchId.current && setResults(rows))
        .catch(() => id === searchId.current && setResults([]))
        .finally(() => id === searchId.current && setSearching(false));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [term, from, open]);

  const add = (m: Material) => {
    setLines((prev) =>
      prev.some((l) => l.item_code === m.item_code)
        ? prev
        : [...prev, { ...m, uom: m.stock_uom, qty: '' }],
    );
    setTerm('');
  };

  const updateLine = (code: string, changes: Partial<Line>) =>
    setLines((prev) => prev.map((l) => (l.item_code === code ? { ...l, ...changes } : l)));

  const valid = from && to && from !== to && lines.length > 0 && lines.every((l) => Number(l.qty) > 0);

  const save = async () => {
    if (!valid) {
      setError(from && from === to ? t('dash.stock_approvals.same_warehouse') : t('dash.stock_approvals.form_incomplete'));
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await stockApprovalService.createTransfer({
        from_warehouse: from,
        to_warehouse: to,
        posting_date: date,
        remarks: remarks.trim() || undefined,
        items: lines.map((l) => ({ item_code: l.item_code, qty: Number(l.qty), uom: l.uom })),
      });
      showToast.success(t('dash.stock_approvals.transfer_saved', { name: res.name }));
      onSaved();
      onClose();
    } catch (err) {
      setError(parseFrappeError(err, t('dash.stock_approvals.transfer_failed')));
    } finally {
      setSaving(false);
    }
  };

  const label = (name: string) => setup.warehouses.find((w) => w.name === name)?.label || name;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && !saving && onClose()}>
      <DialogContent className="max-w-2xl bg-white p-6" onClose={saving ? undefined : onClose}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-bold text-gray-900">
            <ArrowLeftRight className="h-5 w-5 text-primary" />
            {t('dash.stock_approvals.new_transfer')}
          </DialogTitle>
        </DialogHeader>
        <p className="mt-1 text-sm text-gray-500">{t('dash.stock_approvals.transfer_hint')}</p>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label={t('dash.stock_approvals.from_warehouse')} required>
            <Select value={from} onValueChange={setFrom} placeholder="—">
              {setup.warehouses.map((w) => (
                <SelectItem key={w.name} value={w.name}>{w.label}</SelectItem>
              ))}
            </Select>
          </Field>
          <Field label={t('dash.stock_approvals.to_warehouse')} required>
            <Select value={to} onValueChange={setTo} placeholder="—">
              {setup.warehouses.filter((w) => w.name !== from).map((w) => (
                <SelectItem key={w.name} value={w.name}>{w.label}</SelectItem>
              ))}
            </Select>
          </Field>
          <Field label={t('dash.stock_approvals.date')}>
            <Input type="date" value={date} max={setup.today} onChange={(e) => setDate(e.target.value)} className="h-10" />
          </Field>
        </div>

        <div className="relative mt-4">
          <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder={t('dash.stock_approvals.search_material')}
            className="h-10 ps-9"
          />
        </div>
        <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-gray-100">
          {searching && results.length === 0 ? (
            <div className="flex justify-center p-3"><Spinner className="h-4 w-4" /></div>
          ) : results.length === 0 ? (
            <p className="p-3 text-center text-xs text-gray-500">{t('dash.stock_approvals.no_materials')}</p>
          ) : (
            results.map((m) => {
              const added = lines.some((l) => l.item_code === m.item_code);
              return (
                <Button
                  key={m.item_code}
                  variant="ghost"
                  disabled={added}
                  onClick={() => add(m)}
                  className="flex h-auto w-full justify-between gap-2 rounded-none px-3 py-2 text-start text-sm font-normal"
                >
                  <span className="min-w-0 truncate">
                    <span className="font-medium text-gray-900">{m.item_name}</span>
                    <span className="ms-2 text-xs text-gray-400">{m.item_group}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-gray-500 tabular-nums">
                    {m.available_qty !== null && (
                      <span className={m.available_qty > 0 ? '' : 'text-red-600'}>
                        {qtyFormat.format(m.available_qty)} {m.stock_uom}
                      </span>
                    )}
                    <Plus className="h-4 w-4 text-primary" />
                  </span>
                </Button>
              );
            })
          )}
        </div>

        {lines.length > 0 && (
          <div className="mt-4 overflow-x-auto rounded-lg border border-gray-200">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500">
                <tr>
                  <th className="px-3 py-2 text-start font-semibold">{t('dash.stock_approvals.material')}</th>
                  <th className="px-3 py-2 text-start font-semibold">{t('dash.stock_approvals.qty')}</th>
                  <th className="px-3 py-2 text-start font-semibold">{t('dash.stock_approvals.unit')}</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.item_code} className="border-t border-gray-100">
                    <td className="px-3 py-2">
                      <div className="font-medium text-gray-900">{l.item_name}</div>
                      {l.available_qty !== null && (
                        <div className="text-xs text-gray-500">
                          {t('dash.stock_approvals.available_in', {
                            qty: qtyFormat.format(l.available_qty),
                            uom: l.stock_uom,
                            warehouse: label(from),
                          })}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="any"
                        value={l.qty}
                        onChange={(e) => updateLine(l.item_code, { qty: e.target.value })}
                        className="h-9 w-28 tabular-nums"
                        aria-label={t('dash.stock_approvals.qty')}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <div className="w-28">
                        <Select
                          value={l.uom}
                          onValueChange={(uom) => updateLine(l.item_code, { uom })}
                          aria-label={t('dash.stock_approvals.unit')}
                        >
                          {l.uoms.map((u) => (
                            <SelectItem key={u.uom} value={u.uom}>{u.uom}</SelectItem>
                          ))}
                        </Select>
                      </div>
                    </td>
                    <td className="px-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={t('dash.stock_approvals.delete')}
                        onClick={() => setLines((prev) => prev.filter((x) => x.item_code !== l.item_code))}
                      >
                        <Trash2 className="h-4 w-4 text-red-500" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Input
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          placeholder={t('dash.stock_approvals.remarks')}
          className="mt-3 h-10"
        />

        {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose} disabled={saving}>
            {t('dash.purchases.cancel_action')}
          </Button>
          <Button size="sm" className="bg-primary text-white" onClick={() => void save()} loading={saving}>
            {t('dash.stock_approvals.save_draft')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
