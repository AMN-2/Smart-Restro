/**
 * Live floor updates for the waiter POS.
 *
 * A port of `packages/core/src/realtime/floor-sync.ts` (urypos sits outside
 * the yarn workspace and cannot import @ury/core). Same rules — keep the two
 * in step:
 *
 * - Listens for `ury_floor_update`, published by `ury/ury/api/floor_events.py`
 *   after commit whenever an order or a table changes anywhere.
 * - Joins the permission-checked `doctype:POS Invoice` room on every
 *   (re)connect; the socket server forgets rooms on disconnect.
 * - Raises a `resync` update after a reconnect, when the device comes back
 *   online, or when the tab returns after being hidden a while — events
 *   missed meanwhile are never replayed.
 * - Merges bursts per listener and drops other branches.
 */
import { io } from "socket.io-client";

export const FLOOR_EVENT = "ury_floor_update";
const ROOM_DOCTYPE = "POS Invoice";
const WAKE_RESYNC_MS = 10000;
const MAX_WAIT_MS = 1500;
const RETRY_DELAYS_MS = [2000, 5000, 10000, 30000];

const RESYNC = { branch: null, invoices: [], tables: [], reasons: ["resync"], by: null, resync: true };

const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x) : []);

export function normalizeFloorUpdate(raw) {
  const d = raw && typeof raw === "object" ? raw : {};
  return {
    branch: typeof d.branch === "string" && d.branch ? d.branch : null,
    invoices: list(d.invoices),
    tables: list(d.tables),
    reasons: list(d.reasons),
    by: typeof d.by === "string" ? d.by : null,
    resync: false,
  };
}

/** True when the update is about this invoice or any of these tables. */
export function floorUpdateTouches(update, { invoice, tables = [] }) {
  if (update.resync) return true;
  if (invoice && update.invoices.includes(invoice)) return true;
  return tables.some((t) => t && update.tables.includes(t));
}

function merge(into, next) {
  if (!into) return { ...next, invoices: [...next.invoices], tables: [...next.tables], reasons: [...next.reasons] };
  const union = (a, b) => Array.from(new Set([...a, ...b]));
  return {
    branch: into.branch === next.branch ? into.branch : null,
    invoices: union(into.invoices, next.invoices),
    tables: union(into.tables, next.tables),
    reasons: union(into.reasons, next.reasons),
    by: into.by === next.by ? into.by : null,
    resync: into.resync || next.resync,
  };
}

async function openSocket() {
  const res = await fetch("/api/method/ury.ury.api.ury_kot_display.get_site_name", {
    credentials: "include",
  });
  const data = await res.json();
  const site = data && data.message && data.message.site_name;
  if (!site) throw new Error("Site name unavailable");
  const { protocol, hostname, port } = window.location;
  const host = port ? `${protocol}//${hostname}:${port}` : `${protocol}//${hostname}`;
  return io(`${host}/${site}`, { withCredentials: true });
}

const entries = new Set();
let socket = null;
let starting = false;
let retryIndex = 0;
let wasDisconnected = false;
let hiddenAt = null;
let windowBound = false;

function flush(entry) {
  const update = entry.pending;
  entry.pending = null;
  entry.timer = null;
  if (!update || !entries.has(entry)) return;
  try {
    entry.listener(update);
  } catch (error) {
    console.error("[URY floor] listener failed", error);
  }
}

function dispatch(update) {
  for (const entry of entries) {
    const branch = typeof entry.branch === "function" ? entry.branch() : entry.branch;
    if (!update.resync && update.branch && branch && update.branch !== branch) continue;
    const now = Date.now();
    if (!entry.pending) entry.firstQueuedAt = now;
    entry.pending = merge(entry.pending, update);
    if (entry.timer) clearTimeout(entry.timer);
    const wait = Math.max(0, Math.min(entry.debounceMs, entry.firstQueuedAt + MAX_WAIT_MS - now));
    entry.timer = setTimeout(() => flush(entry), wait);
  }
}

function join() {
  if (socket) socket.emit("doctype_subscribe", ROOM_DOCTYPE);
}

function bindWindow() {
  if (windowBound) return;
  windowBound = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      hiddenAt = Date.now();
    } else if (hiddenAt !== null) {
      const away = Date.now() - hiddenAt;
      hiddenAt = null;
      if (away >= WAKE_RESYNC_MS) dispatch(RESYNC);
    }
  });
  window.addEventListener("online", () => dispatch(RESYNC));
}

function start() {
  if (socket || starting) return;
  starting = true;
  openSocket()
    .then((s) => {
      starting = false;
      retryIndex = 0;
      socket = s;
      s.on(FLOOR_EVENT, (raw) => dispatch(normalizeFloorUpdate(raw)));
      s.on("connect", () => {
        join();
        if (wasDisconnected) {
          wasDisconnected = false;
          dispatch(RESYNC);
        }
      });
      s.on("disconnect", () => {
        wasDisconnected = true;
      });
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
}

/**
 * Subscribe to floor updates. `branch` may be a value or a function read on
 * each update. Returns an unsubscribe function.
 */
export function subscribeFloorUpdates(listener, { branch = null, debounceMs = 300 } = {}) {
  const entry = { listener, branch, debounceMs, pending: null, timer: null, firstQueuedAt: 0 };
  entries.add(entry);
  bindWindow();
  start();
  return () => {
    if (entry.timer) clearTimeout(entry.timer);
    entries.delete(entry);
  };
}

/* Own-write echoes: see pos/src/lib/floor-sync.ts. */
const ECHO_GRACE_MS = 4000;
let writesInFlight = 0;
let lastWriteEndedAt = 0;

export async function trackLocalWrite(write) {
  writesInFlight += 1;
  try {
    return await write();
  } finally {
    writesInFlight -= 1;
    lastWriteEndedAt = Date.now();
  }
}

export function isOwnEcho(update, currentUser) {
  if (update.resync || !currentUser || update.by !== currentUser) return false;
  return writesInFlight > 0 || Date.now() - lastWriteEndedAt < ECHO_GRACE_MS;
}
