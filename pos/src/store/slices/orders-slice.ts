import { StateCreator } from 'zustand';
import { OrderType } from '../../data/order-types';
import { call } from '@ury/core';
import { getPOSInvoices, getPOSInvoiceItems, getSplitGroup, mapSplitGroupInvoiceToPOSInvoice, POSInvoiceItem, POSInvoiceTax } from '../../lib/invoice-api';
import { searchPosInvoice } from '../../lib/invoice-api';
import type { FloorUpdate } from '@ury/core';

export interface POSInvoice {
  name: string;
  invoice_printed: number;
  grand_total: number;
  restaurant_table: string | null;
  cashier: string;
  waiter: string;
  net_total: number;
  posting_time: string;
  total_taxes_and_charges: number;
  customer: string;
  status: 'Draft' | 'Unbilled' | 'Recently Paid' | 'Paid' | 'Consolidated' | 'Return';
  mobile_number: string;
  posting_date: string;
  rounded_total: number;
  order_type: OrderType;
  custom_merged_tables?: string | null;
  custom_split_group?: string | null;
  custom_split_from?: string | null;
  split_index?: number;
  split_total?: number;
  split_siblings?: string[];
  custom_merged_pos_invoice?: string | null;
  custom_merged_total?: number | null;
  additional_discount_percentage?: number;
  discount_amount?: number;
}

export interface OrdersState {
  orders: POSInvoice[];
  orderLoading: boolean;
  error: string | null;
  pagination: {
    currentPage: number;
    hasNextPage: boolean;
    itemsPerPage: number;
  };
  selectedStatus: 'Draft' | 'Unbilled' | 'Recently Paid' | 'Paid' | 'Consolidated' | 'Return';
  selectedOrder: POSInvoice | null;
  selectedOrderItems: POSInvoiceItem[];
  selectedOrderTaxes: POSInvoiceTax[];
  selectedOrderLoading: boolean;
  selectedOrderError: string | null;
  orderSearchQuery: string;
}

export interface OrdersActions {
  fetchOrders: (page?: number) => Promise<void>;
  updateOrderStatus: (orderId: string, status: POSInvoice['status']) => Promise<void>;
  goToNextPage: () => Promise<void>;
  goToPreviousPage: () => Promise<void>;
  setSelectedStatus: (status: POSInvoice['status']) => Promise<void>;
  selectOrder: (order: POSInvoice) => Promise<void>;
  clearSelectedOrder: () => void;
  setOrderSearchQuery: (query: string) => void;
  /**
   * Live update from another device (see lib/floor-sync.ts): re-reads the
   * current page and the open order without any loading state. Returns
   * 'closed' when the open order has left the current list (paid, cancelled,
   * moved to another status) and was deselected.
   */
  refreshOrdersLive: (update: FloorUpdate) => Promise<'refreshed' | 'closed' | 'ignored'>;
}

export type OrdersSlice = OrdersState & OrdersActions;

const ITEMS_PER_PAGE = 10;

interface OrdersPage {
  orders: POSInvoice[];
  pagination: OrdersState['pagination'];
}

/** One page of the order list for the current filter/search (no state writes). */
async function loadOrdersPage(
  page: number,
  orderSearchQuery: string,
  selectedStatus: OrdersState['selectedStatus'],
): Promise<OrdersPage> {
  // Get POS profile to access paid_limit
  const posProfile = sessionStorage.getItem('posProfile');
  const profile = posProfile ? JSON.parse(posProfile) : null;
  const paidLimit = profile?.paid_limit;

  if (orderSearchQuery && orderSearchQuery.trim()) {
    const res = await searchPosInvoice(orderSearchQuery, selectedStatus);
    return {
      orders: res.data || [],
      pagination: { currentPage: 1, hasNextPage: false, itemsPerPage: ITEMS_PER_PAGE },
    };
  }
  const { invoices, hasMore } = await getPOSInvoices({
    status: selectedStatus,
    limit: ITEMS_PER_PAGE,
    limit_start: (page - 1) * ITEMS_PER_PAGE,
    paid_limit: paidLimit,
  });
  return {
    orders: invoices,
    pagination: { currentPage: page, hasNextPage: hasMore, itemsPerPage: ITEMS_PER_PAGE },
  };
}

/** Items, taxes and split-group data for one order. */
async function loadOrderDetail(order: POSInvoice) {
  const [{ items, taxes }, splitGroup] = await Promise.all([
    getPOSInvoiceItems(order.name),
    getSplitGroup(order.name).catch(() => ({ invoices: [], current: order.name, group: null })),
  ]);
  const splitMatch = splitGroup.invoices.find((inv) => inv.name === order.name);
  const enrichedOrder = splitMatch ? { ...order, ...mapSplitGroupInvoiceToPOSInvoice(splitMatch) } : order;
  return { items, taxes, enrichedOrder, splitMatched: Boolean(splitMatch) };
}

