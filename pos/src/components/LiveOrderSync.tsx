import { showToast } from '@ury/ui';
import { usePOSStore } from '../store/pos-store';
import { useRootStore } from '../store/root-store';
import { useFloorUpdates } from '../lib/floor-sync';
import { t } from '../i18n';

/**
 * Keeps the cashier's open order in step with every other device.
 *
 * Mounted on the POS screen. When the order (or table) on screen changes
 * elsewhere — items added by a captain, the table transferred, the bill paid
 * or cancelled at another till — it reloads silently if nothing here is
 * unsent; otherwise the store raises `remoteChange` and `RemoteChangeBanner`
 * lets the cashier choose. Renders nothing.
 */
export default function LiveOrderSync() {
  const branch = usePOSStore((s) => s.posProfile?.branch ?? null);

  useFloorUpdates(async (update) => {
    const user = useRootStore.getState().user?.name;
    const outcome = await usePOSStore.getState().handleFloorUpdate(update, user);
    if (outcome === 'reloaded') {
      showToast.info(t('live.order_refreshed'));
    }
  }, { branch });

  return null;
}
