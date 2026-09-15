/**
 * 「操作记录」 — the side card holding the operations timeline (04 §4.7, 屏幕稿 07 / 08).
 *
 * The timeline itself is `EventTimeline` from the kit; this only gives it the mockups'
 * white card with the 15/700 title, and renders nothing when there is nothing to show.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';

import type { TransactionEvent, Uuid } from '@/api/types';
import type { CategoryIndex } from '@/domain/categories';
import { EventTimeline } from '@/ui';

import { SideCard } from './parts';

export interface EventsCardProps {
  events: readonly TransactionEvent[];
  names: Readonly<Record<Uuid, string>>;
  meId: Uuid;
  index?: CategoryIndex;
  sourceNames: Readonly<Record<Uuid, string>>;
  currency: string;
  onPressBatch(batchId: Uuid): void;
  testID?: string;
}

export function EventsCard({
  events,
  names,
  meId,
  index,
  sourceNames,
  currency,
  onPressBatch,
  testID,
}: EventsCardProps): React.JSX.Element | null {
  const { t } = useTranslation();
  if (events.length === 0) return null;
  const id = testID ?? 'detail-events';
  return (
    <SideCard title={t('transaction:detail.events_title')} testID={`${id}-card`}>
      <EventTimeline
        testID={id}
        events={events}
        names={names}
        meId={meId}
        index={index}
        sourceNames={sourceNames}
        currency={currency}
        onPressBatch={onPressBatch}
      />
    </SideCard>
  );
}
