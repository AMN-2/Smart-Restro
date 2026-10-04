import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FloorUpdate } from '@ury/core';

const getTableOrder = vi.fn();
vi.mock('../lib/order-api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/order-api')>();
  return { ...actual, getTableOrder: (...args: unknown[]) => getTableOrder(...args) };
});

const { usePOSStore, generateCartHash } = await import('./pos-store');
const { trackLocalWrite } = await import('../lib/floor-sync');

const update = (over: Partial<FloorUpdate> = {}): FloorUpdate => ({
  branch: 'B1',
  invoices: ['INV-1'],
  tables: ['T1'],
  reasons: ['updated'],
  by: 'other@x',
  resync: false,
  ...over,
});

const serverOrder = (qty: number) => ({
  message: {
    name: 'INV-1',
    customer: '',
    items: [{ item_code: 'I1', item_name: 'Tea', rate: 1000, qty, amount: 1000 * qty }],
    no_of_pax: 2,
    modified: '2026-10-04 10:00:00',
  },
});

/** Put the store on table T1 with INV-1 loaded, unchanged. */
async function openCleanOrder(qty = 1) {
  getTableOrder.mockResolvedValueOnce(serverOrder(qty));
  usePOSStore.setState({ selectedTable: 'T1', remoteChange: null });
  await usePOSStore.getState().loadTableOrder('T1');
}

describe('pos-store live floor handling', () => {
  beforeEach(() => {
    getTableOrder.mockReset();
    usePOSStore.setState({
      selectedTable: null,
      orderId: null,
      isUpdatingOrder: false,
      activeOrders: [],
      remoteChange: null,
      orderLoading: false,
    });
  });

  it('reloads a clean open order when another device changes it', async () => {
    await openCleanOrder(1);
    getTableOrder.mockResolvedValueOnce(serverOrder(3));
    const outcome = await usePOSStore.getState().handleFloorUpdate(update(), 'me@x');
    expect(outcome).toBe('reloaded');
    expect(usePOSStore.getState().activeOrders[0].quantity).toBe(3);
    expect(usePOSStore.getState().remoteChange).toBeNull();
  });

  it('keeps unsent edits and raises the banner instead', async () => {
    await openCleanOrder(1);
    const item = usePOSStore.getState().activeOrders[0];
    await usePOSStore.getState().updateQuantity(item.uniqueId!, 5);
    const state = usePOSStore.getState();
    expect(generateCartHash(state)).not.toBe(state.originalCartHash);

    const outcome = await usePOSStore.getState().handleFloorUpdate(update({ by: 'cashier@x' }), 'me@x');
    expect(outcome).toBe('conflict');
    expect(usePOSStore.getState().activeOrders[0].quantity).toBe(5);
    expect(usePOSStore.getState().remoteChange).toEqual({ by: 'cashier@x' });
    expect(getTableOrder).toHaveBeenCalledTimes(1);
  });

  it('ignores updates about other tables and invoices', async () => {
    await openCleanOrder(1);
    const outcome = await usePOSStore.getState().handleFloorUpdate(update({ invoices: ['INV-9'], tables: ['T9'] }), 'me@x');
    expect(outcome).toBe('ignored');
    expect(getTableOrder).toHaveBeenCalledTimes(1);
  });

  it("ignores this tab's own save coming back", async () => {
    await openCleanOrder(1);
    const item = usePOSStore.getState().activeOrders[0];
    await usePOSStore.getState().updateQuantity(item.uniqueId!, 2);
    let outcome: string | undefined;
    await trackLocalWrite(async () => {
      outcome = await usePOSStore.getState().handleFloorUpdate(update({ by: 'me@x' }), 'me@x');
    });
    expect(outcome).toBe('ignored');
    expect(usePOSStore.getState().remoteChange).toBeNull();
  });

  it('treats a resync as relevant even with no names', async () => {
    await openCleanOrder(1);
    getTableOrder.mockResolvedValueOnce(serverOrder(1));
    const outcome = await usePOSStore
      .getState()
      .handleFloorUpdate(update({ invoices: [], tables: [], resync: true, by: null }), 'me@x');
    expect(outcome).toBe('reloaded');
  });

  it('does nothing with no table and no order open', async () => {
    const outcome = await usePOSStore.getState().handleFloorUpdate(update({ resync: true }), 'me@x');
    expect(outcome).toBe('ignored');
  });

  it('clears the banner when the order is reloaded or the tab switches', async () => {
    await openCleanOrder(1);
    usePOSStore.setState({ remoteChange: { by: 'x' } });
    getTableOrder.mockResolvedValueOnce(serverOrder(1));
    await usePOSStore.getState().reloadRemoteChange();
    expect(usePOSStore.getState().remoteChange).toBeNull();

    usePOSStore.setState({ remoteChange: { by: 'x' } });
    usePOSStore.getState().addTab();
    expect(usePOSStore.getState().remoteChange).toBeNull();
  });
});
