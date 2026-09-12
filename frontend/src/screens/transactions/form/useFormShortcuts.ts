/**
 * Desktop keyboard shortcuts for the entry form (04 §4.6, decision §14.52 A19):
 * `⌘/Ctrl+S` save, `⌘/Ctrl+Enter` save and add another, `Esc` discard, `1..4` switch tab
 * (only while the focus is not in a text box), `?` open the shortcut sheet.
 *
 * The listener is attached to `document`, which only exists on the web build — the guard
 * is `typeof document`, never a platform check (04 §0.2: pages and their hooks never branch
 * on the running platform).
 */
import React from 'react';

import type { TxKind } from '@/api/types';
import { KINDS } from '@/domain/kinds';

export interface FormShortcutHandlers {
  onSave(): void;
  onSaveAndNext(): void;
  onDiscard(): void;
  /** Omitted on the edit screens, where the tab row is not freely switchable. */
  onKind?(kind: TxKind): void;
  onHelp(): void;
  /** `false` unhooks everything (e.g. while a modal owns the keyboard). */
  enabled?: boolean;
}

/** Whether the key event came from somewhere that eats plain characters. */
function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as { tagName?: string; isContentEditable?: boolean } | null;
  if (!el) return false;
  if (el.isContentEditable === true) return true;
  const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : '';
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export function useFormShortcuts(handlers: FormShortcutHandlers): void {
  // A ref keeps the listener registered exactly once while the callbacks stay fresh.
  const ref = React.useRef(handlers);
  ref.current = handlers;
  const enabled = handlers.enabled !== false;

  React.useEffect(() => {
    if (!enabled) return;
    if (typeof document === 'undefined') return;

    function onKeyDown(event: KeyboardEvent): void {
      const h = ref.current;
      const mod = event.metaKey || event.ctrlKey;

      if (mod && (event.key === 's' || event.key === 'S')) {
        event.preventDefault();
        h.onSave();
        return;
      }
      if (mod && event.key === 'Enter') {
        event.preventDefault();
        h.onSaveAndNext();
        return;
      }
      if (event.key === 'Escape') {
        h.onDiscard();
        return;
      }
      if (mod || event.altKey) return;
      if (isTypingTarget(event.target)) return;

      if (event.key === '?') {
        event.preventDefault();
        h.onHelp();
        return;
      }
      const digit = Number(event.key);
      if (Number.isInteger(digit) && digit >= 1 && digit <= KINDS.length) {
        event.preventDefault();
        h.onKind?.(KINDS[digit - 1]);
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
