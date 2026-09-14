/**
 * DataTable (04 §6.4): the base the import review grid is built on — column definitions,
 * a sticky header, 44px rows (tighter than the C2 list density), a selection column with
 * select-all, an inline-edit slot per cell and a controlled keyboard focus ring.
 *
 * It is presentation-only: it knows nothing about imports, the API or i18n. Every label
 * arrives as a prop, every piece of state (selection, focus, the row to scroll to) is
 * owned by the caller, and a cell's content is whatever `column.render` returns — that is
 * the "inline editing slot": the caller decides when a cell renders a value and when it
 * renders an editor.
 *
 * The table is its own scroll container in both directions — a vertical box of a bounded
 * height (`maxHeight`, or the viewport minus the page chrome) inside a horizontal one — so
 * the header can stick, `scrollToRow` can move and the focused cell can be kept in view.
 *
 * Rows are windowed (04 §6.4). A batch may hold up to 2000 of them (`IMPORT_MAX_ROWS`) and
 * each row is eleven cells, so mounting the whole slice would cost twenty thousand
 * components at once. Only the rows around the scroll offset are mounted — one viewport
 * above and one below — and the rest of the scroll range is held open by a spacer at each
 * end, so the scrollbar's length and position are the ones the full grid would have. The
 * window is aimed by *index*, never by "the row is already mounted": `scrollToRow` and the
 * keyboard both move it first and scroll second, so a jump to row 1500 works from row 1.
 * Row heights are assumed to be the nominal 44 — a row carrying a hint line is taller,
 * which costs the mapping a few pixels and nothing else.
 */
import React from 'react';
import {
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  ScrollView,
  type StyleProp,
  View,
  type ViewStyle,
  useWindowDimensions,
} from 'react-native';

import { radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';

import { Checkbox } from './Checkbox';
import { Text } from './Text';
import { useRowWindow } from './useRowWindow';

/** 04 §6.4: the review grid is tighter than the 56px list row. */
export const DATA_TABLE_ROW_HEIGHT = 44;

/** Width of the leading selection column. */
const SELECT_WIDTH = 44;

/**
 * How much of the viewport the page keeps for everything that is not the table (the top
 * bar, the screen header, the filter slices, the bulk bar and the submit bar). The table's
 * own scroll box is what is left, unless the caller measures better and passes `maxHeight`.
 *
 * A height matters: the vertical ScrollView is nested inside the page's own scroll view, so
 * without one it grows to its content and *nothing* scrolls inside it — the sticky header
 * would not stick and `scrollTo` would be a no-op.
 */
const CHROME_HEIGHT = 320;
const MIN_TABLE_HEIGHT = 240;

export interface DataTableCellContext {
  rowIndex: number;
  colIndex: number;
  /** The keyboard focus is on this cell (04 §4.11.7). */
  focused: boolean;
}

export interface DataTableColumn<Row> {
  key: string;
  title: string;
  width: number;
  align?: 'left' | 'right';
  render(row: Row, ctx: DataTableCellContext): React.ReactNode;
}

export interface DataTableToggleOpts {
  /** The row checkbox was clicked with Shift held: select the range, do not toggle. */
  extend: boolean;
}

/** Whether a press event carries the Shift modifier, in either place a platform puts it. */
function isShiftPress(event: GestureResponderEvent | undefined): boolean {
  const flat = event as unknown as
    | { shiftKey?: boolean; nativeEvent?: { shiftKey?: boolean } }
    | undefined;
  return flat?.shiftKey === true || flat?.nativeEvent?.shiftKey === true;
}

/** A cell address: indexes into `rows` and into `columns` (the select column is not one). */
export interface DataTableCellPos {
  row: number;
  col: number;
}

/** How a whole row is painted; `muted` is the skipped row, `highlight` the one an error
 *  pointed at. */
export type DataTableRowTone = 'default' | 'muted' | 'highlight';

export interface DataTableProps<Row> {
  rows: readonly Row[];
  columns: readonly DataTableColumn<Row>[];
  rowKey(row: Row): string;
  /** Presence of this set turns the selection column on. */
  selected?: ReadonlySet<string>;
  /**
   * `extend` is the Shift modifier of the click (04 §4.11.2: "Shift-click selects a
   * range"). It is only ever true where the platform reports modifier keys — a touch
   * press carries none, and the caller falls back to a plain toggle.
   */
  onToggleRow?(row: Row, index: number, opts: DataTableToggleOpts): void;
  onToggleAll?(next: boolean): void;
  selectAllLabel?: string;
  rowSelectLabel?(row: Row): string;
  /** Rendered inside the selection column, under the checkbox (the save-state dot). */
  rowLead?(row: Row): React.ReactNode;
  /** A full-width second line below the row — the server's read-only `hint`. */
  rowBelow?(row: Row): React.ReactNode;
  rowTone?(row: Row): DataTableRowTone;
  focus?: DataTableCellPos | null;
  onFocusCell?(pos: DataTableCellPos): void;
  /** Whenever this index changes to a number, that row is scrolled into view. */
  scrollToRow?: number | null;
  /**
   * Bump this to repeat a scroll the index alone cannot express: "jump to the first
   * uncategorized row" pressed twice is two requests for the *same* row, and both have to
   * move the view (04 §4.11.8).
   */
  scrollSignal?: number;
  /**
   * Height of the table's own scroll box. Defaults to the viewport minus the page chrome;
   * pass a measured value when the surrounding layout is known.
   */
  maxHeight?: number;
  emptyLabel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function DataTable<Row>({
  rows,
  columns,
  rowKey,
  selected,
  onToggleRow,
  onToggleAll,
  selectAllLabel,
  rowSelectLabel,
  rowLead,
  rowBelow,
  rowTone,
  focus,
  onFocusCell,
  scrollToRow,
  scrollSignal = 0,
  maxHeight,
  emptyLabel,
  style,
  testID,
}: DataTableProps<Row>): React.JSX.Element {
  const colors = useColors();
  const id = testID ?? 'data-table';
  const selectable = selected !== undefined;
  const scroller = React.useRef<ScrollView | null>(null);
  const viewportSize = useWindowDimensions();
  const boxHeight =
    maxHeight ?? Math.max(MIN_TABLE_HEIGHT, viewportSize.height - CHROME_HEIGHT);

  // Which rows are mounted, and everything that moves that window: the scroll offset, the
  // measured height of the box, `scrollToRow` and the focused row (see `useRowWindow`).
  const { first, last, topPad, bottomPad, onScroll, onLayout } = useRowWindow({
    count: rows.length,
    rowHeight: DATA_TABLE_ROW_HEIGHT,
    scroller,
    scrollToRow,
    scrollSignal,
    focusRow: focus?.row ?? null,
  });

  const totalWidth =
    (selectable ? SELECT_WIDTH : 0) + columns.reduce((sum, c) => sum + c.width, 0);

  const allSelected = selectable && rows.length > 0 && rows.every((r) => selected.has(rowKey(r)));
  const someSelected = selectable && rows.some((r) => selected.has(rowKey(r)));

  const header = (
    <View
      testID={`${id}-header`}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: DATA_TABLE_ROW_HEIGHT,
        backgroundColor: colors['bg.subtle'],
        borderTopLeftRadius: radius.md,
        borderTopRightRadius: radius.md,
      }}
    >
      {selectable ? (
        <View style={{ width: SELECT_WIDTH, paddingHorizontal: space['2'] }}>
          <Checkbox
            testID={`${id}-select-all`}
            checked={allSelected}
            indeterminate={!allSelected && someSelected}
            accessibilityLabel={selectAllLabel}
            onChange={(next) => onToggleAll?.(next)}
          />
        </View>
      ) : null}
      {columns.map((column) => (
        <View
          key={column.key}
          testID={`${id}-header-${column.key}`}
          style={{
            width: column.width,
            paddingHorizontal: space['2'],
            alignItems: column.align === 'right' ? 'flex-end' : 'flex-start',
          }}
        >
          <Text variant="micro" tone="secondary" numberOfLines={1}>
            {column.title}
          </Text>
        </View>
      ))}
    </View>
  );

  function rowBackground(tone: DataTableRowTone): string {
    if (tone === 'highlight') return colors['status.warning.bg'];
    return colors['bg.surface'];
  }

  // Only the window is mounted; `rowIndex` stays the index into `rows`, because that is
  // what selection, focus and every caller callback speak in.
  const body = rows.slice(first, last).map((row, sliceIndex) => {
    const rowIndex = first + sliceIndex;
    const key = rowKey(row);
    const tone = rowTone?.(row) ?? 'default';
    const below = rowBelow?.(row);
    return (
      <View
        key={key}
        testID={`${id}-row-${key}`}
        style={{
          borderTopWidth: 1,
          borderColor: colors['border.default'],
          backgroundColor: rowBackground(tone),
          opacity: tone === 'muted' ? 0.55 : 1,
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'stretch',
            minHeight: DATA_TABLE_ROW_HEIGHT,
          }}
        >
          {selectable ? (
            <View
              style={{
                width: SELECT_WIDTH,
                paddingHorizontal: space['2'],
                justifyContent: 'center',
                gap: space['1'],
              }}
            >
              {/* The press target is this wrapper rather than the Checkbox itself: only a
                  press handler sees the event, and the event is where Shift lives. The
                  box inside is the plain visual, with its own press target switched off. */}
              <Pressable
                testID={`${id}-select-${key}`}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected.has(key) }}
                accessibilityLabel={rowSelectLabel?.(row)}
                onPress={(event) =>
                  onToggleRow?.(row, rowIndex, { extend: isShiftPress(event) })
                }
                style={{ minHeight: DATA_TABLE_ROW_HEIGHT, justifyContent: 'center' }}
              >
                <View
                  pointerEvents="none"
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                >
                  <Checkbox checked={selected.has(key)} onChange={() => {}} />
                </View>
              </Pressable>
              {rowLead?.(row)}
            </View>
          ) : null}
          {columns.map((column, colIndex) => {
            const focused = focus?.row === rowIndex && focus.col === colIndex;
            return (
              <Pressable
                key={column.key}
                testID={`${id}-cell-${key}-${column.key}`}
                onPress={() => onFocusCell?.({ row: rowIndex, col: colIndex })}
                style={{
                  width: column.width,
                  // The row is this tall anyway; saying so on the cell itself is what makes
                  // the whole cell — not just the text in it — a full-size tap target.
                  minHeight: DATA_TABLE_ROW_HEIGHT,
                  justifyContent: 'center',
                  alignItems: column.align === 'right' ? 'flex-end' : 'stretch',
                  paddingHorizontal: space['1'],
                  paddingVertical: space['1'],
                  // The ring is always drawn, transparent when unfocused, so gaining focus
                  // never shifts the grid by 2px (04 §4.11.7).
                  borderWidth: 2,
                  borderRadius: radius.sm,
                  borderColor: focused ? colors['border.focus'] : 'transparent',
                }}
              >
                {column.render(row, { rowIndex, colIndex, focused })}
              </Pressable>
            );
          })}
        </View>
        {below ? (
          <View
            testID={`${id}-below-${key}`}
            style={{ paddingHorizontal: space['3'], paddingBottom: space['1'] }}
          >
            {below}
          </View>
        ) : null}
      </View>
    );
  });

  return (
    <ScrollView
      horizontal
      testID={`${id}-hscroll`}
      style={[{ flexGrow: 0 }, style]}
      contentContainerStyle={{ minWidth: '100%' }}
    >
      <ScrollView
        ref={scroller}
        testID={id}
        stickyHeaderIndices={[0]}
        style={{ maxHeight: boxHeight }}
        scrollEventThrottle={16}
        onScroll={(event: NativeSyntheticEvent<NativeScrollEvent>) => {
          onScroll(event.nativeEvent.contentOffset.y);
        }}
        onLayout={(event: LayoutChangeEvent) => {
          onLayout(event.nativeEvent.layout.height);
        }}
        contentContainerStyle={{ width: totalWidth, minWidth: '100%' }}
      >
        {header}
        {rows.length === 0 && emptyLabel !== undefined ? (
          <View style={{ padding: space['4'] }} testID={`${id}-empty`}>
            <Text variant="body" tone="muted">
              {emptyLabel}
            </Text>
          </View>
        ) : (
          <>
            {/* The two spacers stand in for the rows that are not mounted, so the content
                is as tall as the whole grid and the scrollbar behaves as if it were. */}
            <View testID={`${id}-spacer-top`} style={{ height: topPad }} />
            {body}
            <View testID={`${id}-spacer-bottom`} style={{ height: bottomPad }} />
          </>
        )}
      </ScrollView>
    </ScrollView>
  );
}
