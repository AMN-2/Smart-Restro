import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Layout, LayoutGrid, Loader2, RefreshCw } from 'lucide-react';
import { usePOSStore } from '../store/pos-store';
import { useRootStore } from '../store/root-store';
import { getRooms, getTableCount, getVacantTablesForBranch, mergeTablesBatch, unmergeTables, type Room, type Table } from '../lib/table-api';
import { getTableReservationStatus, type ReservationsByTable } from '../lib/reservation-api';
import { getMergeGroupMembers, formatMergedTableLabelFromGroup, getTableRenderGroups } from '../lib/table-utils';
import { Spinner, ErrorState, EmptyState } from '@ury/ui';
import { Button } from '@ury/ui';
import { Badge } from '@ury/ui';
import { DINE_IN } from '../data/order-types';
import { captainTransfer, getTableOrder, tableTransfer } from '../lib/order-api';
import { printOrder } from '../lib/print';
import { resolvePrintFormat } from '../lib/invoice-api';
import { canCaptainTransfer, isUserRestrictedFromTableOrders } from '@ury/core';
import { showToast } from '@ury/ui';
import { t } from '../i18n';
import LayoutView from '../components/LayoutView';
import TableMergeDialog from '../components/TableMergeDialog';
import TableUnmergeDialog from '../components/TableUnmergeDialog';
import TableTransferDialog from '../components/TableTransferDialog';
import CaptainTransferDialog from '../components/CaptainTransferDialog';
import TableCard from '../components/TableCard';
import { ALL_ROOMS, useRoomTables } from '../hooks/useRoomTables';
import MergeLinkConnector from '../components/MergeLinkConnector';

type StatusFilter = 'all' | 'occupied' | 'available';

const STATUS_FILTER_KEY = 'ury_pos_tables_status_filter';
/** The earlier on/off "occupied only" toggle; still honoured on first read. */
const OCCUPIED_ONLY_KEY = 'ury_pos_tables_occupied_only';

/** Per-device convenience: storage can be blocked, and that is fine. */
function readStatusFilter(): StatusFilter {
  try {
    const stored = localStorage.getItem(STATUS_FILTER_KEY);
    if (stored === 'all' || stored === 'occupied' || stored === 'available') return stored;
    return localStorage.getItem(OCCUPIED_ONLY_KEY) === '1' ? 'occupied' : 'all';
  } catch {
    return 'all';
  }
}

const STATUS_FILTERS: Array<{ value: StatusFilter; labelKey: string; dot?: string }> = [
  { value: 'all', labelKey: 'tables.filter_all' },
  { value: 'occupied', labelKey: 'tables.occupied', dot: 'bg-amber-400' },
  { value: 'available', labelKey: 'tables.available', dot: 'bg-emerald-500' },
];

