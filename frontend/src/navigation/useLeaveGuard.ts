/**
 * "别把填了一半的表单弄丢" (04 §4.6.5 离开确认).
 *
 * Three exits are covered:
 *  - a route change that removes the form (the navigator's `beforeRemove` event, which is
 *    preventable and re-dispatchable once the user has answered);
 *  - every page change the shell makes — sidebar, tab bar, switcher, sheets, the top bar's
 *    ‹ (decision §14.65 g). Those mostly *unmount* the form without removing its route (the
 *    signed-in groups are `Slot`s), so `beforeRemove` never hears of them; instead, while
 *    dirty, the guard registers with the shell (`useRegisterLeaveGuard`), which asks it
 *    before navigating and then lets the navigation through without a second question;
 *  - the browser closing/reloading the tab (`beforeunload`, guarded by `typeof window`
 *    rather than by a platform check).
 *
 * Buttons that leave on purpose call `confirmLeave()` themselves.
 */
import React from 'react';
import { useNavigation, useNavigationContainerRef } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { confirm } from '@/ui';

import { type LeaveGuardHandle, useRegisterLeaveGuard } from './leaveGuard';

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

  // The shell's exits: asked first, then let through once (the answer was "leave").
  //
  // expo-router queues a navigation and dispatches it on its next render, so the bypass has
  // to outlive `go()`. It is stood back down on the container's next state report: that
  // comes after the dispatch, and so after `beforeRemove` if the form's route is removed at
  // all — and a navigation that leaves the form mounted (the same route with new params)
  // does not leave a free pass behind for the next exit.
  const container = useNavigationContainerRef();
  const handle = React.useMemo<LeaveGuardHandle>(
    () => ({
      confirm: confirmLeave,
      pass: (go) => {
        bypass.current = true;
        const off = container.addListener('state', () => {
          off();
          bypass.current = false;
        });
        go();
      },
    }),
    [confirmLeave, container],
  );
  useRegisterLeaveGuard(dirty ? handle : null);

  // In-app navigation that removes the form's route.
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
