import React, { type MouseEvent } from 'react';
import { ArrowRight, CalendarClock, Clock, Eye, Link2, Loader2, Printer, Users } from 'lucide-react';
import { cn, TableScene } from '@ury/ui';
import { formatElapsed, minutesSince, tableVisualState, type TableVisualState } from '@ury/core';
import type { Table } from '../lib/table-api';
import TableActionsMenu from './TableActionsMenu';
import { t } from '../i18n';
import type { TableReservationHint } from '../lib/reservation-api';

/**
 * One look per state, shared with the waiter app's TableTile: a rail down the
 * leading edge, a badge, and the 3D table painted in the same colour.
 */
export const TABLE_STATE_STYLES: Record<TableVisualState, { rail: string; badge: string; label: string }> = {
  free: {
    rail: 'bg-emerald-500',
    badge: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    label: 'tables.available',
  },
  occupied: {
    rail: 'bg-amber-400',
    badge: 'border-amber-200 bg-amber-50 text-amber-800',
    label: 'tables.occupied',
  },
  // The one state that needs someone to move; it pulses so it is findable
  // in a room of thirty cards.
  attention: {
    rail: 'bg-red-500 animate-pulse-soft',
    badge: 'border-red-200 bg-red-50 text-red-700',
    label: 'tables.needs_attention',
  },
};

interface TableCardProps {
  table: Table;
  mergeGroupLabel?: string;
  className?: string;
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  onMerge: () => void;
  onUnmerge: () => void;
  onTransferTable?: () => void;
  onTransferCaptain?: () => void;
  showCaptainTransfer?: boolean;
  onNavigate: () => void;
  onPreview: (event: MouseEvent<HTMLButtonElement>) => void;
  onPrint: (event: MouseEvent<HTMLButtonElement>) => void;
  isPrinting: boolean;
  isRestricted?: boolean;
  /** Position in the room grid; drives only the entrance stagger. */
  index?: number;
  /** Set when this table is booked now or within the next 45 minutes. */
  reservation?: TableReservationHint;
  /** POS Profile "table attention time", in minutes; 0 turns the red state off. */
  attentionMinutes?: number;
  /** The page's ticking clock, so open times move while the screen is up. */
  now?: Date;
}

