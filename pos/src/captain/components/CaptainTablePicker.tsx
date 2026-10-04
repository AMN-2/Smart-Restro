import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, RefreshCw, Search, Square, X } from 'lucide-react';
import { Spinner, cn, showToast } from '@ury/ui';
import { getRooms, getTables, type Room, type Table } from '../../lib/table-api';
import { getMergeGroupMembers, sortTablesByMergeGroups } from '../../lib/table-utils';
import SlideOverPanel from '../../components/SlideOverPanel';
import { t } from '../../i18n';
import { useFloorUpdates } from '../../lib/floor-sync';
import {
  getActiveTableOrders,
  getUserFullNames,
  type ActiveTableOrder,
} from '../lib/captain-table-api';
import CaptainTableCard, { type CaptainTableOwnership } from './CaptainTableCard';

type StatusFilter = 'all' | 'free' | 'occupied' | 'mine';

/** Live table state is refreshed this often while the picker is open. */
const REFRESH_INTERVAL_MS = 20_000;

interface CaptainTablePickerProps {
  isOpen: boolean;
  onClose: () => void;
  branch: string | null;
  /** The captain's own room assignment(s) from `get_captain_context()`; picks the default tab. */
  assignedRooms: { name: string | null }[];
  currentUser: string | null;
  canAccessOtherCaptainsTables: boolean;
  selectedTable: string | null;
  onSelect: (table: Table) => void;
}

/**
 * The Captain's table picker: a sheet over the order workspace rather than
 * a separate screen, so choosing or switching a table never throws away the
 * menu the captain was browsing.
 *
 * Every room's tables load together, so search finds "12" whichever room it
 * is in, and the room tabs can show how many tables are free before the
 * captain switches to them. Ownership/billed gating happens here, at the tap
 * — a table the captain may not open says why instead of opening onto an
 * error screen. The server still re-checks everything (PLAN.md §9).
 */
