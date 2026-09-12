/**
 * Entry-form controls (04 §4.6, §6.4; decision §14.52 A19): the calculator and quick-add
 * chips on `AmountField`, the read-only sign, the native `DateField` fallback, the month
 * switcher's ceiling, and the rule that a transfer amount is never painted (§6.2 rule 2).
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import type { IsoDate, TxKind } from '@/api/types';
import { namespaces, resources } from '@/i18n/resources';
import { ThemeProvider } from '@/theme/ThemeProvider';
import { lightColors } from '@/theme/tokens';
import { AmountField, trimMoney } from '@/ui/AmountField';
import { DateField, dateFieldErrorKey } from '@/ui/DateField';
import { MoneyText } from '@/ui/MoneyText';
import { MonthSwitcher } from '@/ui/MonthSwitcher';

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

function renderThemed(node: React.ReactElement) {
  return render(<ThemeProvider initialPref="light">{node}</ThemeProvider>);
}

function styleOf(element: { props: { style?: unknown } }): Record<string, unknown> {
  return StyleSheet.flatten(element.props.style as never) as unknown as Record<string, unknown>;
}

/** The field is controlled, so the tests drive it the way a form does. */
function AmountHarness({
  initial,
  onChange,
  kind,
  quickAdd = false,
  allowExpression = false,
}: {
  initial: string;
  onChange: (next: string) => void;
  kind?: TxKind;
  quickAdd?: boolean;
  allowExpression?: boolean;
}) {
  const [value, setValue] = React.useState(initial);
  return (
    <AmountField
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
      currency="CNY"
      kind={kind}
      quickAdd={quickAdd}
      allowExpression={allowExpression}
      testID="amt"
    />
  );
}

describe('AmountField', () => {
  test('an expression is evaluated on blur and kept in a dismissible tag', () => {
    const onChange = jest.fn();
    renderThemed(<AmountHarness initial="12.5+8.8*2" onChange={onChange} allowExpression />);

    fireEvent(screen.getByTestId('amt'), 'blur');
    expect(onChange).toHaveBeenCalledWith('30.1');
    expect(screen.getByTestId('amt-expression')).toHaveTextContent(/12\.5\+8\.8\*2/);

    fireEvent.press(screen.getByTestId('amt-expression-remove'));
    expect(screen.queryByTestId('amt-expression')).toBeNull();
  });

  test('an ordinary number is left alone on blur', () => {
    const onChange = jest.fn();
    renderThemed(<AmountHarness initial="38" onChange={onChange} allowExpression />);
    fireEvent(screen.getByTestId('amt'), 'blur');
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByTestId('amt-expression')).toBeNull();
  });

  test('quick add and ×2 work on the current value without touching floats', () => {
    const onChange = jest.fn();
    renderThemed(<AmountHarness initial="38" onChange={onChange} quickAdd />);

    fireEvent.press(screen.getByTestId('amt-plus-10'));
    expect(onChange).toHaveBeenLastCalledWith('48');
    fireEvent.press(screen.getByTestId('amt-plus-100'));
    expect(onChange).toHaveBeenLastCalledWith('148');
    fireEvent.press(screen.getByTestId('amt-double'));
    expect(onChange).toHaveBeenLastCalledWith('296');
  });

  test('quick add evaluates an expression in the box before adding to it', () => {
    const onChange = jest.fn();
    renderThemed(
      <AmountHarness initial="12.5+8.8" onChange={onChange} quickAdd allowExpression />,
    );
    fireEvent.press(screen.getByTestId('amt-plus-10'));
    expect(onChange).toHaveBeenLastCalledWith('31.3');

    fireEvent.press(screen.getByTestId('amt-double'));
    expect(onChange).toHaveBeenLastCalledWith('62.6');
  });

  test('quick add leaves a box that cannot be evaluated untouched', () => {
    const onChange = jest.fn();
    renderThemed(<AmountHarness initial="12+" onChange={onChange} quickAdd allowExpression />);
    fireEvent.press(screen.getByTestId('amt-plus-10'));
    fireEvent.press(screen.getByTestId('amt-double'));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId('amt').props.value).toBe('12+');
  });

  test('quick add starts from zero when the box is empty', () => {
    const onChange = jest.fn();
    renderThemed(<AmountHarness initial="" onChange={onChange} quickAdd />);
    fireEvent.press(screen.getByTestId('amt-plus-50'));
    expect(onChange).toHaveBeenLastCalledWith('50');
  });

  test('the sign is read-only and decided by the kind', () => {
    const { unmount } = renderThemed(
      <AmountHarness initial="38" onChange={() => undefined} kind="expense" />,
    );
    expect(screen.getByTestId('amt-sign')).toHaveTextContent('−');
    unmount();

    const income = renderThemed(
      <AmountHarness initial="38" onChange={() => undefined} kind="income" />,
    );
    expect(screen.getByTestId('amt-sign')).toHaveTextContent('+');
    income.unmount();

    // A transfer shows no sign at all — the two legs get theirs from the server.
    renderThemed(<AmountHarness initial="38" onChange={() => undefined} kind="transfer" />);
    expect(screen.queryByTestId('amt-sign')).toBeNull();
  });

  test('thousands separators appear only once the field is at rest', () => {
    renderThemed(<AmountHarness initial="12480.35" onChange={() => undefined} />);
    expect(screen.getByTestId('amt').props.value).toBe('12,480.35');
    fireEvent(screen.getByTestId('amt'), 'focus');
    expect(screen.getByTestId('amt').props.value).toBe('12480.35');
  });

  test('trimMoney drops the wire format\'s trailing zeros', () => {
    expect(trimMoney('48.0000')).toBe('48');
    expect(trimMoney('30.1000')).toBe('30.1');
    expect(trimMoney('0.1234')).toBe('0.1234');
  });
});

