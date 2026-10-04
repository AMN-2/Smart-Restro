/**
 * Live floor updates — the client half of `ury/ury/api/floor_events.py`.
 *
 * The server publishes one `ury_floor_update` event, after commit, whenever an
 * order or a table changes anywhere: an item added on another device, a table
 * transferred or merged, a bill printed, paid, cancelled or closed. The event
 * only names what changed; screens re-fetch through their normal APIs.
 *
 * This module owns everything about receiving it, once, so no screen has to:
 *
 * - **Room membership.** The event goes to the permission-checked
 *   `doctype:POS Invoice` room. The socket server forgets rooms on every
 *   disconnect, so the subscription is re-sent on every (re)connect.
 * - **Missed events.** Nothing is replayed after a dropped connection or a
 *   tablet waking from sleep, so those moments raise a `resync` update that
 *   tells every listener "assume anything changed".
 * - **Bursts.** Updates are merged per listener over a short window, so a
 *   flurry of changes costs one re-fetch, not ten.
 * - **Branch.** Updates for another branch are dropped per listener; a
 *   resync or an update without a branch always passes.
 *
 * Framework-agnostic: React apps wrap it in a hook; the Vue apps carry a port
 * of the same rules (`urypos/src/realtime/floorSync.js`).
 */

export const FLOOR_EVENT = 'ury_floor_update';
export const FLOOR_ROOM_DOCTYPE = 'POS Invoice';

export interface FloorUpdate {
  /** Branch the change belongs to; null when the server could not tell. */
  branch: string | null;
  invoices: string[];
  tables: string[];
  /** e.g. created, updated, paid, cancelled, printed, released, merged. */
  reasons: string[];
  /** User who made the change (absent on a resync). */
  by: string | null;
  /** True after a reconnect or wake-up: treat everything as changed. */
  resync: boolean;
}

/** The slice of a socket.io client this module needs. */
export interface FloorSocket {
  connected: boolean;
  on(event: string, handler: (...args: any[]) => void): unknown;
  off(event: string, handler: (...args: any[]) => void): unknown;
  emit(event: string, ...args: any[]): unknown;
}

export interface FloorSubscribeOptions {
  /** Only updates for this branch (a resync always passes). Read on each update. */
  branch?: string | null | (() => string | null | undefined);
  /** Merge window before the listener is called. Default 300ms. */
  debounceMs?: number;
}

export type FloorListener = (update: FloorUpdate) => void;

export interface FloorSync {
  subscribe(listener: FloorListener, options?: FloorSubscribeOptions): () => void;
  /** Number of active listeners (diagnostics/tests). */
  size(): number;
}

/** A hidden tab that comes back after this long may have missed events. */
const WAKE_RESYNC_MS = 10_000;
const MAX_WAIT_MS = 1_500;
const RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 30_000];

const asStringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.length > 0) : [];

export function normalizeFloorUpdate(raw: unknown): FloorUpdate {
  const data = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    branch: typeof data.branch === 'string' && data.branch ? data.branch : null,
    invoices: asStringList(data.invoices),
    tables: asStringList(data.tables),
    reasons: asStringList(data.reasons),
    by: typeof data.by === 'string' ? data.by : null,
    resync: data.resync === true,
  };
}

const RESYNC: FloorUpdate = { branch: null, invoices: [], tables: [], reasons: ['resync'], by: null, resync: true };

interface Entry {
  listener: FloorListener;
  options: FloorSubscribeOptions;
  pending: FloorUpdate | null;
  timer: ReturnType<typeof setTimeout> | null;
  firstQueuedAt: number;
}

function merge(into: FloorUpdate | null, next: FloorUpdate): FloorUpdate {
  if (!into) return { ...next, invoices: [...next.invoices], tables: [...next.tables], reasons: [...next.reasons] };
  const union = (a: string[], b: string[]) => Array.from(new Set([...a, ...b]));
  return {
    branch: into.branch === next.branch ? into.branch : null,
    invoices: union(into.invoices, next.invoices),
    tables: union(into.tables, next.tables),
    reasons: union(into.reasons, next.reasons),
    by: into.by === next.by ? into.by : null,
    resync: into.resync || next.resync,
  };
}

