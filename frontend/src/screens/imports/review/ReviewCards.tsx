/**
 * The phone layout of the review step (04 §4.11.9, 屏幕稿 03 · 375): the same rows as the
 * wide grid, as a card flow. Semantically equivalent, not a subset — every field is still
 * editable, but the two that get changed the most (kind and category) sit on the card while
 * the rest moves into an "edit details" sheet behind the ⋯ button.
 *
 * A card is 屏幕稿 03's: the checkbox, then the merchant with its row number, the date and
 * account under it and a row of chips (kind, category, state, flags); the amount, coloured
 * by kind, and the ⋯ button stand on the right. A transfer or refund row keeps its whole
 * link band on the card — the pairing checkbox is prefilled and checked whenever the server
 * found a single candidate, and the spec is explicit that the user has to see it, and be
 * able to clear it, without opening anything.
 *
 * The checkbox and the ⋯ button are the card's only two press targets: the card itself is
 * not pressable, because a card-wide `Pressable` wrapping them would nest a button inside a
 * button (invalid on the web, and it swallows the inner click). So there is no long press
 * to 「进入多选模式」 either, and 04 §4.11.9's sentence about one is a deviation for the
 * docs: the bulk strip lives on the bottom bar at all times and greys out while nothing is
 * selected, rather than appearing with a selection.
 */
