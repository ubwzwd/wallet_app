/**
 * The layout kit the mockups share (phase 7): page header, section header, list card and
 * row, the two-column fact list, letter avatars, tinted stat cards and the round icon
 * wells. Behaviour, not pixels — but the few numbers the mockups actually fix (the wide /
 * narrow row height, the label column, the avatar shape) are asserted, because a page
 * built on top of these is only as aligned as they are.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import { namespaces, resources } from '@/i18n/resources';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { darkColors, density, lightColors, radius, type } from '@/theme/tokens';
import { Avatar, avatarGlyph, avatarGlyphSize } from '@/ui/Avatar';
import { Button } from '@/ui/Button';
import { KeyValueRows, KEY_COLUMN_WIDTH } from '@/ui/KeyValueRows';
import { KindIcon, SourceTypeIcon } from '@/ui/KindIcon';
import { ListCard } from '@/ui/ListCard';
import { ListRow } from '@/ui/ListRow';
import { PageHeader } from '@/ui/PageHeader';
import { SectionHeader } from '@/ui/SectionHeader';
import { Text } from '@/ui/Text';
import { TintCard } from '@/ui/TintCard';

beforeAll(async () => {
  if (!i18next.isInitialized) {
    await i18next.use(initReactI18next).init({
      lng: 'zh',
      fallbackLng: 'zh',
      ns: [...namespaces],
      defaultNS: 'common',
      resources: resources as never,
      interpolation: { escapeValue: false },
    });
  }
});

/** The jest runtime reports a 750pt window (narrow); flip this for the 1440 frame. */
let mockWideViewport = false;

jest.mock('@/theme/useBreakpoint', () => {
  const actual = jest.requireActual(
    '@/theme/useBreakpoint',
  ) as typeof import('@/theme/useBreakpoint');
  return { ...actual, useIsWide: () => mockWideViewport };
});

afterEach(() => {
  mockWideViewport = false;
});

function renderThemed(node: React.ReactElement, pref: 'light' | 'dark' = 'light') {
  return render(<ThemeProvider initialPref={pref}>{node}</ThemeProvider>);
}

function styleOf(element: { props: { style?: unknown } }): Record<string, unknown> {
  return StyleSheet.flatten(element.props.style as never) as unknown as Record<string, unknown>;
}