/** True when `update` is about the given invoice or any of the given tables. */
export function floorUpdateTouches(
  update: FloorUpdate,
  target: { invoice?: string | null; tables?: Array<string | null | undefined> },
): boolean {
  if (update.resync) return true;
  if (target.invoice && update.invoices.includes(target.invoice)) return true;
  return (target.tables ?? []).some((t) => !!t && update.tables.includes(t));
}

export function createFloorSync(getSocket: () => Promise<FloorSocket>): FloorSync {
  const entries = new Set<Entry>();
  let socket: FloorSocket | null = null;
  let starting = false;
  let retryIndex = 0;
  let wasDisconnected = false;
  let hiddenAt: number | null = null;
  let windowBound = false;

  const branchOf = (options: FloorSubscribeOptions) =>
    (typeof options.branch === 'function' ? options.branch() : options.branch) || null;

  const flush = (entry: Entry) => {
    const update = entry.pending;
    entry.pending = null;
    entry.timer = null;
    if (!update || !entries.has(entry)) return;
    try {
      entry.listener(update);
    } catch (error) {
      console.error('[URY floor] listener failed', error);
    }
  };

  const dispatch = (update: FloorUpdate) => {
    for (const entry of entries) {
      const branch = branchOf(entry.options);
      if (!update.resync && update.branch && branch && update.branch !== branch) continue;

      const now = Date.now();
      if (!entry.pending) entry.firstQueuedAt = now;
      entry.pending = merge(entry.pending, update);
      if (entry.timer) clearTimeout(entry.timer);
      const debounce = entry.options.debounceMs ?? 300;
      // Debounce, but never hold an update longer than MAX_WAIT_MS under a
      // steady stream of changes.
      const wait = Math.max(0, Math.min(debounce, entry.firstQueuedAt + MAX_WAIT_MS - now));
      entry.timer = setTimeout(() => flush(entry), wait);
    }
  };

  const join = () => socket?.emit('doctype_subscribe', FLOOR_ROOM_DOCTYPE);
  const onFloorEvent = (raw: unknown) => dispatch({ ...normalizeFloorUpdate(raw), resync: false });
  const onConnect = () => {
    join();
    if (wasDisconnected) {
      wasDisconnected = false;
      dispatch(RESYNC);
    }
  };
  const onDisconnect = () => {
    wasDisconnected = true;
  };

  const onVisibility = () => {
    if (typeof document === 'undefined') return;
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
    } else if (hiddenAt !== null) {
      const away = Date.now() - hiddenAt;
      hiddenAt = null;
      if (away >= WAKE_RESYNC_MS) dispatch(RESYNC);
    }
  };
  const onOnline = () => dispatch(RESYNC);

  const bindWindow = () => {
    if (windowBound || typeof window === 'undefined') return;
    windowBound = true;
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);
  };

  const start = () => {
    if (socket || starting) return;
    starting = true;
    getSocket()
      .then((s) => {
        starting = false;
        retryIndex = 0;
        socket = s;
        s.on(FLOOR_EVENT, onFloorEvent);
        s.on('connect', onConnect);
        s.on('disconnect', onDisconnect);
        if (s.connected) join();
      })
      .catch((error) => {
        starting = false;
        if (entries.size === 0) return;
        const delay = RETRY_DELAYS_MS[Math.min(retryIndex, RETRY_DELAYS_MS.length - 1)];
        retryIndex += 1;
        console.warn(`[URY floor] realtime unavailable, retrying in ${delay / 1000}s`, error);
        setTimeout(start, delay);
      });
  };

  return {
    subscribe(listener, options = {}) {
      const entry: Entry = { listener, options, pending: null, timer: null, firstQueuedAt: 0 };
      entries.add(entry);
      bindWindow();
      start();
      return () => {
        if (entry.timer) clearTimeout(entry.timer);
        entries.delete(entry);
      };
    },
    size: () => entries.size,
  };
}
