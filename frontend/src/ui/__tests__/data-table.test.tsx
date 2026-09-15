/**
 * DataTable's row windowing (04 §6.4).
 *
 * The import review grid pulls a whole batch in on purpose — up to 2000 rows of eleven
 * cells — so the table may only ever mount the rows around the scroll offset. What these
 * tests hold it to: the mounted slice is a tiny fraction of the data, the spacers keep the
 * scroll range (and with it the scrollbar) the size of the full grid, the window follows
 * the scroll, and both ways of jumping — `scrollToRow` and the keyboard focus — reach a row
 * that was nowhere near being mounted.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { ThemeProvider } from '@/theme/ThemeProvider';
import {
  DATA_TABLE_ROW_HEIGHT,
  DataTable,
  type DataTableCellPos,
  type DataTableColumn,
} from '@/ui/DataTable';
import { Text } from '@/ui/Text';

interface Item {
  id: string;
  label: string;
}

const COUNT = 2000;
const ITEMS: Item[] = Array.from({ length: COUNT }, (_, i) => ({
  id: `r${i}`,
  label: `row ${i}`,
}));

const COLUMNS: DataTableColumn<Item>[] = [
  {
    key: 'label',
    title: 'Label',
    width: 160,
    render: (item) => <Text variant="body">{item.label}</Text>,
  },
  {
    key: 'id',
    title: 'Id',
    width: 120,
    render: (item) => <Text variant="body">{item.id}</Text>,
  },
];

interface Options {
  selected?: ReadonlySet<string>;
  onToggleRow?(item: Item, index: number, opts: { extend: boolean }): void;
  focus?: DataTableCellPos | null;
  scrollToRow?: number | null;
  scrollSignal?: number;
  footer?: React.ReactNode;
}

function renderTable(options: Options = {}) {
  const view = render(
    <ThemeProvider initialPref="light">
      <DataTable<Item>
        testID="grid"
        rows={ITEMS}
        columns={COLUMNS}
        rowKey={(item) => item.id}
        {...options}
      />
    </ThemeProvider>,
  );
  return view;
}

/** Every row currently mounted, in order. */
function mountedRows(): number[] {
  return screen
    .queryAllByTestId(/^grid-row-r\d+$/)
    .map((node) => Number(String(node.props.testID).replace('grid-row-r', '')));
}

function spacerHeight(which: 'top' | 'bottom'): number {
  const style = StyleSheet.flatten(
    screen.getByTestId(`grid-spacer-${which}`).props.style as never,
  ) as unknown as { height: number };
  return style.height;
}

/** RNTL never fires `onLayout`, so this is how the table learns how tall its box is. */
function measure(height: number): void {
  fireEvent(screen.getByTestId('grid'), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 800, height } },
  });
}

function scrollTo(y: number): void {
  fireEvent.scroll(screen.getByTestId('grid'), {
    nativeEvent: {
      contentOffset: { x: 0, y },
      contentSize: { width: 800, height: COUNT * DATA_TABLE_ROW_HEIGHT },
      layoutMeasurement: { width: 800, height: 440 },
    },
  });
}

