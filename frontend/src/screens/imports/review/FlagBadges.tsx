/**
 * The 「状态与标记」 cell of the review table (04 §4.11.4, decisions §5, §14.31).
 *
 * Two kinds of pill sit here, exactly as 屏幕稿 03 draws them: the row's own state — 待处理
 * / 已改 / 已跳过, pressable, because pressing it is how a row is skipped and unskipped —
 * and one badge per server flag. There are exactly four flags; a value outside them is not
 * rendered at all: the table must not invent a badge for something the language pack cannot
 * name. The derived 「待归类」 is not a badge here — it is the ringed 「待归类」 chip in the
 * level-1 category column, which is also where it gets fixed.
 *
 * Every badge carries a text label, never colour alone (04 §6.2 rule 7).
 */
import React from 'react';
import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { ImportFlag, ImportRow, ImportRowStatus } from '@/api/types';
import { space } from '@/theme/tokens';
import { Badge, type BadgeTone, type IconName } from '@/ui';

/** The four flags, in the order the cell shows them (04 §4.11.4). */
export const FLAG_ORDER: readonly ImportFlag[] = [
  'duplicate',
  'refund_candidate',
  'transfer_candidate',
  'needs_review',
];

const FLAG_TONE: Readonly<Record<ImportFlag, BadgeTone>> = {
  duplicate: 'flag-duplicate',
  refund_candidate: 'info',
  transfer_candidate: 'info',
  needs_review: 'flag-needs_review',
};

const FLAG_ICON: Readonly<Record<ImportFlag, IconName>> = {
  duplicate: 'copy',
  refund_candidate: 'undo-2',
  transfer_candidate: 'arrow-left-right',
  needs_review: 'alert-triangle',
};

const STATUS_TONE: Readonly<Record<ImportRowStatus, BadgeTone>> = {
  pending: 'neutral',
  edited: 'success',
  skipped: 'neutral',
};

export interface FlagBadgesProps {
  row: ImportRow;
  testIDPrefix: string;
}

export function FlagBadges({ row, testIDPrefix }: FlagBadgesProps): React.JSX.Element {
  const { t } = useTranslation();
  const flags = FLAG_ORDER.filter((flag) => row.flags.includes(flag));

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space['1'] }}>
      {flags.map((flag) => (
        <Badge
          key={flag}
          label={t(`import:review.flag.${flag}`)}
          tone={FLAG_TONE[flag]}
          icon={FLAG_ICON[flag]}
          testID={`${testIDPrefix}-${flag}`}
        />
      ))}
    </View>
  );
}

export interface SkipToggleProps {
  row: ImportRow;
  onToggle(row: ImportRow): void;
  testID: string;
}

/**
 * The row's state as a pill you can press: 待处理 / 已改 → 已跳过 and back (04 §4.11.2 puts
 * the skip switch in this cell; 屏幕稿 03 makes the state badge itself the switch).
 */
export function SkipToggle({ row, onToggle, testID }: SkipToggleProps): React.JSX.Element {
  const { t } = useTranslation();
  const skipped = row.status === 'skipped';
  const state = t(`import:review.status.${row.status}`);
  const action = t(skipped ? 'import:review.unskip_row' : 'import:review.skip_row');
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      // The visible pill is the row's state, so the accessible name starts with it and only
      // then names the action pressing it performs (WCAG 2.5.3).
      accessibilityLabel={`${state} · ${action}`}
      hitSlop={space['3']}
      onPress={() => onToggle(row)}
    >
      <Badge label={state} tone={STATUS_TONE[row.status]} />
    </Pressable>
  );
}
