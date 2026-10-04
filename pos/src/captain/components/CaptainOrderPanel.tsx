import { useMemo, useState } from 'react';
import { ClipboardList, Loader2, MessageSquare, Send, ShoppingBasket, Trash2, Users } from 'lucide-react';
import { AnimatedNumber, Button, Spinner, cn } from '@ury/ui';
import { formatCurrency, flt } from '@ury/core';
import { usePOSStore } from '../../store/pos-store';
import type { OrderDeltaLine } from '../hooks/useTableOrderContext';
import CaptainOrderLine from './CaptainOrderLine';
import ProductDialog from '../../components/ProductDialog';
import CommentDialog from '../../components/CommentDialog';
import { CustomerSelect } from '../../components/CustomerSelect';
import { t, tPlural } from '../../i18n';

const MIN_PAX = 1;
const MAX_PAX = 50;

interface CaptainOrderPanelProps {
  /** The open table, or null while the captain is building a draft first. */
  table: string | null;
  /** False while the table's order (baseline) is still loading. */
  isReady: boolean;
  canModify: boolean;
  canReduce: boolean;
  canRemove: boolean;
  isSubmitting: boolean;
  alreadyOrderedLines: OrderDeltaLine[];
  newOrChangedLines: OrderDeltaLine[];
  reductionPendingLines: OrderDeltaLine[];
  onSend: () => void;
  onPickTable: () => void;
  /** Docked beside the menu (landscape tablet / desktop) vs. inside a sheet. */
  docked?: boolean;
}

/**
 * The Captain's ticket, laid out like the Cashier `OrderPanel` — header,
 * guests and customer, the lines, then total and one primary action — but
 * keeping the captain's delta grouping (PLAN.md §8): what the kitchen
 * already has, what this round adds, and what it takes back.
 *
 * The primary action always does the next useful thing: with no table it
 * opens the table picker (the draft carries over), otherwise it sends.
 */
