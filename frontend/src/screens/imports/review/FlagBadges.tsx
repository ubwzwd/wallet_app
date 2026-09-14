/**
 * The "flags" cell of the review table (04 §4.11.4, decisions §5, §14.31).
 *
 * There are exactly four server flags; everything else in this cell is derived from the row
 * itself — "uncategorized" (the commit blocker), "skipped" and "edited". A value outside the
 * four is not rendered at all: the table must not invent a badge for something the language
 * pack cannot name.
 *
 * Every badge carries a text label, never colour alone (04 §6.2 rule 7).
 */
import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { ImportFlag, ImportRow } from '@/api/types';
import { space } from '@/theme/tokens';
import { Badge, type BadgeTone, Button, type IconName } from '@/ui';

import { isUncategorized } from './useReviewSelection';

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
      {isUncategorized(row) ? (
        <Badge
          label={t('import:review.flag.uncategorized')}
          tone="flag-uncategorized"
          icon="tag"
          testID={`${testIDPrefix}-uncategorized`}
        />
      ) : null}
      {row.status === 'skipped' ? (
        <Badge
          label={t('import:review.flag.skipped')}
          tone="neutral"
          testID={`${testIDPrefix}-skipped`}
        />
      ) : null}
      {row.status === 'edited' ? (
        <Badge
          label={t('import:review.flag.edited')}
          tone="neutral"
          testID={`${testIDPrefix}-edited`}
        />
      ) : null}
    </View>
  );
}

export interface SkipToggleProps {
  row: ImportRow;
  onToggle(row: ImportRow): void;
  testID: string;
}

/** Skip / unskip one row — it lives in the flags cell (04 §4.11.2) and on the phone card. */
export function SkipToggle({ row, onToggle, testID }: SkipToggleProps): React.JSX.Element {
  const { t } = useTranslation();
  const skipped = row.status === 'skipped';
  return (
    <Button
      testID={testID}
      size="sm"
      variant="ghost"
      label={t(skipped ? 'import:review.unskip_row' : 'import:review.skip_row')}
      onPress={() => onToggle(row)}
    />
  );
}
