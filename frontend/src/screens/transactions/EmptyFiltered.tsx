/**
 * "Nothing matched — try dropping one of these" (04 §4.5, decision §14.52 A15).
 *
 * At most **two** probes, ever: one `limit=1` request per candidate condition, asking only
 * for its `total`. Candidates are taken in a fixed order (kind, date range, category,
 * account, keyword, currency, amount range) and the two results are rendered together, so
 * the block appears once instead of flickering in twice.
 */
import React from 'react';
import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import type { TransactionListParams, Uuid } from '@/api/types';
import { useTransactions } from '@/queries';
import { type Lang } from '@/i18n';
import { formatAmountPlain, formatDate } from '@/i18n/format';
import { categoryName } from '@/i18n/category';
import type { CategoryIndex } from '@/domain/categories';
import { radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { useIsWide } from '@/theme/useBreakpoint';
import { Icon, Text } from '@/ui';

/** 04 §4.5: a probe asks for the count, not for the rows. */
const PROBE_LIMIT = 1;
/** 04 §4.5: "只发 2 个请求", never a full combination sweep. */
export const MAX_PROBES = 2;

export interface DropCandidate {
  id: string;
  label: string;
  /** The same filters with that one condition taken out. */
  without: TransactionListParams;
}

export interface CandidateCtx {
  t: TFunction;
  lang: Lang;
  index: CategoryIndex | null;
  sourceName(id: Uuid): string;
  baseCurrency: string;
}

/**
 * The conditions worth suggesting, in the order 04 §4.5 lists them. A condition that spans
 * two query params (a date range, a two-level category, an amount range) is one candidate:
 * dropping "8 月" has to drop both ends of it.
 */
export function dropCandidates(
  filters: TransactionListParams,
  ctx: CandidateCtx,
): DropCandidate[] {
  const { t, lang } = ctx;
  const out: DropCandidate[] = [];

  if (filters.kind && filters.kind.length > 0) {
    out.push({
      id: 'kind',
      label: t('transaction:list.chip.kind', {
        value: filters.kind.map((k) => t(`transaction:kind.${k}`)).join('·'),
      }),
      without: { ...filters, kind: undefined },
    });
  }

  if (filters.from || filters.to) {
    out.push({
      id: 'date',
      label: t('transaction:list.chip.date_range', {
        from: filters.from
          ? formatDate(filters.from)
          : t('transaction:list.chip.unbounded'),
        to: filters.to ? formatDate(filters.to) : t('transaction:list.chip.unbounded'),
      }),
      without: { ...filters, from: undefined, to: undefined },
    });
  }

  if (filters.category_l1) {
    const code = filters.category_l2 ?? filters.category_l1;
    const category = ctx.index?.byCode[code];
    out.push({
      id: 'category',
      label: t('transaction:list.chip.category', {
        value: category ? categoryName(category, lang) : code,
      }),
      without: { ...filters, category_l1: undefined, category_l2: undefined },
    });
  }

  if (filters.source_id && filters.source_id.length > 0) {
    out.push({
      id: 'source',
      label: t('transaction:list.chip.source', {
        value: filters.source_id.map((s) => ctx.sourceName(s)).join('·'),
      }),
      without: { ...filters, source_id: undefined },
    });
  }

  if (filters.q) {
    out.push({
      id: 'q',
      label: t('transaction:list.chip.q', { value: filters.q }),
      without: { ...filters, q: undefined },
    });
  }

  if (filters.currency) {
    out.push({
      id: 'currency',
      label: t('transaction:list.chip.currency', { value: filters.currency }),
      without: { ...filters, currency: undefined },
    });
  }

  if (filters.min_amount !== undefined || filters.max_amount !== undefined) {
    out.push({
      id: 'amount',
      label: t('transaction:list.chip.amount_range', {
        min:
          filters.min_amount === undefined
            ? t('transaction:list.chip.unbounded')
            : formatAmountPlain(filters.min_amount, ctx.baseCurrency),
        max:
          filters.max_amount === undefined
            ? t('transaction:list.chip.unbounded')
            : formatAmountPlain(filters.max_amount, ctx.baseCurrency),
      }),
      without: { ...filters, min_amount: undefined, max_amount: undefined },
    });
  }

  return out;
}

export interface EmptyFilteredProps {
  ledgerId: Uuid;
  filters: TransactionListParams;
  ctx: CandidateCtx;
  /** Apply the suggestion: the filter set with that condition removed. */
  onApply(next: TransactionListParams): void;
  testID?: string;
}

export function EmptyFiltered({
  ledgerId,
  filters,
  ctx,
  onApply,
  testID,
}: EmptyFilteredProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const wide = useIsWide();
  const id = testID ?? 'tx-empty-filtered';

  const candidates = React.useMemo(
    () => dropCandidates(filters, ctx).slice(0, MAX_PROBES),
    // `ctx` is rebuilt every render by the screen; the filters are what actually decide
    // the candidate set (labels aside), so they are the dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filters],
  );

  // Two hooks, always — a loop would break the rules of hooks. `useTransactions` is a
  // no-op when the ledger id is `undefined`, which is how a missing candidate is disabled.
  const first = useProbe(candidates[0], ledgerId);
  const second = useProbe(candidates[1], ledgerId);
  const probes = [first, second];

  const answered = candidates.map((_, i) => probes[i].data?.total);
  // Render once, when every probe has come back (04 §4.5: "只在两个探测都返回后一起渲染").
  if (candidates.length === 0 || answered.some((total) => total === undefined)) return null;

  return (
    <View
      testID={id}
      style={{
        gap: space['2'],
        alignSelf: 'stretch',
        maxWidth: wide ? undefined : 420,
        flexDirection: wide ? 'row' : 'column',
        flexWrap: wide ? 'wrap' : 'nowrap',
        justifyContent: 'center',
      }}
    >
      {candidates.map((candidate, i) => (
        <Suggestion
          key={candidate.id}
          wide={wide}
          title={t('transaction:list.filter.remove_filter', { label: candidate.label })}
          count={t('transaction:list.filter.drop_filter_count', { count: answered[i] ?? 0 })}
          onPress={() => onApply(candidate.without)}
          testID={`${id}-${candidate.id}`}
        />
      ))}
    </View>
  );
}

/** 屏幕稿 15: a two-line row with a chevron on narrow, a soft button on wide. */
function Suggestion({
  wide,
  title,
  count,
  onPress,
  testID,
}: {
  wide: boolean;
  title: string;
  count: string;
  onPress(): void;
  testID: string;
}): React.JSX.Element {
  const colors = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title} ${count}`}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => ({
        minHeight: 44,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space['2'] + 2,
        paddingVertical: space['2'],
        paddingHorizontal: space['4'] - 2,
        borderRadius: radius.md,
        backgroundColor: pressed ? colors['bg.hover'] : colors['bg.subtle'],
      })}
    >
      <View style={{ flexShrink: 1, minWidth: 0, gap: wide ? 0 : 1 }}>
        <Text variant="body" weight={wide ? 600 : 500} numberOfLines={1}>
          {title}
        </Text>
        {wide ? null : (
          <Text variant="caption" tone="muted" mono>
            {count}
          </Text>
        )}
      </View>
      {wide ? (
        <Text variant="caption" tone="muted" mono>
          {count}
        </Text>
      ) : (
        <Icon name="chevron-right" size={18} color={colors['fg.muted']} />
      )}
    </Pressable>
  );
}

/** One "how many would be left without this condition" probe. */
function useProbe(
  candidate: DropCandidate | undefined,
  ledgerId: Uuid,
): ReturnType<typeof useTransactions> {
  return useTransactions(candidate ? ledgerId : undefined, {
    ...(candidate?.without ?? {}),
    offset: undefined,
    limit: PROBE_LIMIT,
  });
}
