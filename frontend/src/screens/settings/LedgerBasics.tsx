/**
 * Ledger settings → basics (04 §4.12): the ledger name and the base currency.
 *
 * Both are owner-only (decision §2); a member sees the same values as plain text.
 * Changing the base currency is gated behind the §8 warning, which states the count of
 * transactions that will be re-converted and nothing else — no amount preview
 * (decision §14.52 A9).
 */
import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import type { LedgerDetail, Uuid } from '@/api/types';
import { formatDate } from '@/i18n/format';
import { useLang } from '@/i18n';
import { useCurrencies, useUpdateLedger } from '@/queries';
import { space } from '@/theme/tokens';
import { Button, Card, CurrencyPicker, Text, TextField, confirm, toast } from '@/ui';

/** Decision §14.13: a ledger name is 1–100 characters. */
export const LEDGER_NAME_MAX_LENGTH = 100;

const nameSchema = z.string().trim().min(1, 'required').max(LEDGER_NAME_MAX_LENGTH, 'max_length');

export interface LedgerBasicsProps {
  ledgerId: Uuid;
  /** `undefined` while `GET /ledgers/{id}` is still in flight. */
  detail: LedgerDetail | undefined;
  canEdit: boolean;
}

export function LedgerBasics({ ledgerId, detail, canEdit }: LedgerBasicsProps): React.JSX.Element {
  const { t } = useTranslation();
  const lang = useLang();
  const currencies = useCurrencies();
  // Not `{ silent: true }`: this card renders no server error of its own, so a failed
  // rename or currency change has to reach the user through the global error Toast.
  const update = useUpdateLedger(ledgerId);

  const serverName = detail?.name ?? '';
  const [name, setName] = React.useState(serverName);
  const [touched, setTouched] = React.useState(false);

  // 04 §3.8 step 3: a refreshed ledger (first load, or the invalidation a 409 triggers)
  // overwrites the field only while the user has not edited it themselves.
  React.useEffect(() => {
    if (touched) return;
    setName(serverName);
  }, [serverName, touched]);

  const parsed = nameSchema.safeParse(name);
  const errorKey = parsed.success ? undefined : parsed.error.issues[0]?.message;
  const error =
    touched && errorKey
      ? t([`validation:${errorKey}`, 'validation:required'], { max: LEDGER_NAME_MAX_LENGTH })
      : null;

  const saveName = (): void => {
    if (!detail || !parsed.success || parsed.data === detail.name) return;
    update.mutate(
      { name: parsed.data, updated_at: detail.updated_at },
      {
        onSuccess: () => {
          setTouched(false);
          toast.success(t('ledger:settings.basic.name_saved_toast'));
        },
      },
    );
  };

  const changeCurrency = (next: string): void => {
    if (!detail || next === detail.base_currency) return;
    void (async () => {
      const ok = await confirm({
        title: t('ledger:settings.basic.currency_change_title'),
        body: t('ledger:settings.basic.base_currency_warning', {
          currency: next,
          count: detail.counts.transactions,
        }),
        confirmLabel: t('ledger:settings.basic.currency_change_confirm', { currency: next }),
        cancelLabel: t('ledger:settings.basic.currency_change_cancel'),
      });
      if (!ok) return;
      update.mutate(
        { base_currency: next, updated_at: detail.updated_at },
        {
          onSuccess: () =>
            toast.success(t('ledger:settings.basic.currency_saved_toast', { currency: next })),
        },
      );
    })();
  };

  return (
    <Card variant="outlined" style={{ gap: space['3'] }} testID="ledger-basics">
      <Text variant="heading" accessibilityRole="header">
        {t('ledger:settings.basic.title')}
      </Text>
      {detail ? (
        <Text variant="caption" tone="muted" testID="ledger-created-at">
          {t('ledger:settings.basic.created_at', {
            date: formatDate(detail.created_at.slice(0, 10), lang),
          })}
        </Text>
      ) : null}

      {canEdit ? (
        <View style={{ gap: space['2'] }}>
          <TextField
            testID="ledger-name-input"
            label={t('ledger:settings.basic.name_label')}
            accessibilityLabel={t('ledger:settings.basic.name_label')}
            value={name}
            onChangeText={(next) => {
              setTouched(true);
              setName(next);
            }}
            error={error}
            maxLength={LEDGER_NAME_MAX_LENGTH}
            showCounter
            disabled={!detail || update.isPending}
          />
          <Button
            testID="ledger-name-save"
            label={t('ledger:settings.basic.save')}
            size="sm"
            onPress={saveName}
            loading={update.isPending}
            disabled={!detail || !parsed.success || parsed.data === detail?.name}
          />
        </View>
      ) : (
        <View style={{ gap: space['1'] }}>
          <Text variant="caption" tone="secondary">
            {t('ledger:settings.basic.name_label')}
          </Text>
          <Text testID="ledger-name-readonly">{serverName}</Text>
        </View>
      )}

      <CurrencyPicker
        testID="ledger-base-currency"
        label={t('ledger:settings.basic.base_currency_label')}
        codes={currencies.codes}
        names={currencies.names}
        value={detail?.base_currency ?? null}
        onChange={changeCurrency}
        readOnly={!canEdit}
        disabled={!detail || update.isPending}
      />
      {canEdit ? null : (
        <Text variant="caption" tone="muted" testID="ledger-basics-readonly-hint">
          {t('ledger:settings.basic.read_only_hint')}
        </Text>
      )}
    </Card>
  );
}

export default LedgerBasics;
