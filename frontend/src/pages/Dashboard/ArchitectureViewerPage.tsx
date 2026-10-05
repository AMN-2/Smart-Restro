import { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, ExternalLink, Network, Power, PowerOff, RefreshCw, ShieldAlert } from 'lucide-react';
import { call, parseFrappeError } from '@ury/core';
import { Button, Card, Spinner, showToast } from '@ury/ui';
import { t } from '../../i18n';

const API = 'ury.ury.api.architecture_viewer';

interface ViewerState {
  running: boolean;
  port: number;
  path: string | null;
  started_at: string | null;
  started_by: string | null;
}

const unwrap = <T,>(res: unknown): T => ((res as { message?: T })?.message ?? res) as T;

export const ArchitectureViewerPage = () => {
  const [state, setState] = useState<ViewerState | null>(null);
  const [error, setError] = useState('');
  const [working, setWorking] = useState<'start' | 'stop' | 'refresh' | ''>('');

  const publicUrl = useMemo(() => {
    if (!state?.running || !state.path) return '';
    return `http://${window.location.hostname}:${state.port}${state.path}`;
  }, [state]);

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setWorking('refresh');
    setError('');
    try {
      setState(unwrap<ViewerState>(await call(`${API}.status`, {})));
    } catch (err) {
      setError(parseFrappeError(err, t('dash.architecture.load_failed')));
    } finally {
      if (!quiet) setWorking('');
    }
  }, []);

  useEffect(() => { void refresh(true); }, [refresh]);

  const runAction = async (action: 'start' | 'stop') => {
    setWorking(action);
    try {
      setState(unwrap<ViewerState>(await call(`${API}.${action}`, {})));
      showToast.success(t(`dash.architecture.${action === 'start' ? 'started' : 'stopped'}`));
    } catch (err) {
      showToast.error(parseFrappeError(err, t(`dash.architecture.${action}_failed`)));
    } finally {
      setWorking('');
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
      showToast.success(t('dash.architecture.copied'));
    } catch {
      showToast.error(t('dash.architecture.copy_failed'));
    }
  };

  if (error) return <Card className="p-10 text-center text-sm text-red-600 space-y-3"><p>{error}</p><Button variant="outline" onClick={() => void refresh()}>{t('common.retry')}</Button></Card>;
  if (!state) return <div className="py-24 flex justify-center"><Spinner className="w-8 h-8 text-primary" /></div>;

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-xl font-bold text-gray-900">{t('dash.architecture.title')}</h1><p className="text-sm text-gray-500">{t('dash.architecture.subtitle')}</p></div>
        <Button variant="outline" onClick={() => void refresh()} disabled={!!working} className="gap-2">{working === 'refresh' ? <Spinner className="w-4 h-4" /> : <RefreshCw className="w-4 h-4" />}{t('common.refresh')}</Button>
      </div>

      <Card className="border border-gray-200 p-6 space-y-5">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className={`flex h-11 w-11 items-center justify-center rounded-xl ${state.running ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}><Network className="w-5 h-5" /></span>
            <div><p className="font-bold text-gray-900">{state.running ? t('dash.architecture.running') : t('dash.architecture.stopped_status')}</p><p className="text-xs text-gray-500">{t('dash.architecture.port', { port: state.port })}</p></div>
          </div>
          <span className={`h-3 w-3 rounded-full ${state.running ? 'bg-emerald-500 animate-pulse' : 'bg-gray-300'}`} />
        </div>

        {state.running && <div className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-xs font-semibold text-emerald-800">{t('dash.architecture.current_link')}</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <code className="min-w-0 flex-1 overflow-x-auto rounded-lg bg-white px-3 py-2 text-sm text-gray-800 border border-emerald-100">{publicUrl}</code>
            <Button variant="outline" onClick={() => void copyLink()} className="gap-2"><Copy className="w-4 h-4" />{t('dash.architecture.copy')}</Button>
            <Button variant="outline" onClick={() => window.open(publicUrl, '_blank', 'noopener,noreferrer')} className="gap-2"><ExternalLink className="w-4 h-4" />{t('dash.architecture.open')}</Button>
          </div>
          {state.started_by && <p className="text-xs text-emerald-800">{t('dash.architecture.started_by', { user: state.started_by })}</p>}
        </div>}

        {!state.running ?
          <Button onClick={() => void runAction('start')} disabled={!!working} className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700">{working === 'start' ? <Spinner className="w-4 h-4" /> : <Power className="w-4 h-4" />}{t('dash.architecture.start')}</Button> :
          <Button onClick={() => void runAction('stop')} disabled={!!working} className="gap-2 bg-red-600 text-white hover:bg-red-700">{working === 'stop' ? <Spinner className="w-4 h-4" /> : <PowerOff className="w-4 h-4" />}{t('dash.architecture.stop')}</Button>}
      </Card>

      <Card className="border border-amber-200 bg-amber-50 p-5"><div className="flex items-start gap-3 text-amber-900"><ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" /><div className="space-y-1"><p className="text-sm font-bold">{t('dash.architecture.security_title')}</p><p className="text-sm leading-6">{t('dash.architecture.security_note')}</p></div></div></Card>
    </div>
  );
};

export default ArchitectureViewerPage;
