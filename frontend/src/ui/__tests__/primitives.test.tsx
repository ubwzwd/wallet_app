/**
 * The component library's behaviour (04 §6.4): type scale, button states, field errors,
 * chips, segmented control and the select overlay.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { controls, darkColors, icons, lightColors, radius, type } from '@/theme/tokens';
import { Badge } from '@/ui/Badge';
import { Card } from '@/ui/Card';
import { Button } from '@/ui/Button';
import { Checkbox } from '@/ui/Checkbox';
import { Chip } from '@/ui/Chip';
import { EmptyState } from '@/ui/EmptyState';
import { KIND_ICON, SOURCE_TYPE_ICON } from '@/ui/Icon';
import { PAGE_MAX_WIDTH, Page } from '@/ui/Page';
import { ProgressBar } from '@/ui/ProgressBar';
import { SegmentedControl } from '@/ui/SegmentedControl';
import { Select } from '@/ui/Select';
import { Skeleton } from '@/ui/Skeleton';
import { StatTile } from '@/ui/StatTile';
import { Text } from '@/ui/Text';
import { TextField } from '@/ui/TextField';

/** The jest runtime reports a 750pt window, i.e. the narrow layout. Flip this to exercise
 *  the wide one (sidebar / inline dropdown panels) without faking `Dimensions`. */
let mockWideViewport = false;

jest.mock('@/theme/useBreakpoint', () => {
  const actual = jest.requireActual('@/theme/useBreakpoint') as typeof import('@/theme/useBreakpoint');
  return { ...actual, useIsWide: () => mockWideViewport };
});

function renderThemed(node: React.ReactElement, pref: 'light' | 'dark' = 'light') {
  return render(<ThemeProvider initialPref={pref}>{node}</ThemeProvider>);
}

/** RNTL hands back the style prop as written; flatten it before asserting. */
function styleOf(element: { props: { style?: unknown } }): Record<string, unknown> {
  return StyleSheet.flatten(element.props.style as never) as unknown as Record<string, unknown>;
}

describe('Text', () => {
  test('every variant takes its size, line height and weight from the tokens', () => {
    renderThemed(
      <>
        <Text variant="display">display</Text>
        <Text variant="body">body</Text>
        <Text variant="micro">micro</Text>
      </>,
    );
    for (const variant of ['display', 'body', 'micro'] as const) {
      const style = styleOf(screen.getByText(variant));
      expect(style.fontSize).toBe(type[variant].size);
      expect(style.lineHeight).toBe(type[variant].lineHeight);
      expect(style.fontWeight).toBe(String(type[variant].weight));
    }
    // 04 §6.3: the headline steps carry −0.02em tracking.
    expect(styleOf(screen.getByText('display')).letterSpacing).toBeCloseTo(
      -0.02 * type.display.size,
    );
    expect(styleOf(screen.getByText('body')).letterSpacing).toBeUndefined();
  });

  test('mono switches family and turns on tabular figures', () => {
    renderThemed(<Text mono>-12.34</Text>);
    const style = styleOf(screen.getByText('-12.34'));
    expect(style.fontFamily).toContain('IBMPlexMono');
    expect(style.fontVariant).toEqual(['tabular-nums']);
  });

  test('tone resolves against the active palette, not a literal colour', () => {
    const light = renderThemed(<Text tone="expense">x</Text>, 'light');
    expect(styleOf(screen.getByText('x')).color).toBe(lightColors['kind.expense']);
    light.unmount();
    renderThemed(<Text tone="expense">x</Text>, 'dark');
    expect(styleOf(screen.getByText('x')).color).toBe(darkColors['kind.expense']);
  });
});

