import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronDown, ChevronUp, Loader2, Send, ShoppingBasket, Table2 } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  cn,
  showToast,
} from '@ury/ui';
import { formatCurrency, flt, parseFrappeError } from '@ury/core';
import { usePOSStore, type MenuItem, type OrderItem } from '../../store/pos-store';
import { useRootStore, type RootState } from '../../store/root-store';
import {
  captainTransfer,
  reprintKot,
  syncOrder,
  type SyncOrderRequest,
  tableTransfer,
} from '../../lib/order-api';
import { printOrder } from '../../lib/print';
import { connectivity } from '../../lib/connectivity';
import { enqueueOrder, newRequestId } from '../../lib/sync-queue';
import { resolvePrintFormat } from '../../lib/invoice-api';
import { getVacantTablesForBranch, type Table } from '../../lib/table-api';
import { useViewportClass } from '../../hooks/useViewport';
import { DINE_IN } from '../../data/order-types';
import { useCaptainContext } from '../hooks/useCaptainContext';
import { useTableOrderContext } from '../hooks/useTableOrderContext';
import CaptainMenu from '../components/CaptainMenu';
import CaptainOrderPanel from '../components/CaptainOrderPanel';
import CaptainTablePicker from '../components/CaptainTablePicker';
import CaptainActionsMenu from '../components/CaptainActionsMenu';
import ProductDialog from '../../components/ProductDialog';
import SlideOverPanel from '../../components/SlideOverPanel';
import TableTransferDialog from '../../components/TableTransferDialog';
import CaptainTransferDialog from '../../components/CaptainTransferDialog';
import { t, tPlural } from '../../i18n';
import RemoteChangeBanner from '../../components/RemoteChangeBanner';
import { floorUpdateTouches, isOwnEcho, useFloorUpdates } from '../../lib/floor-sync';

/**
 * Captain workspace (`/order`): one screen, built like the Cashier POS —
 * menu on one side, the live ticket on the other — instead of the old
 * tables screen → order screen → menu/order toggle.
 *
 * The table is a property of the order, not a step before it. It lives in
 * the URL (`?table=`) and is picked from a sheet over the workspace, so
 * picking or switching never leaves the menu. A captain can also start
 * tapping items first; whatever is in the cart when they pick a table is
 * carried onto it.
 *
 * Per-table authorization comes from `get_table_order_context()` via
 * `useTableOrderContext` — NOT from `useCaptainContext()`'s session-level
 * `capabilities`, which know nothing about ownership/billed-state for a
 * specific table. The server re-validates every mutation regardless.
 */