const TableCard = ({
  table,
  mergeGroupLabel,
  className,
  menuOpen,
  onMenuOpenChange,
  onMerge,
  onUnmerge,
  onTransferTable,
  onTransferCaptain,
  showCaptainTransfer = false,
  onNavigate,
  onPreview,
  onPrint,
  isPrinting,
  isRestricted = false,
  index = 0,
  reservation,
  attentionMinutes = 0,
  now,
}: TableCardProps) => {
  const isOccupied = table.occupied === 1;
  const state = tableVisualState(table, attentionMinutes, now);
  const style = TABLE_STATE_STYLES[state];
  const elapsed = isOccupied ? formatElapsed(minutesSince(table.latest_invoice_time, now)) : null;
  const isMerged = Boolean(mergeGroupLabel && mergeGroupLabel !== table.name);

  // An available table is opened by a real <button> laid over the card rather
  // than a div carrying role="button", so Enter and Space work (UX-07). It is
  // a sibling of the content, not a wrapper, because the card already
  // contains buttons and a button cannot nest inside one.
  const isOpenable = !isOccupied && !isRestricted;

  return (
    <article
      style={{ '--i': index } as React.CSSProperties}
      className={cn(
        'group relative flex min-h-[17rem] flex-col rounded-2xl border border-gray-200 bg-white shadow-sm',
        'focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 ring-offset-background',
        'transition-[box-shadow,transform] duration-fast ease-out',
        'animate-fade-in-up stagger-fast',
        isOpenable && 'cursor-pointer hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:scale-[0.99]',
        isRestricted && !isOccupied && 'cursor-not-allowed opacity-60',
        menuOpen ? 'z-20' : 'z-0',
        className
      )}
    >
      <span className={cn('absolute inset-y-0 start-0 w-1.5 rounded-s-2xl', style.rail)} aria-hidden="true" />

      {isOpenable && (
        <button
          type="button"
          onClick={onNavigate}
          aria-label={t('tables.open_table', { table: table.name })}
          className="absolute inset-0 z-[1] rounded-2xl focus:outline-none"
        />
      )}

      <header className="pointer-events-none relative z-[2] flex items-start justify-between gap-1 pe-1 ps-4 pt-3">
        <div className="flex min-w-0 flex-wrap items-center gap-1">
          <span
            className={cn(
              'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold',
              style.badge
            )}
          >
            <span
              aria-hidden="true"
              className={cn('h-1.5 w-1.5 shrink-0 rounded-full bg-current', isOccupied && 'animate-pulse-soft')}
            />
            {t(style.label)}
          </span>
          {/* A booking on a free table is the only thing that changes what
              a cashier should do with it, so it sits next to the status. */}
          {reservation && !isOccupied && (
            <span
              className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-violet-300 bg-violet-50 px-2 py-0.5 text-xs font-semibold text-violet-900"
              title={t('tables.reserved_for', {
                guest: reservation.guest_name,
                time: reservation.reserved_from.slice(11, 16),
              })}
            >
              <CalendarClock className="h-3 w-3 shrink-0" aria-hidden="true" />
              {reservation.in_progress ? t('tables.reserved_now') : reservation.reserved_from.slice(11, 16)}
            </span>
          )}
        </div>
        <div className="pointer-events-auto shrink-0">
          <TableActionsMenu
            table={table}
            isOpen={menuOpen}
            onOpenChange={onMenuOpenChange}
            onMerge={onMerge}
            onUnmerge={onUnmerge}
            onTransferTable={onTransferTable}
            onTransferCaptain={onTransferCaptain}
            showCaptainTransfer={showCaptainTransfer}
          />
        </div>
      </header>

      <div className="pointer-events-none relative z-[2] flex flex-1 flex-col px-4 pt-1 text-center">
        <TableScene state={state} />

        <h2
          className="flex items-center justify-center gap-1.5 text-2xl font-bold leading-tight text-gray-900"
          title={mergeGroupLabel ?? table.name}
        >
          <span className="truncate">{table.name}</span>
          {isMerged && (
            <Link2 className="h-4 w-4 shrink-0 text-gray-400" aria-label={t('tables.merged')} />
          )}
        </h2>

        {isMerged ? (
          <p className="mt-0.5 truncate text-xs font-medium text-primary-700" title={mergeGroupLabel}>
            {t('tables.merged_with_list', { tables: mergeGroupLabel ?? '' })}
          </p>
        ) : null}

        {isOccupied ? (
          <p
            className={cn(
              'mt-1 flex items-center justify-center gap-1 text-sm font-semibold tabular-nums',
              state === 'attention' ? 'text-red-600' : 'text-gray-500'
            )}
            title={t('tables.seated_for', { time: elapsed ?? '' })}
          >
            <Clock className="h-3.5 w-3.5" aria-hidden="true" />
            <bdi>{elapsed}</bdi>
          </p>
        ) : (
          <p className="mt-1 flex min-h-[1.25rem] items-center justify-center gap-1 text-sm text-gray-500">
            {typeof table.no_of_seats === 'number' && table.no_of_seats > 0 ? (
              <>
                <Users className="h-3.5 w-3.5" aria-hidden="true" />
                {t('tables.seats_count', { count: table.no_of_seats })}
              </>
            ) : (
              ' '
            )}
          </p>
        )}

        {table.is_take_away === 1 && (
          <span className="mx-auto mt-1 rounded-full bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-800">
            {t('tables.take_away')}
          </span>
        )}
      </div>

      <footer className="relative z-[2] mt-auto flex gap-2 p-3 pt-2">
        {isOccupied ? (
          <>
            <button
              type="button"
              onClick={onPreview}
              disabled={isRestricted}
              className="flex h-10 min-w-0 flex-1 items-center justify-center gap-1.5 truncate rounded-xl px-2 border border-gray-200 bg-white text-xs font-semibold text-gray-800 transition-colors hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Eye className="h-3.5 w-3.5" />
              {t('common.preview')}
            </button>
            <button
              type="button"
              onClick={onPrint}
              disabled={isPrinting}
              className="flex h-10 min-w-0 flex-1 items-center justify-center gap-1.5 truncate rounded-xl px-2 border border-gray-200 bg-white text-xs font-semibold text-gray-800 transition-colors hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isPrinting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {t('tables.printing')}
                </>
              ) : (
                <>
                  <Printer className="h-3.5 w-3.5" />
                  {t('order.print')}
                </>
              )}
            </button>
          </>
        ) : (
          // Visual only: the overlay button above is what takes the click
          // and the focus, so this is not a second tab stop.
          <span
            aria-hidden="true"
            className="pointer-events-none flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground shadow-sm transition-colors group-hover:bg-primary/90"
          >
            {t('tables.open')}
            <ArrowRight className="h-4 w-4 rtl:-scale-x-100" />
          </span>
        )}
      </footer>
    </article>
  );
};

export default TableCard;
