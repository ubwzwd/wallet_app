/**
 * The one-shot "add an account first" card of 04 §4.2.
 *
 * Registration creates a default ledger (decision §2) but no accounts, so the register page
 * leaves the `onboarding_hint` preference behind and the home page spends it: the card shows
 * once, while the ledger still has no account, and both the action and the dismiss clear the
 * preference for good. It is a per-device preference — nothing here reaches the server.
 */
import React from 'react';
import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { ONBOARDING_HINT_PREF } from '@/screens/auth/RegisterScreen';
import { space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { Button, Card, Icon, Text } from '@/ui';
import { getPref, setPref } from '@/utils/prefs';

export interface OnboardingHintProps {
  /** Unarchived accounts in this ledger; `undefined` while the list is still loading. */
  sourceCount: number | undefined;
  onAddSource(): void;
}

export function OnboardingHint({
  sourceCount,
  onAddSource,
}: OnboardingHintProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const colors = useColors();
  const [pref, setPrefValue] = React.useState<string | null>(null);
  const [dismissed, setDismissed] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    void getPref(ONBOARDING_HINT_PREF).then((value) => {
      if (alive) setPrefValue(value);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Spent on the first press, whichever one it is: the card never comes back.
  const spend = React.useCallback((): void => {
    setDismissed(true);
    void setPref(ONBOARDING_HINT_PREF, null);
  }, []);

  if (dismissed || pref !== '1' || sourceCount !== 0) return null;

  return (
    <Card variant="raised" style={{ gap: space['3'] }} testID="home-onboarding">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space['2'] }}>
        <Icon name="info" size={18} color={colors['accent.solid']} />
        <Text variant="subheading" style={{ flex: 1 }}>
          {t('stats:home.onboarding_title')}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('common:button.close')}
          onPress={spend}
          testID="home-onboarding-dismiss"
          // 04 §6.6: no touch target smaller than 44×44.
          style={{
            minWidth: 44,
            minHeight: 44,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Icon name="x" size={18} color={colors['fg.muted']} />
        </Pressable>
      </View>
      <Button
        label={t('stats:home.onboarding_action')}
        onPress={() => {
          spend();
          onAddSource();
        }}
        testID="home-onboarding-action"
      />
    </Card>
  );
}