export default function CaptainWorkspace() {
  const [searchParams, setSearchParams] = useSearchParams();
  const table = searchParams.get('table') || undefined;
  const user = useRootStore((state: RootState) => state.user);

  const {
    context: captainContext,
    capabilities,
    branch,
    rooms: assignedRooms,
  } = useCaptainContext();

  const {
    context,
    permissions,
    isContextLoading,
    contextError,
    isOrderReady,
    alreadyOrderedLines,
    newOrChangedLines,
    reductionPendingLines,
    reload: reloadTableOrder,
  } = useTableOrderContext(table);

  const {
    activeOrders,
    addToOrder,
    setSelectedItem,
    isUpdatingOrder,
    orderId,
    posProfile,
    paymentModes,
    orderComment,
    noOfPax,
    lastModifiedTime,
    selectedRoom,
    selectedCustomer,
    clearTableOrder,
  } = usePOSStore();

  const viewport = useViewportClass();
  const docked = viewport === 'medium' || viewport === 'wide';

  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [isOrderSheetOpen, setIsOrderSheetOpen] = useState(false);
  const [isCustomizing, setIsCustomizing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingSwitch, setPendingSwitch] = useState<Table | null>(null);

  const [isActionsMenuOpen, setIsActionsMenuOpen] = useState(false);
  const [isReprintingKot, setIsReprintingKot] = useState(false);
  const [isPrintingBill, setIsPrintingBill] = useState(false);
  const [isTransferTableOpen, setIsTransferTableOpen] = useState(false);
  const [transferDestinations, setTransferDestinations] = useState<Table[]>([]);
  const [isTransferDestinationsLoading, setIsTransferDestinationsLoading] = useState(false);
  const [isTransferCaptainOpen, setIsTransferCaptainOpen] = useState(false);

  /** Items waiting to be carried onto the table being opened. */
  const pendingDraftRef = useRef<OrderItem[] | null>(null);

  // With no table, the whole cart is a draft the captain is free to build.
  const canModify = table ? permissions?.modify ?? false : true;
  const canReduce = permissions?.reduce_items ?? false;
  const canRemove = permissions?.remove_items ?? false;
  const canView = table ? permissions?.view ?? false : true;

  const hasUnsentChanges = newOrChangedLines.length > 0 || reductionPendingLines.length > 0;

  // Live: the open table's order changed on another device (a cashier added
  // items, it was paid, cancelled, transferred, merged…). With nothing unsent
  // it is simply re-read; with unsent lines the captain chooses via the
  // banner, so neither side's work disappears without a word.
  useFloorUpdates((update) => {
    if (!table || !isOrderReady) return;
    const invoice = usePOSStore.getState().orderId ?? context?.order?.name ?? null;
    if (!floorUpdateTouches(update, { invoice, tables: [table] })) return;
    if (isOwnEcho(update, user?.name)) return;
    if (isSubmitting) return;
    if (hasUnsentChanges) {
      usePOSStore.setState({ remoteChange: { by: update.by } });
      return;
    }
    reloadTableOrder();
    showToast.info(t('live.order_refreshed'));
  }, { branch });

  const goToTable = useCallback(
    (name: string | null) => {
      // Leaving a table also forgets it in the (persisted) store, so a
      // reload of the empty workspace doesn't mistake the next draft for
      // that table's cart.
      if (!name) usePOSStore.getState().setSelectedTable(null, null);
      setSearchParams(name ? { table: name } : {}, { replace: true });
    },
    [setSearchParams]
  );

  // Captains only take dine-in orders. The shared pos-store may still hold
  // the Cashier's last order type or table cart (it is persisted), which
  // would price the menu wrongly or pose as this captain's draft.
  useEffect(() => {
    const store = usePOSStore.getState();
    if (store.selectedOrderType !== DINE_IN) store.setSelectedOrderType(DINE_IN);
    if (!table && (store.selectedTable || store.isUpdatingOrder)) store.setSelectedTable(null, null);
    // Opening onto an empty workspace, the first thing a captain does is
    // pick a table — so offer the picker straight away.
    if (!table && usePOSStore.getState().activeOrders.length === 0) setIsPickerOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Carry the draft onto the table once its own order has loaded, so the
  // carried items land as new lines on top of the baseline.
  useEffect(() => {
    const draft = pendingDraftRef.current;
    if (!draft || !(isOrderReady || contextError)) return;
    pendingDraftRef.current = null;

    if (table && (contextError || !canModify)) {
      // The table failed to open or opened read-only (billed, or another
      // captain's): put the draft back rather than lose it, and let the
      // captain pick again.
      pendingDraftRef.current = draft;
      showToast.error(t('captain.table_locked_draft_kept', { table }));
      goToTable(null);
      setIsPickerOpen(true);
      return;
    }

    draft.forEach((item) => addToOrder({ ...item }));
    if (table) showToast.info(t('captain.draft_moved', { table }));
  }, [isOrderReady, contextError, table, canModify, addToOrder, goToTable]);

  const snapshotNewItems = (): OrderItem[] =>
    newOrChangedLines
      .map((line) => {
        const item = activeOrders.find((i) => i.uniqueId === line.uniqueId);
        return item ? { ...item, quantity: line.delta } : null;
      })
      .filter((item): item is OrderItem => item !== null);

  const handleSelectTable = (picked: Table) => {
    setIsPickerOpen(false);
    if (picked.name === table) return;

    if (!table) {
      if (activeOrders.length > 0) pendingDraftRef.current = activeOrders.map((i) => ({ ...i }));
      goToTable(picked.name);
      return;
    }

    if (hasUnsentChanges) {
      setPendingSwitch(picked);
      return;
    }
    goToTable(picked.name);
  };

  const confirmSwitch = (carryNewItems: boolean) => {
    if (!pendingSwitch) return;
    pendingDraftRef.current = carryNewItems ? snapshotNewItems() : null;
    goToTable(pendingSwitch.name);
    setPendingSwitch(null);
  };

  const handleCustomize = (item: MenuItem) => {
    if (!canModify) return;
    setSelectedItem(item);
    setIsCustomizing(true);
  };

  /** Back to an empty workspace, ready for the next table. */
  const finishOrder = () => {
    setIsOrderSheetOpen(false);
    goToTable(null);
  };

  const handleSend = async () => {
    if (!table) {
      setIsPickerOpen(true);
      return;
    }
    if (!posProfile) {
      showToast.error(t('captain.errors.no_pos_profile'));
      return;
    }
    if (!user?.name) {
      showToast.error(t('captain.errors.not_logged_in'));
      return;
    }
    if (!canModify) {
      showToast.error(t('captain.errors.no_permission'));
      return;
    }
    if (activeOrders.length === 0) {
      showToast.error(t('captain.errors.empty_order'));
      return;
    }

    setIsSubmitting(true);
    try {
      // `customer` must still be sent (sync_order takes it positionally), but
      // it may be empty: the server then bills the table.
      const orderData: SyncOrderRequest = {
        items: activeOrders.map((item) => ({
          item: item.id,
          item_name: item.name,
          rate: item.selectedVariant?.price || item.price,
          qty: item.quantity,
          comment: item.comment || undefined,
        })),
        no_of_pax: noOfPax,
        pos_profile: posProfile.name,
        order_type: DINE_IN,
        table,
        room: selectedRoom || undefined,
        customer: selectedCustomer?.name || '',
        cashier: posProfile.cashier,
        owner: posProfile.owner,
        mode_of_payment: paymentModes[0],
        last_invoice: isUpdatingOrder ? orderId : null,
        last_modified_time: isUpdatingOrder ? lastModifiedTime || undefined : undefined,
        invoice: isUpdatingOrder ? orderId : null,
        waiter: user.name,
        comments: orderComment || undefined,
      };

      // One key per submission attempt, carried through a queued retry so
      // the server recognises a delivery we never heard the answer to
      // rather than cooking it twice.
      const requestId = newRequestId();
      const payload = { ...orderData, request_id: requestId };

      if (connectivity.getState() === 'offline') {
        enqueueOrder({ request_id: requestId, queued_at: Date.now(), label: table, payload });
        // Said plainly: the kitchen has NOT seen this.
        showToast.warning(t('offline.order_queued'));
        finishOrder();
        return;
      }

      const result = await syncOrder(payload);

      if (
        result?.message &&
        typeof result.message === 'object' &&
        'status' in result.message &&
        result.message.status === 'Failure'
      ) {
        showToast.error(isUpdatingOrder ? t('captain.errors.modified_elsewhere') : t('captain.errors.send_failed'));
        return;
      }

      showToast.success(
        isUpdatingOrder ? t('captain.success.order_updated', { table }) : t('captain.success.order_sent', { table })
      );
      finishOrder();
    } catch (error) {
      console.error('Failed to sync order:', error);
      showToast.error(parseFrappeError(error, t('captain.errors.send_failed')));
    } finally {
      setIsSubmitting(false);
    }
  };

  // Secondary actions operate on the confirmed invoice for this table, not
  // the in-progress cart — `orderId` is what `handleSend`'s `last_invoice` uses.
  const invoiceId = orderId ?? context?.order?.name ?? null;
  const canReprintKot = permissions?.reprint_kot ?? false;
  const canTransferTable = permissions?.transfer_table ?? false;
  const canTransferCaptain = permissions?.transfer_captain ?? false;
  const canPrintBill = permissions?.print_bill ?? false;
  const currentCaptain = context?.assignment?.waiter ?? '';

  const handleReprintKot = async () => {
    if (!invoiceId) {
      showToast.error(t('captain.errors.no_order_reprint'));
      return;
    }
    setIsReprintingKot(true);
    try {
      await reprintKot(invoiceId);
      showToast.success(t('captain.success.kot_reprinted'));
    } catch (error) {
      showToast.error(parseFrappeError(error, t('captain.errors.api_error')));
    } finally {
      setIsReprintingKot(false);
    }
  };

  const handlePrintBill = async () => {
    if (!invoiceId) {
      showToast.error(t('captain.errors.no_order_print'));
      return;
    }
    if (!posProfile) {
      showToast.error(t('captain.errors.no_pos_profile'));
      return;
    }
    setIsPrintingBill(true);
    try {
      await printOrder({
        orderId: invoiceId,
        posProfile,
        printFormat: resolvePrintFormat(context?.order ?? {}, posProfile.print_format),
      });
      showToast.success(t('captain.success.printed'));
    } catch (error) {
      showToast.error(parseFrappeError(error, t('captain.errors.api_error')));
    } finally {
      setIsPrintingBill(false);
    }
  };

  const handleOpenTransferTable = async () => {
    if (!invoiceId || !table) {
      showToast.error(t('captain.errors.no_order_transfer'));
      return;
    }
    const tableBranch = posProfile?.branch;
    if (!tableBranch) {
      showToast.error(t('captain.errors.transfer_unavailable'));
      return;
    }
    setTransferDestinations([]);
    setIsTransferDestinationsLoading(true);
    setIsTransferTableOpen(true);
    try {
      setTransferDestinations(await getVacantTablesForBranch(tableBranch, table));
    } catch (error) {
      setIsTransferTableOpen(false);
      showToast.error(parseFrappeError(error, t('captain.errors.api_error')));
    } finally {
      setIsTransferDestinationsLoading(false);
    }
  };

  const handleTableTransferConfirm = async (newTable: string) => {
    if (!table || !invoiceId) return;
    await tableTransfer(table, newTable, invoiceId);
    showToast.success(t('captain.success.table_transferred'));
    // Follow the order to its new table instead of dropping the captain
    // back on an empty screen.
    clearTableOrder();
    goToTable(newTable);
  };

  const handleCaptainTransferConfirm = async (newCaptain: string) => {
    if (!invoiceId) return;
    await captainTransfer(currentCaptain, newCaptain, invoiceId);
    showToast.success(t('captain.success.captain_transferred'));
    finishOrder();
  };

  const total = flt(
    activeOrders.reduce((sum, item) => {
      const basePrice = item.selectedVariant?.price || item.price;
      const addons = item.selectedAddons?.reduce((a, addon) => a + addon.price, 0) || 0;
      return sum + (basePrice + addons) * item.quantity;
    }, 0),
    2
  );

  const tableStatus = !table
    ? t('captain.tap_to_choose')
    : isContextLoading || !isOrderReady
      ? t('common.loading')
      : !canView
        ? t('errors.not_permitted')
        : isUpdatingOrder
          ? t('captain.updating_order')
          : t('captain.new_order');

  const tableRoom = (context?.table?.restaurant_room as string | undefined) ?? selectedRoom ?? '';
  const isTableBlocked = Boolean(table) && (Boolean(contextError) || (Boolean(context) && !canView));

  const orderPanel = (
    <CaptainOrderPanel
      table={table ?? null}
      isReady={!table || isOrderReady}
      canModify={canModify && !isTableBlocked}
      canReduce={canReduce}
      canRemove={canRemove}
      isSubmitting={isSubmitting}
      alreadyOrderedLines={alreadyOrderedLines}
      newOrChangedLines={newOrChangedLines}
      reductionPendingLines={reductionPendingLines}
      onSend={handleSend}
      onPickTable={() => setIsPickerOpen(true)}
      docked={docked}
    />
  );

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-[#f8f4eb]">
      {/* Top bar: the table is the one thing always in view. */}
      <header className="z-20 flex shrink-0 items-center gap-2 border-b border-[#eadfce] bg-[#fffdf8] px-3 py-2.5 sm:px-4">
        <button
          type="button"
          onClick={() => setIsPickerOpen(true)}
          className={cn(
            'flex min-w-0 flex-1 items-center gap-3 rounded-2xl border px-3 py-2 text-start transition-colors sm:flex-none sm:min-w-[16rem]',
            table
              ? 'border-[#eadfce] bg-white hover:border-[#f0b83e]'
              : 'border-[#f05b42] bg-[#fff1ec] ring-4 ring-[#f05b42]/15'
          )}
          aria-label={t('captain.picker.title')}
        >
          <span
            className={cn(
              'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white',
              table ? 'bg-[#3f2a20]' : 'bg-[#f05b42]'
            )}
          >
            <Table2 className="h-5 w-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-base font-bold leading-tight text-[#3f2a20]">
              {table ? t('captain.table_label', { table }) : t('captain.choose_table')}
            </span>
            <span className="block truncate text-xs text-[#8f6b55]">
              {table && tableRoom ? `${tableRoom} · ${tableStatus}` : tableStatus}
            </span>
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-[#8f6b55]" />
        </button>

        <div className="ms-auto flex shrink-0 items-center gap-1">
          {captainContext?.user && (
            <span className="hidden max-w-[12rem] truncate text-sm text-[#8f6b55] md:block">
              {user?.full_name || captainContext.user}
            </span>
          )}
          {table && canView && (
            <CaptainActionsMenu
              isOpen={isActionsMenuOpen}
              onOpenChange={setIsActionsMenuOpen}
              showReprintKot={canReprintKot}
              onReprintKot={handleReprintKot}
              isReprintingKot={isReprintingKot}
              showTransferTable={canTransferTable}
              onTransferTable={handleOpenTransferTable}
              showTransferCaptain={canTransferCaptain}
              onTransferCaptain={() =>
                invoiceId ? setIsTransferCaptainOpen(true) : showToast.error(t('captain.errors.no_order_transfer'))
              }
              showPrintBill={canPrintBill}
              onPrintBill={handlePrintBill}
              isPrintingBill={isPrintingBill}
            />
          )}
        </div>
      </header>

      <RemoteChangeBanner onReload={reloadTableOrder} />
      {isTableBlocked && (
        <div className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          {contextError ? `${t('captain.table_load_failed')}: ${contextError}` : t('captain.view_only_other')}
        </div>
      )}
      {table && !isTableBlocked && context && !canModify && (
        <div className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
          {t('captain.view_only')}
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col">
          <CaptainMenu canAddItems={canModify && !isTableBlocked} onCustomize={handleCustomize} />
        </main>
        {docked && orderPanel}
      </div>

      {/* Phone / portrait tablet: the ticket stays one tap away, and sending
          needs no detour through the sheet. */}
      {!docked && (
        <div className="flex shrink-0 items-center gap-2 border-t border-[#eadfce] bg-[#fffaf0] px-3 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={() => setIsOrderSheetOpen(true)}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-1 py-1 text-start"
          >
            <span className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#3f2a20] text-white">
              <ShoppingBasket className="h-5 w-5" />
              {newOrChangedLines.length > 0 && (
                <span className="absolute -end-1.5 -top-1.5 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-[#f05b42] px-1 text-[11px] font-bold">
                  {newOrChangedLines.reduce((n, l) => n + l.delta, 0)}
                </span>
              )}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-xs font-semibold text-[#8f6b55]">
                {tPlural('order_panel.item_count', activeOrders.length)}
              </span>
              <span className="block text-lg font-bold tabular-nums text-[#3f2a20]">{formatCurrency(total)}</span>
            </span>
            <ChevronUp className="ms-auto h-5 w-5 shrink-0 text-[#8f6b55]" />
          </button>
          {canModify && !isTableBlocked && (
            <Button
              onClick={handleSend}
              className="h-12 shrink-0 gap-2 rounded-xl px-4 text-base font-bold shadow-[0_7px_18px_rgba(240,91,66,0.22)]"
              disabled={isSubmitting || (Boolean(table) && (!isOrderReady || activeOrders.length === 0))}
            >
              {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : table ? <Send className="h-4 w-4" /> : <Table2 className="h-4 w-4" />}
              {!table
                ? t('captain.choose_table')
                : isUpdatingOrder
                  ? t('captain.update_short')
                  : t('captain.send_short')}
            </Button>
          )}
        </div>
      )}

      {!docked && (
        <SlideOverPanel
          isOpen={isOrderSheetOpen}
          onClose={() => setIsOrderSheetOpen(false)}
          title={table ? t('captain.table_label', { table }) : t('order_panel.your_order')}
          className="max-w-lg"
        >
          {orderPanel}
        </SlideOverPanel>
      )}

      <CaptainTablePicker
        isOpen={isPickerOpen}
        onClose={() => setIsPickerOpen(false)}
        branch={branch}
        assignedRooms={assignedRooms}
        currentUser={captainContext?.user ?? null}
        canAccessOtherCaptainsTables={Boolean(capabilities?.canAccessOtherCaptainsTables)}
        selectedTable={table ?? null}
        onSelect={handleSelectTable}
      />

      {isCustomizing && (
        <ProductDialog
          onClose={() => {
            setIsCustomizing(false);
            setSelectedItem(null);
          }}
        />
      )}

      <Dialog open={pendingSwitch !== null} onOpenChange={(open) => !open && setPendingSwitch(null)}>
        <DialogContent size="sm" showCloseButton onClose={() => setPendingSwitch(null)}>
          <DialogHeader>
            <DialogTitle>{t('captain.switch.title')}</DialogTitle>
            <DialogDescription>
              {t('captain.switch.body', { from: table ?? '', to: pendingSwitch?.name ?? '' })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button variant="outline" onClick={() => setPendingSwitch(null)}>
              {t('common.cancel')}
            </Button>
            <Button variant="danger" onClick={() => confirmSwitch(false)}>
              {t('captain.switch.discard')}
            </Button>
            {newOrChangedLines.length > 0 && (
              <Button onClick={() => confirmSwitch(true)}>
                {t('captain.switch.carry', { to: pendingSwitch?.name ?? '' })}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <TableTransferDialog
        open={isTransferTableOpen}
        onOpenChange={(open) => {
          if (!open) {
            setIsTransferTableOpen(false);
            setTransferDestinations([]);
          }
        }}
        sourceTable={
          table
            ? {
                name: table,
                occupied: 1,
                latest_invoice_time: null,
                is_take_away: 0,
                restaurant_room: tableRoom,
                table_shape: 'Rectangle',
              }
            : null
        }
        destinationTables={transferDestinations}
        loading={isTransferDestinationsLoading}
        onConfirm={handleTableTransferConfirm}
      />

      <CaptainTransferDialog
        open={isTransferCaptainOpen}
        onOpenChange={setIsTransferCaptainOpen}
        currentCaptain={currentCaptain}
        onConfirm={handleCaptainTransferConfirm}
      />
    </div>
  );
}
