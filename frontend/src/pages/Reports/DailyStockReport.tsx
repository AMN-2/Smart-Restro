import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, AlertTriangle, ArrowLeftRight, Boxes, ChefHat, Printer } from 'lucide-react';
import { formatCurrency, getIntlLocale, parseFrappeError } from '@ury/core';
import { Badge, Button, Card, EmptyState, Input, Select, SelectItem, Spinner, StatCard } from '@ury/ui';
import { useBranchContext } from '../../context/BranchContext';
import { dailyStockService, type DailyStockReport as Report, type DailyStockRow } from '../../services/stockApprovals';
import { t } from '../../i18n';

/**
 * The day's raw materials, one line per material and warehouse: what the
 * day opened with, what came in and went out by kind, and what was left
 * after closing — and, while drafts still wait for approval, what is
 * really left once they are counted.
 */

const MOVE_COLUMNS: { key: keyof DailyStockRow; tone: 'in' | 'out' | 'adj' }[] = [
  { key: 'purchase', tone: 'in' },
  { key: 'transfer_in', tone: 'in' },
  { key: 'transfer_out', tone: 'out' },
  { key: 'sale_consumption', tone: 'out' },
  { key: 'direct_sale', tone: 'out' },
  { key: 'waste', tone: 'out' },
  { key: 'adjustment', tone: 'adj' },
];

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const DailyStockReport: React.FC = () => {
  const { activeBranchId } = useBranchContext();
  const [date, setDate] = useState(today);
  const [warehouse, setWarehouse] = useState('');
  const [rawOnly, setRawOnly] = useState(true);
  const [data, setData] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestId = useRef(0);

  const locale = getIntlLocale();
  const qty = useMemo(() => new Intl.NumberFormat(locale, { maximumFractionDigits: 3 }), [locale]);
  const fmt = (n: number) => (Math.abs(n) < 1e-9 ? '—' : qty.format(n));

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    setError('');
    try {
      const res = await dailyStockService.report({
        date,
        branch: activeBranchId,
        warehouse: warehouse || undefined,
        raw_only: rawOnly,
      });
      if (id === requestId.current) setData(res);
    } catch (err) {
      if (id === requestId.current) setError(parseFrappeError(err, t('reports.daily_stock.load_failed')));
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [date, activeBranchId, warehouse, rawOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  const label = (name?: string | null) => (name && data?.warehouses.find((w) => w.name === name)?.label) || name || '—';

  // One table per warehouse: a kitchen and a main store are read separately.
  const byWarehouse = useMemo(() => {
    const map = new Map<string, DailyStockRow[]>();
    for (const r of data?.rows ?? []) {
      const list = map.get(r.warehouse);
      if (list) list.push(r);
      else map.set(r.warehouse, [r]);
    }
    return [...map.entries()];
  }, [data]);

  const hasPending = (data?.totals.pending ?? 0) > 0;

  return (
    <div className="space-y-6 print:space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{t('reports.daily_stock.title')}</h1>
          <p className="text-sm text-muted-foreground">{t('reports.daily_stock.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <Input type="date" value={date} max={today()} onChange={(e) => e.target.value && setDate(e.target.value)} className="h-9 w-40 text-sm" aria-label={t('dash.stock_approvals.date')} />
          <div className="w-52">
            <Select value={warehouse} onValueChange={setWarehouse} size="sm">
              <SelectItem value="">{t('reports.daily_stock.all_warehouses')}</SelectItem>
              {(data?.warehouses ?? []).map((w) => (
                <SelectItem key={w.name} value={w.name}>{w.label}</SelectItem>
              ))}
            </Select>
          </div>
          <label className="flex h-9 items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" className="h-4 w-4 accent-primary" checked={rawOnly} onChange={(e) => setRawOnly(e.target.checked)} />
            {t('dash.stock_count.raw_only')}
          </label>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => window.print()}>
            <Printer className="h-4 w-4" /> {t('reports.daily_stock.print')}
          </Button>
        </div>
      </div>

      {error && (
        <div role="alert" className="flex items-start gap-2.5 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t('reports.daily_stock.consumed_value')} value={formatCurrency(data?.totals.consumption_cost ?? 0)} isLoading={loading && !data} icon={<ChefHat className="h-4 w-4" />} tone="primary" />
        <StatCard label={t('reports.daily_stock.materials')} value={data?.totals.materials ?? 0} isLoading={loading && !data} icon={<Boxes className="h-4 w-4" />} />
        <StatCard label={t('reports.daily_stock.transfers')} value={data?.transfers.length ?? 0} isLoading={loading && !data} icon={<ArrowLeftRight className="h-4 w-4" />} />
        <StatCard
          label={t('reports.daily_stock.below_zero')}
          value={data?.totals.short ?? 0}
          isLoading={loading && !data}
          icon={<AlertTriangle className="h-4 w-4" />}
          tone={data?.totals.short ? 'danger' : 'success'}
        />
      </div>

      {hasPending && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {t('reports.daily_stock.pending_hint', { count: data?.totals.pending ?? 0 })}
        </div>
      )}

      {/* Materials: opening → movements → after closing */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold">{t('reports.daily_stock.section_materials')}</h2>
        {loading && !data ? (
          <div className="flex justify-center py-12"><Spinner className="h-6 w-6 text-primary" /></div>
        ) : byWarehouse.length === 0 ? (
          <EmptyState className="py-12" illustration="inventory" title={t('reports.daily_stock.empty')} />
        ) : (
          byWarehouse.map(([wh, rows]) => (
            <Card key={wh} className="overflow-x-auto border border-gray-200 print:break-inside-avoid">
              <div className="border-b border-gray-100 bg-gray-50/70 px-4 py-2 text-sm font-semibold text-gray-900">{label(wh)}</div>
              <table className="w-full text-xs sm:text-sm">
                <thead className="text-[11px] text-gray-500 sm:text-xs">
                  <tr>
                    <th className="px-3 py-2 text-start font-semibold">{t('dash.stock_approvals.material')}</th>
                    <th className="px-3 py-2 text-end font-semibold">{t('reports.daily_stock.opening')}</th>
                    {MOVE_COLUMNS.map((c) => (
                      <th key={c.key} className="px-3 py-2 text-end font-semibold">{t(`reports.daily_stock.col_${c.key}`)}</th>
                    ))}
                    <th className="bg-gray-50 px-3 py-2 text-end font-semibold text-gray-800">{t('reports.daily_stock.closing')}</th>
                    {hasPending && <th className="px-3 py-2 text-end font-semibold">{t('reports.daily_stock.pending')}</th>}
                    {hasPending && <th className="bg-gray-50 px-3 py-2 text-end font-semibold text-gray-800">{t('reports.daily_stock.after_pending')}</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {rows.map((r) => {
                    const pendingNet = r.pending_in - r.pending_out;
                    return (
                      <tr key={r.item_code} className={r.short ? 'bg-red-50/60' : undefined}>
                        <td className="px-3 py-2">
                          <div className="font-medium text-gray-900">{r.item_name}</div>
                          <div className="text-[11px] text-gray-400">{r.stock_uom}</div>
                        </td>
                        <td className="px-3 py-2 text-end tabular-nums text-gray-600">{fmt(r.opening)}</td>
                        {MOVE_COLUMNS.map((c) => {
                          const v = r[c.key] as number;
                          const tone = Math.abs(v) < 1e-9 ? 'text-gray-300' : c.tone === 'in' ? 'text-emerald-700' : c.tone === 'out' ? 'text-amber-700' : 'text-blue-700';
                          return (
                            <td key={c.key} className={`px-3 py-2 text-end tabular-nums ${tone}`}>{fmt(v)}</td>
                          );
                        })}
                        <td className="bg-gray-50 px-3 py-2 text-end font-semibold tabular-nums text-gray-900">{qty.format(r.closing)}</td>
                        {hasPending && (
                          <td className="px-3 py-2 text-end tabular-nums text-amber-700">
                            {Math.abs(pendingNet) < 1e-9 ? '—' : `${pendingNet > 0 ? '+' : ''}${qty.format(pendingNet)}`}
                          </td>
                        )}
                        {hasPending && (
                          <td className={`bg-gray-50 px-3 py-2 text-end font-semibold tabular-nums ${r.short ? 'text-red-600' : 'text-gray-900'}`}>
                            {qty.format(r.after_pending)}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          ))
        )}
      </section>

      {/* Consumption by product sold */}
      {data && data.by_product.length > 0 && (
        <section className="space-y-3 print:break-before-page">
          <h2 className="text-base font-semibold">{t('reports.daily_stock.section_products')}</h2>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {data.by_product.map((p) => (
              <Card key={p.item_code} className="border border-gray-200 p-4 print:break-inside-avoid">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">{p.item_name}</h3>
                    <p className="text-xs text-gray-500">{t('reports.daily_stock.sold', { qty: qty.format(p.sold_qty) })}</p>
                  </div>
                  <div className="text-end">
                    <p className="text-sm font-semibold tabular-nums">{formatCurrency(p.cost)}</p>
                    {p.has_draft && <Badge variant="pending">{t('reports.daily_stock.has_draft')}</Badge>}
                  </div>
                </div>
                <ul className="mt-2 space-y-1 text-xs">
                  {p.ingredients.map((i) => (
                    <li key={i.item_code} className="flex justify-between gap-2 text-gray-700">
                      <span>{i.item_name}</span>
                      <span className="tabular-nums">{qty.format(i.qty)} {i.stock_uom}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* Transfers of the day */}
      {data && data.transfers.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-base font-semibold">{t('reports.daily_stock.section_transfers')}</h2>
          <Card className="divide-y divide-gray-100 border border-gray-200">
            {data.transfers.map((tr) => (
              <div key={tr.name} className="px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="tabular-nums text-gray-500">{tr.posting_time}</span>
                  <Badge variant={tr.status === 'posted' ? 'success' : 'pending'}>{t(`reports.daily_stock.status_${tr.status}`)}</Badge>
                  <span className="text-gray-700">{tr.owner_name}</span>
                  <span className="ms-auto text-xs text-gray-400">{tr.name}</span>
                </div>
                <ul className="mt-1 space-y-0.5 text-xs text-gray-700">
                  {tr.items.map((i, idx) => (
                    <li key={idx}>
                      {i.item_name}: <span className="tabular-nums">{qty.format(i.qty)} {i.uom}</span>{' '}
                      <span className="text-gray-500">{t('dash.stock_approvals.route', { from: label(i.from), to: label(i.to) })}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </Card>
        </section>
      )}
    </div>
  );
};
