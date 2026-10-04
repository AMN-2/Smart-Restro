import { RefreshCw, X } from 'lucide-react';
import { Button } from '@ury/ui';
import { usePOSStore } from '../store/pos-store';
import { t } from '../i18n';

/**
 * "This order changed on another device" — shown above the cart while it
 * holds unsent edits, so neither side's work is overwritten silently.
 * Reload takes the server's version; Keep leaves the edits (sending them
 * then is checked server-side against the newer order).
 */
export default function RemoteChangeBanner({ onReload }: { onReload?: () => void } = {}) {
  const remoteChange = usePOSStore((s) => s.remoteChange);
  const reloadRemoteChange = usePOSStore((s) => s.reloadRemoteChange);
  const handleReload = () => {
    if (onReload) {
      usePOSStore.setState({ remoteChange: null });
      onReload();
    } else {
      void reloadRemoteChange();
    }
  };

  if (!remoteChange) return null;

  return (
    <div
      role="alert"
      className="mx-4 mt-3 flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
    >
      <RefreshCw className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{t('live.changed_elsewhere_title')}</p>
        <p className="mt-0.5 text-amber-800">
          {remoteChange.by
            ? t('live.changed_elsewhere_by', { user: remoteChange.by })
            : t('live.changed_elsewhere_body')}
        </p>
        <div className="mt-2 flex gap-2">
          <Button size="sm" onClick={handleReload}>
            {t('live.reload_order')}
          </Button>
          <Button size="sm" variant="outline" onClick={() => usePOSStore.setState({ remoteChange: null })}>
            {t('live.keep_mine')}
          </Button>
        </div>
      </div>
      <button
        type="button"
        onClick={() => usePOSStore.setState({ remoteChange: null })}
        aria-label={t('common.close')}
        className="rounded-md p-1 text-amber-700 hover:bg-amber-100"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
