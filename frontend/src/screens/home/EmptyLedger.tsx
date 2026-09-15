/**
 * Screen 15 A — the home page of a ledger with no accounts yet.
 *
 * Not an illustration and not a blank page: the net worth still reads S$0.00 in grey (the
 * user needs to see that the ledger is empty, not that the page failed), and the body says
 * what will grow here. Wide: one white card with the three steps on the left and a striped
 * preview panel on the right. Narrow: the same three steps as three stacked cards — the
 * account button lives in the net-worth card, the preview stands in for the category block,
 * and the last card offers 记一笔 / 导入账单 / 邀请成员.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { Button, GhostBlock, Icon, ListCard, Text } from '@/ui';

export interface EmptyLedgerActions {
  onAddSource(): void;
  onAddTransaction(): void;
  onImport(): void;
  onInvite(): void;
}

interface Step {
  n: number;
  title: string;
  body: string;
  cta: string;
  onPress(): void;
}

function useSteps({
  onAddSource,
  onAddTransaction,
  onInvite,
}: EmptyLedgerActions): Step[] {
  const { t } = useTranslation();
  return [
    {
      n: 1,
      title: t('stats:home.empty.step_source_title'),
      body: t('stats:home.empty.step_source_body'),
      cta: t('stats:home.empty.step_source_cta'),
      onPress: onAddSource,
    },
    {
      n: 2,
      title: t('stats:home.empty.step_record_title'),
      body: t('stats:home.empty.step_record_body'),
      cta: t('stats:home.empty.step_record_cta'),
      onPress: onAddTransaction,
    },
    {
      n: 3,
      title: t('stats:home.empty.step_invite_title'),
      body: t('stats:home.empty.step_invite_body'),
      cta: t('stats:home.empty.step_invite_cta'),
      onPress: onInvite,
    },
  ];
}

function StepRow({ step, first }: { step: Step; first: boolean }): React.JSX.Element {
  const colors = useColors();
  return (
    // touch-target-exempt: `step` is 56 tall (12 of padding around a 28 badge).
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${step.title} — ${step.cta}`}
      onPress={step.onPress}
      testID={`home-empty-step-${step.n}`}
      style={({ pressed }) => [
        styles.step,
        { backgroundColor: pressed ? colors['bg.hover'] : colors['bg.canvas'] },
      ]}
    >
      <View
        style={[
          styles.stepNumber,
          {
            backgroundColor: first ? colors['accent.solid'] : colors['bg.subtle'],
          },
        ]}
      >
        <Text
          variant="caption"
          mono
          weight={600}
          style={{ color: colors[first ? 'accent.fg' : 'fg.secondary'] }}
        >
          {String(step.n)}
        </Text>
      </View>
      <View style={styles.stepText}>
        <Text variant="body" weight={500} numberOfLines={1}>
          {step.title}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={2}>
          {step.body}
        </Text>
      </View>
      <Text variant="body" tone="accent" weight={600}>
        {step.cta}
      </Text>
    </Pressable>
  );
}

/** The wide card: headline + the three steps, with the striped preview panel beside them. */
export function EmptyLedgerCard(actions: EmptyLedgerActions): React.JSX.Element {
  const { t } = useTranslation();
  const steps = useSteps(actions);

  return (
    <ListCard style={styles.card} testID="home-empty">
      <View style={styles.cardBody}>
        <View style={styles.copy}>
          <Text variant="heading" weight={700} style={styles.headline}>
            {t('stats:home.empty.title')}
          </Text>
          <Text variant="body" tone="secondary" style={styles.body}>
            {t('stats:home.empty.body')}
          </Text>
          <View style={styles.steps}>
            {steps.map((step) => (
              <StepRow key={step.n} step={step} first={step.n === 1} />
            ))}
          </View>
        </View>
        <GhostBlock
          framed
          rows={4}
          chart
          caption={t('stats:home.empty.preview_caption')}
          note={t('stats:home.empty.preview_note')}
          style={styles.preview}
          testID="home-empty-preview"
        />
      </View>
    </ListCard>
  );
}

/** The narrow 「本月支出 —」 block: the striped preview standing in for the categories. */
export function EmptyMonthCard(): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text variant="subheading" weight={700}>
          {t('stats:home.empty.month_expense_title')}
        </Text>
        <Text variant="caption" tone="muted" mono>
          {t('stats:home.empty.no_amount')}
        </Text>
      </View>
      <ListCard style={styles.ghostCard} testID="home-empty-month">
        <GhostBlock rows={4} note={t('stats:home.month_empty_hint')} />
      </ListCard>
    </View>
  );
}

/** The narrow 「还没有交易」 card: three ways in, stacked. */
export function EmptyTransactionsCard({
  onAddTransaction,
  onImport,
  onInvite,
}: Omit<EmptyLedgerActions, 'onAddSource'>): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  return (
    <ListCard style={styles.ctaCard} testID="home-empty-transactions">
      <View style={styles.ctaBody}>
        <View style={[styles.ctaIcon, { backgroundColor: colors['accent.subtle'] }]}>
          <Icon name="plus" size={24} color={colors['accent.solid']} />
        </View>
        <Text variant="subheading" weight={700} style={styles.centered}>
          {t('stats:home.empty.no_tx_title')}
        </Text>
        <Text variant="body" tone="muted" style={styles.centered}>
          {t('stats:home.empty.no_tx_body')}
        </Text>
        <View style={styles.ctaButtons}>
          <Button
            label={t('stats:home.empty.record')}
            size="lg"
            fullWidth
            onPress={onAddTransaction}
            testID="home-empty-record"
          />
          <Button
            label={t('stats:home.empty.import')}
            variant="soft"
            size="lg"
            fullWidth
            onPress={onImport}
            testID="home-empty-import"
          />
          <Button
            label={t('stats:home.empty.invite_action')}
            variant="ghost"
            fullWidth
            onPress={onInvite}
            testID="home-empty-invite"
          />
        </View>
      </View>
    </ListCard>
  );
}

const styles = StyleSheet.create({
  card: { padding: space['8'] },
  cardBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space['8'],
    flexWrap: 'wrap',
  },
  copy: { flex: 1, minWidth: 300, gap: space['2'] },
  headline: { fontSize: 22, lineHeight: 30 },
  body: { maxWidth: 460, fontSize: 15, lineHeight: 23 },
  steps: { gap: space['3'] - 2, maxWidth: 460, marginTop: space['3'] },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space['3'],
    minHeight: 56,
    paddingHorizontal: space['3'] + 2,
    paddingVertical: space['3'],
    borderRadius: radius.md,
  },
  stepNumber: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  stepText: { flex: 1, minWidth: 0, gap: 1 },
  preview: { width: 360, flexGrow: 0, flexShrink: 1, maxWidth: '100%' },
  section: { alignSelf: 'stretch', gap: space['2'] + 2 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    paddingHorizontal: space['1'] + 2,
  },
  ghostCard: { padding: space['4'] + 2 },
  ctaCard: { paddingVertical: space['5'] + 2, paddingHorizontal: space['4'] + 2 },
  ctaBody: { alignItems: 'center', gap: space['2'] },
  ctaIcon: {
    width: 52,
    height: 52,
    borderRadius: radius.md + 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centered: { textAlign: 'center' },
  ctaButtons: { alignSelf: 'stretch', gap: space['2'], marginTop: space['3'] },
});
