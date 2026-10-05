import { flt } from '@ury/core';
import { usePOSStore } from '../store/pos-store';

/** The running total of the ticket, as the order panel shows it. */
export function useOrderTotal(): { count: number; total: number } {
  const { activeOrders } = usePOSStore();
  const total = flt(
    activeOrders.reduce((sum, item) => {
      const basePrice = item.selectedVariant?.price || item.price;
      const addons = item.selectedAddons?.reduce((a, addon) => a + addon.price, 0) || 0;
      return sum + (basePrice + addons) * item.quantity;
    }, 0),
    2
  );
  return { count: activeOrders.length, total };
}
