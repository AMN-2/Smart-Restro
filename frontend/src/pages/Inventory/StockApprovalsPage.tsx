import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeftRight,
  CheckCheck,
  ChevronDown,
  ClipboardCheck,
  ExternalLink,
  FilePen,
  Info,
  Plus,
  Receipt,
  Trash2,
} from 'lucide-react';
import { formatCurrency, getIntlLocale, parseFrappeError } from '@ury/core';
import { Badge, Button, Card, EmptyState, ErrorState, Input, Spinner, StatCard, showToast } from '@ury/ui';
import { useNavigate } from 'react-router-dom';
import { useBranchContext } from '../../context/BranchContext';
import { ConfirmDialog } from '../../components/common/ConfirmDialog';
import {
  APPROVE_BATCH,
  stockApprovalService,
  stockCountService,
  type ApprovalSetup,
  type DraftEntry,
  type DraftKind,
  type DraftList,
} from '../../services/stockApprovals';
import { TransferDialog } from './TransferDialog';
import { t } from '../../i18n';

/**
 * The day's raw-material movements, held as drafts so the floor never waits
 * on stock: sale deductions from recipes, and transfers between warehouses.
 * When the manager is free they are reviewed here day by day — with any
 * shortage that would stop them posting — and approved in one go.
 */

type Preset = 'today' | 'week' | 'month' | 'custom';
type KindFilter = 'all' | 'consumption' | 'transfer';
type View = 'entries' | 'materials';

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function presetRange(preset: Preset): [string, string] {
  const today = new Date();
  const from = new Date(today);
  if (preset === 'week') from.setDate(today.getDate() - 6);
  if (preset === 'month') from.setDate(today.getDate() - 29);
  return [iso(from), iso(today)];
}

const KIND_STYLE: Record<DraftKind, { badge: 'info' | 'pending' | 'secondary'; icon: React.ElementType }> = {
  consumption: { badge: 'pending', icon: Receipt },
  transfer: { badge: 'info', icon: ArrowLeftRight },
  issue: { badge: 'secondary', icon: FilePen },
};

const chip = (active: boolean) =>
  `h-8 rounded-full px-3 text-xs font-semibold ${
    active ? 'border-primary bg-primary text-white hover:bg-primary/90 hover:text-white' : 'text-gray-700'
  }`;