describe('PageHeader', () => {
  test('wide: the title, the inline stats and the actions live on one row', () => {
    mockWideViewport = true;
    const onPress = jest.fn();
    renderThemed(
      <PageHeader
        title="交易"
        meta="共 6 笔 · 支出 111.20"
        actions={<Button label="记一笔" onPress={onPress} testID="new" />}
        testID="ph"
      />,
    );
    expect(screen.getByTestId('ph-title')).toHaveTextContent('交易');
    expect(screen.getByTestId('ph-meta')).toHaveTextContent('共 6 笔 · 支出 111.20');
    expect(styleOf(screen.getByTestId('ph-title')).fontSize).toBe(type.title.size);
    // The stats are mono so the digits line up with the table under them.
    expect(styleOf(screen.getByTestId('ph-meta')).fontFamily).toContain('IBMPlexMono');
    fireEvent.press(screen.getByTestId('new'));
    expect(onPress).toHaveBeenCalled();
  });

  test('narrow: the top bar owns the title, so the header does not repeat it', () => {
    renderThemed(<PageHeader title="交易" meta="共 6 笔" testID="ph" />);
    expect(screen.queryByTestId('ph-title')).toBeNull();
    expect(screen.getByTestId('ph-meta')).toBeTruthy();
  });

  test('narrow: a header with nothing but a title renders nothing at all', () => {
    renderThemed(<PageHeader title="账户" testID="ph" />);
    expect(screen.queryByTestId('ph')).toBeNull();
  });

  test('the breadcrumb form shows the trail and goes back', () => {
    mockWideViewport = true;
    const onBack = jest.fn();
    renderThemed(
      <PageHeader
        title="Grab 打车"
        back={{ crumb: '交易 · Grab 打车', onPress: onBack, label: '返回' }}
        testID="ph"
      />,
    );
    expect(screen.getByText('交易 · Grab 打车')).toBeTruthy();
    fireEvent.press(screen.getByTestId('ph-back'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  test('a subtitle renders under the title', () => {
    mockWideViewport = true;
    renderThemed(<PageHeader title="导入" subtitle="应用本身不调用大模型" testID="ph" />);
    expect(screen.getByTestId('ph-subtitle')).toHaveTextContent('应用本身不调用大模型');
  });
});

describe('SectionHeader', () => {
  test('a meta string is mono and a link reports its press', () => {
    const onPress = jest.fn();
    renderThemed(
      <SectionHeader
        title="近 12 个月支出"
        meta="月均 6,220 · 峰值 8,100（4 月）"
        link={{ label: '管理账户', onPress }}
        testID="sh"
      />,
    );
    expect(screen.getByTestId('sh-title')).toHaveTextContent('近 12 个月支出');
    expect(styleOf(screen.getByTestId('sh-meta')).fontFamily).toContain('IBMPlexMono');
    // Mockup 01 draws the trailing stat at 13/19, a step above `caption`.
    expect(styleOf(screen.getByTestId('sh-meta')).fontSize).toBe(13);
    fireEvent.press(screen.getByTestId('sh-link'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test('the title steps up to the 20 heading on a wide screen', () => {
    mockWideViewport = true;
    renderThemed(<SectionHeader title="账户" testID="sh" />);
    expect(styleOf(screen.getByTestId('sh-title')).fontSize).toBe(type.heading.size);
  });
});

describe('ListCard and ListRow', () => {
  test('a row shows its two lines of text, its amount and its converted value', () => {
    renderThemed(
      <ListCard testID="card">
        <ListRow
          icon={<KindIcon kind="expense" />}
          title="Grab 打车"
          subtitle="交通 / 打车 · DBS Multiplier"
          amount="−S$12.40"
          amountTone="expense"
          amountSub="≈ −¥66.20"
          testID="row"
        />
      </ListCard>,
    );
    expect(screen.getByTestId('row-title')).toHaveTextContent('Grab 打车');
    expect(screen.getByTestId('row-subtitle')).toHaveTextContent('交通 / 打车 · DBS Multiplier');
    expect(screen.getByTestId('row-amount')).toHaveTextContent('−S$12.40');
    expect(screen.getByTestId('row-amount-sub')).toHaveTextContent('≈ −¥66.20');
    // The amount carries the kind's colour; the text next to it does not.
    expect(styleOf(screen.getByTestId('row-amount')).color).toBe(lightColors['kind.expense']);
    expect(styleOf(screen.getByTestId('row-amount')).fontFamily).toContain('IBMPlexMono');
  });

  test('rows are 56 narrow and 60 wide', () => {
    const { unmount } = renderThemed(<ListRow title="招行储蓄卡" testID="row" />);
    expect(styleOf(screen.getByTestId('row')).minHeight).toBe(density.listRowHeight);
    unmount();

    mockWideViewport = true;
    renderThemed(<ListRow title="招行储蓄卡" testID="row" />);
    expect(styleOf(screen.getByTestId('row')).minHeight).toBe(60);
  });

  test('a pressable row is a button that reports its selected state', () => {
    const onPress = jest.fn();
    renderThemed(<ListRow title="招行储蓄卡" selected onPress={onPress} testID="row" />);
    expect(screen.getByTestId('row').props.accessibilityRole).toBe('button');
    expect(screen.getByTestId('row').props.accessibilityState).toMatchObject({ selected: true });
    fireEvent.press(screen.getByTestId('row'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test('the card is a rounded surface and can carry a header and a footer', () => {
    renderThemed(
      <ListCard
        header={<Text>表头</Text>}
        footer={<Text>合计</Text>}
        divided
        testID="card"
      >
        <ListRow title="一" testID="r1" />
        <ListRow title="二" testID="r2" />
      </ListCard>,
    );
    expect(styleOf(screen.getByTestId('card')).borderRadius).toBe(radius.lg);
    expect(styleOf(screen.getByTestId('card')).backgroundColor).toBe(lightColors['bg.surface']);
    expect(screen.getByTestId('card-header')).toBeTruthy();
    expect(screen.getByTestId('card-footer')).toBeTruthy();
    expect(screen.getByTestId('r2')).toBeTruthy();
  });

  test('a divided card separates its rows with a single hairline, not a double one', () => {
    renderThemed(
      <ListCard divided testID="card">
        <ListRow title="一" testID="r1" />
        <ListRow title="二" testID="r2" />
      </ListCard>,
    );
    const divider = styleOf(screen.getByTestId('card-slot-1'));
    // The first row opens the card, so it gets no line above it at all.
    expect(screen.getByTestId('card-slot-0').props.style).toBeUndefined();
    expect(divider.borderTopWidth).toBe(1);
    expect(divider.borderTopColor).toBe(lightColors['border.default']);
  });

  test('dark mode drops the shadow and leans on the surface lightness instead', () => {
    renderThemed(<ListCard testID="card" />, 'dark');
    expect(styleOf(screen.getByTestId('card')).shadowOpacity).toBeUndefined();
    expect(styleOf(screen.getByTestId('card')).backgroundColor).toBe(darkColors['bg.surface']);
  });
});

describe('KeyValueRows', () => {
  const rows = [
    { label: '日期', value: '2026-09-08 周二', mono: true },
    { label: '分类', value: '交通 / 打车' },
    { label: '备注', value: '去机场' },
  ];

  test('every row pairs its label with its value, and dates stay mono', () => {
    renderThemed(<KeyValueRows rows={rows} testID="kv" />);
    expect(screen.getByTestId('kv-row-日期')).toBeTruthy();
    expect(screen.getByTestId('kv-value-分类')).toHaveTextContent('交通 / 打车');
    expect(styleOf(screen.getByTestId('kv-value-日期')).fontFamily).toContain('IBMPlexMono');
    expect(styleOf(screen.getByTestId('kv-value-分类')).fontFamily).not.toContain('IBMPlexMono');
  });

  test('the label column is 160 wide once there is room for it', () => {
    mockWideViewport = true;
    renderThemed(<KeyValueRows rows={rows} testID="kv" />);
    expect(styleOf(screen.getByText('日期')).width).toBe(KEY_COLUMN_WIDTH);
  });

  test('a long value wraps only when the row asks to, and is clipped otherwise', () => {
    renderThemed(
      <KeyValueRows
        rows={[
          { label: '备注', value: '去机场'.repeat(60), wrap: true },
          { label: '分类', value: '交通 / 打车' },
        ]}
        testID="kv"
      />,
    );
    expect(screen.getByTestId('kv-value-备注').props.numberOfLines).toBeUndefined();
    expect(screen.getByTestId('kv-value-分类').props.numberOfLines).toBe(1);
  });

  test('a value may be a node, for a row that holds a badge or a link', () => {
    renderThemed(
      <KeyValueRows
        rows={[{ label: '来源', value: <Text testID="node">导入 cmb-09.csv</Text> }]}
        testID="kv"
      />,
    );
    expect(screen.getByTestId('node')).toBeTruthy();
  });
});

describe('Avatar', () => {
  test('a ledger is a rounded square on the accent, a person a circle on the tint', () => {
    renderThemed(
      <>
        <Avatar name="家庭账本" shape="square" size={32} testID="ledger" />
        <Avatar name="wang" shape="circle" size={32} testID="me" />
      </>,
    );
    expect(styleOf(screen.getByTestId('ledger')).backgroundColor).toBe(
      lightColors['accent.solid'],
    );
    expect(styleOf(screen.getByTestId('ledger')).borderRadius).toBe(10);
    expect(styleOf(screen.getByTestId('me')).backgroundColor).toBe(lightColors['bg.subtle']);
    expect(styleOf(screen.getByTestId('me')).borderRadius).toBe(radius.pill);
  });

  test('the narrow top bar gets its own tone: the page white, not the tint', () => {
    renderThemed(<Avatar name="wang" shape="circle" size={40} tone="surface" testID="disc" />);
    expect(styleOf(screen.getByTestId('disc')).backgroundColor).toBe(lightColors['bg.surface']);
  });

  test('the glyph follows the mockups’ ladder and never drops below the caption step', () => {
    // 32 → 13 and 64 → 24 are the mockups' own sizes (01 / 14); a 26px menu tile would
    // land on 10 at a flat 0.4 ratio, which stops reading as a letter, so it floors at 12.
    expect(avatarGlyphSize(32)).toBe(13);
    expect(avatarGlyphSize(64)).toBe(26);
    expect(avatarGlyphSize(26)).toBe(12);
  });

  test('only the first character is drawn, upper-cased', () => {
    expect(avatarGlyph('wang')).toBe('W');
    expect(avatarGlyph('  家庭账本 ')).toBe('家');
    expect(avatarGlyph('')).toBe('?');
    renderThemed(<Avatar name="老婆" testID="a" />);
    expect(screen.getByText('老')).toBeTruthy();
  });
});

describe('TintCard', () => {
  test('the tone paints both the fill and everything written on it', () => {
    renderThemed(
      <TintCard tone="expense" icon="arrow-down" label="9 月支出" value="6,842.50" testID="tc" />,
    );
    expect(styleOf(screen.getByTestId('tc')).backgroundColor).toBe(
      lightColors['kind.expense.subtle'],
    );
    expect(styleOf(screen.getByTestId('tc-value')).color).toBe(lightColors['kind.expense']);
    expect(styleOf(screen.getByTestId('tc-label')).color).toBe(lightColors['kind.expense']);
    expect(styleOf(screen.getByTestId('tc-value')).fontFamily).toContain('IBMPlexMono');
  });

  test('a warning note is the same card with prose instead of a number', () => {
    renderThemed(
      <TintCard tone="warning" label="已关联的退款" testID="tc">
        <Text testID="prose">这笔还没有退款记录。</Text>
      </TintCard>,
    );
    expect(styleOf(screen.getByTestId('tc')).backgroundColor).toBe(
      lightColors['status.warning.bg'],
    );
    expect(screen.getByTestId('prose')).toBeTruthy();
    expect(screen.queryByTestId('tc-value')).toBeNull();
  });
});

describe('icon wells', () => {
  test('a kind well is a circle on its own subtle tint and names itself', () => {
    renderThemed(<KindIcon kind="refund" size={36} testID="well" />);
    const style = styleOf(screen.getByTestId('well'));
    expect(style.backgroundColor).toBe(lightColors['kind.refund.subtle']);
    expect(style.borderRadius).toBe(radius.pill);
    expect(style.width).toBe(36);
    expect(screen.getByTestId('well').props.accessibilityLabel).toBe('退款');
  });

  test('an account well takes the type tint and the type name', () => {
    renderThemed(<SourceTypeIcon type="credit" testID="well" />);
    expect(styleOf(screen.getByTestId('well')).backgroundColor).toBe(
      lightColors['status.danger.bg'],
    );
    expect(screen.getByTestId('well').props.accessibilityLabel).toBe('信用卡');
  });
});