import React from 'react';
import { type LayoutChangeEvent, ScrollView, View, useWindowDimensions } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { ImportRow } from '@/api/types';
import { space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { Button, Card, Checkbox, Divider, KIND_AMOUNT_TONE, Sheet, Text } from '@/ui';

import { importAmountText } from '../amountFormat';
import { FlagBadges, SkipToggle } from './FlagBadges';
import { LinkCell } from './LinkCell';
import { LinkPanel, hasLinkPanel } from './LinkPanel';
import { CategoryCell, CurrencyCell, KindCell } from './ReviewCells.picker';
import {
  AmountCell,
  DateCell,
  RowNoCell,
  TextCell,
  shortDate,
  transferTitle,
} from './ReviewCells.text';
import type { ReviewViewProps } from './ReviewTable';

const MERCHANT_MAX = 200;
const NOTE_MAX = 500;

/**
 * The card flow is its own scroll box, for the same reason the wide grid is (04 §6.4): a
 * list that simply grows inside the page's scroll view cannot be scrolled *by us*, and
 * "jump to the row the server complained about" then moves nothing on a phone — the one
 * device where the offending row is most likely several screens away (04 §4.11.8).
 *
 * The height is the viewport minus the page chrome above and below the list (the top bar,
 * the screen header, the slice control and the commit bar).
 */
// 380 is the measured phone chrome at the C2 density (the top bar, the page header, the
// banner, the slices and 屏幕稿 03 · 375's bottom bar), not a computed value; the row
// virtualisation task that reworks this file replaces it with a measured height.
const CARDS_CHROME_HEIGHT = 380;
const MIN_CARDS_HEIGHT = 240;

export function ReviewCards({
  env,
  selection,
  highlight,
  bannerJumpSignal = 0,
  testID,
}: ReviewViewProps): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  const id = testID ?? 'review-cards';
  const viewportSize = useWindowDimensions();
  const [detailFor, setDetailFor] = React.useState<string | null>(null);
  const [categoryOpen, setCategoryOpen] = React.useState<{ id: string; level: 'l1' | 'l2' } | null>(
    null,
  );

  const rows = selection.visible;
  const detailRow = rows.find((row) => row.id === detailFor) ?? null;
  const highlightRowNo = highlight?.rowNo ?? null;

  // Bringing the highlighted card into view needs its position inside the scroll box, and a
  // card with a link band is much taller than a plain one, so a nominal row height would not
  // do. Two ways in, because a jump reaches a card in two different states:
  //  - the card is mounting for the first time (the jump widened the slice to reveal it) —
  //    its own `onLayout` reports where it landed and serves the pending request;
  //  - the card was already on screen and only *moved* down as the widened slice inserted
  //    rows above it. Moving is not a size change, so no renderer reports a new layout for
  //    it; the position has to be measured off the live node instead. A remembered offset
  //    would be the pre-widening one and would scroll to where the card used to be.
  const scroller = React.useRef<ScrollView | null>(null);
  const cardNodes = React.useRef(new Map<number, View>());
  const cardTops = React.useRef(new Map<number, number>());
  const pendingScroll = React.useRef<number | null>(null);
  const scrollToTop = React.useCallback((top: number): void => {
    scroller.current?.scrollTo({ y: Math.max(0, top - space['2']), animated: true });
  }, []);
  // Every offset recorded under the previous slice is stale the moment the slice changes, so
  // drop them all. Effects run in declaration order, so this lands before the highlight
  // effect below: a jump that widens the slice can never read a pre-widening offset back.
  React.useEffect(() => {
    cardTops.current.clear();
  }, [selection.slice]);
  const highlightSeq = highlight?.seq ?? 0;
  React.useEffect(() => {
    if (highlightRowNo === null) {
      pendingScroll.current = null;
      return;
    }
    // Record the request first; whichever of the three paths below gets there first clears it.
    pendingScroll.current = highlightRowNo;
    const node = cardNodes.current.get(highlightRowNo);
    const content = scroller.current?.getInnerViewNode?.();
    if (node && content && typeof node.measureLayout === 'function') {
      node.measureLayout(
        content,
        (_x: number, y: number) => {
          // A newer jump may have landed while the measurement was in flight.
          if (pendingScroll.current !== highlightRowNo) return;
          pendingScroll.current = null;
          scrollToTop(y);
        },
        () => {
          // Measuring failed (the node went away); `onLayout` still has the request.
        },
      );
      return;
    }
    const top = cardTops.current.get(highlightRowNo);
    if (top === undefined) return;
    pendingScroll.current = null;
    scrollToTop(top);
    // `highlightSeq` is the point: the same row twice is a new request to scroll to it.
  }, [highlightRowNo, highlightSeq, scrollToTop]);

  // The page's blocking banner asked for the first uncategorized row (04 §4.11.8): on a
  // phone that is the uncategorized slice, whose first card is exactly that row.
  const sliceRef = React.useRef(selection.setSlice);
  sliceRef.current = selection.setSlice;
  const firstBannerJump = React.useRef(bannerJumpSignal);
  React.useEffect(() => {
    if (bannerJumpSignal === firstBannerJump.current) return;
    firstBannerJump.current = bannerJumpSignal;
    sliceRef.current('uncategorized');
    scroller.current?.scrollTo({ y: 0, animated: true });
  }, [bannerJumpSignal]);

  return (
    <ScrollView
      ref={scroller}
      testID={id}
      style={{ maxHeight: Math.max(MIN_CARDS_HEIGHT, viewportSize.height - CARDS_CHROME_HEIGHT) }}
      contentContainerStyle={{ gap: space['3'] }}
    >
      {rows.length === 0 ? (
        <Text variant="body" tone="muted" testID={`${id}-empty`}>
          {t('import:review.no_rows_in_slice')}
        </Text>
      ) : null}

      {rows.map((row, index) => (
        // 屏幕稿 03 · 375 draws the card body as plain surface: the checkbox selects, the
        // ⋯ button opens the details sheet, and nothing else on the card is pressable. A
        // Pressable here would also nest the checkbox and the button inside a <button>,
        // which the browser refuses outright.
        <View
          key={row.id}
          testID={`${id}-row-${row.row_no}`}
          ref={(node: View | null) => {
            if (node) cardNodes.current.set(row.row_no, node);
            else cardNodes.current.delete(row.row_no);
          }}
          onLayout={(event: LayoutChangeEvent) => {
            const y = event.nativeEvent.layout.y;
            cardTops.current.set(row.row_no, y);
            if (pendingScroll.current !== row.row_no) return;
            pendingScroll.current = null;
            scrollToTop(y);
          }}
        >
          <Card
            variant="raised"
            style={{
              gap: space['2'],
              opacity: row.status === 'skipped' ? 0.55 : 1,
              backgroundColor:
                row.row_no === highlightRowNo ? colors['status.warning.bg'] : undefined,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space['2'] }}>
              <Checkbox
                testID={`${id}-select-${row.row_no}`}
                checked={selection.selected.has(row.id)}
                accessibilityLabel={t('import:review.select_row', { row: row.row_no })}
                onChange={() => selection.toggle(row, index)}
              />

              <View style={{ flex: 1, minWidth: 0, gap: space['1'] }}>
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space['2'] }}>
                  <Text variant="subheading" numberOfLines={1} style={{ flexShrink: 1 }}>
                    {row.kind === 'transfer'
                      ? transferTitle(row, env, t)
                      : (row.merchant ?? t('import:review.missing_value'))}
                  </Text>
                  {/* The row number, its save-state dot and — when a write was refused —
                      the retry button, exactly as the wide grid shows them (§4.11.5). */}
                  <RowNoCell
                    row={row}
                    state={env.ctrl.saveStateOf(row.id)}
                    onRetry={() => env.ctrl.retry(row.id)}
                    hash
                    testID={`review-${row.row_no}-row-no`}
                  />
                </View>

                <Text variant="caption" tone="muted" numberOfLines={1}>
                  {[
                    row.date === null ? t('import:review.missing_value') : shortDate(row.date),
                    env.batch.source_name,
                  ].join(' · ')}
                </Text>

                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: space['1'],
                    marginTop: space['1'],
                  }}
                >
                  <KindCell row={row} env={env} testID={`review-${row.row_no}-kind`} />
                  <CategoryCell
                    row={row}
                    env={env}
                    level="l1"
                    open={categoryOpen?.id === row.id && categoryOpen.level === 'l1'}
                    onOpenChange={(open) =>
                      setCategoryOpen(open ? { id: row.id, level: 'l1' } : null)
                    }
                    testID={`review-${row.row_no}-l1`}
                  />
                  <SkipToggle
                    row={row}
                    onToggle={(target) =>
                      env.ctrl.patch(target, {
                        status: target.status === 'skipped' ? 'pending' : 'skipped',
                      })
                    }
                    testID={`review-${row.row_no}-skip`}
                  />
                  <FlagBadges row={row} testIDPrefix={`review-${row.row_no}-flag`} />
                </View>
              </View>

              <View style={{ alignItems: 'flex-end', gap: space['1'] }}>
                <Text
                  variant="subheading"
                  mono
                  tone={
                    row.amount === null
                      ? 'danger'
                      : row.kind === null
                        ? 'primary'
                        : KIND_AMOUNT_TONE[row.kind]
                  }
                  testID={`${id}-amount-${row.row_no}`}
                >
                  {row.amount === null
                    ? t('import:review.missing_value')
                    : importAmountText(
                        row.amount,
                        row.currency ?? env.batch.base_currency,
                        env.batch.base_currency,
                        env.lang,
                      )}
                </Text>
                <Button
                  testID={`${id}-details-${row.row_no}`}
                  size="sm"
                  variant="ghost"
                  icon="more-horizontal"
                  iconOnly
                  accessibilityLabel={t('import:review.edit_details')}
                  onPress={() => setDetailFor(row.id)}
                />
              </View>
            </View>

            {hasLinkPanel(row) ? (
              <LinkPanel row={row} env={env} testID={`review-${row.row_no}-link`} />
            ) : null}

            {row.hint !== null ? (
              <Text variant="micro" tone="muted" testID={`review-${row.row_no}-hint`}>
                {row.hint}
              </Text>
            ) : null}
          </Card>
        </View>
      ))}

      <Sheet
        open={detailRow !== null}
        onClose={() => setDetailFor(null)}
        title={t('import:review.edit_details')}
        closeLabel={t('common:button.close')}
        testID={`${id}-detail-sheet`}
      >
        {detailRow !== null ? (
          <View style={{ gap: space['3'] }}>
            <DateCell row={detailRow} env={env} editing testID={`review-detail-date`} />
            <AmountCell row={detailRow} env={env} editing testID={`review-detail-amount`} />
            <CurrencyCell row={detailRow} env={env} testID={`review-detail-currency`} />
            {detailRow.kind !== 'transfer' ? (
              <TextCell
                row={detailRow}
                env={env}
                field="merchant"
                maxLength={MERCHANT_MAX}
                editing
                testID={`review-detail-merchant`}
              />
            ) : null}
            <TextCell
              row={detailRow}
              env={env}
              field="note"
              maxLength={NOTE_MAX}
              editing
              testID={`review-detail-note`}
            />
            <CategoryCell
              row={detailRow}
              env={env}
              level="l2"
              open={categoryOpen?.id === detailRow.id && categoryOpen.level === 'l2'}
              onOpenChange={(open) =>
                setCategoryOpen(open ? { id: detailRow.id, level: 'l2' } : null)
              }
              testID={`review-detail-l2`}
            />
            <Divider />
            {/* The counterparty controls of a transfer row (the account / free-text pair);
                the pairing itself is the band on the card. */}
            <LinkCell row={detailRow} env={env} testID={`review-detail-link`} />
          </View>
        ) : null}
      </Sheet>
    </ScrollView>
  );
}
