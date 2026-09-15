/**
 * The white card a list of rows sits in (mockups 01 / 08 / 09 / 11 / 13): `bg.surface`,
 * radius 18, the `shadow.raised` hairline lift, and 4px of vertical padding so the first
 * and last row do not touch the corners.
 *
 * `divided` draws a 1px `border.default` between rows — the mockups use it for tables and
 * detail lists, and leave it off for short lists like the home page's accounts.
 */
import React from 'react';
import { type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';
import { radius, space } from '@/theme/tokens';
import { useTheme } from '@/theme/ThemeProvider';
import { raisedShadow } from './Card';

export interface ListCardProps {
  children?: React.ReactNode;
  /** A header strip above the rows (a table head, a section title). */
  header?: React.ReactNode;
  /** A footer strip below them (「合计 · 在用」, 「6 / 6 笔已显示」). */
  footer?: React.ReactNode;
  /** 1px separators between rows. */
  divided?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function ListCard({
  children,
  header,
  footer,
  divided = false,
  style,
  testID,
}: ListCardProps): React.JSX.Element {
  const { colors, scheme } = useTheme();
  const rows = React.Children.toArray(children).filter((child) => child !== null);

  return (
    <View
      testID={testID}
      style={[
        styles.card,
        raisedShadow(colors, scheme),
        { backgroundColor: colors['bg.surface'] },
        style,
      ]}
    >
      {header !== undefined ? (
        <View
          testID={testID ? `${testID}-header` : undefined}
          style={[styles.strip, { borderBottomColor: colors['border.default'] }]}
        >
          {header}
        </View>
      ) : null}
      <View style={header === undefined && footer === undefined ? styles.body : null}>
        {rows.map((child, i) => (
          <View
            // Rows are positional and have no stable identity of their own; the child
            // itself carries a key when the caller maps over data.
            key={i}
            style={
              divided && i > 0
                ? { borderTopWidth: StyleSheet.hairlineWidth * 2, borderTopColor: colors['border.default'] }
                : undefined
            }
          >
            {child}
          </View>
        ))}
      </View>
      {footer !== undefined ? (
        <View
          testID={testID ? `${testID}-footer` : undefined}
          style={[styles.stripBottom, { borderTopColor: colors['border.default'] }]}
        >
          {footer}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, overflow: 'hidden', alignSelf: 'stretch' },
  body: { paddingVertical: space['1'] },
  strip: { borderBottomWidth: 1 },
  stripBottom: { borderTopWidth: 1 },
});
