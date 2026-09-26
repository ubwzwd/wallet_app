/**
 * The header an edit screen wears while its record is loading or could not be read — a
 * link to an entry deleted since it was shared, a dropped connection. The form itself is
 * not up yet, but the way back must be (§14.64 e): wide, the same round button and
 * 「交易 · 编辑」 trail the form draws; narrow, the shell's ‹ bar, titled the same.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';

import { useBack, useTopBar } from '@/navigation';
import { PageHeader } from '@/ui';

export interface EditStateHeaderProps {
  title: string;
  /** The screen's own way out (`?next=` first), the one its form's breadcrumb uses. */
  onBack(): void;
}

export function EditStateHeader({ title, onBack }: EditStateHeaderProps): React.JSX.Element {
  const { t } = useTranslation();
  const back = useBack();
  useTopBar(title);
  return (
    // The form's own header id, so the back button is the same `tx-form-header-back`
    // whichever state the screen is in.
    <PageHeader
      testID="tx-form-header"
      title={title}
      back={
        back.show
          ? {
              crumb: `${back.parentLabel} · ${title}`,
              onPress: onBack,
              label: t('common:button.back'),
            }
          : undefined
      }
    />
  );
}
