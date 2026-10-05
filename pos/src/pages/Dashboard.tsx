import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  TrendingUp, ShoppingCart, Clock, Users, AlertTriangle, Bell,
  RefreshCw, Package, UserCheck, Activity, Sparkles, Utensils,
  ReceiptText, LayoutGrid, ArrowUpRight,
} from 'lucide-react';
import { Button, StatCard, cn } from '@ury/ui';
import { formatCurrency } from '@ury/core';
import { usePOSStore } from '../store/pos-store';
import { t, tPlural } from '../i18n';
import { useDashboardData } from './dashboard/use-dashboard-data';
import { Panel } from './dashboard/Panel';
import {
  formatETA, formatMinutes, formatRelativeTime, percentDelta,
} from './dashboard/format';

/** Service stages, in the order a table moves through them. */
const STAGE_STYLE: Record<string, { bar: string; swatch: string; label: string }> = {
  open:   { bar: 'bg-gray-300',  swatch: 'bg-gray-300',  label: 'dashboard.open' },
  seated: { bar: 'bg-blue-300',  swatch: 'bg-blue-300',  label: 'dashboard.seated' },
  fired:  { bar: 'bg-blue-500',  swatch: 'bg-blue-500',  label: 'dashboard.fired' },
  served: { bar: 'bg-blue-700',  swatch: 'bg-blue-700',  label: 'dashboard.served' },
  over:   { bar: 'bg-destructive', swatch: 'bg-destructive', label: 'dashboard.over_time' },
};

/** A labelled figure compared against its historical median. */
function MetricTile({
  label, value, delta, positive,
}: { label: string; value: string; delta?: string | null; positive?: boolean }) {
  return (
    <div className="rounded-lg bg-muted/50 p-3">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-bold tabular-nums text-foreground">{value}</p>
      {delta ? (
        <p className="mt-1 text-xs">
          <span className={cn('font-semibold', positive ? 'text-green-600' : 'text-destructive')}>
            {delta}
          </span>
        </p>
      ) : null}
    </div>
  );
}

/** Horizontal meter used by Floor Load and Running Low. */
function Meter({ pct, tone }: { pct: number; tone: 'primary' | 'warning' }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
      <div
        className={cn(
          'h-full rounded-full',
          // Width animates so a refresh reads as the bar moving rather than
          // the value teleporting.
          'transition-[width] duration-slow ease-out',
          tone === 'primary' ? 'bg-primary' : 'bg-amber-500',
        )}
        style={{ width: `${Math.max(0, Math.min(pct, 100))}%` }}
      />
    </div>
  );
}

function QuickAction({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <Link to={to} className="group flex min-h-20 items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 shadow-sm transition hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-ring">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary [&_svg]:h-5 [&_svg]:w-5">{icon}</span>
      <span className="min-w-0 flex-1 text-sm font-semibold text-foreground">{label}</span>
      <ArrowUpRight className="h-4 w-4 shrink-0 text-muted-foreground rtl:rotate-180" aria-hidden="true" />
    </Link>
  );
}

