/**
 * Ledger settings → base currency (屏幕稿 12, 04 §4.12).
 *
 * Closed it is one line: a round icon well, 「基准币种 · CNY 人民币」 over its explainer,
 * and 「修改」 on the right. Opening it drops the currency picker and the mockup's beige
 * warning — which states the count of transactions that will be re-converted and nothing
 * else, no amount preview (decision §14.52 A9) — over 「先不改」 / 「仍要改成 SGD」.
 *
 * A member sees the same line without the button (decision §2).
 */
import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { LedgerDetail, Uuid } from '@/api/types';
import { useCurrencies, useUpdateLedger } from '@/queries';
import { radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { useIsWide } from '@/theme/useBreakpoint';
import { Button, Card, CurrencyPicker, Icon, Text, toast } from '@/ui';

import { IconWell } from './IconWell';
import { SectionLabel } from './SectionLabel';

export interface BaseCurrencyCardProps {
  ledgerId: Uuid;
  /** `undefined` while `GET /ledgers/{id}` is still in flight. */
  detail: LedgerDetail | undefined;
  canEdit: boolean;
}

export function BaseCurrencyCard({
  ledgerId,
  detail,
  canEdit,
}: BaseCurrencyCardProps): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  const wide = useIsWide();
  const currencies = useCurrencies();
  // Not `{ silent: true }`: this card renders no server error of its own, so a failed
  // change has to reach the user through the global error Toast.
  const update = useUpdateLedger(ledgerId);

  const [open, setOpen] = React.useState(false);
  const [next, setNext] = React.useState<string | null>(null);

  const current = detail?.base_currency ?? '';
  const target = next ?? current;

  const close = (): void => {
    setOpen(false);
    setNext(null);
  };

  const apply = (): void => {
    if (!detail || next === null || next === detail.base_currency) return;
    update.mutate(
      { base_currency: next, updated_at: detail.updated_at },
      {
        onSuccess: () => {
          close();
          toast.success(t('ledger:settings.currency.saved_toast', { currency: next }));
        },
      },
    );
  };

  const card = (
    <Card variant="raised" testID="ledger-base-currency-card" style={{ padding: space['5'] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space['3'] + 2 }}>
        <IconWell name="banknote" tone="accent" size={38} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text variant="subheading" weight={700} testID="ledger-base-currency">
            {/* 屏幕稿 12 375 moves 「基准币种」 out to the section label, so the row there
                reads 「CNY · 人民币」 alone. */}
            {t(wide ? 'ledger:settings.currency.title' : 'ledger:settings.currency.title_short', {
              code: current,
              name: currencies.names?.[current] ?? '',
            })}
          </Text>
          <Text variant="body" tone="muted">
            {t('ledger:settings.currency.subtitle')}
          </Text>
        </View>
        {canEdit ? (
          <Button
            testID="ledger-base-currency-change"
            label={t('ledger:settings.currency.change')}
            variant="soft"
            onPress={() => (open ? close() : setOpen(true))}
            style={{ flexShrink: 0 }}
          />
        ) : null}
      </View>

      {canEdit ? null : (
        <Text
          variant="caption"
          tone="muted"
          style={{ marginTop: space['3'] }}
          testID="ledger-basics-readonly-hint"
        >
          {t('ledger:settings.currency.read_only_hint')}
        </Text>
      )}

      {canEdit && open ? (
        <View style={{ marginTop: space['4'], gap: space['4'] }} testID="ledger-currency-panel">
          <CurrencyPicker
            testID="ledger-base-currency-picker"
            label={t('ledger:settings.currency.pick_label')}
            codes={currencies.codes}
            names={currencies.names}
            value={target}
            onChange={setNext}
            disabled={!detail || update.isPending}
          />
          <View
            style={{
              borderRadius: radius.lg - 2,
              padding: wide ? space['4'] + 2 : space['4'],
              gap: space['3'] + 2,
              backgroundColor: colors['status.warning.bg'],
            }}
            testID="ledger-currency-warning"
          >
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space['3'] }}>
              <Icon name="alert-triangle" size={20} color={colors['status.warning.fg']} />
              <View style={{ flex: 1, minWidth: 0, gap: space['1'] }}>
                <Text variant="subheading" weight={700}>
                  {t('ledger:settings.currency.warning_title')}
                </Text>
                <Text variant="body" style={{ color: colors['status.warning.fg'] }}>
                  {t('ledger:settings.currency.warning_body', {
                    count: detail?.counts.transactions ?? 0,
                  })}
                </Text>
              </View>
            </View>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'flex-end',
                flexWrap: 'wrap',
                gap: space['2'] + 2,
              }}
            >
              <Button
                testID="ledger-currency-cancel"
                label={t('ledger:settings.currency.cancel')}
                variant="secondary"
                onPress={close}
              />
              <Button
                testID="ledger-currency-confirm"
                label={t('ledger:settings.currency.confirm', { currency: target })}
                onPress={apply}
                loading={update.isPending}
                disabled={!detail || next === null || next === current}
              />
            </View>
          </View>
        </View>
      ) : null}
    </Card>
  );

  if (wide) return card;
  return (
    <View>
      <SectionLabel title={t('ledger:settings.currency.section')} />
      {card}
    </View>
  );
}

export default BaseCurrencyCard;