function DateHarness({ initial, max, min }: { initial: IsoDate; max?: IsoDate; min?: IsoDate }) {
  const [value, setValue] = React.useState(initial);
  return <DateField value={value} onChange={setValue} max={max} min={min} testID="date" />;
}

describe('DateField', () => {
  test('on native it is a text box that rejects a day past `max`', () => {
    renderThemed(<DateHarness initial="2026-08-14" max="2026-09-11" />);
    const input = screen.getByTestId('date');
    expect(input.props.value).toBe('2026-08-14');

    fireEvent.changeText(input, '2026-09-20');
    expect(screen.getByTestId('date').props.value).toBe('2026-09-20');
    expect(screen.getByText('日期不能晚于明天')).toBeTruthy();

    fireEvent.changeText(screen.getByTestId('date'), '2026-09-01');
    expect(screen.queryByText('日期不能晚于明天')).toBeNull();
  });

  test('a malformed day is reported too, and not as "required"', () => {
    renderThemed(<DateHarness initial="2026-08-14" />);
    fireEvent.changeText(screen.getByTestId('date'), '2026-02-31');
    expect(screen.getByText('日期格式不对')).toBeTruthy();
    expect(screen.queryByText('这是必填项')).toBeNull();
  });

  test('a day before `min` never borrows the "not later than tomorrow" wording', () => {
    renderThemed(<DateHarness initial="2026-08-14" min="2026-08-01" max="2026-09-11" />);
    fireEvent.changeText(screen.getByTestId('date'), '2026-07-20');
    expect(screen.queryByText('日期不能晚于明天')).toBeNull();
    expect(screen.getByText('日期太早了')).toBeTruthy();
  });

  test('the range check itself is pure', () => {
    expect(dateFieldErrorKey('2026-08-14', '2026-09-11')).toBeNull();
    expect(dateFieldErrorKey('2026-09-12', '2026-09-11')).toEqual(['validation:date_not_future']);
    expect(dateFieldErrorKey('', '2026-09-11')).toBeNull();
    expect(dateFieldErrorKey('14/08/2026')).toEqual(['validation:date_invalid']);
    // `min` gets its own key: "太早" and "不能晚于明天" are opposite complaints.
    expect(dateFieldErrorKey('2026-07-20', '2026-09-11', '2026-08-01')).toEqual([
      'validation:date_too_early',
    ]);
  });
});

describe('MonthSwitcher', () => {
  test('it steps back a month and never past the ceiling', () => {
    const onChange = jest.fn();
    renderThemed(
      <MonthSwitcher value="2026-08" max="2026-09" onChange={onChange} lang="zh" testID="ms" />,
    );
    expect(screen.getByTestId('ms-label')).toHaveTextContent('2026 年 8 月');

    fireEvent.press(screen.getByTestId('ms-prev'));
    expect(onChange).toHaveBeenCalledWith('2026-07');

    fireEvent.press(screen.getByTestId('ms-next'));
    expect(onChange).toHaveBeenLastCalledWith('2026-09');
  });

  test('the next arrow is disabled on the ceiling month', () => {
    const onChange = jest.fn();
    renderThemed(
      <MonthSwitcher value="2026-09" max="2026-09" onChange={onChange} lang="zh" testID="ms" />,
    );
    const next = screen.getByTestId('ms-next');
    expect(next.props.accessibilityState).toMatchObject({ disabled: true });
    fireEvent.press(next);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('MoneyText', () => {
  test('a transfer amount stays fg.primary while an expense is painted', () => {
    const { unmount } = renderThemed(
      <MoneyText amount="-1000.0000" currency="CNY" kind="transfer" lang="zh" testID="m" />,
    );
    expect(styleOf(screen.getByTestId('m')).color).toBe(lightColors['fg.primary']);
    unmount();

    renderThemed(
      <MoneyText amount="-38.0000" currency="CNY" kind="expense" lang="zh" testID="m" />,
    );
    const expense = screen.getByTestId('m');
    expect(styleOf(expense).color).toBe(lightColors['kind.expense']);
    expect(expense).toHaveTextContent('−¥38.00');
  });

  test('a missing rate says so instead of reading as zero', () => {
    const { unmount } = renderThemed(
      <MoneyText
        amount="-140.0000"
        currency="USD"
        base={{ amount_base: null, base_currency: 'CNY' }}
        lang="zh"
        testID="m"
      />,
    );
    expect(screen.getByTestId('m-base')).toHaveTextContent('暂无汇率');
    unmount();

    renderThemed(
      <MoneyText
        amount="-140.0000"
        currency="USD"
        base={{ amount_base: '-1003.72', base_currency: 'CNY' }}
        lang="zh"
        testID="m"
      />,
    );
    expect(screen.getByTestId('m-base')).toHaveTextContent(/1,003\.72/);
  });

  test('no second line when the row is already in the base currency', () => {
    renderThemed(
      <MoneyText
        amount="-38.0000"
        currency="CNY"
        base={{ amount_base: '-38.0000', base_currency: 'CNY' }}
        lang="zh"
        testID="m"
      />,
    );
    expect(screen.queryByTestId('m-base')).toBeNull();
  });
});