describe('Button', () => {
  test('the four variants render at the token heights and radius', () => {
    renderThemed(
      <>
        <Button label="primary" testID="b-primary" />
        <Button label="secondary" variant="secondary" size="sm" testID="b-secondary" />
        <Button label="ghost" variant="ghost" size="lg" testID="b-ghost" />
        <Button label="danger" variant="danger" testID="b-danger" />
      </>,
    );
    expect(styleOf(screen.getByTestId('b-primary')).height).toBe(controls.button.heights.md);
    expect(styleOf(screen.getByTestId('b-secondary')).height).toBe(controls.button.heights.sm);
    expect(styleOf(screen.getByTestId('b-ghost')).height).toBe(controls.button.heights.lg);
    expect(styleOf(screen.getByTestId('b-danger')).borderRadius).toBe(radius.md);
    // Danger is outlined by default (tokens `controls.button.notes`).
    expect(styleOf(screen.getByTestId('b-danger')).borderColor).toBe(
      lightColors['status.danger.fg'],
    );
    expect(screen.getByTestId('b-primary').props.accessibilityRole).toBe('button');
  });

  test('a small icon-only button clears 44×44 on both axes through hit slop', () => {
    renderThemed(<Button icon="pencil" iconOnly accessibilityLabel="编辑" size="sm" testID="b" />);
    const slop = screen.getByTestId('b').props.hitSlop as {
      top: number;
      bottom: number;
      left: number;
      right: number;
    };
    // An icon-only button is square, so width == height == the `sm` height.
    expect(controls.button.heights.sm + slop.top + slop.bottom).toBeGreaterThanOrEqual(44);
    expect(controls.button.heights.sm + slop.left + slop.right).toBeGreaterThanOrEqual(44);
  });

  test('loading marks the button busy and swallows presses', () => {
    const onPress = jest.fn();
    renderThemed(<Button label="save" loading onPress={onPress} testID="b" />);
    const button = screen.getByTestId('b');
    expect(button.props.accessibilityState).toMatchObject({ busy: true, disabled: true });
    expect(screen.getByTestId('button-spinner')).toBeTruthy();
    fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  test('disabled swallows presses and reports the state', () => {
    const onPress = jest.fn();
    renderThemed(<Button label="save" disabled onPress={onPress} testID="b" />);
    expect(screen.getByTestId('b').props.accessibilityState).toMatchObject({
      disabled: true,
      busy: false,
    });
    fireEvent.press(screen.getByTestId('b'));
    expect(onPress).not.toHaveBeenCalled();
  });

  test('an enabled button fires once per press', () => {
    const onPress = jest.fn();
    renderThemed(<Button label="save" onPress={onPress} testID="b" />);
    fireEvent.press(screen.getByTestId('b'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  test('an icon-only button keeps its accessible name', () => {
    renderThemed(<Button icon="pencil" iconOnly accessibilityLabel="编辑" testID="b" />);
    expect(screen.getByLabelText('编辑')).toBeTruthy();
  });
});

describe('TextField', () => {
  test('the error message replaces the hint and tints the field, not the row', () => {
    const { unmount } = renderThemed(
      <TextField label="邮箱" hint="公司邮箱" value="" onChangeText={() => undefined} />,
    );
    expect(screen.getByText('公司邮箱')).toBeTruthy();
    unmount();

    renderThemed(
      <TextField
        label="邮箱"
        hint="公司邮箱"
        error="邮箱格式不对"
        value=""
        onChangeText={() => undefined}
        testID="field"
      />,
    );
    expect(screen.getByText('邮箱格式不对')).toBeTruthy();
    expect(screen.queryByText('公司邮箱')).toBeNull();
    const input = screen.getByTestId('field');
    expect(styleOf(input).color).toBe(lightColors['fg.primary']);
  });

  test('the secure toggle flips secureTextEntry and keeps an accessible name', () => {
    renderThemed(
      <TextField
        label="口令"
        secureToggle
        secureShowLabel="显示口令"
        secureHideLabel="隐藏口令"
        value="hunter2"
        onChangeText={() => undefined}
        testID="pw"
      />,
    );
    expect(screen.getByTestId('pw').props.secureTextEntry).toBe(true);
    fireEvent.press(screen.getByLabelText('显示口令'));
    expect(screen.getByTestId('pw').props.secureTextEntry).toBe(false);
    expect(screen.getByLabelText('隐藏口令')).toBeTruthy();
  });

  test('the in-field icon button clears 44×44 through hit slop', () => {
    renderThemed(
      <TextField
        label="口令"
        secureToggle
        secureShowLabel="显示口令"
        value="hunter2"
        onChangeText={() => undefined}
      />,
    );
    const slop = screen.getByTestId('secure-toggle').props.hitSlop as {
      top: number;
      bottom: number;
      left: number;
      right: number;
    };
    expect(icons.grid + slop.top + slop.bottom).toBeGreaterThanOrEqual(44);
    expect(icons.grid + slop.left + slop.right).toBeGreaterThanOrEqual(44);
  });

  test('the counter shows the used length against the limit', () => {
    renderThemed(
      <TextField value="abc" maxLength={40} showCounter onChangeText={() => undefined} />,
    );
    expect(screen.getByTestId('text-field-counter')).toHaveTextContent('3/40');
  });

  test('focus rings the wrapper, and the native input draws no ring of its own', () => {
    renderThemed(<TextField value="" onChangeText={() => undefined} testID="f" />, 'dark');
    const input = screen.getByTestId('f');
    expect(styleOf(screen.getByTestId('f-field')).borderColor).toBe('transparent');

    fireEvent(input, 'focus');
    expect(styleOf(screen.getByTestId('f-field')).borderColor).toBe(darkColors['border.focus']);
    // Two rings would show: the wrapper's, plus the browser's own around the text box.
    expect(styleOf(input).outlineWidth).toBe(0);

    fireEvent(input, 'blur');
    expect(styleOf(screen.getByTestId('f-field')).borderColor).toBe('transparent');
  });

  test('the field is 52 high with radius 14', () => {
    renderThemed(<TextField value="" onChangeText={() => undefined} testID="f" />);
    const style = styleOf(screen.getByTestId('f-field'));
    expect(style.minHeight).toBe(controls.textField.height);
    expect(style.borderRadius).toBe(radius.md);
  });
});

describe('Badge and Chip', () => {
  test('a badge always carries its label, never colour alone', () => {
    renderThemed(<Badge label="重复" tone="flag-duplicate" icon="copy" testID="badge" />);
    expect(screen.getByText('重复')).toBeTruthy();
    expect(styleOf(screen.getByTestId('badge')).height).toBe(controls.badge.height);
  });

  test('a chip is a pill and its × calls onRemove', () => {
    const onRemove = jest.fn();
    renderThemed(<Chip label="来自导入 #12" onRemove={onRemove} testID="chip" />);
    expect(styleOf(screen.getByTestId('chip')).height).toBe(controls.chip.height);
    expect(styleOf(screen.getByTestId('chip')).borderRadius).toBe(radius.pill);
    fireEvent.press(screen.getByTestId('chip-remove'));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  test('a pressable chip reports its selected state', () => {
    const onPress = jest.fn();
    renderThemed(<Chip label="本月" selected onPress={onPress} testID="chip" />);
    expect(screen.getByTestId('chip').props.accessibilityState).toMatchObject({ selected: true });
    fireEvent.press(screen.getByTestId('chip'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('SegmentedControl', () => {
  const options = [
    { value: 'expense', label: '支出' },
    { value: 'income', label: '收入' },
    { value: 'transfer', label: '转账', disabled: true },
  ];

  test('it is a tablist, marks the current tab and reports changes', () => {
    const onChange = jest.fn();
    renderThemed(
      <SegmentedControl value="expense" onChange={onChange} options={options} testID="kind" />,
    );
    expect(screen.getByTestId('kind').props.accessibilityRole).toBe('tablist');
    expect(screen.getByTestId('kind-expense').props.accessibilityState).toMatchObject({
      selected: true,
    });
    fireEvent.press(screen.getByTestId('kind-income'));
    expect(onChange).toHaveBeenCalledWith('income');
  });

  test('a disabled segment does not fire', () => {
    const onChange = jest.fn();
    renderThemed(
      <SegmentedControl value="expense" onChange={onChange} options={options} testID="kind" />,
    );
    fireEvent.press(screen.getByTestId('kind-transfer'));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('Select', () => {
  const options = [
    { value: 'cmb', label: '招商银行储蓄卡', hint: 'CNY' },
    { value: 'ccb', label: '建设银行信用卡', hint: 'CNY' },
    { value: 'cash', label: '现金', hint: 'CNY' },
  ];

  test('picking an option reports the value and closes the overlay', () => {
    const onChange = jest.fn();
    renderThemed(
      <Select label="账户" value={null} onChange={onChange} options={options} testID="src" />,
    );
    fireEvent.press(screen.getByTestId('src-trigger'));
    fireEvent.press(screen.getByTestId('src-option-ccb'));
    expect(onChange).toHaveBeenCalledWith('ccb');
    expect(screen.queryByTestId('src-option-ccb')).toBeNull();
  });

  test('the search box filters by label and by hint', () => {
    renderThemed(
      <Select
        label="账户"
        value={null}
        onChange={() => undefined}
        options={options}
        searchable
        emptyLabel="没有匹配的账户"
        testID="src"
      />,
    );
    fireEvent.press(screen.getByTestId('src-trigger'));
    fireEvent.changeText(screen.getByTestId('src-search'), '信用');
    expect(screen.getByTestId('src-option-ccb')).toBeTruthy();
    expect(screen.queryByTestId('src-option-cmb')).toBeNull();

    fireEvent.changeText(screen.getByTestId('src-search'), '不存在');
    expect(screen.getByText('没有匹配的账户')).toBeTruthy();
  });

  test('the trigger shows the selected label and reports expansion', () => {
    renderThemed(
      <Select
        label="账户"
        value="cash"
        onChange={() => undefined}
        options={options}
        placeholder="选一个账户"
        testID="src"
      />,
    );
    const trigger = screen.getByTestId('src-trigger');
    expect(trigger).toHaveTextContent('现金');
    expect(trigger.props.accessibilityState).toMatchObject({ expanded: false });
    fireEvent.press(trigger);
    expect(screen.getByTestId('src-trigger').props.accessibilityState).toMatchObject({
      expanded: true,
    });
  });

  test('renderOption replaces the row body but keeps the row pressable', () => {
    const onChange = jest.fn();
    renderThemed(
      <Select
        label="账户"
        value={null}
        onChange={onChange}
        options={options}
        renderOption={(option, selected) => (
          <Text testID={`custom-${option.value}`}>
            {`${option.label}${selected ? ' ✓' : ''} · 余额`}
          </Text>
        )}
        testID="src"
      />,
    );
    fireEvent.press(screen.getByTestId('src-trigger'));
    expect(screen.getByTestId('custom-cash')).toHaveTextContent('现金 · 余额');
    fireEvent.press(screen.getByTestId('src-option-cash'));
    expect(onChange).toHaveBeenCalledWith('cash');
  });

  describe('wide layout', () => {
    beforeEach(() => {
      mockWideViewport = true;
    });
    afterEach(() => {
      mockWideViewport = false;
    });

    test('the overlay is an inline panel, and a click outside closes it', () => {
      renderThemed(
        <Select
          label="账户"
          value={null}
          onChange={() => undefined}
          options={options}
          closeLabel="关闭"
          testID="src"
        />,
      );
      expect(screen.queryByTestId('src-sheet')).toBeNull();
      fireEvent.press(screen.getByTestId('src-trigger'));
      expect(screen.getByTestId('src-panel')).toBeTruthy();

      fireEvent.press(screen.getByTestId('src-backdrop'));
      expect(screen.queryByTestId('src-panel')).toBeNull();
      expect(screen.queryByTestId('src-option-cash')).toBeNull();
    });
  });

  test('multiple mode toggles values and keeps the overlay open', () => {
    const onChange = jest.fn();
    renderThemed(
      <Select
        multiple
        label="分类"
        values={['cmb']}
        onChange={onChange}
        options={options}
        selectedLabel={(n) => `已选 ${n} 项`}
        testID="cat"
      />,
    );
    expect(screen.getByTestId('cat-trigger')).toHaveTextContent('已选 1 项');
    fireEvent.press(screen.getByTestId('cat-trigger'));
    fireEvent.press(screen.getByTestId('cat-option-cash'));
    expect(onChange).toHaveBeenCalledWith(['cmb', 'cash']);
    expect(screen.getByTestId('cat-option-cash')).toBeTruthy();
    fireEvent.press(screen.getByTestId('cat-option-cmb'));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });
});

describe('smaller pieces', () => {
  test('the checkbox reports a checkbox role and toggles', () => {
    const onChange = jest.fn();
    renderThemed(<Checkbox checked={false} onChange={onChange} label="跳过这一行" testID="cb" />);
    expect(screen.getByTestId('cb').props.accessibilityRole).toBe('checkbox');
    fireEvent.press(screen.getByTestId('cb'));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  test('the progress bar clamps and reports its value', () => {
    renderThemed(<ProgressBar value={1.7} accessibilityLabel="上传进度" testID="p" />);
    expect(screen.getByTestId('p').props.accessibilityValue).toMatchObject({ now: 100 });
    expect(styleOf(screen.getByTestId('p-fill')).width).toBe('100%');
  });

  test('a stat tile renders its big number in mono', () => {
    renderThemed(<StatTile label="净资产" value="34,627.10" sub="CNY" testID="tile" />);
    expect(styleOf(screen.getByText('34,627.10')).fontFamily).toContain('IBMPlexMono');
  });

  test('an empty state wires both actions', () => {
    const primary = jest.fn();
    const secondary = jest.fn();
    renderThemed(
      <EmptyState
        icon="list"
        title="还没有交易"
        body="记下第一笔，这里就会有内容。"
        primaryAction={{ label: '记一笔', onPress: primary }}
        secondaryAction={{ label: '导入 CSV', onPress: secondary }}
        testID="empty"
      />,
    );
    expect(screen.getByText('还没有交易')).toBeTruthy();
    fireEvent.press(screen.getByTestId('empty-primary'));
    fireEvent.press(screen.getByTestId('empty-secondary'));
    expect(primary).toHaveBeenCalledTimes(1);
    expect(secondary).toHaveBeenCalledTimes(1);
  });

  test('a card rounds to the container radius and a page caps the reading width', () => {
    renderThemed(
      <>
        <Card variant="outlined" testID="card" />
        <Page testID="page">
          <Text>页面</Text>
        </Page>
        <Page wide testID="wide-page" />
      </>,
    );
    expect(styleOf(screen.getByTestId('card')).borderRadius).toBe(radius.lg);
    const content = StyleSheet.flatten(
      screen.getByTestId('page').props.contentContainerStyle as never,
    ) as unknown as Record<string, unknown>;
    expect(content.maxWidth).toBe(PAGE_MAX_WIDTH);
    const wideContent = StyleSheet.flatten(
      screen.getByTestId('wide-page').props.contentContainerStyle as never,
    ) as unknown as Record<string, unknown>;
    expect(wideContent.maxWidth).toBeUndefined();
    expect(screen.getByText('页面')).toBeTruthy();
  });

  test('the three skeleton shapes render', () => {
    renderThemed(
      <>
        <Skeleton variant="row" testID="sk-row" />
        <Skeleton variant="card" testID="sk-card" />
        <Skeleton variant="table" rows={4} testID="sk-table" />
      </>,
    );
    for (const id of ['sk-row', 'sk-card', 'sk-table']) {
      expect(screen.getByTestId(id)).toBeTruthy();
    }
  });

  test('the kind and account-type icon maps are complete', () => {
    expect(Object.keys(KIND_ICON).sort()).toEqual(
      ['expense', 'income', 'refund', 'transfer'].sort(),
    );
    expect(Object.keys(SOURCE_TYPE_ICON).sort()).toEqual(
      ['cash', 'checking', 'credit', 'other'].sort(),
    );
    expect(KIND_ICON.transfer).toBe('arrow-left-right');
    expect(SOURCE_TYPE_ICON.credit).toBe('credit-card');
  });
});
