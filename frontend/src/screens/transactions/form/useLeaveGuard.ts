/**
 * "别把填了一半的表单弄丢" (04 §4.6.5 离开确认).
 *
 * Two exits are covered: a route change inside the app (the navigator's `beforeRemove`
 * event, which is preventable and re-dispatchable once the user has answered), and the
 * browser closing/reloading the tab (`beforeunload`, guarded by `typeof window` rather
 * than by a platform check). Buttons that leave on purpose call `confirmLeave()` themselves.
 */
import React from 'react';
import { useNavigation } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { confirm } from '@/ui';

/** The slice of the navigation object this hook needs; expo-router's type is wider. */
interface RemovalEvent {
  preventDefault(): void;
  data: { action: unknown };
}
interface GuardableNavigation {
  addListener(type: string, callback: (event: RemovalEvent) => void): () => void;
  dispatch(action: unknown): void;
}

export interface LeaveGuard {
  /** `true` when it is safe to leave — either nothing is dirty, or the user said so. */
  confirmLeave(): Promise<boolean>;
  /**
   * Let the **next** navigation through without asking. A successful save is exactly that
   * case: the changes are no longer unsaved, but the form is still marked dirty at the
   * moment the screen navigates away.
   */
  allowLeave(): void;
}

export function useLeaveGuard(dirty: boolean): LeaveGuard {
  const { t } = useTranslation();
  const navigation = useNavigation() as unknown as GuardableNavigation;
  const bypass = React.useRef(false);

  const allowLeave = React.useCallback((): void => {
    bypass.current = true;
  }, []);

  const confirmLeave = React.useCallback(async (): Promise<boolean> => {
    if (!dirty || bypass.current) return true;
    return confirm({
      title: t('common:unsaved_changes.title'),
      body: t('common:unsaved_changes.body'),
      confirmLabel: t('common:unsaved_changes.leave'),
      cancelLabel: t('common:unsaved_changes.stay'),
    });
  }, [dirty, t]);

  // In-app navigation.
  React.useEffect(() => {
    if (!dirty) return;
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = navigation.addListener('beforeRemove', (event: RemovalEvent) => {
        if (bypass.current) {
          bypass.current = false;
          return;
        }
        event.preventDefault();
        void confirmLeave().then((leave) => {
          if (leave) navigation.dispatch(event.data.action);
        });
      });
    } catch {
      // expo-router's `Slot` is a navigator and does emit `beforeRemove` (pinned by
      // form-kinds.test.tsx), but a host that does not would throw here rather than take
      // the whole screen down; the in-page cancel button still goes through
      // `confirmLeave()` either way.
    }
    return unsubscribe;
  }, [confirmLeave, dirty, navigation]);

  // Closing / reloading the tab.
  React.useEffect(() => {
    if (!dirty) return;
    if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return;
    const onBeforeUnload = (event: BeforeUnloadEvent): string => {
      event.preventDefault();
      // Browsers show their own wording; a non-empty return value is what triggers it.
      event.returnValue = '';
      return '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  return { confirmLeave, allowLeave };
}