export default function Dashboard() {
  const { posProfile } = usePOSStore();
  const branch = posProfile?.branch;
  const d = useDashboardData(branch);

  const stats = d.stats.data;
  const overTime = d.serviceLine.data.filter((r) => r.stage === 'over').length;
  const occupancy = stats?.total_tables ? Math.round((stats.active_tables / stats.total_tables) * 100) : 0;

  // Bars are scaled against a 90-minute floor so a quiet service does not make
  // a 5-minute table look alarming by filling the whole chart.
  const maxMinutes = useMemo(
    () => Math.max(90, ...d.serviceLine.data.map((r) => r.minutes ?? 0)),
    [d.serviceLine.data],
  );
  const maxTables = useMemo(
    () => Math.max(1, ...d.floorLoad.data.map((f) => f.table_count)),
    [d.floorLoad.data],
  );

  if (!branch) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">{t('dashboard.no_branch')}</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-background">
      <div className="mx-auto max-w-screen-2xl space-y-5 p-4 sm:p-6 pb-24">

        {/* ---- header ---------------------------------------------------- */}
        <header className="flex flex-wrap items-end justify-between gap-3 overflow-hidden rounded-2xl border border-primary/15 bg-gradient-to-br from-primary/10 via-card to-card p-5 shadow-sm sm:p-6">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-foreground">
              {t('dashboard.title')}
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">{t('dashboard.subtitle')}</p>
          </div>

          <div className="flex items-center gap-3">
            {d.lastUpdated ? (
              <span className="text-xs text-muted-foreground" aria-live="polite">
                {t('dashboard.updated_at', {
                  time: d.lastUpdated.toLocaleTimeString(undefined, {
                    hour: '2-digit', minute: '2-digit',
                  }),
                })}
              </span>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              onClick={d.refresh}
              loading={d.refreshing}
              loadingText={t('dashboard.refreshing')}
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              {t('dashboard.refresh')}
            </Button>
          </div>
        </header>

        <section aria-label={t('dashboard.quick_actions')} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <QuickAction to="/pos" icon={<Utensils />} label={t('dashboard.new_order')} />
          <QuickAction to="/orders" icon={<ReceiptText />} label={t('dashboard.open_orders')} />
          <QuickAction to="/tables" icon={<LayoutGrid />} label={t('dashboard.view_tables')} />
        </section>

        {/* ---- headline figures ----------------------------------------- */}
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label={t('dashboard.todays_sales')}
            value={stats ? formatCurrency(stats.todays_sales) : '—'}
            isLoading={d.stats.loading}
            tone="success"
            icon={<TrendingUp className="h-4 w-4" />}
          />
          <StatCard
            label={t('dashboard.orders_today')}
            value={stats ? String(stats.orders_today) : '—'}
            isLoading={d.stats.loading}
            tone="primary"
            icon={<ShoppingCart className="h-4 w-4" />}
          />
          <StatCard
            label={t('dashboard.avg_order_value')}
            value={stats ? formatCurrency(stats.avg_order_value) : '—'}
            isLoading={d.stats.loading}
            icon={<Clock className="h-4 w-4" />}
          />
          <StatCard
            label={t('dashboard.active_tables')}
            // A ratio, so it is isolated from bidi reordering: "3 / 10"
            // reversed would read as the wrong number.
            value={stats ? `${stats.active_tables} / ${stats.total_tables}` : '—'}
            isLoading={d.stats.loading}
            tone={stats && stats.active_tables === stats.total_tables ? 'warning' : 'default'}
            icon={<Users className="h-4 w-4" />}
            className="bidi-isolate"
          />
        </section>

        {/* ---- service line --------------------------------------------- */}
        <Panel
          title={t('dashboard.service_line')}
          icon={<Activity />}
          loading={d.serviceLine.loading}
          error={d.serviceLine.error}
          empty={d.serviceLine.data.length === 0}
          emptyTitle={t('dashboard.no_tables_seated')}
          emptyIcon={<Users />}
          aside={
            overTime > 0 ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-destructive/10 px-2.5 py-1 text-xs font-semibold text-destructive">
                <span className="h-1.5 w-1.5 rounded-full bg-destructive animate-pulse-soft" aria-hidden="true" />
                {tPlural('dashboard.tables_over_time', overTime)}
              </span>
            ) : null
          }
        >
          <div className="space-y-4">
            <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
              {Object.entries(STAGE_STYLE).map(([stage, s]) => (
                <span key={stage} className="flex items-center gap-2">
                  <span className={cn('h-3 w-3 rounded', s.swatch)} aria-hidden="true" />
                  {t(s.label)}
                </span>
              ))}
            </div>

            <div className="flex h-32 items-end gap-1.5 overflow-x-auto border-b border-border pb-2">
              {d.serviceLine.data.map((row, i) => {
                const style = STAGE_STYLE[row.stage] ?? STAGE_STYLE.open;
                const pct = row.minutes !== null ? (row.minutes / maxMinutes) * 100 : 4;
                return (
                  <div
                    key={`${row.table}-${i}`}
                    className="group flex shrink-0 flex-col items-center animate-fade-in-up stagger-fast"
                    style={{ '--i': i } as React.CSSProperties}
                    title={`${row.table} · ${t(style.label)}${row.minutes !== null ? ` · ${formatMinutes(row.minutes)}` : ''}`}
                  >
                    <span className="mb-1 h-4 text-xs tabular-nums text-muted-foreground">
                      {row.minutes ?? ''}
                    </span>
                    <div
                      className={cn(
                        'w-8 rounded-t',
                        style.bar,
                        'transition-[height,filter] duration-slow ease-out group-hover:brightness-110',
                      )}
                      style={{ height: `${pct}%`, minHeight: 4 }}
                    />
                    <span className="mt-1 max-w-[3rem] truncate text-xs text-foreground">
                      {row.table}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </Panel>

        {/* ---- two columns ---------------------------------------------- */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-6">

            <Panel
              title={t('dashboard.needs_attention')}
              icon={<AlertTriangle />}
              loading={d.attention.loading}
              error={d.attention.error}
              empty={d.attention.data.length === 0}
              emptyTitle={t('dashboard.nothing_needs_attention')}
              emptyIcon={<Sparkles />}
            >
              <ul className="space-y-2">
                {d.attention.data.map((item, i) => {
                  const high = item.severity === 'high';
                  return (
                    <li
                      key={i}
                      style={{ '--i': i } as React.CSSProperties}
                      className={cn(
                        // Logical border so the severity stripe stays on the
                        // reading-start edge in Arabic.
                        'flex items-start gap-3 rounded-md border-s-4 p-3 animate-slide-in stagger-fast',
                        high
                          ? 'border-s-destructive bg-destructive/5'
                          : 'border-s-amber-500 bg-amber-50',
                      )}
                    >
                      {high
                        ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
                        : <Clock className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />}
                      <p className="text-sm text-foreground">{item.message}</p>
                    </li>
                  );
                })}
              </ul>
            </Panel>

            <Panel
              title={t('dashboard.tonight_vs_baseline')}
              icon={<TrendingUp />}
              loading={d.metrics.loading}
              error={d.metrics.error}
              empty={!d.metrics.data.shift || !d.metrics.data.baseline}
              emptyTitle={t('dashboard.no_data')}
              skeletonLines={4}
            >
              {(() => {
                const { shift, baseline } = d.metrics.data;
                if (!shift || !baseline) return null;
                const hasBaseline = baseline.sample_days > 0;
                return (
                  <div className="grid grid-cols-2 gap-3">
                    <MetricTile
                      label={t('dashboard.sales')}
                      value={formatCurrency(shift.sales)}
                      delta={hasBaseline ? percentDelta(shift.sales, baseline.median_sales) : null}
                      positive={shift.sales >= baseline.median_sales}
                    />
                    <MetricTile
                      label={t('dashboard.covers')}
                      value={String(shift.covers)}
                      delta={hasBaseline
                        ? `${shift.covers >= baseline.median_covers ? '+' : ''}${shift.covers - baseline.median_covers}`
                        : null}
                      positive={shift.covers >= baseline.median_covers}
                    />
                    <MetricTile
                      label={t('dashboard.avg_per_cover')}
                      value={formatCurrency(shift.avg_per_cover)}
                    />
                    <MetricTile
                      label={t('dashboard.avg_ticket_time')}
                      value={formatMinutes(shift.avg_ticket_minutes)}
                    />
                  </div>
                );
              })()}
            </Panel>

            <Panel
              title={t('dashboard.running_low')}
              icon={<Package />}
              loading={d.runningLow.loading}
              error={d.runningLow.error}
              empty={d.runningLow.data.length === 0}
              emptyTitle={t('dashboard.no_forecast')}
              emptyIcon={<Package />}
            >
              <ul className="space-y-3">
                {d.runningLow.data.map((item, i) => {
                  const total = item.remaining + item.qty_sold_today;
                  const pct = total > 0 ? (item.remaining / total) * 100 : 0;
                  return (
                    <li
                      key={`${item.item_name}-${i}`}
                      style={{ '--i': i } as React.CSSProperties}
                      className="animate-slide-in stagger-fast"
                    >
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium text-foreground">
                          {item.item_name}
                        </span>
                        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                          {formatETA(item.eta_minutes)}
                        </span>
                      </div>
                      <Meter pct={pct} tone="warning" />
                      {item.data_quality_issue ? (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t('dashboard.stock_needs_review')}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </Panel>
          </div>

          {/* ---- right rail --------------------------------------------- */}
          <div className="space-y-6">

            <Panel
              title={t('dashboard.floor_load')}
              icon={<UserCheck />}
              loading={d.floorLoad.loading}
              error={d.floorLoad.error}
              empty={d.floorLoad.data.length === 0}
              emptyTitle={t('dashboard.no_tables_assigned')}
              emptyIcon={<Users />}
            >
              <ul className="space-y-3">
                {d.floorLoad.data.map((w, i) => (
                  <li
                    key={`${w.waiter}-${i}`}
                    style={{ '--i': i } as React.CSSProperties}
                    className="animate-slide-in stagger-fast"
                  >
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-foreground">{w.waiter}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {tPlural('dashboard.table_count', w.table_count)}
                      </span>
                    </div>
                    <Meter pct={(w.table_count / maxTables) * 100} tone="primary" />
                  </li>
                ))}
              </ul>
            </Panel>

            <Panel
              title={t('dashboard.floor_status')}
              icon={<LayoutGrid />}
              loading={d.stats.loading}
              error={d.stats.error}
            >
              <div className="flex items-center gap-5">
                <div className="relative grid h-28 w-28 shrink-0 place-items-center">
                  <svg viewBox="0 0 36 36" className="h-full w-full -rotate-90" aria-hidden="true">
                    <circle cx="18" cy="18" r="15.5" fill="none" className="stroke-muted" strokeWidth="5" />
                    <circle cx="18" cy="18" r="15.5" fill="none" className="stroke-primary transition-all duration-slow" strokeWidth="5" strokeLinecap="round" pathLength="100" strokeDasharray={[occupancy, 100 - occupancy].join(" ")} />
                  </svg>
                  <div className="absolute text-center"><p className="text-2xl font-bold tabular-nums">{occupancy}%</p><p className="text-[11px] text-muted-foreground">{t('dashboard.occupied')}</p></div>
                </div>
                <div className="space-y-3">
                  <div><p className="text-xs text-muted-foreground">{t('dashboard.active_tables')}</p><p className="text-lg font-bold tabular-nums">{stats?.active_tables ?? '—'}</p></div>
                  <div><p className="text-xs text-muted-foreground">{t('dashboard.available_tables')}</p><p className="text-lg font-bold tabular-nums">{stats ? Math.max(0, stats.total_tables - stats.active_tables) : '—'}</p></div>
                </div>
              </div>
            </Panel>

            <Panel
              title={t('dashboard.recent_notifications')}
              icon={<Bell />}
              loading={d.notifications.loading}
              error={d.notifications.error}
              empty={d.notifications.data.length === 0}
              emptyTitle={t('dashboard.no_notifications')}
              emptyIcon={<Bell />}
            >
              <ul className="-my-1 divide-y divide-border">
                {d.notifications.data.map((n, i) => (
                  <li
                    key={n.name}
                    style={{ '--i': i } as React.CSSProperties}
                    className="flex items-start justify-between gap-2 py-2 animate-fade-in stagger-fast"
                  >
                    <p className="text-xs leading-relaxed text-foreground">{n.subject}</p>
                    <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">
                      {formatRelativeTime(n.creation)}
                    </span>
                  </li>
                ))}
              </ul>
            </Panel>
          </div>
        </div>
      </div>
    </div>
  );
}
