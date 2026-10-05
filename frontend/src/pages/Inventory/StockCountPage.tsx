import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, ClipboardList, Search, Send, X } from 'lucide-react';
import { formatCurrency, getIntlLocale, parseFrappeError } from '@ury/core';
import { Badge, Button, Card, EmptyState, ErrorState, Input, Select, SelectItem, Spinner, Textarea, showToast } from '@ury/ui';
import { useBranchContext } from '../../context/BranchContext';
import { ConfirmDialog } from '../../components/common/ConfirmDialog';
import {
  stockApprovalService,
  stockCountService,
  type ApprovalSetup,
  type CountRequest,
  type CountSheet,
} from '../../services/stockApprovals';
import { t } from '../../i18n';

/**
 * Counting a warehouse. Staff enter what is on the shelf against what the
 * system expects (posted stock, less the drafts still waiting); only the
 * differences are sent, as a correction a manager has to approve before
 * any figure changes.
 */

type Tab = 'count' | 'requests';

const diffClass = (diff: number) =>
  Math.abs(diff) < 1e-6 ? 'text-gray-400' : diff < 0 ? 'text-red-600' : 'text-emerald-700';

export const StockCountPage: React.FC = () => {
  const { activeBranchId } = useBranchContext();
  const [tab, setTab] = useState<Tab>('count');
  const [setup, setSetup] = useState<ApprovalSetup | null>(null);
  const [requests, setRequests] = useState<CountRequest[]>([]);
  const [canApprove, setCanApprove] = useState(false);

  const locale = getIntlLocale();
  const qty = useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }), [locale]);

  const loadRequests = useCallback(async () => {
    try {
      const res = await stockCountService.list(activeBranchId);
      setRequests(res.counts);
      setCanApprove(res.can_approve);
    } catch {
      setRequests([]);
    }
  }, [activeBranchId]);

  useEffect(() => {
    stockApprovalService.setup(activeBranchId).then(setSetup).catch(() => setSetup(null));
    void loadRequests();
  }, [activeBranchId, loadRequests]);

  return (
    <div className="mx-auto max-w-7xl space-y-5 pb-24">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{t('dash.stock_count.title')}</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-500">{t('dash.stock_count.subtitle')}</p>
      </div>

      <div className="flex items-center gap-1 border-b border-gray-200">
        {(['count', 'requests'] as Tab[]).map((v) => (
          <Button
            key={v}
            variant="ghost"
            aria-pressed={tab === v}
            onClick={() => setTab(v)}
            className={`-mb-px gap-2 rounded-none border-b-2 px-4 text-sm font-semibold hover:bg-transparent ${
              tab === v ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            {t(`dash.stock_count.tab_${v}`)}
            {v === 'requests' && requests.length > 0 && <Badge variant="pending">{requests.length}</Badge>}
          </Button>
        ))}
      </div>

      {tab === 'count' ? (
        setup ? (
          <CountSheetView
            setup={setup}
            qty={qty}
            onSubmitted={() => {
              void loadRequests();
              setTab('requests');
            }}
          />
        ) : (
          <div className="flex justify-center py-16"><Spinner className="h-8 w-8 text-primary" /></div>
        )
      ) : (
        <RequestsView requests={requests} canApprove={canApprove} qty={qty} setup={setup} onChanged={() => void loadRequests()} />
      )}
    </div>
  );
};

// --------------------------------------------------------------------------- sheet

const CountSheetView: React.FC<{ setup: ApprovalSetup; qty: Intl.NumberFormat; onSubmitted: () => void }> = ({
  setup,
  qty,
  onSubmitted,
}) => {
  const [warehouse, setWarehouse] = useState(setup.default_to || setup.default_from || '');
  const [rawOnly, setRawOnly] = useState(true);
  const [sheet, setSheet] = useState<CountSheet | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [group, setGroup] = useState('');
  const [onlyDiff, setOnlyDiff] = useState(false);
  const [remarks, setRemarks] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    if (!warehouse) return;
    setLoading(true);
    setError('');
    try {
      setSheet(await stockCountService.sheet(warehouse, rawOnly));
      setCounts({});
    } catch (err) {
      setError(parseFrappeError(err, t('dash.stock_count.load_failed')));
    } finally {
      setLoading(false);
    }
  }, [warehouse, rawOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (sheet?.rows ?? []).filter((r) => {
      if (group && r.item_group !== group) return false;
      if (needle && !`${r.item_name} ${r.item_code}`.toLowerCase().includes(needle)) return false;
      if (onlyDiff) {
        const v = counts[r.item_code];
        return v !== undefined && v !== '' && Math.abs(Number(v) - r.expected_qty) > 1e-6;
      }
      return true;
    });
  }, [sheet, search, group, onlyDiff, counts]);

  const entered = (sheet?.rows ?? []).filter((r) => counts[r.item_code] !== undefined && counts[r.item_code] !== '');
  const differences = entered.filter((r) => Math.abs(Number(counts[r.item_code]) - r.expected_qty) > 1e-6);
  const valueDiff = differences.reduce((sum, r) => sum + (Number(counts[r.item_code]) - r.expected_qty) * r.valuation_rate, 0);

  const send = async () => {
    setConfirming(false);
    setSending(true);
    try {
      const res = await stockCountService.submit(
        warehouse,
        entered.map((r) => ({ item_code: r.item_code, counted_qty: Number(counts[r.item_code]) })),
        remarks.trim() || undefined,
      );
      if (res.name) {
        showToast.success(t('dash.stock_count.sent', { count: res.differences }));
        onSubmitted();
      } else {
        showToast.success(t('dash.stock_count.no_differences'));
      }
      setCounts({});
      setRemarks('');
      void load();
    } catch (err) {
      showToast.error(parseFrappeError(err, t('dash.stock_count.send_failed')));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="flex flex-wrap items-end gap-3 border border-gray-200 p-4">
        <div className="w-full sm:w-64">
          <label className="mb-1 block text-xs font-semibold text-gray-600">{t('dash.stock_approvals.warehouse')}</label>
          <Select value={warehouse} onValueChange={setWarehouse} placeholder="—">
            {setup.warehouses.map((w) => (
              <SelectItem key={w.name} value={w.name}>{w.label}</SelectItem>
            ))}
          </Select>
        </div>
        {sheet && sheet.item_groups.length > 1 && (
          <div className="w-full sm:w-48">
            <label className="mb-1 block text-xs font-semibold text-gray-600">{t('dash.stock_count.group')}</label>
            <Select value={group} onValueChange={setGroup}>
              <SelectItem value="">{t('dash.stock_approvals.kind_filter_all')}</SelectItem>
              {sheet.item_groups.map((g) => (
                <SelectItem key={g} value={g}>{g}</SelectItem>
              ))}
            </Select>
          </div>
        )}
        <div className="relative min-w-[200px] flex-1">
          <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('dash.stock_approvals.search_material')} className="h-10 ps-9" />
        </div>
        <label className="flex h-10 items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" className="h-4 w-4 accent-primary" checked={rawOnly} onChange={(e) => setRawOnly(e.target.checked)} />
          {t('dash.stock_count.raw_only')}
        </label>
        <label className="flex h-10 items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" className="h-4 w-4 accent-primary" checked={onlyDiff} onChange={(e) => setOnlyDiff(e.target.checked)} />
          {t('dash.stock_count.only_differences')}
        </label>
      </Card>

      {sheet?.open_count && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {t('dash.stock_count.open_count', { name: sheet.open_count })}
        </div>
      )}

      {error ? (
        <ErrorState className="py-12" title={t('dash.stock_count.load_failed')} description={error} retryLabel={t('common.retry')} onRetry={() => void load()} />
      ) : loading || !sheet ? (
        <div className="flex justify-center py-16"><Spinner className="h-8 w-8 text-primary" /></div>
      ) : rows.length === 0 ? (
        <EmptyState className="py-16" illustration="inventory" title={t('dash.stock_count.empty')} />
      ) : (
        <Card className="overflow-x-auto border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="px-4 py-2 text-start font-semibold">{t('dash.stock_approvals.material')}</th>
                <th className="px-4 py-2 text-end font-semibold">{t('dash.stock_count.system')}</th>
                <th className="px-4 py-2 text-end font-semibold">{t('dash.stock_count.pending')}</th>
                <th className="px-4 py-2 text-end font-semibold">{t('dash.stock_count.expected')}</th>
                <th className="px-4 py-2 text-center font-semibold">{t('dash.stock_count.counted')}</th>
                <th className="px-4 py-2 text-end font-semibold">{t('dash.stock_count.difference')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r) => {
                const value = counts[r.item_code] ?? '';
                const diff = value === '' ? 0 : Number(value) - r.expected_qty;
                return (
                  <tr key={r.item_code} className={value !== '' && Math.abs(diff) > 1e-6 ? 'bg-amber-50/50' : undefined}>
                    <td className="px-4 py-2">
                      <div className="font-medium text-gray-900">{r.item_name}</div>
                      <div className="text-xs text-gray-400">{r.item_group} · {r.stock_uom}</div>
                    </td>
                    <td className="px-4 py-2 text-end tabular-nums text-gray-600">{qty.format(r.system_qty)}</td>
                    <td className="px-4 py-2 text-end tabular-nums text-amber-700">{r.pending_qty ? qty.format(r.pending_qty) : '—'}</td>
                    <td className="px-4 py-2 text-end font-semibold tabular-nums text-gray-900">{qty.format(r.expected_qty)}</td>
                    <td className="px-4 py-2">
                      <Input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="any"
                        value={value}
                        placeholder="—"
                        onChange={(e) => setCounts((prev) => ({ ...prev, [r.item_code]: e.target.value }))}
                        className="mx-auto h-9 w-28 text-center tabular-nums"
                        aria-label={t('dash.stock_count.counted_for', { item: r.item_name })}
                      />
                    </td>
                    <td className={`px-4 py-2 text-end font-semibold tabular-nums ${diffClass(diff)}`}>
                      {value === '' ? '—' : `${diff > 0 ? '+' : ''}${qty.format(diff)}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {entered.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-gray-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3">
            <span className="text-sm text-gray-700">
              {t('dash.stock_count.summary', { entered: entered.length, differences: differences.length })}
              {differences.length > 0 && (
                <span className={`ms-2 font-semibold tabular-nums ${valueDiff < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
                  {formatCurrency(valueDiff)}
                </span>
              )}
            </span>
            <Input
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder={t('dash.stock_approvals.remarks')}
              className="h-9 min-w-[180px] flex-1"
            />
            <Button
              className="gap-2 bg-primary text-white"
              disabled={!!sheet?.open_count}
              loading={sending}
              onClick={() => setConfirming(true)}
            >
              <Send className="h-4 w-4" />
              {t('dash.stock_count.send')}
            </Button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirming}
        title={t('dash.stock_count.confirm_title')}
        description={t('dash.stock_count.confirm_body', { count: differences.length })}
        confirmLabel={t('dash.stock_count.send')}
        onClose={() => setConfirming(false)}
        onConfirm={() => void send()}
      />
    </div>
  );
};

// --------------------------------------------------------------------------- requests

const RequestsView: React.FC<{
  requests: CountRequest[];
  canApprove: boolean;
  qty: Intl.NumberFormat;
  setup: ApprovalSetup | null;
  onChanged: () => void;
}> = ({ requests, canApprove, qty, setup, onChanged }) => {
  const [busy, setBusy] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<CountRequest | null>(null);
  const [reason, setReason] = useState('');
  const whLabel = (name?: string | null) => (name && setup?.warehouses.find((w) => w.name === name)?.label) || name || '—';

  const approve = async (c: CountRequest) => {
    setBusy(c.name);
    try {
      await stockCountService.approve(c.name);
      showToast.success(t('dash.stock_count.approved', { name: c.name }));
      onChanged();
    } catch (err) {
      showToast.error(parseFrappeError(err, t('dash.stock_approvals.approve_failed')));
    } finally {
      setBusy(null);
    }
  };

  const reject = async () => {
    if (!rejecting) return;
    const c = rejecting;
    setBusy(c.name);
    try {
      await stockCountService.reject(c.name, reason.trim() || undefined);
      showToast.success(t('dash.stock_count.rejected', { name: c.name }));
      setRejecting(null);
      setReason('');
      onChanged();
    } catch (err) {
      showToast.error(parseFrappeError(err, t('dash.stock_count.reject_failed')));
    } finally {
      setBusy(null);
    }
  };

  if (requests.length === 0) {
    return <EmptyState className="py-16" illustration="inventory" title={t('dash.stock_count.no_requests')} />;
  }

  return (
    <div className="space-y-4">
      {!canApprove && (
        <p className="flex items-center gap-2 text-sm text-gray-500">
          <ClipboardList className="h-4 w-4" />
          {t('dash.stock_count.waiting_manager')}
        </p>
      )}
      {requests.map((c) => (
        <Card key={c.name} className="overflow-hidden border border-gray-200">
          <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 bg-gray-50/70 px-4 py-3">
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-gray-900">
                {whLabel(c.warehouse)} · <span className="font-normal text-gray-500">{c.posting_date} {c.posting_time}</span>
              </h2>
              <p className="text-xs text-gray-500">
                {t('dash.stock_approvals.created_by', { name: c.owner_name })} · {t('dash.stock_count.corrections', { count: c.rows.length })}
                {c.remarks && <> · {c.remarks}</>}
              </p>
            </div>
            <span className={`ms-auto text-sm font-semibold tabular-nums ${c.value_difference < 0 ? 'text-red-600' : 'text-emerald-700'}`}>
              {formatCurrency(c.value_difference)}
            </span>
            {canApprove && (
              <div className="flex gap-2">
                <Button size="sm" variant="outline" className="gap-1.5 text-red-600" disabled={busy !== null} onClick={() => setRejecting(c)}>
                  <X className="h-4 w-4" /> {t('dash.stock_count.reject')}
                </Button>
                <Button size="sm" className="gap-1.5 bg-primary text-white" loading={busy === c.name} disabled={busy !== null} onClick={() => void approve(c)}>
                  <Check className="h-4 w-4" /> {t('dash.stock_approvals.approve')}
                </Button>
              </div>
            )}
          </div>
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-500">
              <tr>
                <th className="px-4 py-2 text-start font-semibold">{t('dash.stock_approvals.material')}</th>
                <th className="px-4 py-2 text-end font-semibold">{t('dash.stock_count.expected_now')}</th>
                <th className="px-4 py-2 text-end font-semibold">{t('dash.stock_count.counted')}</th>
                <th className="px-4 py-2 text-end font-semibold">{t('dash.stock_count.difference')}</th>
                <th className="px-4 py-2 text-end font-semibold">{t('dash.stock_count.value')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {c.rows.map((r) => (
                <tr key={r.item_code}>
                  <td className="px-4 py-2">
                    {r.item_name} <span className="text-xs text-gray-400">{r.stock_uom}</span>
                  </td>
                  <td className="px-4 py-2 text-end tabular-nums text-gray-600">{qty.format(r.expected_qty)}</td>
                  <td className="px-4 py-2 text-end font-semibold tabular-nums">{qty.format(r.counted_qty)}</td>
                  <td className={`px-4 py-2 text-end font-semibold tabular-nums ${diffClass(r.difference)}`}>
                    {r.difference > 0 ? '+' : ''}{qty.format(r.difference)}
                  </td>
                  <td className={`px-4 py-2 text-end tabular-nums ${diffClass(r.difference)}`}>
                    {formatCurrency(r.difference * r.valuation_rate)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}

      <ConfirmDialog
        open={rejecting !== null}
        title={t('dash.stock_count.reject_title')}
        description={t('dash.stock_count.reject_body')}
        confirmLabel={t('dash.stock_count.reject')}
        tone="danger"
        busy={busy !== null}
        onClose={() => setRejecting(null)}
        onConfirm={() => void reject()}
      >
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('dash.stock_count.reject_reason')} rows={3} />
      </ConfirmDialog>
    </div>
  );
};
