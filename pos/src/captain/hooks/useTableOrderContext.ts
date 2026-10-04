import { useCallback, useEffect, useState } from 'react';
import { usePOSStore, OrderItem } from '../../store/pos-store';
import {
  getTableOrderContext,
  TableOrderContext,
  TableOrderPermissions,
} from '../../lib/table-order-context-api';

export interface BaselineItem {
  uniqueId: string;
  id: string;
  name: string;
  price: number;
  quantity: number;
  comment?: string;
}

export interface OrderDeltaLine {
  uniqueId: string;
  id: string;
  name: string;
  price: number;
  comment?: string;
  /** Quantity already sent/confirmed on the server for this line (0 if this round's addition). */
  baseQty: number;
  /** Current editable quantity in the working cart (0 if fully removed). */
  curQty: number;
  /** `curQty - baseQty`. Positive = new/increased, negative = reduced/removed. */
  delta: number;
  /**
   * `min(baseQty, curQty)` — the portion still standing as originally sent.
   * This, not `baseQty`, is what "Already Ordered" displays: once a line is
   * reduced below its baseline, only the remaining confirmed portion still
   * belongs in that group; the rest shows as a distinct reduction line.
   */
  confirmedQty: number;
}

export interface UseTableOrderContextResult {
  context: TableOrderContext | null;
  permissions: TableOrderPermissions | null;
  isContextLoading: boolean;
  contextError: string | null;
  /**
   * True once the table's baseline order has loaded into the store — or
   * immediately when no table is picked yet, where the whole cart is a
   * draft with no baseline.
   */
  isOrderReady: boolean;
  /** Delta lines for items still at (or above) their originally-sent quantity. */
  alreadyOrderedLines: OrderDeltaLine[];
  /** Delta lines for brand-new items or quantity increases this round (`delta > 0`). */
  newOrChangedLines: OrderDeltaLine[];
  /** Delta lines for quantity reductions/removals against the baseline (`delta < 0`). */
  reductionPendingLines: OrderDeltaLine[];
  /**
   * Re-read the table's context and order from the server and take a fresh
   * baseline — used when the order changed on another device.
   */
  reload: () => void;
}

const toBaseline = (items: OrderItem[]): BaselineItem[] =>
  items.map((item) => ({
    uniqueId: item.uniqueId!,
    id: item.id,
    name: item.name,
    price: item.price,
    quantity: item.quantity,
    comment: item.comment,
  }));

/**
 * Fetches `get_table_order_context(table)` — the server-authoritative
 * permission map + order snapshot for THIS Captain on THIS table (PLAN.md
 * §8) — and, when viewing is allowed, loads the table's order into the
 * Cashier `pos-store` so menu/cart logic is reused rather than reimplemented.
 *
 * The Captain workspace switches tables in place (no route remount), so
 * every piece of state here is tagged with the table it belongs to and only
 * read back when that tag matches the current `table`. A response for a
 * table the captain has already left is ignored instead of leaking into the
 * next one.
 *
 * Delta grouping (PLAN.md §7/§8: baselineItems / workingItems / pendingChanges)
 * diffs a snapshot of `activeOrders` taken right after the load ("baseline")
 * against the live `activeOrders` ("working"). With no table picked the
 * baseline is empty, so everything in the cart is a new line.
 */
export const useTableOrderContext = (table: string | undefined): UseTableOrderContextResult => {
  const [loaded, setLoaded] = useState<{ table: string; context: TableOrderContext } | null>(null);
  const [failure, setFailure] = useState<{ table: string; message: string } | null>(null);
  const [baseline, setBaseline] = useState<{ table: string; items: BaselineItem[] } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const activeOrders = usePOSStore((s) => s.activeOrders);
  const clearTableOrder = usePOSStore((s) => s.clearTableOrder);

  useEffect(() => {
    if (!table) return;

    // A reload of the same table: the old baseline would otherwise be diffed
    // against the emptied cart and show phantom reductions until it loads.
    setBaseline((current) => (current && current.table === table ? null : current));

    let cancelled = false;
    (async () => {
      try {
        const result = await getTableOrderContext(table);
        if (cancelled) return;
        setLoaded({ table, context: result });
        if (!result.permissions.view) return;

        const store = usePOSStore.getState();
        store.setSelectedTable(table, result.table?.restaurant_room ?? null, true);
        await store.loadTableOrder(table);
        if (cancelled) return;
        setBaseline({ table, items: toBaseline(usePOSStore.getState().activeOrders) });
      } catch (err) {
        if (cancelled) return;
        setFailure({ table, message: (err as Error).message || 'Failed to load table order context.' });
      }
    })();

    return () => {
      cancelled = true;
      clearTableOrder();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, reloadKey]);

  const context = table && loaded?.table === table ? loaded.context : null;
  const contextError = table && failure?.table === table ? failure.message : null;
  const isContextLoading = Boolean(table) && !context && !contextError;

  const baselineItems: BaselineItem[] | null = !table
    ? []
    : baseline?.table === table
      ? baseline.items
      : null;

  const isOrderReady = baselineItems !== null || Boolean(context && !context.permissions.view);

  const deltaLines: OrderDeltaLine[] = [];
  if (baselineItems) {
    const baselineMap = new Map(baselineItems.map((b) => [b.uniqueId, b]));
    const currentMap = new Map(activeOrders.map((i) => [i.uniqueId!, i]));
    const uniqueIds = new Set<string>([...baselineMap.keys(), ...currentMap.keys()]);

    uniqueIds.forEach((uid) => {
      const base = baselineMap.get(uid);
      const cur = currentMap.get(uid);
      const baseQty = base?.quantity ?? 0;
      const curQty = cur?.quantity ?? 0;
      const source = cur ?? base!;
      deltaLines.push({
        uniqueId: uid,
        id: source.id,
        name: source.name,
        price: cur?.price ?? base?.price ?? 0,
        comment: cur?.comment ?? base?.comment,
        baseQty,
        curQty,
        delta: curQty - baseQty,
        confirmedQty: Math.min(baseQty, curQty),
      });
    });
  }

  return {
    context,
    permissions: context?.permissions ?? null,
    isContextLoading,
    contextError,
    isOrderReady,
    alreadyOrderedLines: deltaLines.filter((l) => l.confirmedQty > 0),
    newOrChangedLines: deltaLines.filter((l) => l.delta > 0),
    reductionPendingLines: deltaLines.filter((l) => l.delta < 0),
    reload,
  };
};

export default useTableOrderContext;
