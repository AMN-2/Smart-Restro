import { useEffect, useRef } from 'react';
import { createFloorSync, type FloorSocket, type FloorUpdate } from '@ury/core';
import { getSetupSocket } from './realtimeClient';

/**
 * Live floor updates for the management app — the same engine the POS uses
 * (`@ury/core` floor-sync, server side `ury/ury/api/floor_events.py`), on
 * this app's own socket.
 */
export const floorSync = createFloorSync(() => getSetupSocket() as Promise<unknown> as Promise<FloorSocket>);

/**
 * Calls `handler` with every debounced floor update while mounted.
 * `branch` of 'all' / empty means every branch.
 */
export function useFloorUpdates(
  handler: (update: FloorUpdate) => void,
  options: { branch?: string | null; debounceMs?: number } = {},
): void {
  const handlerRef = useRef(handler);
  const branchRef = useRef(options.branch ?? null);
  handlerRef.current = handler;
  branchRef.current = options.branch ?? null;
  const debounceMs = options.debounceMs;

  useEffect(
    () =>
      floorSync.subscribe((update) => handlerRef.current(update), {
        branch: () => (branchRef.current && branchRef.current !== 'all' ? branchRef.current : null),
        debounceMs,
      }),
    [debounceMs],
  );
}
