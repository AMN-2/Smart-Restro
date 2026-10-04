import { useEffect, useRef } from 'react';
import { createFloorSync, type FloorSocket, type FloorUpdate } from '@ury/core';
import { getRealtimeSocket } from './realtime';

export type { FloorUpdate } from '@ury/core';
export { floorUpdateTouches } from '@ury/core';

/**
 * The POS's one subscription to live floor updates (`ury_floor_update`, see
 * `@ury/core` floor-sync and `ury/ury/api/floor_events.py`). Shares the
 * realtime socket the KOT and service-request listeners already use.
 */
export const floorSync = createFloorSync(() => getRealtimeSocket() as Promise<unknown> as Promise<FloorSocket>);

/**
 * Calls `handler` with every (debounced) floor update for `branch` while the
 * component is mounted. The handler and branch are read through refs, so
 * passing inline functions does not re-subscribe on every render.
 */
export function useFloorUpdates(
  handler: (update: FloorUpdate) => void,
  options: { branch?: string | null; enabled?: boolean; debounceMs?: number } = {},
): void {
  const handlerRef = useRef(handler);
  const branchRef = useRef(options.branch ?? null);
  handlerRef.current = handler;
  branchRef.current = options.branch ?? null;
  const enabled = options.enabled ?? true;
  const debounceMs = options.debounceMs;

  useEffect(() => {
    if (!enabled) return;
    return floorSync.subscribe((update) => handlerRef.current(update), {
      branch: () => branchRef.current,
      debounceMs,
    });
  }, [enabled, debounceMs]);
}

/* ------------------------------------------------------------------------ *
 * Own-write echoes
 *
 * The server publishes after commit, which can be before this tab has even
 * read the HTTP response to its own save. A screen that compares "my unsent
 * edits" with "someone changed this order" would then flag the user's own
 * save as a conflict. Writes from this tab are bracketed here, and an update
 * by the same user during or just after one is treated as its echo.
 * ------------------------------------------------------------------------ */

const ECHO_GRACE_MS = 4_000;
let writesInFlight = 0;
let lastWriteEndedAt = 0;

/** Wrap a mutation made by this tab so its realtime echo is recognised. */
export async function trackLocalWrite<T>(write: () => Promise<T>): Promise<T> {
  writesInFlight += 1;
  try {
    return await write();
  } finally {
    writesInFlight -= 1;
    lastWriteEndedAt = Date.now();
  }
}

/** True when `update` is most likely this tab's own write coming back. */
export function isOwnEcho(update: FloorUpdate, currentUser: string | null | undefined): boolean {
  if (update.resync || !currentUser || update.by !== currentUser) return false;
  return writesInFlight > 0 || Date.now() - lastWriteEndedAt < ECHO_GRACE_MS;
}
