/**
 * The account form's 类型 picker (屏幕稿 09 · 账户表单): four tappable blocks rather than a
 * dropdown — there are only four types (决策 §14.48) and each has an icon, so picking one is
 * a single tap. Wide draws them in one row of 88-tall tiles, narrow in a 2×2 grid of 56-tall
 * rows; the chosen one takes its type's tint plus a 1.5px ring in the type's own colour.
 */
import React from 'react';
import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { SourceType } from '@/api/types';
import { radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { useIsWide } from '@/theme/useBreakpoint';
import {
  Icon,
  SOURCE_TYPE_FG,
  SOURCE_TYPE_ICON,
  SOURCE_TYPE_SUBTLE,
  Text,
  sourceTypeLabelKey,
} from '@/ui';

import { SOURCE_TYPES } from './schemas';

/** 屏幕稿 09: an 88 tile wide, a 56 row narrow; the icon well is 34 / 32. */
const TILE_WIDE = 88;
const TILE_NARROW = 56;
const WELL_WIDE = 34;
const WELL_NARROW = 32;

export interface TypePickerProps {
  value: SourceType;
  onChange(next: SourceType): void;
  disabled?: boolean;
  label: string;
  testID?: string;
}

export function TypePicker({
  value,
  onChange,
  disabled = false,
  label,
  testID,
}: TypePickerProps): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  const wide = useIsWide();
  const id = testID ?? 'source-type';
  const well = wide ? WELL_WIDE : WELL_NARROW;

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      testID={id}
      style={{
        flexDirection: 'row',
        flexWrap: 'wrap',
        gap: wide ? space['3'] - 2 : space['2'],
      }}
    >
      {SOURCE_TYPES.map((type) => {
        const selected = type === value;
        const tint = colors[SOURCE_TYPE_SUBTLE[type]];
        const ink = colors[SOURCE_TYPE_FG[type]];
        return (
          // touch-target-exempt: every tile is 88 (wide) / 56 (narrow) tall.
          <Pressable
            key={type}
            accessibilityRole="radio"
            accessibilityState={{ selected, disabled }}
            accessibilityLabel={t(sourceTypeLabelKey(type))}
            disabled={disabled}
            onPress={() => onChange(type)}
            testID={`${id}-${type}`}
            style={({ pressed }) => ({
              height: wide ? TILE_WIDE : TILE_NARROW,
              flexGrow: 1,
              flexBasis: wide ? 0 : '45%',
              minWidth: 0,
              flexDirection: wide ? 'column' : 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: wide ? space['2'] : space['3'] - 2,
              paddingHorizontal: space['3'],
              borderRadius: radius.md,
              borderWidth: 1.5,
              borderColor: selected ? ink : 'transparent',
              opacity: disabled ? 0.6 : 1,
              backgroundColor: selected
                ? tint
                : pressed
                  ? colors['bg.hover']
                  : colors['bg.subtle'],
            })}
          >
            <View
              accessibilityElementsHidden
              importantForAccessibility="no"
              style={{
                width: well,
                height: well,
                borderRadius: radius.pill,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: colors['bg.raised'],
              }}
            >
              <Icon
                name={SOURCE_TYPE_ICON[type]}
                size={18}
                color={selected ? ink : colors['fg.muted']}
              />
            </View>
            <Text
              variant={wide ? 'body' : 'subheading'}
              weight={600}
              numberOfLines={1}
              style={{ color: selected ? ink : colors['fg.secondary'] }}
            >
              {t(sourceTypeLabelKey(type))}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
