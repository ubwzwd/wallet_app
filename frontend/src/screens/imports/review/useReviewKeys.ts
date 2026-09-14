/**
 * Keyboard navigation for the review table (04 §4.11.7): a whole batch has to be fixable
 * without touching the mouse.
 *
 * | key | action |
 * |---|---|
 * | ↑ / ↓ | previous / next row |
 * | ← / →, Tab / Shift+Tab | previous / next cell |
 * | Enter | edit this cell; while editing, save and drop one row |
 * | Esc | while editing: cancel and restore the original; otherwise: leave the grid |
 * | Space | select / deselect the row |
 * | Shift + ↑ / ↓ | extend the selection |
 * | S | skip / unskip the row |
 * | C | open the row's category picker |
 * | [ / ] | previous / next uncategorized row |
 * | ⌘/Ctrl + Enter | commit the batch (only when nothing blocks it) |
 * | ? | the shortcut sheet |
 *
 * `Tab` is the grid's only borrowed key, so it is borrowed narrowly: the table takes it
 * while a cell has the focus and leaves it alone otherwise, which is what lets the keyboard
 * reach the filter slices, the bulk bar and the submit button.
 *
 * As in the entry form (04 §4.6), the listener hangs off `document` and is guarded by
 * `typeof document` rather than a platform check, and plain characters are left alone while
 * the caret is inside a text box — except `Enter` and `Esc`, which are exactly what "save
 * this cell" and "never mind" mean while editing.
 */
import React from 'react';

import type { DataTableCellPos } from '@/ui';

export interface ReviewKeyHandlers {
  enabled?: boolean;
  rowCount: number;
  colCount: number;
  focus: DataTableCellPos | null;
  setFocus(pos: DataTableCellPos): void;
  /** Hands focus back to the page: `Esc` outside an edit is how the grid is left. */
  clearFocus(): void;
  /** `true` while a cell editor is open and owns Enter / Esc. */
  editing: boolean;
  beginEdit(): void;
  commitEdit(): void;
  cancelEdit(): void;
  toggleSelect(): void;
  extendSelect(delta: -1 | 1): void;
  toggleSkip(): void;
  openCategory(): void;
  jumpUncategorized(delta: -1 | 1): void;
  commitBatch(): void;
  help(): void;
}

/** Whether the event came from somewhere that eats plain characters. */
function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as { tagName?: string; isContentEditable?: boolean } | null;
  if (!el) return false;
  if (el.isContentEditable === true) return true;
  const tag = typeof el.tagName === 'string' ? el.tagName.toUpperCase() : '';
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function clamp(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.min(Math.max(value, 0), max - 1);
}

export function useReviewKeys(handlers: ReviewKeyHandlers): void {
  const ref = React.useRef(handlers);
  ref.current = handlers;
  const enabled = handlers.enabled !== false;

  React.useEffect(() => {
    if (!enabled) return;
    if (typeof document === 'undefined') return;
    // Captured once: the cleanup must detach from the very object it attached to.
    const host = document;

    function move(dRow: number, dCol: number): void {
      const h = ref.current;
      const at = h.focus ?? { row: 0, col: 0 };
      h.setFocus({
        row: clamp(at.row + dRow, h.rowCount),
        col: clamp(at.col + dCol, h.colCount),
      });
    }

    function onKeyDown(event: KeyboardEvent): void {
      const h = ref.current;
      const mod = event.metaKey || event.ctrlKey;

      if (mod && event.key === 'Enter') {
        event.preventDefault();
        h.commitBatch();
        return;
      }
      if (mod || event.altKey) return;

      if (h.editing) {
        if (event.key === 'Enter') {
          event.preventDefault();
          h.commitEdit();
          move(1, 0);
        } else if (event.key === 'Escape') {
          event.preventDefault();
          h.cancelEdit();
        }
        return;
      }

      if (isTypingTarget(event.target)) return;

      // Tab only belongs to the grid once the grid has the focus, and it is given back by
      // `Esc`: otherwise the table would swallow the one key that reaches the filter
      // slices, the bulk bar and the submit button.
      if (event.key === 'Tab') {
        if (h.focus === null) return;
        event.preventDefault();
        move(0, event.shiftKey ? -1 : 1);
        return;
      }

      switch (event.key) {
        case 'ArrowDown':
          event.preventDefault();
          if (event.shiftKey) h.extendSelect(1);
          else move(1, 0);
          return;
        case 'ArrowUp':
          event.preventDefault();
          if (event.shiftKey) h.extendSelect(-1);
          else move(-1, 0);
          return;
        case 'ArrowLeft':
          event.preventDefault();
          move(0, -1);
          return;
        case 'ArrowRight':
          event.preventDefault();
          move(0, 1);
          return;
        case 'Enter':
          event.preventDefault();
          h.beginEdit();
          return;
        case 'Escape':
          // Not editing: leave the grid altogether (04 §4.11.7 — the keyboard has to be
          // able to get out of the table as well as around it).
          h.clearFocus();
          return;
        case ' ':
          event.preventDefault();
          h.toggleSelect();
          return;
        case '[':
          event.preventDefault();
          h.jumpUncategorized(-1);
          return;
        case ']':
          event.preventDefault();
          h.jumpUncategorized(1);
          return;
        case '?':
          event.preventDefault();
          h.help();
          return;
        default:
          break;
      }

      if (event.key === 's' || event.key === 'S') {
        event.preventDefault();
        h.toggleSkip();
        return;
      }
      if (event.key === 'c' || event.key === 'C') {
        event.preventDefault();
        h.openCategory();
      }
    }

    host.addEventListener('keydown', onKeyDown);
    return () => host.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}
