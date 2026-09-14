/**
 * The row window behind `DataTable` (04 §6.4): which rows are mounted, and everything that
 * moves them.
 *
 * A window is two numbers and two spacers. `anchor` is the index of the row under the top
 * edge of the scroll box, the mounted slice is one viewport of overscan on either side of
 * the visible screen, and the rows outside it are replaced by a spacer at each end — so the
 * content is as tall as the whole grid and the scrollbar's length and position are the ones
 * it would have if every row were mounted.
 *
 * The one rule the callers depend on: the window is aimed by *index*, never by "that row is
 * already mounted". Jumping to row 1500 of 2000 from row 1 moves the window first and the
 * scroll offset second, which is what makes `scrollToRow` and the keyboard work at all.
 *
 * It lives next to `DataTable` rather than inside it only because the file would otherwise
 * be over the 400-line limit; nothing else uses it.
 */
import React from 'react';
import type { ScrollView } from 'react-native';

/**
 * How many rows the window assumes fit in the box until `onLayout` reports its real height.
 *
 * The height is unknown on the first frame — and in every RNTL test, where `onLayout` never
 * fires at all — so a window that renders nothing without it would render nothing at all
 * there. The unmeasured window is a deliberately generous one instead: 54 rows of viewport,
 * i.e. 162 rows with the overscan, about 7000px of grid. That covers any real viewport, and
 * the widest import (2000 rows) still costs an order of magnitude less than all of it. The
 * window shrinks to the three screens around the offset as soon as the box is measured.
 */
export const UNMEASURED_VIEWPORT_ROWS = 54;

/** The mounted slice of the rows, `[first, last)`, and the gap that stands in for the rest. */
export interface RowWindow {
  first: number;
  last: number;
  topPad: number;
  bottomPad: number;
}

export interface RowWindowInput {
  count: number;
  rowHeight: number;
  scroller: React.RefObject<ScrollView | null>;
  /** Whenever this index changes to a number, that row is brought into view. */
  scrollToRow?: number | null;
  /** Bumped to repeat a jump to the same index (04 §4.11.8). */
  scrollSignal: number;
  /** The row the keyboard focus sits on, which has to stay mounted and in view. */
  focusRow: number | null;
}

export interface RowWindowResult extends RowWindow {
  onScroll(y: number): void;
  onLayout(height: number): void;
}

/**
 * The slice to mount when the top edge sits on row `anchor`, clamped to the data.
 *
 * Three screens tall wherever it sits: the screen itself, one above and one below. At the
 * very top there is nothing above, so the overscan that would have gone there is spent
 * downwards instead — otherwise the window a table opens on would be the thinnest one it
 * ever has.
 */
function sliceFor(anchor: number, viewportRows: number, count: number): [number, number] {
  const top = Math.max(0, Math.min(anchor, count));
  const first = Math.max(0, top - viewportRows);
  const last = Math.min(count, Math.max(top + viewportRows * 2, first + viewportRows * 3));
  return [first, last];
}

export function useRowWindow({
  count,
  rowHeight,
  scroller,
  scrollToRow,
  scrollSignal,
  focusRow,
}: RowWindowInput): RowWindowResult {
  // The window is state, not a ref: moving it has to repaint. `anchor` is a row index, so a
  // scroll only re-renders once per row crossed; `measured` is the box's real height.
  const [anchor, setAnchor] = React.useState(0);
  const [measured, setMeasured] = React.useState(0);
  // Where the box is and how tall it turned out, in pixels, so "is the focused row already
  // in view" can be answered without re-running on every scroll.
  const offset = React.useRef(0);
  const viewport = React.useRef(0);

  const viewportRows =
    measured > 0 ? Math.max(1, Math.ceil(measured / rowHeight)) : UNMEASURED_VIEWPORT_ROWS;
  // Clamp before slicing: a filter that narrows the data under a stale anchor (scrolled deep
  // into 2000 rows, then switched to a twelve-row slice) would otherwise put the top of the
  // grid behind a spacer until the browser's own scroll clamp caught up.
  const top = Math.min(anchor, Math.max(0, count - viewportRows));
  const [first, last] = sliceFor(top, viewportRows, count);
  // The effects below need the current window without depending on it: re-running them on
  // every scroll would drag the view back to the focused row the moment it left it.
  const shown = React.useRef<[number, number]>([first, last]);
  shown.current = [first, last];

  // Moving the view and moving the window are one act: the target row is usually not
  // mounted, so the window is aimed by index first and the box scrolled second.
  const moveTo = React.useCallback(
    (y: number): void => {
      offset.current = y;
      setAnchor(Math.max(0, Math.floor(y / rowHeight)));
      scroller.current?.scrollTo({ y, animated: true });
    },
    [rowHeight, scroller],
  );

  // "Scroll this row into view" is a one-shot request expressed as state: the caller sets an
  // index, we move, and nothing else depends on it. `scrollSignal` is the second half of the
  // request — it is in the dependencies precisely so that the same index asks again.
  React.useEffect(() => {
    if (scrollToRow === null || scrollToRow === undefined) return;
    moveTo(Math.max(0, scrollToRow * rowHeight - rowHeight));
  }, [scrollToRow, scrollSignal, rowHeight, moveTo]);

  // 04 §4.11.7: the focused cell stays in the viewport as the keyboard walks the grid — but
  // only when it would otherwise leave it, so arrowing around inside the visible rows never
  // yanks the view.
  React.useEffect(() => {
    if (focusRow === null) return;
    const top = focusRow * rowHeight;
    const height = viewport.current;
    if (height > 0) {
      // The header sits on top of the first visible row, so a row is only really visible one
      // row height below the current offset.
      if (top < offset.current + rowHeight) {
        moveTo(Math.max(0, top - rowHeight));
        return;
      }
      if (top + rowHeight > offset.current + height) {
        moveTo(top + rowHeight - height);
        return;
      }
    }
    // Either the box has not been measured yet or the row is already on screen; the one
    // thing still to guarantee is that the row is *mounted*, which `[` / `]` (jump to the
    // previous / next uncategorized row) and Shift+arrow can walk straight past the window
    // without ever moving the offset.
    if (focusRow < shown.current[0] || focusRow >= shown.current[1]) setAnchor(focusRow);
  }, [focusRow, rowHeight, moveTo]);

  return {
    first,
    last,
    topPad: first * rowHeight,
    bottomPad: Math.max(0, count - last) * rowHeight,
    onScroll: (y) => {
      offset.current = y;
      const next = Math.max(0, Math.floor(y / rowHeight));
      setAnchor((current) => (current === next ? current : next));
    },
    onLayout: (height) => {
      viewport.current = height;
      setMeasured((current) => (current === height ? current : height));
    },
  };
}
