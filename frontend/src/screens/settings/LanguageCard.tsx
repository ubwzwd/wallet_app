/**
 * Personal settings → 语言 (屏幕稿 14).
 *
 * Three whole blocks rather than a dropdown: there are only three, and 「跟随系统」 needs a
 * second line saying which language it currently resolves to. The selected block takes
 * `bg.selected` plus a 1.5 accent ring and a ✓.
 *
 * Wide draws them in a row inside their own card, under the note that repeats what a
 * language change does *not* touch (amounts, dates — decision §14.6); narrow stacks them
 * as one field inside the 偏好 card.
 */
import React from 'react';
import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { Lang } from '@/i18n';
import { radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { useIsWide } from '@/theme/useBreakpoint';
import { Card, Icon, Text } from '@/ui';

/** `system` is the server's `null` — "follow the system" (decision §14.6). */
export type LanguageChoice = 'system' | Lang;

const CHOICES: readonly LanguageChoice[] = ['zh', 'en', 'system'];

export interface LanguageChoicesProps {
  value: LanguageChoice;
  /** The language 「跟随系统」 currently resolves to. */
  resolved: Lang;
  onChange(next: LanguageChoice): void;
}

function Choices({ value, resolved, onChange }: LanguageChoicesProps): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  const wide = useIsWide();

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={t('settings:language_label')}
      testID="settings-language"
      style={{ flexDirection: wide ? 'row' : 'column', gap: space['2'] + 2 }}
    >
      {CHOICES.map((choice) => {
        const selected = choice === value;
        const sub =
          choice === 'system'
            ? t('settings:language_sub.system', { name: t(`settings:language.${resolved}`) })
            : t(`settings:language_sub.${choice}`);
        return (
          // touch-target-exempt: the block is minHeight 64 wide / 52 narrow (below).
          <Pressable
            key={choice}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            accessibilityLabel={t(`settings:language.${choice}`)}
            onPress={() => onChange(choice)}
            testID={`settings-language-${choice}`}
            style={({ pressed }) => ({
              flexGrow: wide ? 1 : 0,
              flexShrink: 1,
              flexBasis: wide ? 0 : 'auto',
              minWidth: 0,
              minHeight: wide ? 64 : 52,
              justifyContent: 'center',
              gap: space['1'],
              paddingVertical: space['2'] + 2,
              paddingHorizontal: space['4'],
              borderRadius: radius.md,
              borderWidth: 1.5,
              borderColor: selected ? colors['accent.solid'] : 'transparent',
              backgroundColor: selected
                ? colors['bg.selected']
                : pressed
                  ? colors['bg.hover']
                  : colors['bg.subtle'],
            })}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space['2'] }}>
              <Text
                variant="subheading"
                weight={600}
                numberOfLines={1}
                tone={selected ? 'primary' : 'secondary'}
                style={{ flex: 1 }}
              >
                {t(`settings:language.${choice}`)}
              </Text>
              {selected ? <Icon name="check" size={18} color={colors['accent.solid']} /> : null}
            </View>
            <Text variant="caption" tone="muted" numberOfLines={1}>
              {sub}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** The wide layout's own card: heading, the three blocks in a row, then the note. */
export function LanguageCard(props: LanguageChoicesProps): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  return (
    <Card
      variant="raised"
      testID="language-card"
      style={{ padding: space['5'], gap: space['3'] + 2 }}
    >
      <Text variant="subheading" weight={700} accessibilityRole="header">
        {t('settings:section.language')}
      </Text>
      <Choices {...props} />
      <View
        style={{
          padding: space['4'],
          borderRadius: radius.md,
          backgroundColor: colors['bg.subtle'],
        }}
      >
        <Text variant="body" tone="secondary" testID="settings-language-note">
          {t('settings:language_note')}
        </Text>
      </View>
    </Card>
  );
}

/** The narrow layout's field inside the 偏好 card. */
export function LanguageField(props: LanguageChoicesProps): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <View style={{ gap: space['2'] }}>
      <Text variant="caption" tone="secondary" weight={600}>
        {t('settings:language_label')}
      </Text>
      <Choices {...props} />
      <Text variant="caption" tone="muted" testID="settings-language-note">
        {t('settings:language_note')}
      </Text>
    </View>
  );
}

export default LanguageCard;
