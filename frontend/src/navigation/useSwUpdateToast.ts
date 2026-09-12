/**
 * 04 §7.2, last row: the service worker keeps `skipWaiting`, so a new build takes over
 * silently. Without a hint the user can keep hitting a bug that is already fixed, so the
 * takeover (`controllerchange`) raises one Toast asking for a refresh.
 *
 * Feature detection rather than a platform switch: `navigator.serviceWorker` exists only
 * in a browser, which keeps this hook importable from native builds unchanged.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';

import { toast } from '@/ui';

type Container = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

function serviceWorkerContainer(): Container | null {
  const nav = (globalThis as { navigator?: { serviceWorker?: Container } }).navigator;
  const container = nav?.serviceWorker;
  if (!container || typeof container.addEventListener !== 'function') return null;
  return container;
}

export function useSwUpdateToast(): void {
  const { t } = useTranslation();
  React.useEffect(() => {
    const container = serviceWorkerContainer();
    if (!container) return;
    const onControllerChange = (): void => {
      toast.info(t('common:status.update_available'));
    };
    container.addEventListener('controllerchange', onControllerChange);
    return () => container.removeEventListener('controllerchange', onControllerChange);
  }, [t]);
}