const TableView = () => {
  const navigate = useNavigate();
  const { posProfile, setSelectedTable, setSelectedOrderType, tableSearchQuery } = usePOSStore();
  const user = useRootStore((state) => state.user);
  const showCaptainTransfer = canCaptainTransfer(user, posProfile);
  const isRestricted = isUserRestrictedFromTableOrders(user, posProfile);

  const branch = posProfile?.branch ?? null;
  const attentionMinutes = Number(posProfile?.tableAttention) || 0;

  // "Occupied" is how a busy floor is worked: the free tables are noise
  // while bills are being chased; "available" is for seating a walk-in.
  // Remembered per device.
  const [statusFilter, setStatusFilterState] = useState<StatusFilter>(readStatusFilter);
  const setStatusFilter = (next: StatusFilter) => {
    setStatusFilterState(next);
    try {
      localStorage.setItem(STATUS_FILTER_KEY, next);
    } catch {
      /* blocked storage: the filter still works for this visit */
    }
  };

  // A minute clock, so open times and the red "needs attention" state move
  // while the screen is left up, without refetching the floor.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [reservations, setReservations] = useState<ReservationsByTable>({});
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);
  const [loadingRooms, setLoadingRooms] = useState(false);
  const [roomCounts, setRoomCounts] = useState<Record<string, number>>({});

  const [roomsError, setRoomsError] = useState<string | null>(null);
  const roomRequest = useRef(0);
  const { tables, loading: loadingTables, refreshing: refreshingTables,
    error: tablesError, lastUpdated, loadTables } = useRoomTables(selectedRoom, branch);
  const error = roomsError || tablesError;
  const [printingTable, setPrintingTable] = useState<string | null>(null);
  const [menuOpenForTable, setMenuOpenForTable] = useState<string | null>(null);
  const [mergeSourceTable, setMergeSourceTable] = useState<Table | null>(null);
  const [unmergeSourceTable, setUnmergeSourceTable] = useState<Table | null>(null);
  const [transferSourceTable, setTransferSourceTable] = useState<Table | null>(null);
  const [transferInvoiceName, setTransferInvoiceName] = useState<string | null>(null);
  const [transferDestinationTables, setTransferDestinationTables] = useState<Table[]>([]);
  const [transferDestinationsLoading, setTransferDestinationsLoading] = useState(false);
  const [captainTransferContext, setCaptainTransferContext] = useState<{
    table: Table;
    invoiceName: string;
    currentCaptain: string;
  } | null>(null);

  const persistRoomCounts = useCallback((counts: Record<string, number>) => {
    if (!branch) return;
    sessionStorage.setItem(`ury_room_counts_${branch}`, JSON.stringify(counts));
  }, [branch]);

  const fetchRooms = useCallback(async () => {
    const id = ++roomRequest.current;
    if (!branch) return;
    setLoadingRooms(true);
    setRoomsError(null);
    try {
      const fetchedRooms = await getRooms(branch);
      if (id !== roomRequest.current) return;
      setRooms(fetchedRooms);
      setSelectedRoom((current) => fetchedRooms.some((item) => item.name === current)
        ? current : fetchedRooms[0]?.name ?? null);
    } catch {
      if (id === roomRequest.current) setRoomsError(t('errors.failed_load_rooms'));
    } finally {
      if (id === roomRequest.current) setLoadingRooms(false);
    }
  }, [branch]);

  useEffect(() => {
    setRooms([]);
    setSelectedRoom(null);
    setRoomCounts({});
    void fetchRooms();
    return () => { roomRequest.current++; };
  }, [fetchRooms]);

  useEffect(() => {
    if (!branch || rooms.length === 0) return;
    const cacheKey = `ury_room_counts_${branch}`;
    const cachedCounts = sessionStorage.getItem(cacheKey);
    let shouldFetch = true;

    if (cachedCounts) {
      try {
        const parsedCounts = JSON.parse(cachedCounts) as Record<string, number>;
        setRoomCounts(parsedCounts);
        const hasAllRooms = rooms.every((room) => typeof parsedCounts[room.name] === 'number');
        if (hasAllRooms) {
          shouldFetch = false;
        }
      } catch {
        sessionStorage.removeItem(cacheKey);
      }
    }

    if (!shouldFetch) return;

    async function fetchRoomCounts() {
      try {
        const counts = await Promise.all(
          rooms.map((room) => getTableCount(room.name, room.branch))
        );
        const nextCounts = rooms.reduce((acc, room, index) => {
          acc[room.name] = counts[index];
          return acc;
        }, {} as Record<string, number>);
        setRoomCounts(nextCounts);
        persistRoomCounts(nextCounts);
      } catch (error) {
        console.error('Failed to load room counts', error);
      }
    }

    fetchRoomCounts();
  }, [branch, rooms, persistRoomCounts]);

  const isAllRooms = selectedRoom === ALL_ROOMS;

  const handleNavigateToPOS = (table: Table) => {
    if (!selectedRoom) return;

    // Check if user is restricted from taking table orders
    if (isUserRestrictedFromTableOrders(user, posProfile)) {
      showToast.error(t('errors.dine_in_restricted') || 'Dine In is not available for your role');
      return;
    }

    setSelectedOrderType(DINE_IN);
    setSelectedTable(table.name, table.restaurant_room || selectedRoom);
    navigate('/pos');
  };

  const handlePreviewTable = (table: Table, event?: MouseEvent<HTMLButtonElement>) => {
    event?.stopPropagation();
    handleNavigateToPOS(table);
  };

  const handlePrintTable = async (table: Table, event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();

    if (!posProfile) {
      showToast.error('POS profile not loaded yet');
      return;
    }

    setPrintingTable(table.name);
    try {
      const orderResponse = await getTableOrder(table.name);
      const invoiceId = orderResponse.message?.name;

      if (!invoiceId) {
        showToast.error('No active order found for this table');
        return;
      }

      await printOrder({
        orderId: invoiceId,
        posProfile,
        printFormat: resolvePrintFormat(
          orderResponse.message ?? {},
          posProfile.print_format
        ),
      });
      showToast.success('Printed successfully');
      await loadTables(selectedRoom, { useCache: false });
    } catch (error) {
      showToast.error(error instanceof Error ? error.message : 'Failed to print order');
    } finally {
      setPrintingTable(null);
    }
  };

  const handleMergeConfirm = async (targetNames: string[]) => {
    if (!mergeSourceTable || targetNames.length === 0) return;

    const sourceName = mergeSourceTable.name;

    try {
      await mergeTablesBatch(sourceName, targetNames);
      if (selectedRoom) {
        await loadTables(selectedRoom, { useCache: false });
      }
      showToast.success(t('tables.merge_success'));
    } catch (error) {
      showToast.error(error instanceof Error ? error.message : t('tables.merge_failed'));
      throw error;
    }
  };

  const handleUnmergeConfirm = async () => {
    if (!unmergeSourceTable) return;

    try {
      await unmergeTables(unmergeSourceTable.name);
      if (selectedRoom) {
        await loadTables(selectedRoom, { useCache: false });
      }
      showToast.success(t('tables.unmerge_success'));
    } catch (error) {
      showToast.error(error instanceof Error ? error.message : t('tables.unmerge_failed'));
      throw error;
    }
  };

  const validateActiveTableOrder = async (tableName: string) => {
    const orderResponse = await getTableOrder(tableName);
    const invoice = orderResponse.message;

    if (!invoice?.name) {
      throw new Error(t('tables.no_active_order'));
    }
    if (invoice.invoice_printed === 1) {
      throw new Error(t('tables.order_already_billed'));
    }

    return invoice;
  };

  const handleOpenTransferTable = async (table: Table) => {
    if (getMergeGroupMembers(table, tables).length > 1) {
      showToast.error(t('tables.transfer_not_for_merged'));
      return;
    }

    if (!branch) {
      showToast.error(t('tables.transfer_failed'));
      return;
    }

    setTransferSourceTable(table);
    setTransferInvoiceName(null);
    setTransferDestinationTables([]);
    setTransferDestinationsLoading(true);

    try {
      const invoice = await validateActiveTableOrder(table.name);
      const destinations = await getVacantTablesForBranch(branch, table.name);
      setTransferDestinationTables(destinations);
      setTransferInvoiceName(invoice.name);
    } catch (error) {
      setTransferSourceTable(null);
      setTransferInvoiceName(null);
      setTransferDestinationTables([]);
      showToast.error(error instanceof Error ? error.message : t('tables.transfer_failed'));
    } finally {
      setTransferDestinationsLoading(false);
    }
  };

  const handleOpenCaptainTransfer = async (table: Table) => {
    try {
      const invoice = await validateActiveTableOrder(table.name);
      if (!invoice.waiter) {
        throw new Error(t('tables.no_active_order'));
      }
      setCaptainTransferContext({
        table,
        invoiceName: invoice.name,
        currentCaptain: invoice.waiter,
      });
    } catch (error) {
      showToast.error(error instanceof Error ? error.message : t('tables.transfer_failed'));
    }
  };

  const handleTableTransferConfirm = async (newTable: string) => {
    if (!transferSourceTable || !transferInvoiceName) return;

    try {
      await tableTransfer(transferSourceTable.name, newTable, transferInvoiceName);
      if (selectedRoom) {
        await loadTables(selectedRoom, { useCache: false });
      }
      showToast.success(t('tables.transfer_success'));
    } catch (error) {
      showToast.error(error instanceof Error ? error.message : t('tables.transfer_failed'));
      throw error;
    }
  };

  const handleCaptainTransferConfirm = async (newCaptain: string) => {
    if (!captainTransferContext) return;

    const { currentCaptain, invoiceName } = captainTransferContext;

    try {
      await captainTransfer(currentCaptain, newCaptain, invoiceName);
      if (selectedRoom) {
        await loadTables(selectedRoom, { useCache: false });
      }
      showToast.success(t('tables.captain_transfer_success'));
    } catch (error) {
      showToast.error(error instanceof Error ? error.message : t('tables.transfer_failed'));
      throw error;
    }
  };

  const mergeAvailableTables = useMemo(() => {
    if (!mergeSourceTable) return [];
    const sourceCluster = new Set(getMergeGroupMembers(mergeSourceTable, tables));
    return tables.filter((table) => {
      if (table.name === mergeSourceTable.name) return false;
      if (sourceCluster.has(table.name)) return false;
      // The "All rooms" floor lists every room; a merge stays within one.
      if (table.restaurant_room !== mergeSourceTable.restaurant_room) return false;
      if (table.occupied === 1 && mergeSourceTable.occupied === 1) return false;
      return true;
    });
  }, [mergeSourceTable, tables]);

  const tablesToDisplay = useMemo(() => {
    // Already grouped by merge cluster when it was fetched (useRoomTables).
    const needle = tableSearchQuery.trim().toLowerCase();
    const scoped =
      statusFilter === 'all'
        ? tables
        : tables.filter((table) => (table.occupied === 1) === (statusFilter === 'occupied'));
    if (!needle) return scoped;
    // Name and room both: staff say "table 12" and "the terrace", and the
    // header box gives no hint that only one of them would work.
    return scoped.filter(
      (table: Table) =>
        table.name.toLowerCase().includes(needle) ||
        (table.restaurant_room || '').toLowerCase().includes(needle)
    );
  }, [tables, tableSearchQuery, statusFilter]);

  const statusCounts = useMemo(() => {
    const occupied = tables.filter((table) => table.occupied === 1).length;
    return { all: tables.length, occupied, available: tables.length - occupied };
  }, [tables]);

  const unmergeGroupMembers = useMemo(() => {
    if (!unmergeSourceTable) return [];
    return getMergeGroupMembers(unmergeSourceTable, tablesToDisplay);
  }, [unmergeSourceTable, tablesToDisplay]);

  const tableRenderGroups = useMemo(() => getTableRenderGroups(tablesToDisplay), [tablesToDisplay]);

  // One section per room, rooms in the order they were fetched (natural
  // name order). A single room still renders as one unlabelled section.
  const roomSections = useMemo(() => {
    const sections = new Map<string, Table[][]>();
    for (const group of tableRenderGroups) {
      const room = isAllRooms ? group[0]?.restaurant_room || '' : '';
      const list = sections.get(room);
      if (list) list.push(group);
      else sections.set(room, [group]);
    }
    return [...sections.entries()].map(([room, groups]) => ({
      room,
      groups,
      occupied: groups.flat().filter((table) => table.occupied === 1).length,
      total: groups.flat().length,
    }));
  }, [tableRenderGroups, isAllRooms]);

  // Refreshed on a timer, not once: "booked in twenty minutes" becomes
  // "booked now" while the cashier is looking at the same screen, and a
  // stale hint is the one that lets a walk-in take a booked table.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const next = await getTableReservationStatus();
      if (!cancelled) setReservations(next);
    };
    load();
    const timer = window.setInterval(load, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  /** `index` is the card's position in the room grid; it only staggers the
      entrance animation, so a missing value just means "animate with the
      first group". */
  const renderTableCard = (table: Table, className?: string, index = 0) => {
    const mergeMembers = getMergeGroupMembers(table, tables);
    const mergeGroupLabel =
      mergeMembers.length > 1 ? formatMergedTableLabelFromGroup(mergeMembers) : undefined;
    const canTransferTable = table.occupied === 1 && mergeMembers.length <= 1;

    return (
    <TableCard
      key={table.name}
      index={index}
      table={table}
      reservation={reservations[table.name]}
      mergeGroupLabel={mergeGroupLabel}
      className={className}
      menuOpen={menuOpenForTable === table.name}
      onMenuOpenChange={(open) => setMenuOpenForTable(open ? table.name : null)}
      onMerge={() => setMergeSourceTable(table)}
      onUnmerge={() => setUnmergeSourceTable(table)}
      onTransferTable={canTransferTable ? () => void handleOpenTransferTable(table) : undefined}
      onTransferCaptain={() => void handleOpenCaptainTransfer(table)}
      showCaptainTransfer={showCaptainTransfer}
      onNavigate={() => handleNavigateToPOS(table)}
      onPreview={(event) => handlePreviewTable(table, event)}
      onPrint={(event) => handlePrintTable(table, event)}
      isPrinting={printingTable === table.name}
      isRestricted={isRestricted}
      attentionMinutes={attentionMinutes}
      now={now}
    />
    );
  };

  const hasRooms = rooms.length > 0;
  const showGridSkeleton = loadingTables || loadingRooms;

  const handleRoomChange = (roomName: string) => {
    if (roomName === selectedRoom) {
      loadTables(roomName, { useCache: false });
      return;
    }

    setSelectedRoom(roomName);


  };

  const [isLayoutView, setIsLayoutView] = useState(false);

  const handleLayoutView = () => {
    if (selectedRoom && !isAllRooms) {
      loadTables(selectedRoom, { useCache: false });
    }
    setIsLayoutView(true);
  };

  if (isLayoutView && selectedRoom && !isAllRooms) {
    return (
      <LayoutView
        selectedRoom={selectedRoom}
        tables={tablesToDisplay}
        onBackToGrid={() => setIsLayoutView(false)}
        onRefresh={() => loadTables(selectedRoom, { useCache: false })}
      />
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 bg-white border-b border-gray-200">
        <div className="max-w-screen-xl mx-auto">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap justify-between items-start gap-4">
              <div className="flex flex-wrap gap-2">
                {loadingRooms && (
                  <div className="flex-1 min-w-[160px]">
                    <Spinner message={t('common.loading_rooms')} />
                  </div>
                )}

                {!loadingRooms && !hasRooms && (
                  <div className="flex items-center gap-2 text-gray-500 text-sm">
                    <AlertTriangle className="w-4 h-4" />{t('tables.no_rooms_for_branch')}</div>
                )}

                {rooms.length > 1 && (
                  <Button
                    variant="tab"
                    data-selected={isAllRooms}
                    onClick={() => handleRoomChange(ALL_ROOMS)}
                    className="h-fit"
                  >
                    <LayoutGrid className="me-1.5 h-4 w-4" />
                    {t('tables.all_rooms')}
                    {rooms.every((room) => typeof roomCounts[room.name] === 'number') ? (
                      <Badge variant="outline" className="ms-2 bg-white/60">
                        {rooms.reduce((sum, room) => sum + roomCounts[room.name], 0)}
                      </Badge>
                    ) : null}
                  </Button>
                )}

                {rooms.map((room) => (
                  <Button
                    key={room.name}
                    variant="tab"
                    data-selected={selectedRoom === room.name}
                    onClick={() => handleRoomChange(room.name)}
                    className="h-fit"
                  >
                    {room.name}
                    {typeof roomCounts[room.name] === 'number' ? (
                      <Badge variant="outline" className="ms-2 bg-white/60">
                        {roomCounts[room.name]}
                      </Badge>
                    ) : null}
                  </Button>
                ))}
              </div>

              <div className="flex shrink-0 flex-wrap gap-2">
                <div
                  role="radiogroup"
                  aria-label={t('tables.status_filter')}
                  className="flex items-center rounded-lg border border-gray-200 bg-gray-50 p-0.5"
                >
                  {STATUS_FILTERS.map(({ value, labelKey, dot }) => {
                    const active = statusFilter === value;
                    return (
                      <Button
                        key={value}
                        variant="ghost"
                        size="sm"
                        role="radio"
                        aria-checked={active}
                        disabled={!selectedRoom}
                        onClick={() => setStatusFilter(value)}
                        className={`flex items-center gap-1.5 ${
                          active ? 'bg-white text-gray-900 shadow-sm hover:bg-white' : 'text-gray-500 hover:text-gray-800'
                        }`}
                      >
                        {dot && <span className={`h-2 w-2 rounded-full ${dot}`} aria-hidden="true" />}
                        {t(labelKey)}
                        <span
                          className={`min-w-[1.25rem] rounded-full px-1.5 text-center text-xs tabular-nums ${
                            active ? 'bg-gray-900 text-white' : 'bg-gray-200 text-gray-600'
                          }`}
                        >
                          {statusCounts[value]}
                        </span>
                      </Button>
                    );
                  })}
                </div>
                <Button variant="outline" size="icon" disabled={loadingRooms || loadingTables || refreshingTables}
                  aria-label={t('common.refresh')}
                  onClick={() => selectedRoom ? loadTables(selectedRoom) : fetchRooms()}>
                  <RefreshCw className="h-4 w-4" />
                </Button>
                <Button
                  variant="tab"
                  className="flex items-center gap-2 text-sm"
                  onClick={() => handleLayoutView()}
                  disabled={!selectedRoom || isAllRooms}
                >
                  <Layout className="w-4 h-4" />
                  {t('tables.layout_view')}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto bg-gray-50 p-6">
        <div className="max-w-screen-xl mx-auto h-full">
          {/* Announced but not blocking: the cached grid stays usable while
              the server confirms it. */}
          {refreshingTables && (
            <div
              role="status"
              aria-live="polite"
              className="mb-3 flex items-center justify-center gap-2 text-xs text-gray-500"
            >
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
              {t('tables.refreshing')}
            </div>
          )}
          {tablesError && tables.length > 0 && !loadingTables && (
            <div role="alert" className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <span>{t('tables.stale_data')}</span>
              <Button variant="outline" size="sm" onClick={() => loadTables(selectedRoom)}>{t('common.retry')}</Button>
            </div>
          )}
          {lastUpdated && (
            <p className="mb-3 text-xs text-muted-foreground">
              {t('tables.last_updated', { time: lastUpdated.toLocaleTimeString() })}
            </p>
          )}
          {error && (roomsError || tables.length === 0) && !loadingTables ? (
            <ErrorState
              className="h-full"
              title={t(roomsError ? 'errors.failed_load_rooms' : 'errors.failed_load_tables')}
              description={error}
              retryLabel={t('common.retry')}
              // Cache bypassed: the previous attempt failed, so whatever is
              // cached is either absent or the reason we are here.
              onRetry={() => roomsError ? fetchRooms() : loadTables(selectedRoom)}
            />
          ) : showGridSkeleton ? (
            <Spinner message={t('common.loading_tables')} />
          ) : tablesToDisplay.length === 0 ? (
            <EmptyState
              className="h-full"
              illustration="tables"
              title={t(
                statusFilter !== 'all' && tables.length > 0
                  ? statusFilter === 'occupied' ? 'tables.no_occupied_tables' : 'tables.no_available_tables'
                  : 'tables.no_tables_found'
              )}
              action={
                statusFilter !== 'all' && tables.length > 0 ? (
                  <Button variant="outline" onClick={() => setStatusFilter('all')}>
                    {t('tables.show_all_tables')}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="space-y-6 pb-10">
              {roomSections.map((section) => (
                <section key={section.room || 'room'} aria-label={section.room || undefined}>
                  {section.room && (
                    <div className="mb-3 flex items-center gap-3">
                      <h2 className="text-sm font-semibold text-gray-800">{section.room}</h2>
                      <span className="text-xs text-gray-500 tabular-nums">
                        {t('tables.room_summary', { occupied: section.occupied, total: section.total })}
                      </span>
                      <div className="h-px flex-1 bg-gray-200" aria-hidden="true" />
                    </div>
                  )}
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,13rem),1fr))] gap-4">
                    {section.groups.map((group, groupIndex) =>
                      group.length === 1 ? (
                        renderTableCard(group[0], undefined, groupIndex)
                      ) : (
                        <div
                          key={group.map((t) => t.name).join('-')}
                          className="col-span-full flex flex-wrap items-stretch gap-y-2 rounded-lg border border-blue-200/70 bg-blue-50/40 p-2"
                        >
                          {group.map((table, index) => (
                            <Fragment key={table.name}>
                              {renderTableCard(
                                table,
                                'min-w-[9.5rem] flex-1 basis-[calc(50%-1.5rem)] sm:basis-[calc(33.333%-1.5rem)] md:min-w-[10rem] md:max-w-[14rem]',
                                groupIndex
                              )}
                              {index < group.length - 1 && (
                                <MergeLinkConnector
                                  leftTable={table.name}
                                  rightTable={group[index + 1].name}
                                />
                              )}
                            </Fragment>
                          ))}
                        </div>
                      )
                    )}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>

      <TableMergeDialog
        open={mergeSourceTable !== null}
        onOpenChange={(open) => {
          if (!open) setMergeSourceTable(null);
        }}
        sourceTable={mergeSourceTable}
        availableTables={mergeAvailableTables}
        onConfirm={handleMergeConfirm}
      />

      <TableUnmergeDialog
        open={unmergeSourceTable !== null}
        onOpenChange={(open) => {
          if (!open) setUnmergeSourceTable(null);
        }}
        sourceTable={unmergeSourceTable}
        groupMembers={unmergeGroupMembers}
        onConfirm={handleUnmergeConfirm}
      />

      <TableTransferDialog
        open={transferSourceTable !== null}
        onOpenChange={(open) => {
          if (!open) {
            setTransferSourceTable(null);
            setTransferInvoiceName(null);
            setTransferDestinationTables([]);
          }
        }}
        sourceTable={transferSourceTable}
        destinationTables={transferDestinationTables}
        loading={transferDestinationsLoading}
        onConfirm={handleTableTransferConfirm}
      />

      <CaptainTransferDialog
        open={captainTransferContext !== null}
        onOpenChange={(open) => {
          if (!open) setCaptainTransferContext(null);
        }}
        currentCaptain={captainTransferContext?.currentCaptain ?? ''}
        onConfirm={handleCaptainTransferConfirm}
      />

      {/* Status Legend */}
      <div className="fixed bottom-[4.5rem] w-full p-4 bg-white border-t border-gray-200">
        <div className="max-w-screen-xl mx-auto">
          <div className="flex items-center justify-center gap-6 text-sm">
            <div className="flex items-center gap-2">
              <div className="h-3 w-3 rounded-full bg-emerald-500"></div>
              <span>{t('tables.available')}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-3 w-3 rounded-full bg-amber-400"></div>
              <span>{t('tables.occupied')}</span>
            </div>
            {attentionMinutes > 0 && (
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-red-500"></div>
                <span>{t('tables.needs_attention')}</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 bg-blue-50/40 border border-blue-200/70 rounded"></div>
              <span>{t('tables.merged')}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default TableView;
