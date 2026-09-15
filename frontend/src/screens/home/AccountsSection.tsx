/**
 * Home block 2 (screen 01, 04 §4.4): the accounts, as the mockup draws them — a
 * `SectionHeader` with a 「管理账户」 link over one white `ListCard`, one `ListRow` per
 * account: type well, name over 「储蓄卡 · CNY」, the balance in its own currency on the
 * right, and the converted value underneath when the account is foreign.
 *
 * Archived accounts never appear here; they are only counted in the header's "not counting
 * N archived accounts" line. `balance_base === null` says "no rate yet" rather than reading
 * as zero (04 §4.5).
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { UseQueryResult } from '@tanstack/react-query';

import type { FinanceSource, Paged, Uuid } from '@/api/types';
import { parseMoney } from '@/domain';
import { SOURCE_TYPE_ORDER } from '@/domain/networth';
import { useLang } from '@/i18n';
import { formatConverted, formatMoney } from '@/i18n/format';
import { space } from '@/theme/tokens';
import { useIsWide } from '@/theme/useBreakpoint';
import {
  EmptyState,
  ListCard,
  ListRow,
  SectionHeader,
  Skeleton,
  SourceTypeIcon,
  sourceTypeLabelKey,
} from '@/ui';

export interface AccountsSectionProps {
  query: UseQueryResult<Paged<FinanceSource>>;
  baseCurrency: string;
  /** Opens the account list. */
  onManage(): void;
  /** Opens the transaction list pre-filtered to that account. */
  onPressSource(sourceId: Uuid): void;
}

const SKELETON_ROWS = 3;

export function AccountsSection({
  query,
  baseCurrency,
  onManage,
  onPressSource,
}: AccountsSectionProps): React.JSX.Element {
  const { t } = useTranslation();
  const lang = useLang();
  const wide = useIsWide();

  const header = (
    <SectionHeader
      title={t('stats:home.accounts_title')}
      link={{
        label: wide ? t('stats:home.manage_accounts') : t('stats:home.manage_accounts_short'),
        onPress: onManage,
      }}
      testID="home-accounts-header"
    />
  );

  if (query.isPending) {
    return (
      <View style={styles.section} testID="home-balances-loading">
        {header}
        <Skeleton variant="table" rows={SKELETON_ROWS} />
      </View>
    );
  }

  if (query.isError) {
    return (
      <View style={styles.section} testID="home-balances">
        {header}
        <EmptyState
          icon="alert-triangle"
          title={t('stats:home.error_retry')}
          primaryAction={{ label: t('common:button.retry'), onPress: () => void query.refetch() }}
          testID="home-balances-error"
        />
      </View>
    );
  }

  // The frozen §14.48 type order — 储蓄卡 → 信用卡 → 现金 → 其他 — the same one the accounts
  // page sorts by, so the two screens never disagree about which account leads the list.
  const all = query.data.items.filter((source) => !source.archived);
  const active = SOURCE_TYPE_ORDER.flatMap((type) => all.filter((s) => s.type === type));

  return (
    <View style={styles.section} testID="home-balances">
      {header}
      <ListCard testID="home-balances-card">
        {active.map((source) => {
          const foreign = source.default_currency !== baseCurrency;
          const converted = foreign
            ? source.balance_base === null
              ? t('transaction:list.rate_missing')
              : formatConverted(
                  source.balance,
                  source.default_currency,
                  source.balance_base,
                  baseCurrency,
                  lang,
                )
            : undefined;
          return (
            <ListRow
              key={source.id}
              icon={<SourceTypeIcon type={source.type} size={wide ? 36 : 34} />}
              title={source.name}
              subtitle={`${t(sourceTypeLabelKey(source.type))} · ${source.default_currency}`}
              amount={formatMoney(source.balance, source.default_currency, lang)}
              amountTone={parseMoney(source.balance) < 0n ? 'expense' : 'primary'}
              amountSub={converted}
              onPress={() => onPressSource(source.id)}
              testID={`home-balance-${source.id}`}
            />
          );
        })}
      </ListCard>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { alignSelf: 'stretch', gap: space['2'] + 2 },
});
