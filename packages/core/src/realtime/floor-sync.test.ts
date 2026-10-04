import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FLOOR_EVENT,
  createFloorSync,
  floorUpdateTouches,
  normalizeFloorUpdate,
  type FloorSocket,
  type FloorUpdate,
} from './floor-sync';

class FakeSocket implements FloorSocket {
  connected = true;
  handlers = new Map<string, Set<(...args: any[]) => void>>();
  emitted: unknown[][] = [];
  on(event: string, handler: (...args: any[]) => void) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
  }
  off(event: string, handler: (...args: any[]) => void) {
    this.handlers.get(event)?.delete(handler);
  }
  emit(...args: unknown[]) {
    this.emitted.push(args);
  }
  fire(event: string, ...args: unknown[]) {
    this.handlers.get(event)?.forEach((h) => h(...args));
  }
}

const flushStart = () => Promise.resolve().then(() => Promise.resolve());

describe('floor sync', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('joins the POS Invoice room on start and on every reconnect', async () => {
    const socket = new FakeSocket();
    const sync = createFloorSync(async () => socket);
    sync.subscribe(() => {});
    await flushStart();
    expect(socket.emitted).toEqual([['doctype_subscribe', 'POS Invoice']]);
    socket.fire('disconnect');
    socket.fire('connect');
    expect(socket.emitted).toHaveLength(2);
  });

  it('merges a burst into one call and filters other branches', async () => {
    const socket = new FakeSocket();
    const sync = createFloorSync(async () => socket);
    const seen: FloorUpdate[] = [];
    sync.subscribe((u) => seen.push(u), { branch: 'B1' });
    await flushStart();
    socket.fire(FLOOR_EVENT, { branch: 'B1', invoices: ['I1'], tables: ['T1'], reasons: ['updated'] });
    socket.fire(FLOOR_EVENT, { branch: 'B2', invoices: ['X'], tables: ['X'] });
    socket.fire(FLOOR_EVENT, { branch: 'B1', invoices: ['I2'], tables: ['T1', 'T2'], reasons: ['printed'] });
    vi.advanceTimersByTime(400);
    expect(seen).toHaveLength(1);
    expect(seen[0].invoices).toEqual(['I1', 'I2']);
    expect(seen[0].tables).toEqual(['T1', 'T2']);
    expect(seen[0].reasons.sort()).toEqual(['printed', 'updated']);
    expect(seen[0].resync).toBe(false);
  });

  it('never holds updates longer than the max wait under a steady stream', async () => {
    const socket = new FakeSocket();
    const sync = createFloorSync(async () => socket);
    const seen: FloorUpdate[] = [];
    sync.subscribe((u) => seen.push(u), { debounceMs: 300 });
    await flushStart();
    for (let i = 0; i < 20; i++) {
      socket.fire(FLOOR_EVENT, { invoices: [`I${i}`] });
      vi.advanceTimersByTime(200);
    }
    expect(seen.length).toBeGreaterThanOrEqual(2);
  });

  it('raises a resync after a reconnect, and lets it through any branch filter', async () => {
    const socket = new FakeSocket();
    const sync = createFloorSync(async () => socket);
    const seen: FloorUpdate[] = [];
    sync.subscribe((u) => seen.push(u), { branch: 'B1' });
    await flushStart();
    socket.fire('disconnect');
    socket.fire('connect');
    vi.advanceTimersByTime(400);
    expect(seen).toHaveLength(1);
    expect(seen[0].resync).toBe(true);
  });

  it('resyncs when a tab comes back after being hidden for a while', async () => {
    const socket = new FakeSocket();
    const sync = createFloorSync(async () => socket);
    const seen: FloorUpdate[] = [];
    sync.subscribe((u) => seen.push(u));
    await flushStart();
    const state = vi.spyOn(document, 'visibilityState', 'get');
    state.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(15_000);
    state.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(400);
    expect(seen.some((u) => u.resync)).toBe(true);
    state.mockRestore();
  });

  it('stops delivering after unsubscribe, and survives a throwing listener', async () => {
    const socket = new FakeSocket();
    const sync = createFloorSync(async () => socket);
    const ok = vi.fn();
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    const unsubscribe = sync.subscribe(ok);
    sync.subscribe(() => {
      throw new Error('boom');
    });
    await flushStart();
    socket.fire(FLOOR_EVENT, { invoices: ['I1'] });
    vi.advanceTimersByTime(400);
    expect(ok).toHaveBeenCalledTimes(1);
    unsubscribe();
    socket.fire(FLOOR_EVENT, { invoices: ['I2'] });
    vi.advanceTimersByTime(400);
    expect(ok).toHaveBeenCalledTimes(1);
    quiet.mockRestore();
  });

  it('retries when the socket cannot be created', async () => {
    const socket = new FakeSocket();
    let attempts = 0;
    const sync = createFloorSync(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('down');
      return socket;
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    sync.subscribe(() => {});
    await flushStart();
    vi.advanceTimersByTime(2_100);
    await flushStart();
    expect(attempts).toBe(2);
    expect(socket.emitted).toEqual([['doctype_subscribe', 'POS Invoice']]);
  });
});

describe('floor helpers', () => {
  it('normalizes untrusted payloads', () => {
    expect(normalizeFloorUpdate(null)).toEqual({ branch: null, invoices: [], tables: [], reasons: [], by: null, resync: false });
    expect(normalizeFloorUpdate({ branch: 'B', invoices: ['I', 3, ''], tables: 'T' }).invoices).toEqual(['I']);
  });

  it('matches by invoice or table, and always on resync', () => {
    const u = { ...normalizeFloorUpdate({ invoices: ['I1'], tables: ['T1'] }) };
    expect(floorUpdateTouches(u, { invoice: 'I1' })).toBe(true);
    expect(floorUpdateTouches(u, { tables: ['T9', 'T1'] })).toBe(true);
    expect(floorUpdateTouches(u, { invoice: 'I2', tables: ['T2'] })).toBe(false);
    expect(floorUpdateTouches({ ...u, resync: true }, { invoice: 'X' })).toBe(true);
  });
});