export default function CaptainTablePicker({
  isOpen,
  onClose,
  branch,
  assignedRooms,
  currentUser,
  canAccessOtherCaptainsTables,
  selectedTable,
  onSelect,
}: CaptainTablePickerProps) {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);
  const [tablesByRoom, setTablesByRoom] = useState<Record<string, Table[]>>({});
  const [activeOrders, setActiveOrders] = useState<Map<string, ActiveTableOrder>>(new Map());
  const [ownerNames, setOwnerNames] = useState<Map<string, string>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  // Lists ALL branch rooms (as the Cashier `Table.tsx` does), not just the
  // captain's assignment: `get_captain_context()` returns a `name: null` row
  // for a branch-level assignment, and room restriction, where it exists, is
  // enforced server-side rather than by hiding rooms here.
  const refresh = useCallback(async () => {
    if (!branch) return;
    setIsLoading(true);
    setError(null);
    try {
      const fetchedRooms = await getRooms(branch);
      const [tableLists, orders] = await Promise.all([
        Promise.all(fetchedRooms.map((room) => getTables(room.name))),
        // Non-fatal: without it the grid still shows occupied/free, just
        // without owner/total annotations.
        getActiveTableOrders(branch).catch((err) => {
          console.error('Failed to load active table orders', err);
          return new Map<string, ActiveTableOrder>();
        }),
      ]);

      const byRoom: Record<string, Table[]> = {};
      fetchedRooms.forEach((room, i) => {
        byRoom[room.name] = sortTablesByMergeGroups(tableLists[i]);
      });

      setRooms(fetchedRooms);
      setTablesByRoom(byRoom);
      setActiveOrders(orders);
      setHasLoaded(true);

      const names = await getUserFullNames(Array.from(orders.values()).map((o) => o.waiter)).catch(
        () => new Map<string, string>()
      );
      setOwnerNames(names);
    } catch (err) {
      console.error(err);
      setError(t('errors.failed_load_tables'));
    } finally {
      setIsLoading(false);
    }
  }, [branch]);

  // Live while open: a table taken, freed, merged or paid elsewhere shows at
  // once instead of on the next 20s refresh.
  useFloorUpdates(() => {
    if (isOpen) void refresh();
  }, { branch });

  useEffect(() => {
    if (!isOpen) return;
    refresh();
    const timer = window.setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [isOpen, refresh]);

  // Default tab: the room holding the current table, else the captain's own
  // assigned room, else the first room.
  useEffect(() => {
    if (rooms.length === 0) return;
    if (selectedRoom && rooms.some((r) => r.name === selectedRoom)) return;
    const currentTableRoom = selectedTable
      ? rooms.find((r) => tablesByRoom[r.name]?.some((tb) => tb.name === selectedTable))?.name
      : undefined;
    const assigned = assignedRooms.find((r) => r.name)?.name;
    setSelectedRoom(
      currentTableRoom ?? rooms.find((r) => r.name === assigned)?.name ?? rooms[0].name
    );
  }, [rooms, tablesByRoom, selectedRoom, selectedTable, assignedRooms]);

  const resolveOwnership = useCallback(
    (table: Table): CaptainTableOwnership => {
      if (table.occupied !== 1) return 'free';
      const order = activeOrders.get(table.name);
      if (!order) return 'occupied-unknown';
      return order.waiter === currentUser ? 'mine' : 'other';
    },
    [activeOrders, currentUser]
  );

  const matchesStatus = useCallback(
    (table: Table) => {
      if (statusFilter === 'all') return true;
      if (statusFilter === 'occupied') return table.occupied === 1;
      return resolveOwnership(table) === statusFilter;
    },
    [statusFilter, resolveOwnership]
  );

  const allTables = useMemo(() => Object.values(tablesByRoom).flat(), [tablesByRoom]);
  const term = search.trim().toLowerCase();

  // A search looks across every room; otherwise the grid shows the tab's room.
  const scopeTables = term
    ? allTables.filter((tb) => tb.name.toLowerCase().includes(term))
    : selectedRoom
      ? tablesByRoom[selectedRoom] ?? []
      : [];
  const visibleTables = scopeTables.filter(matchesStatus);

  const countBy = (status: StatusFilter) =>
    status === 'all'
      ? scopeTables.length
      : status === 'occupied'
        ? scopeTables.filter((tb) => tb.occupied === 1).length
        : scopeTables.filter((tb) => resolveOwnership(tb) === status).length;

  const freeCountIn = (roomName: string) =>
    (tablesByRoom[roomName] ?? []).filter((tb) => tb.occupied !== 1).length;

  const handleTap = (table: Table) => {
    const ownership = resolveOwnership(table);
    const order = activeOrders.get(table.name);

    // `get_table_order_context` ignores printed invoices, so opening a billed
    // table would show an empty order on an occupied table and the send
    // would be rejected. Say so here instead.
    if (order?.invoicePrinted) {
      showToast.error(t('captain.picker.billed_locked_hint'));
      return;
    }

    if (ownership === 'other' || ownership === 'occupied-unknown') {
      if (!canAccessOtherCaptainsTables) {
        const ownerName = order ? ownerNames.get(order.waiter) ?? order.waiter : null;
        showToast.error(
          ownerName ? t('captain.picker.assigned_to', { name: ownerName }) : t('captain.picker.occupied')
        );
        return;
      }
    }

    onSelect(table);
  };

  const filterChips: { key: StatusFilter; label: string }[] = [
    { key: 'all', label: t('common.all') },
    { key: 'free', label: t('captain.status.free') },
    { key: 'occupied', label: t('captain.status.occupied') },
    { key: 'mine', label: t('captain.status.mine') },
  ];

  return (
    <SlideOverPanel
      isOpen={isOpen}
      onClose={onClose}
      title={t('captain.picker.title')}
      side="start"
      className="max-w-2xl"
    >
      <div className="space-y-3 border-b border-[#eadfce] bg-[#fffaf0] p-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9a7e6b]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('captain.picker.search')}
              inputMode="search"
              className="h-11 w-full rounded-xl border border-[#eadfce] bg-white pe-9 ps-9 text-base text-[#3f2a20] placeholder:text-[#b29a88] focus:outline-none focus:ring-2 focus:ring-primary"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label={t('common.clear')}
                className="absolute end-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-[#9a7e6b] hover:bg-[#f5eadc]"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={refresh}
            disabled={isLoading}
            aria-label={t('common.refresh')}
            title={t('common.refresh')}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[#eadfce] bg-white text-[#735d4e] transition-colors hover:bg-[#fff2d7] disabled:opacity-60"
          >
            <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} />
          </button>
        </div>

        {!term && rooms.length > 1 && (
          <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-0.5">
            {rooms.map((room) => {
              const active = selectedRoom === room.name;
              return (
                <button
                  key={room.name}
                  type="button"
                  onClick={() => setSelectedRoom(room.name)}
                  className={cn(
                    'flex shrink-0 items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-semibold transition-colors',
                    active
                      ? 'border-[#f05b42] bg-[#f05b42] text-white shadow-[0_5px_14px_rgba(240,91,66,0.25)]'
                      : 'border-[#eadfce] bg-white text-[#735d4e] hover:border-[#f0b83e]'
                  )}
                >
                  {room.name}
                  <span
                    className={cn(
                      'rounded-full px-1.5 text-[11px] font-bold tabular-nums',
                      active ? 'bg-white/25 text-white' : 'bg-emerald-100 text-emerald-800'
                    )}
                    title={t('captain.picker.free_count')}
                  >
                    {freeCountIn(room.name)}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <div className="flex gap-1 rounded-xl border border-[#eadfce] bg-[#f5eadc] p-1">
          {filterChips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={() => setStatusFilter(chip.key)}
              className={cn(
                'flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-semibold transition-colors',
                statusFilter === chip.key ? 'bg-white text-[#3f2a20] shadow-sm' : 'text-[#8f6b55]'
              )}
            >
              {chip.label}
              <span className="text-xs tabular-nums opacity-70">{countBy(chip.key)}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain p-3">
        {!hasLoaded && isLoading ? (
          <Spinner message={t('common.loading_tables')} />
        ) : error && !hasLoaded ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-red-500">
            <AlertTriangle className="h-8 w-8" />
            <p className="text-sm">{error}</p>
          </div>
        ) : rooms.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-[#9a7e6b]">
            <AlertTriangle className="h-8 w-8" />
            <p className="text-sm">{t('captain.no_rooms')}</p>
          </div>
        ) : visibleTables.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-[#9a7e6b]">
            <Square className="h-8 w-8" />
            <p className="text-sm">{term ? t('captain.picker.no_match') : t('captain.no_tables_in_room')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {visibleTables.map((table) => {
              const order = activeOrders.get(table.name);
              const ownership = resolveOwnership(table);
              const ownerName = order ? ownerNames.get(order.waiter) ?? order.waiter : undefined;
              const mergePartners = getMergeGroupMembers(table, allTables).filter((n) => n !== table.name);

              return (
                <CaptainTableCard
                  key={table.name}
                  table={table}
                  order={order}
                  ownership={ownership}
                  ownerName={ownership === 'mine' ? undefined : ownerName}
                  mergePartners={mergePartners}
                  roomLabel={term ? table.restaurant_room : undefined}
                  isSelected={table.name === selectedTable}
                  onTap={() => handleTap(table)}
                />
              );
            })}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-t border-[#eadfce] bg-[#fffaf0] px-3 py-2 text-xs text-[#8f6b55]">
        <LegendDot className="bg-emerald-400" label={t('captain.status.free')} />
        <LegendDot className="bg-sky-400" label={t('captain.status.mine')} />
        <LegendDot className="bg-amber-400" label={t('captain.status.occupied')} />
        <LegendDot className="bg-slate-400" label={t('captain.status.billed')} />
      </div>
    </SlideOverPanel>
  );
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={cn('h-2.5 w-2.5 rounded-full', className)} />
      {label}
    </span>
  );
}