export const StockApprovalsPage: React.FC = () => {
  const { activeBranchId } = useBranchContext();
  const [preset, setPreset] = useState<Preset>('week');
  const [custom, setCustom] = useState<[string, string]>(() => presetRange('week'));
  const [fromDate, toDate] = preset === 'custom' ? custom : presetRange(preset);
  const [kind, setKind] = useState<KindFilter>('all');
  const [view, setView] = useState<View>('entries');

  const [setup, setSetup] = useState<ApprovalSetup | null>(null);
  const [data, setData] = useState<DraftList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [failures, setFailures] = useState<Record<string, string>>({});
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [confirm, setConfirm] = useState<{ action: 'approve' | 'delete'; names: string[] } | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const requestId = useRef(0);
  const navigate = useNavigate();
  const [countRequests, setCountRequests] = useState(0);

  useEffect(() => {
    let cancelled = false;
    stockCountService
      .list(activeBranchId)
      .then((res) => !cancelled && setCountRequests(res.can_approve ? res.counts.length : 0))
      .catch(() => !cancelled && setCountRequests(0));
    return () => {
      cancelled = true;
    };
  }, [activeBranchId]);

  const locale = getIntlLocale();
  const qtyFormat = useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }), [locale]);
  const dayFormat = useMemo(
    () => new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long' }),
    [locale],
  );

  useEffect(() => {
    let cancelled = false;
    stockApprovalService
      .setup(activeBranchId)
      .then((res) => !cancelled && setSetup(res))
      .catch(() => !cancelled && setSetup(null));
    return () => {
      cancelled = true;
    };
  }, [activeBranchId]);

  const load = useCallback(async () => {
    const current = ++requestId.current;
    setLoading(true);
    setError('');
    try {
      const res = await stockApprovalService.drafts(activeBranchId, fromDate, toDate);
      if (current !== requestId.current) return;
      setData(res);
      // Selection survives a reload only for drafts that are still waiting.
      const still = new Set(res.entries.map((e) => e.name));
      setSelected((prev) => new Set([...prev].filter((n) => still.has(n))));
    } catch (err) {
      if (current === requestId.current) setError(parseFrappeError(err, t('dash.stock_approvals.load_failed')));
    } finally {
      if (current === requestId.current) setLoading(false);
    }
  }, [activeBranchId, fromDate, toDate]);

  useEffect(() => {
    void load();
  }, [load]);

  const entries = useMemo(
    () => (data?.entries ?? []).filter((e) => kind === 'all' || (kind === 'transfer' ? e.kind !== 'consumption' : e.kind === 'consumption')),
    [data, kind],
  );

  // Newest day first: today's drafts are the ones being asked about.
  const days = useMemo(() => {
    const map = new Map<string, DraftEntry[]>();
    for (const e of entries) {
      const list = map.get(e.posting_date);
      if (list) list.push(e);
      else map.set(e.posting_date, [e]);
    }
    return [...map.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([date, list]) => ({
        date,
        entries: list,
        value: list.reduce((sum, e) => sum + e.value, 0),
        consumption: list.filter((e) => e.kind === 'consumption').length,
        transfers: list.filter((e) => e.kind !== 'consumption').length,
        short: list.filter((e) => e.short_items.length > 0).length,
      }));
  }, [entries]);

  const totals = useMemo(() => {
    const all = data?.entries ?? [];
    return {
      count: all.length,
      value: all.reduce((sum, e) => sum + e.value, 0),
      consumption: all.filter((e) => e.kind === 'consumption').length,
      transfers: all.filter((e) => e.kind !== 'consumption').length,
      short: all.filter((e) => e.short_items.length > 0).length,
    };
  }, [data]);

  const canApprove = !!setup?.permissions.approve;
  const canDelete = !!setup?.permissions.delete;
  const busy = progress !== null;
  const byName = useMemo(() => new Map((data?.entries ?? []).map((e) => [e.name, e])), [data]);
  const selectedNames = [...selected];
  const deletable = selectedNames.filter((n) => byName.get(n)?.kind !== 'consumption');

  const toggle = (set: Set<string>, name: string) => {
    const next = new Set(set);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    return next;
  };
  const toggleDay = (names: string[]) =>
    setSelected((prev) => {
      const all = names.every((n) => prev.has(n));
      const next = new Set(prev);
      names.forEach((n) => (all ? next.delete(n) : next.add(n)));
      return next;
    });

  const runApprove = async (names: string[]) => {
    setConfirm(null);
    setProgress({ done: 0, total: names.length });
    const failed: Record<string, string> = {};
    let approved = 0;
    try {
      for (let i = 0; i < names.length; i += APPROVE_BATCH) {
        const res = await stockApprovalService.approve(names.slice(i, i + APPROVE_BATCH));
        approved += res.approved;
        res.results.forEach((r) => {
          if (!r.ok) failed[r.name] = r.error || t('dash.stock_approvals.approve_failed');
        });
        setProgress({ done: Math.min(i + APPROVE_BATCH, names.length), total: names.length });
      }
    } catch (err) {
      showToast.error(parseFrappeError(err, t('dash.stock_approvals.approve_failed')));
    } finally {
      setProgress(null);
      setFailures((prev) => {
        const next = { ...prev };
        names.forEach((n) => delete next[n]);
        return { ...next, ...failed };
      });
      const failedCount = Object.keys(failed).length;
      if (approved) showToast.success(t('dash.stock_approvals.approved_count', { count: approved }));
      if (failedCount) {
        showToast.error(t('dash.stock_approvals.failed_count', { count: failedCount }));
        // The failed ones stay selected and open, with the reason beside them.
        setSelected(new Set(Object.keys(failed)));
        setExpanded((prev) => new Set([...prev, ...Object.keys(failed)]));
      } else {
        setSelected(new Set());
      }
      void load();
    }
  };

  const runDelete = async (names: string[]) => {
    setConfirm(null);
    setProgress({ done: 0, total: names.length });
    try {
      const res = await stockApprovalService.remove(names);
      if (res.deleted.length) showToast.success(t('dash.stock_approvals.deleted_count', { count: res.deleted.length }));
      setSelected(new Set());
    } catch (err) {
      showToast.error(parseFrappeError(err, t('dash.stock_approvals.delete_failed')));
    } finally {
      setProgress(null);
      void load();
    }
  };

  const whLabel = (name?: string | null) =>
    (name && setup?.warehouses.find((w) => w.name === name)?.label) || name || '—';

  if (error && !data) {
    return (
      <ErrorState
        className="py-24"
        title={t('dash.stock_approvals.load_failed')}
        description={error}
        retryLabel={t('common.retry')}
        onRetry={() => void load()}
      />
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5 pb-24">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{t('dash.stock_approvals.title')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-gray-500">{t('dash.stock_approvals.subtitle')}</p>
        </div>
        {setup?.permissions.create && (
          <Button className="gap-2 bg-primary text-white" onClick={() => setTransferOpen(true)}>
            <Plus className="h-4 w-4" /> {t('dash.stock_approvals.new_transfer')}
          </Button>
        )}
      </div>

      {countRequests > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm text-violet-900">
          <span className="flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4 shrink-0" />
            {t('dash.stock_count.requests_banner', { count: countRequests })}
          </span>
          <Button variant="outline" size="sm" onClick={() => navigate('/stock-count')}>
            {t('dash.stock_count.review')}
          </Button>
        </div>
      )}

      {data && !data.approval_on && (
        <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
          <Info className="mt-0.5 h-4 w-4 shrink-0" />
          {t('dash.stock_approvals.feature_off')}
        </div>
      )}

      {/* Period and kind */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {(['today', 'week', 'month', 'custom'] as Preset[]).map((p) => (
            <Button key={p} variant="outline" size="xs" aria-pressed={preset === p} className={chip(preset === p)} onClick={() => setPreset(p)}>
              {t(`dash.stock_approvals.range_${p}`)}
            </Button>
          ))}
          {preset === 'custom' && (
            <div className="flex items-center gap-1.5">
              <Input type="date" value={custom[0]} max={custom[1]} onChange={(e) => setCustom([e.target.value, custom[1]])} className="h-9 w-40 text-xs" aria-label={t('dash.transactions.from')} />
              <span className="text-xs text-gray-400">—</span>
              <Input type="date" value={custom[1]} min={custom[0]} onChange={(e) => setCustom([custom[0], e.target.value])} className="h-9 w-40 text-xs" aria-label={t('dash.transactions.to')} />
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {(['all', 'consumption', 'transfer'] as KindFilter[]).map((k) => (
            <Button key={k} variant="outline" size="xs" aria-pressed={kind === k} className={chip(kind === k)} onClick={() => setKind(k)}>
              {t(`dash.stock_approvals.kind_filter_${k}`)}
              <span className="ms-1.5 tabular-nums opacity-75">
                {k === 'all' ? totals.count : k === 'consumption' ? totals.consumption : totals.transfers}
              </span>
            </Button>
          ))}
        </div>
      </div>

      {data && data.older_count > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {t('dash.stock_approvals.older_drafts', { count: data.older_count })}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setCustom(['2000-01-01', presetRange('today')[1]]);
              setPreset('custom');
            }}
          >
            {t('dash.stock_approvals.show_all_pending')}
          </Button>
        </div>
      )}

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={t('dash.stock_approvals.kpi_pending')}
          value={totals.count}
          isLoading={!data}
          icon={<ClipboardCheck className="h-5 w-5" />}
          tone="primary"
        />
        <StatCard
          label={t('dash.stock_approvals.kpi_value')}
          value={formatCurrency(totals.value)}
          isLoading={!data}
          icon={<Receipt className="h-5 w-5" />}
        />
        <StatCard
          label={t('dash.stock_approvals.kpi_split')}
          value={`${totals.consumption} / ${totals.transfers}`}
          isLoading={!data}
          icon={<ArrowLeftRight className="h-5 w-5" />}
          delta={{ value: t('dash.stock_approvals.kpi_split_hint'), direction: 'flat' }}
        />
        <StatCard
          label={t('dash.stock_approvals.kpi_short')}
          value={totals.short}
          isLoading={!data}
          icon={<AlertTriangle className="h-5 w-5" />}
          tone={totals.short ? 'danger' : 'success'}
          delta={{ value: t('dash.stock_approvals.kpi_short_hint'), direction: 'flat' }}
        />
      </div>

      {/* View switch */}
      <div className="flex items-center gap-1 border-b border-gray-200">
        {(['entries', 'materials'] as View[]).map((v) => (
          <Button
            key={v}
            variant="ghost"
            aria-pressed={view === v}
            onClick={() => setView(v)}
            className={`-mb-px rounded-none border-b-2 px-4 text-sm font-semibold hover:bg-transparent ${
              view === v ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            {t(`dash.stock_approvals.view_${v}`)}
          </Button>
        ))}
        {loading && data && <Spinner className="ms-auto h-4 w-4" />}
      </div>

      {data?.truncated && (
        <p className="text-xs text-amber-700">{t('dash.stock_approvals.truncated')}</p>
      )}

      {!data ? (
        <div className="flex justify-center py-16"><Spinner className="h-8 w-8 text-primary" /></div>
      ) : view === 'materials' ? (
        <MaterialsTable data={data} whLabel={whLabel} qtyFormat={qtyFormat} />
      ) : days.length === 0 ? (
        <EmptyState
          className="py-16"
          illustration="inventory"
          title={t('dash.stock_approvals.empty_title')}
          description={t('dash.stock_approvals.empty_body')}
        />
      ) : (
        <div className="space-y-5">
          {days.map((day) => {
            const names = day.entries.map((e) => e.name);
            const allSelected = names.every((n) => selected.has(n));
            const someSelected = !allSelected && names.some((n) => selected.has(n));
            return (
              <Card key={day.date} className="overflow-hidden border border-gray-200">
                <div className="flex flex-wrap items-center gap-3 border-b border-gray-100 bg-gray-50/70 px-4 py-3">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-primary"
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someSelected;
                    }}
                    onChange={() => toggleDay(names)}
                    aria-label={t('dash.stock_approvals.select_day')}
                  />
                  <div className="min-w-0">
                    <h2 className="text-sm font-bold text-gray-900">
                      {day.date === data.today ? t('dash.stock_approvals.today') + ' · ' : ''}
                      {dayFormat.format(new Date(`${day.date}T00:00:00`))}
                    </h2>
                    <p className="text-xs text-gray-500">
                      {t('dash.stock_approvals.day_summary', {
                        consumption: day.consumption,
                        transfers: day.transfers,
                      })}
                      {' · '}
                      <span className="tabular-nums">{formatCurrency(day.value)}</span>
                    </p>
                  </div>
                  {day.short > 0 && (
                    <Badge variant="danger" className="gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      {t('dash.stock_approvals.short_count', { count: day.short })}
                    </Badge>
                  )}
                  {canApprove && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="ms-auto gap-1.5"
                      disabled={busy}
                      onClick={() => setConfirm({ action: 'approve', names })}
                    >
                      <CheckCheck className="h-4 w-4" />
                      {t('dash.stock_approvals.approve_day', { count: names.length })}
                    </Button>
                  )}
                </div>
                <ul className="divide-y divide-gray-100">
                  {day.entries.map((e) => (
                    <EntryRow
                      key={e.name}
                      entry={e}
                      selected={selected.has(e.name)}
                      expanded={expanded.has(e.name)}
                      failure={failures[e.name]}
                      onSelect={() => setSelected((prev) => toggle(prev, e.name))}
                      onExpand={() => setExpanded((prev) => toggle(prev, e.name))}
                      whLabel={whLabel}
                      qtyFormat={qtyFormat}
                    />
                  ))}
                </ul>
              </Card>
            );
          })}
        </div>
      )}

      {/* Selection bar */}
      {(selected.size > 0 || busy) && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-gray-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-3">
            {busy ? (
              <div className="flex flex-1 items-center gap-3">
                <Spinner className="h-4 w-4" />
                <span className="text-sm font-medium text-gray-700">
                  {t('dash.stock_approvals.working', { done: progress!.done, total: progress!.total })}
                </span>
                <div className="h-1.5 max-w-xs flex-1 overflow-hidden rounded-full bg-gray-100">
                  <div
                    className="h-full rounded-full bg-primary transition-[width]"
                    style={{ width: `${progress!.total ? (progress!.done / progress!.total) * 100 : 0}%` }}
                  />
                </div>
              </div>
            ) : (
              <>
                <span className="text-sm font-semibold text-gray-800">
                  {t('dash.stock_approvals.selected', { count: selected.size })}
                </span>
                <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                  {t('dash.stock_approvals.clear_selection')}
                </Button>
                <div className="ms-auto flex gap-2">
                  {canDelete && deletable.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 text-red-600"
                      onClick={() => setConfirm({ action: 'delete', names: deletable })}
                    >
                      <Trash2 className="h-4 w-4" />
                      {t('dash.stock_approvals.delete_selected', { count: deletable.length })}
                    </Button>
                  )}
                  {canApprove && (
                    <Button
                      size="sm"
                      className="gap-1.5 bg-primary text-white"
                      onClick={() => setConfirm({ action: 'approve', names: selectedNames })}
                    >
                      <CheckCheck className="h-4 w-4" />
                      {t('dash.stock_approvals.approve_selected', { count: selected.size })}
                    </Button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirm !== null}
        title={t(confirm?.action === 'delete' ? 'dash.stock_approvals.confirm_delete_title' : 'dash.stock_approvals.confirm_approve_title', {
          count: confirm?.names.length ?? 0,
        })}
        description={t(confirm?.action === 'delete' ? 'dash.stock_approvals.confirm_delete_body' : 'dash.stock_approvals.confirm_approve_body')}
        confirmLabel={t(confirm?.action === 'delete' ? 'dash.stock_approvals.delete' : 'dash.stock_approvals.approve')}
        tone={confirm?.action === 'delete' ? 'danger' : 'default'}
        onClose={() => setConfirm(null)}
        onConfirm={() => {
          if (!confirm) return;
          void (confirm.action === 'delete' ? runDelete(confirm.names) : runApprove(confirm.names));
        }}
      />

      {setup && (
        <TransferDialog open={transferOpen} setup={setup} onClose={() => setTransferOpen(false)} onSaved={() => void load()} />
      )}
    </div>
  );
};

interface EntryRowProps {
  entry: DraftEntry;
  selected: boolean;
  expanded: boolean;
  failure?: string;
  onSelect: () => void;
  onExpand: () => void;
  whLabel: (name?: string | null) => string;
  qtyFormat: Intl.NumberFormat;
}

const EntryRow: React.FC<EntryRowProps> = ({ entry: e, selected, expanded, failure, onSelect, onExpand, whLabel, qtyFormat }) => {
  const style = KIND_STYLE[e.kind];
  const Icon = style.icon;
  const sep = t('dash.stock_approvals.list_sep');
  const from = e.from_warehouses.map(whLabel).join(sep);
  const route =
    e.kind === 'transfer' ? t('dash.stock_approvals.route', { from, to: e.to_warehouses.map(whLabel).join(sep) }) : from;
  const preview = e.items.slice(0, 3).map((i) => i.item_name || i.item_code).join(sep);

  return (
    <li className={selected ? 'bg-primary/5' : undefined}>
      <div className="flex items-start gap-3 px-4 py-3">
        <input
          type="checkbox"
          className="mt-1 h-4 w-4 accent-primary"
          checked={selected}
          onChange={onSelect}
          aria-label={e.name}
        />
        <button type="button" onClick={onExpand} className="flex min-w-0 flex-1 flex-wrap items-start gap-x-4 gap-y-1 text-start">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={style.badge} className="gap-1">
                <Icon className="h-3 w-3" />
                {t(`dash.stock_approvals.kind_${e.kind}`)}
              </Badge>
              <span className="text-xs tabular-nums text-gray-500">{e.posting_time}</span>
              {e.pos_invoice && <span className="text-xs font-medium text-gray-700">{e.pos_invoice}</span>}
              <span className="truncate text-xs text-gray-500">{route}</span>
            </div>
            <p className="truncate text-sm text-gray-800">
              {preview}
              {e.items.length > 3 && (
                <span className="text-gray-500"> {t('dash.stock_approvals.more_items', { count: e.items.length - 3 })}</span>
              )}
            </p>
            {e.short_items.length > 0 && (
              <p className="flex items-center gap-1 text-xs font-medium text-red-600">
                <AlertTriangle className="h-3 w-3 shrink-0" />
                {t('dash.stock_approvals.short_items', { items: e.short_items.join(sep) })}
              </p>
            )}
            {failure && (
              <p role="alert" className="rounded bg-red-50 px-2 py-1 text-xs text-red-700">{failure}</p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-sm font-semibold tabular-nums text-gray-900">{formatCurrency(e.value)}</span>
            <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </div>
        </button>
      </div>
      {expanded && (
        <div className="border-t border-dashed border-gray-100 bg-gray-50/50 px-4 py-3 ps-11">
          <table className="w-full text-xs">
            <thead className="text-gray-500">
              <tr>
                <th className="py-1 text-start font-semibold">{t('dash.stock_approvals.material')}</th>
                <th className="py-1 text-start font-semibold">{t('dash.stock_approvals.qty')}</th>
                <th className="py-1 text-start font-semibold">{t('dash.stock_approvals.from_warehouse')}</th>
                {e.kind === 'transfer' && <th className="py-1 text-start font-semibold">{t('dash.stock_approvals.to_warehouse')}</th>}
              </tr>
            </thead>
            <tbody>
              {e.items.map((i, idx) => (
                <tr key={`${i.item_code}-${idx}`} className={i.short ? 'text-red-700' : 'text-gray-800'}>
                  <td className="py-1">{i.item_name || i.item_code}</td>
                  <td className="py-1 tabular-nums">{qtyFormat.format(i.qty)} {i.uom}</td>
                  <td className="py-1">{whLabel(i.s_warehouse)}</td>
                  {e.kind === 'transfer' && <td className="py-1">{whLabel(i.t_warehouse)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-gray-500">
            <span>{t('dash.stock_approvals.created_by', { name: e.owner_name })}</span>
            {e.remarks && <span>· {e.remarks}</span>}
            <a
              href={`/app/stock-entry/${encodeURIComponent(e.name)}`}
              target="_blank"
              rel="noreferrer"
              className="ms-auto inline-flex items-center gap-1 font-medium text-primary hover:underline"
            >
              {e.name} <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      )}
    </li>
  );
};

const MaterialsTable: React.FC<{
  data: DraftList;
  whLabel: (name?: string | null) => string;
  qtyFormat: Intl.NumberFormat;
}> = ({ data, whLabel, qtyFormat }) => {
  if (data.materials.length === 0) {
    return (
      <EmptyState
        className="py-16"
        illustration="inventory"
        title={t('dash.stock_approvals.empty_title')}
        description={t('dash.stock_approvals.empty_body')}
      />
    );
  }
  return (
    <Card className="overflow-x-auto border border-gray-200">
      <p className="border-b border-gray-100 px-4 py-2 text-xs text-gray-500">{t('dash.stock_approvals.materials_hint')}</p>
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-xs text-gray-500">
          <tr>
            <th className="px-4 py-2 text-start font-semibold">{t('dash.stock_approvals.material')}</th>
            <th className="px-4 py-2 text-start font-semibold">{t('dash.stock_approvals.warehouse')}</th>
            <th className="px-4 py-2 text-end font-semibold">{t('dash.stock_approvals.on_hand')}</th>
            <th className="px-4 py-2 text-end font-semibold">{t('dash.stock_approvals.incoming')}</th>
            <th className="px-4 py-2 text-end font-semibold">{t('dash.stock_approvals.outgoing')}</th>
            <th className="px-4 py-2 text-end font-semibold">{t('dash.stock_approvals.after')}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {data.materials.map((m) => (
            <tr key={`${m.item_code}-${m.warehouse}`} className={m.short ? 'bg-red-50/60' : undefined}>
              <td className="px-4 py-2">
                <div className="font-medium text-gray-900">{m.item_name || m.item_code}</div>
                <div className="text-xs text-gray-400">{m.stock_uom}</div>
              </td>
              <td className="px-4 py-2 text-gray-700">{whLabel(m.warehouse)}</td>
              <td className="px-4 py-2 text-end tabular-nums">{qtyFormat.format(m.on_hand)}</td>
              <td className="px-4 py-2 text-end tabular-nums text-emerald-700">{m.in_qty ? `+${qtyFormat.format(m.in_qty)}` : '—'}</td>
              <td className="px-4 py-2 text-end tabular-nums text-amber-700">{m.out_qty ? `−${qtyFormat.format(m.out_qty)}` : '—'}</td>
              <td className={`px-4 py-2 text-end font-semibold tabular-nums ${m.short ? 'text-red-600' : 'text-gray-900'}`}>
                {qtyFormat.format(m.after)}
                {m.short && <AlertTriangle className="ms-1 inline h-3.5 w-3.5" />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
};
