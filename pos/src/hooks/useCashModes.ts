import { useEffect, useState } from 'react';
import { getCashModes } from '../lib/payment-api';

/** Modes of payment of type Cash, for the banknote shortcuts. */
export function useCashModes(): Set<string> {
  const [modes, setModes] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    let cancelled = false;
    getCashModes().then((list) => {
      if (!cancelled) setModes(new Set(list));
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return modes;
}
