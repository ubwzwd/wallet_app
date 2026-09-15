/**
 * Screen 15 「无账本引导」: what `/ledgers` is when the list comes back empty.
 *
 * It is deliberately not the app's list page with an empty box in it — with no ledger,
 * every navigation entry points at nothing, so the page drops the chrome entirely and keeps
 * only a brand bar, one sentence and the two ways forward.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { BrandBar, BrandMark } from '@/screens/auth/AuthLayout';
import { radius, space } from '@/theme/tokens';
import { useTheme } from '@/theme/ThemeProvider';
import { useIsWide } from '@/theme/useBreakpoint';
import { Avatar, Button, Card, Icon, type IconName, Text, raisedShadow } from '@/ui';

const TILE = 48;
const COLUMN_MAX_WIDTH = 760;

export interface NoLedgerGuideProps {
  /** The signed-in user, named on the pill in the top-right corner. */
  email: string;
  onOpenProfile(): void;
  onCreate(): void;
  onJoin(): void;
}

/** The email pill of screen 15's wide frame; on narrow it shrinks to the disc alone. */
function UserPill({
  email,
  onPress,
  wide,
}: {
  email: string;
  onPress(): void;
  wide: boolean;
}): React.JSX.Element {
  const { colors, scheme } = useTheme();
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={email}
      onPress={onPress}
      testID="onboarding-user"
      style={({ pressed }) => [
        styles.pill,
        raisedShadow(colors, scheme),
        { backgroundColor: pressed ? colors['bg.hover'] : colors['bg.surface'] },
      ]}
    >
      <Avatar name={email} size={wide ? 28 : 32} shape="circle" tone="muted" />
      {wide ? (
        <Text weight={500} style={styles.pillLabel} numberOfLines={1}>
          {email}
        </Text>
      ) : null}
    </Pressable>
  );
}

function ChoiceCard({
  icon,
  tint,
  fg,
  title,
  body,
  button,
  primary,
  wide,
  onPress,
  testID,
}: {
  icon: IconName;
  tint: 'accent.subtle' | 'kind.transfer.subtle';
  fg: 'accent.solid' | 'status.info.fg';
  title: string;
  body: string;
  button: string;
  primary: boolean;
  wide: boolean;
  onPress(): void;
  testID: string;
}): React.JSX.Element {
  const { colors } = useTheme();
  return (
    <Card
      variant="raised"
      style={[styles.choice, wide ? styles.choiceGrow : null, { padding: wide ? space['6'] : space['5'] }]}
    >
      <View style={wide ? styles.choiceHeadWide : styles.choiceHeadNarrow}>
        <View style={[styles.tile, { backgroundColor: colors[tint] }]}>
          <Icon name={icon} size={22} color={colors[fg]} />
        </View>
        <View style={styles.choiceText}>
          <Text variant="heading" weight={700} style={wide ? undefined : styles.choiceTitleNarrow}>
            {title}
          </Text>
          <Text variant="body" tone="muted">
            {body}
          </Text>
        </View>
      </View>
      <Button
        testID={testID}
        label={button}
        variant={primary ? 'primary' : 'soft'}
        size="lg"
        onPress={onPress}
        fullWidth
      />
    </Card>
  );
}

export function NoLedgerGuide({
  email,
  onOpenProfile,
  onCreate,
  onJoin,
}: NoLedgerGuideProps): React.JSX.Element {
  const { t } = useTranslation();
  const wide = useIsWide();
  const pill = <UserPill email={email} onPress={onOpenProfile} wide={wide} />;

  return (
    <View style={styles.root} testID="ledgers-empty">
      {wide ? (
        <BrandBar right={pill} />
      ) : (
        <View style={styles.narrowBar}>
          <BrandMark size={32} />
          {pill}
        </View>
      )}

      <View style={styles.centre}>
        <View style={[styles.column, { maxWidth: COLUMN_MAX_WIDTH }]}>
          <View style={wide ? styles.headingWide : styles.headingNarrow}>
            <Text variant="title" accessibilityRole="header" style={wide ? styles.centred : undefined}>
              {t('ledger:list.onboarding.title')}
            </Text>
            <Text
              variant="subheading"
              weight={400}
              tone="secondary"
              style={wide ? styles.centred : undefined}
            >
              {t('ledger:list.onboarding.body')}
            </Text>
          </View>

          <View style={[styles.choices, wide ? styles.choicesRow : null]}>
            <ChoiceCard
              icon="plus"
              tint="accent.subtle"
              fg="accent.solid"
              title={t('ledger:list.onboarding.create.title')}
              body={t(
                wide
                  ? 'ledger:list.onboarding.create.body'
                  : 'ledger:list.onboarding.create.body_short',
              )}
              button={t('ledger:list.onboarding.create.button')}
              primary
              wide={wide}
              onPress={onCreate}
              testID="ledgers-empty-primary"
            />
            <ChoiceCard
              icon="key-round"
              tint="kind.transfer.subtle"
              fg="status.info.fg"
              title={t('ledger:list.onboarding.join.title')}
              body={t(
                wide ? 'ledger:list.onboarding.join.body' : 'ledger:list.onboarding.join.body_short',
              )}
              button={t('ledger:list.onboarding.join.button')}
              primary={false}
              wide={wide}
              onPress={onJoin}
              testID="ledgers-empty-secondary"
            />
          </View>

          <Text variant="caption" tone="muted" style={wide ? styles.centred : styles.footnote}>
            {t('ledger:list.onboarding.footnote')}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, gap: 0 },
  narrowBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 44,
    paddingVertical: space['1'],
    paddingLeft: space['1'],
    paddingRight: space['3'],
    borderRadius: radius.pill,
  },
  pillLabel: { fontSize: 14, lineHeight: 19 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: space['8'] },
  column: { width: '100%', gap: space['6'] },
  headingWide: { gap: space['3'] },
  headingNarrow: { gap: space['2'], paddingHorizontal: space['1'] },
  centred: { textAlign: 'center' },
  choices: { gap: space['4'] },
  choicesRow: { flexDirection: 'row', alignItems: 'stretch' },
  choice: { gap: space['4'], justifyContent: 'space-between' },
  choiceGrow: { flex: 1 },
  choiceHeadWide: { gap: space['3'] },
  choiceHeadNarrow: { flexDirection: 'row', alignItems: 'center', gap: space['3'] },
  choiceText: { flex: 1, minWidth: 0, gap: space['1'] },
  choiceTitleNarrow: { fontSize: 17, lineHeight: 24 },
  tile: {
    width: TILE,
    height: TILE,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footnote: { paddingHorizontal: space['1'] },
});