describe('DataTable row windowing', () => {
  test('a 2000-row table mounts a window, and the spacers keep the full scroll range', () => {
    renderTable();

    const mounted = mountedRows();
    // Far fewer rows than the data, but still a full screen's worth — the box has not been
    // measured here (as on the first frame), and a window of nothing would be a blank grid.
    expect(mounted.length).toBeLessThan(200);
    expect(mounted.length).toBeGreaterThan(30);
    expect(mounted[0]).toBe(0);
    expect(screen.queryByTestId('grid-row-r1999')).toBeNull();

    // Nothing is missing from the scroll range: what is not mounted is spacer.
    expect(spacerHeight('top')).toBe(0);
    expect(spacerHeight('top') + spacerHeight('bottom') + mounted.length * DATA_TABLE_ROW_HEIGHT)
      .toBe(COUNT * DATA_TABLE_ROW_HEIGHT);
  });

  test('measuring the box shrinks the window, and scrolling moves it', () => {
    renderTable();
    measure(440); // ten rows of viewport

    const atTop = mountedRows();
    expect(atTop.length).toBeLessThan(60);
    expect(atTop.length).toBeGreaterThanOrEqual(10);
    expect(atTop[0]).toBe(0);

    // Half way down the grid: the window follows, the rows at the top are released, and
    // the top spacer has grown to exactly the rows it replaced.
    scrollTo(500 * DATA_TABLE_ROW_HEIGHT);
    const mounted = mountedRows();
    expect(mounted).toContain(500);
    expect(mounted).not.toContain(0);
    expect(mounted.length).toBeLessThan(60);
    expect(spacerHeight('top')).toBe(mounted[0] * DATA_TABLE_ROW_HEIGHT);
    expect(spacerHeight('top') + spacerHeight('bottom') + mounted.length * DATA_TABLE_ROW_HEIGHT)
      .toBe(COUNT * DATA_TABLE_ROW_HEIGHT);
  });

  test('scrollToRow reaches a row that was never mounted', () => {
    const view = renderTable({ scrollToRow: null });
    measure(440);
    expect(screen.queryByTestId('grid-row-r1500')).toBeNull();

    view.rerender(
      <ThemeProvider initialPref="light">
        <DataTable<Item>
          testID="grid"
          rows={ITEMS}
          columns={COLUMNS}
          rowKey={(item) => item.id}
          scrollToRow={1500}
        />
      </ThemeProvider>,
    );

    // The window was aimed by index, not by "the row is already there".
    expect(screen.getByTestId('grid-row-r1500')).toBeTruthy();
    expect(mountedRows().length).toBeLessThan(60);
    expect(spacerHeight('top')).toBe(mountedRows()[0] * DATA_TABLE_ROW_HEIGHT);
  });

  test('a keyboard jump brings the focused row into the window', () => {
    const view = renderTable({ focus: { row: 0, col: 0 } });
    // No layout here: End on the first frame has to work too.
    expect(screen.queryByTestId('grid-row-r1200')).toBeNull();

    view.rerender(
      <ThemeProvider initialPref="light">
        <DataTable<Item>
          testID="grid"
          rows={ITEMS}
          columns={COLUMNS}
          rowKey={(item) => item.id}
          focus={{ row: 1200, col: 1 }}
        />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('grid-row-r1200')).toBeTruthy();
    // And the focus ring is on the cell the caller named, not on the first mounted one.
    const cell = screen.getByTestId('grid-cell-r1200-id');
    const style = StyleSheet.flatten(cell.props.style as never) as unknown as {
      borderColor: string;
    };
    expect(style.borderColor).not.toBe('transparent');
  });

  test('a row inside the window keeps its own index after the window has moved', () => {
    const toggled: number[] = [];
    renderTable({
      selected: new Set<string>(),
      onToggleRow: (_item, index) => toggled.push(index),
    });
    measure(440);
    scrollTo(700 * DATA_TABLE_ROW_HEIGHT);

    fireEvent.press(screen.getByTestId('grid-select-r700'));
    // Selection, shift-ranges and the keyboard all speak in indexes into `rows`, so the
    // window's offset must not leak into them.
    expect(toggled).toEqual([700]);
  });

  test('narrowing the rows under a deep scroll still paints from the top', () => {
    const view = renderTable();
    measure(440);
    scrollTo(1500 * DATA_TABLE_ROW_HEIGHT);
    expect(mountedRows()[0]).toBeGreaterThan(1000);

    // What a review filter does: the same grid, a fraction of the rows, and an anchor still
    // pointing a thousand rows past the end of them.
    const few = ITEMS.slice(0, 12);
    view.rerender(
      <ThemeProvider initialPref="light">
        <DataTable<Item>
          testID="grid"
          rows={few}
          columns={COLUMNS}
          rowKey={(item) => item.id}
        />
      </ThemeProvider>,
    );

    expect(mountedRows()).toEqual([...few.keys()]);
    expect(spacerHeight('top')).toBe(0);
    expect(spacerHeight('bottom')).toBe(0);
  });

  test('every mounted row is still a full-size tap target', () => {
    renderTable({ selected: new Set<string>() });
    const select = StyleSheet.flatten(
      screen.getByTestId('grid-select-r0').props.style as never,
    ) as unknown as { minHeight: number };
    const cell = StyleSheet.flatten(
      screen.getByTestId('grid-cell-r0-label').props.style as never,
    ) as unknown as { minHeight: number };
    expect(select.minHeight).toBe(DATA_TABLE_ROW_HEIGHT);
    expect(cell.minHeight).toBe(DATA_TABLE_ROW_HEIGHT);
  });
});

// ------------------------------------------------------------------ the card's own bottom bar

test('the footer sits inside the card, outside both scroll boxes (屏幕稿 03)', () => {
  renderTable({ footer: <Text variant="body">bar</Text> });

  // It is part of the card, not a second one below it — and it is *not* inside the
  // vertical scroll box, so scrolling the rows never moves it out of reach.
  const footer = screen.getByTestId('grid-footer');
  expect(footer).toBeTruthy();
  expect(screen.getByText('bar')).toBeTruthy();
  const inScroller = screen.getByTestId('grid').findAllByProps({ testID: 'grid-footer' });
  expect(inScroller).toHaveLength(0);
});

test('no footer is drawn when none is asked for', () => {
  renderTable();
  expect(screen.queryByTestId('grid-footer')).toBeNull();
});