export const createOrdersSlice: StateCreator<
  OrdersSlice,
  [],
  [],
  OrdersSlice
> = (set, get) => ({
  // Initial state
  orders: [],
  orderLoading: false,
  error: null,
  pagination: {
    currentPage: 1,
    hasNextPage: false,
    itemsPerPage: ITEMS_PER_PAGE,
  },
  selectedStatus: 'Draft',
  selectedOrder: null,
  selectedOrderItems: [],
  selectedOrderTaxes: [],
  selectedOrderLoading: false,
  selectedOrderError: null,
  orderSearchQuery: '',

  // Actions
  fetchOrders: async (page = 1) => {
    try {
      set({ orderLoading: true, error: null });
      const { orderSearchQuery, selectedStatus } = get();
      const result = await loadOrdersPage(page, orderSearchQuery, selectedStatus);
      set({ ...result, orderLoading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Failed to fetch orders',
        orderLoading: false
      });
    }
  },

  refreshOrdersLive: async (update) => {
    const { orderSearchQuery, selectedStatus, pagination, orderLoading } = get();
    // A user-initiated load is already on its way with fresh data.
    if (orderLoading) return 'ignored';
    let result: OrdersPage;
    try {
      result = await loadOrdersPage(pagination.currentPage, orderSearchQuery, selectedStatus);
    } catch {
      return 'ignored';
    }
    // The filter or page changed while this was in flight: that load wins.
    const now = get();
    if (now.selectedStatus !== selectedStatus || now.orderSearchQuery !== orderSearchQuery
      || now.pagination.currentPage !== pagination.currentPage) {
      return 'ignored';
    }
    set(result);

    const open = get().selectedOrder;
    if (!open || (!update.resync && !update.invoices.includes(open.name))) return 'refreshed';

    const fresh = result.orders.find((o) => o.name === open.name);
    if (!fresh) {
      get().clearSelectedOrder();
      return 'closed';
    }
    try {
      const detail = await loadOrderDetail(fresh);
      if (get().selectedOrder?.name !== open.name) return 'refreshed';
      set((state) => ({
        selectedOrder: detail.enrichedOrder,
        selectedOrderItems: detail.items,
        selectedOrderTaxes: detail.taxes,
        orders: detail.splitMatched
          ? state.orders.map((o) => (o.name === detail.enrichedOrder.name ? detail.enrichedOrder : o))
          : state.orders,
      }));
    } catch {
      // Keep what is on screen; the next update or a manual reload will fix it.
    }
    return 'refreshed';
  },

  goToNextPage: async () => {
    const { pagination, orderLoading } = get();
    if (!orderLoading && pagination.hasNextPage) {
      await get().fetchOrders(pagination.currentPage + 1);
    }
  },

  goToPreviousPage: async () => {
    const { pagination, orderLoading } = get();
    if (!orderLoading && pagination.currentPage > 1) {
      await get().fetchOrders(pagination.currentPage - 1);
    }
  },

  setSelectedStatus: async (status) => {
    set({ selectedStatus: status });
    // Clear selected order when status changes
    get().clearSelectedOrder();
    await get().fetchOrders(1); // Reset to first page when status changes
  },

  selectOrder: async (order) => {
    try {
      set({
        selectedOrder: order,
        selectedOrderLoading: true,
        selectedOrderError: null
      });

      const detail = await loadOrderDetail(order);

      set((state) => ({
        selectedOrder: detail.enrichedOrder,
        selectedOrderItems: detail.items,
        selectedOrderTaxes: detail.taxes,
        selectedOrderLoading: false,
        orders: detail.splitMatched
          ? state.orders.map((o) => (o.name === detail.enrichedOrder.name ? detail.enrichedOrder : o))
          : state.orders,
      }));
    } catch (error) {
      set({
        selectedOrderError: error instanceof Error ? error.message : 'Failed to fetch order details',
        selectedOrderLoading: false
      });
    }
  },

  clearSelectedOrder: () => {
    set({ 
      selectedOrder: null,
      selectedOrderItems: [],
      selectedOrderTaxes: [],
      selectedOrderError: null 
    });
  },

  updateOrderStatus: async (orderId: string, status: POSInvoice['status']) => {
    try {
      set({ orderLoading: true, error: null });

      await call.post('ury.ury_pos.api.updatePosInvoiceStatus', {
        invoice: orderId,
        status,
      });

      // Refresh the orders list after status update
      await get().fetchOrders(get().pagination.currentPage);
      
      set({ orderLoading: false });
    } catch (error) {
      set({ 
        error: error instanceof Error ? error.message : 'Failed to update order status',
        orderLoading: false 
      });
    }
  },

  setOrderSearchQuery: (query) => set({ orderSearchQuery: query }),
}); 