export default function CaptainOrderPanel({
  table,
  isReady,
  canModify,
  canReduce,
  canRemove,
  isSubmitting,
  alreadyOrderedLines,
  newOrChangedLines,
  reductionPendingLines,
  onSend,
  onPickTable,
  docked = true,
}: CaptainOrderPanelProps) {
  const {
    activeOrders,
    removeFromOrder,
    updateQuantity,
    updateItemComment,
    setSelectedItem,
    isUpdatingOrder,
    orderComment,
    setOrderComment,
    noOfPax,
    setNoOfPax,
    isOrderInteractionDisabled,
  } = usePOSStore();

  const [editingItemUniqueId, setEditingItemUniqueId] = useState<string | null>(null);
  const [noteEditingLine, setNoteEditingLine] = useState<OrderDeltaLine | null>(null);
  const [showCommentDialog, setShowCommentDialog] = useState(false);

  const editingItem = useMemo(
    () => (editingItemUniqueId ? activeOrders.find((i) => i.uniqueId === editingItemUniqueId) ?? null : null),
    [editingItemUniqueId, activeOrders]
  );

  const total = flt(
    activeOrders.reduce((sum, item) => {
      const basePrice = item.selectedVariant?.price || item.price;
      const addons = item.selectedAddons?.reduce((a, addon) => a + addon.price, 0) || 0;
      return sum + (basePrice + addons) * item.quantity;
    }, 0),
    2
  );

  const disabled = isOrderInteractionDisabled() || isSubmitting || !isReady;
  const isEmpty = activeOrders.length === 0 && alreadyOrderedLines.length === 0;

  const handleDeltaIncrement = (line: OrderDeltaLine) => {
    if (disabled) return;
    updateQuantity(line.uniqueId, line.curQty + 1);
  };

  const handleDeltaDecrement = (line: OrderDeltaLine) => {
    if (disabled) return;
    const newQty = line.curQty - 1;
    if (newQty <= 0) removeFromOrder(line.uniqueId);
    else updateQuantity(line.uniqueId, newQty);
  };

  const handleConfirmedReduce = (line: OrderDeltaLine) => {
    if (disabled) return;
    // reduce_items (without remove_items) only scales the line down, it
    // never fully removes it — that requires remove_items (the Trash
    // control).
    const floor = canRemove ? 0 : 1;
    const newQty = Math.max(floor, line.curQty - 1);
    if (newQty <= 0) removeFromOrder(line.uniqueId);
    else updateQuantity(line.uniqueId, newQty);
  };

  const handleConfirmedRemove = (line: OrderDeltaLine) => {
    if (disabled) return;
    removeFromOrder(line.uniqueId);
  };

  const handleRestoreReduction = (line: OrderDeltaLine) => {
    if (disabled) return;
    updateQuantity(line.uniqueId, Math.min(line.curQty + 1, line.baseQty));
  };

  const handleEditNewOrChanged = (line: OrderDeltaLine) => {
    if (disabled) return;
    const item = activeOrders.find((i) => i.uniqueId === line.uniqueId);
    if (!item) return;
    setSelectedItem({ ...item, variants: item.variants, addons: item.addons });
    setEditingItemUniqueId(item.uniqueId!);
  };

  const handleClearNew = () => {
    if (disabled) return;
    newOrChangedLines.forEach((line) => {
      if (line.baseQty > 0) updateQuantity(line.uniqueId, line.baseQty);
      else removeFromOrder(line.uniqueId);
    });
  };

  const sendLabel = !table
    ? t('captain.choose_table_to_send')
    : isSubmitting
      ? isUpdatingOrder
        ? t('cart.updating_order')
        : t('captain.sending')
      : isUpdatingOrder
        ? t('cart.update_order')
        : t('captain.send_to_kitchen');

  return (
    <div
      className={cn(
        'flex flex-col bg-[#fffdf8]',
        docked
          ? 'h-full min-h-0 w-[22rem] shrink-0 border-s border-[#eadfce] shadow-[-10px_0_30px_rgba(74,48,30,0.06)] xl:w-96'
          : 'min-h-0 w-full flex-1'
      )}
    >
      <div className="shrink-0 space-y-3 border-b border-[#eadfce] bg-[#fffaf0] p-4">
        {docked && (
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#f05b42] text-white shadow-[0_5px_12px_rgba(240,91,66,0.22)]">
                <ShoppingBasket className="h-4 w-4" />
              </span>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-primary">
                  {table ? t('captain.table_label', { table }) : t('captain.draft_label')}
                </p>
                <h2 className="text-base font-bold text-[#3f2a20]">{t('order_panel.your_order')}</h2>
              </div>
            </div>
            <span className="text-xs font-medium text-[#9a7e6b]">
              {tPlural('order_panel.item_count', activeOrders.length)}
            </span>
          </div>
        )}

        {canModify && <CustomerSelect disabled={disabled} />}

        <div className="flex items-center justify-between rounded-xl border border-[#eadfce] bg-white px-3 py-2">
          <span className="flex items-center gap-2 text-sm font-semibold text-[#735d4e]">
            <Users className="h-4 w-4 text-primary" /> {t('cart.pax')}
          </span>
          {canModify ? (
            <div className="flex items-center gap-2">
              <Button
                onClick={() => setNoOfPax(Math.max(MIN_PAX, noOfPax - 1))}
                variant="outline"
                size="icon"
                className="h-9 w-9 rounded-lg border-[#eadfce]"
                disabled={disabled || noOfPax <= MIN_PAX}
                aria-label={t('common.decrease')}
              >
                -
              </Button>
              <span className="w-6 text-center font-semibold tabular-nums">{noOfPax}</span>
              <Button
                onClick={() => setNoOfPax(Math.min(MAX_PAX, noOfPax + 1))}
                variant="outline"
                size="icon"
                className="h-9 w-9 rounded-lg border-[#eadfce]"
                disabled={disabled || noOfPax >= MAX_PAX}
                aria-label={t('common.increase')}
              >
                +
              </Button>
            </div>
          ) : (
            <span className="text-sm font-semibold text-[#3f2a20]">{noOfPax}</span>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
        {!isReady ? (
          <div className="h-64">
            <Spinner message={t('cart.loading_order')} />
          </div>
        ) : isEmpty ? (
          <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#fff2d7]">
              <ClipboardList className="h-8 w-8 text-[#d89917]" />
            </div>
            <p className="font-semibold text-[#3f2a20]">{t('captain.no_items_yet')}</p>
            <p className="mt-1 max-w-xs text-sm text-[#9a7e6b]">
              {table ? t('captain.empty_hint_table') : t('captain.empty_hint_draft')}
            </p>
            {!table && (
              <Button onClick={onPickTable} variant="outline" size="sm" className="mt-4">
                {t('captain.choose_table')}
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-5">
            {alreadyOrderedLines.length > 0 && (
              <section>
                <h3 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-[#8f6b55]">
                  {t('captain.already_ordered')}
                </h3>
                <div className="space-y-2">
                  {alreadyOrderedLines.map((line) => (
                    <CaptainOrderLine
                      key={`confirmed-${line.uniqueId}`}
                      line={line}
                      variant="confirmed"
                      disabled={disabled}
                      onDecrement={canModify && canReduce ? () => handleConfirmedReduce(line) : undefined}
                      onRemove={canModify && canRemove ? () => handleConfirmedRemove(line) : undefined}
                      onEditNote={canModify ? () => setNoteEditingLine(line) : undefined}
                    />
                  ))}
                </div>
              </section>
            )}

            {newOrChangedLines.length > 0 && (
              <section>
                <div className="mb-2 flex items-center justify-between px-1">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-blue-700">
                    {table && isUpdatingOrder ? t('captain.new_changed') : t('captain.new_items')}
                  </h3>
                  {canModify && (
                    <button
                      type="button"
                      onClick={handleClearNew}
                      disabled={disabled}
                      className="flex items-center gap-1 text-xs font-medium text-[#9a7e6b] hover:text-red-600 disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {t('captain.clear_new')}
                    </button>
                  )}
                </div>
                <div className="space-y-2">
                  {newOrChangedLines.map((line) => (
                    <CaptainOrderLine
                      key={`delta-${line.uniqueId}`}
                      line={line}
                      variant="delta"
                      disabled={disabled || !canModify}
                      onIncrement={canModify ? () => handleDeltaIncrement(line) : undefined}
                      onDecrement={canModify ? () => handleDeltaDecrement(line) : undefined}
                      onEditNote={canModify ? () => handleEditNewOrChanged(line) : undefined}
                    />
                  ))}
                </div>
              </section>
            )}

            {reductionPendingLines.length > 0 && (
              <section>
                <h3 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-red-600">
                  {t('captain.reduction_pending')}
                </h3>
                <div className="space-y-2">
                  {reductionPendingLines.map((line) => (
                    <CaptainOrderLine
                      key={`reduction-${line.uniqueId}`}
                      line={line}
                      variant="reduction"
                      disabled={disabled}
                      onRestore={canModify ? () => handleRestoreReduction(line) : undefined}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </div>

      {canModify && (
        <div className="shrink-0 border-t border-[#eadfce] bg-[#fffaf0] p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Button
                onClick={() => setShowCommentDialog(true)}
                variant="ghost"
                size="sm"
                className={cn(
                  'h-9 w-9 rounded-lg p-0',
                  orderComment ? 'bg-primary-50 text-primary' : 'text-[#9a7e6b] hover:bg-white hover:text-[#3f2a20]'
                )}
                disabled={disabled}
                title={orderComment ? t('cart.edit_comment') : t('cart.add_comment')}
                aria-label={orderComment ? t('cart.edit_comment') : t('cart.add_comment')}
              >
                <MessageSquare className="h-4 w-4" />
              </Button>
              <span className="text-sm font-bold uppercase tracking-wider text-muted-foreground">
                {t('cart.total')}
              </span>
            </div>
            <AnimatedNumber value={formatCurrency(total)} className="text-2xl font-bold text-foreground" />
          </div>
          <Button
            onClick={table ? onSend : onPickTable}
            variant="default"
            className="h-12 w-full gap-2 rounded-xl text-base font-bold shadow-[0_7px_18px_rgba(240,91,66,0.22)]"
            disabled={isSubmitting || !isReady || (Boolean(table) && activeOrders.length === 0)}
          >
            {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : table && <Send className="h-4 w-4" />}
            {sendLabel}
          </Button>
        </div>
      )}

      {editingItem && (
        <ProductDialog
          onClose={() => {
            setEditingItemUniqueId(null);
            setSelectedItem(null);
          }}
          editMode
          initialVariant={editingItem.selectedVariant}
          initialAddons={editingItem.selectedAddons}
          initialQuantity={editingItem.quantity}
          itemToReplace={editingItem}
        />
      )}

      <CommentDialog
        isOpen={noteEditingLine !== null}
        onClose={() => setNoteEditingLine(null)}
        onSave={(comment: string) => {
          if (noteEditingLine) updateItemComment(noteEditingLine.uniqueId, comment);
          setNoteEditingLine(null);
        }}
        initialComment={noteEditingLine?.comment || ''}
      />

      <CommentDialog
        isOpen={showCommentDialog}
        onClose={() => setShowCommentDialog(false)}
        onSave={setOrderComment}
        initialComment={orderComment}
      />
    </div>
  );
}
