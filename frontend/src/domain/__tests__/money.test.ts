/**
 * 04 §8.1: money round-trip/rounding, thousands separators & full-width input, >4-decimal
 * rejection. Also covers the two rows that have no dedicated test file of their own:
 * kind → amount sign (kinds.ts) and the credit opening-balance sign flip (sources.ts).
 */
import {
  absMoney,
  addMoney,
  cmpMoney,
  decimalPlaces,
  formatMoney4,
  isPositiveMoney,
  isZeroMoney,
  negMoney,
  normalizeAmountInput,
  parseMoney,
  subMoney,
  sumMoney,
} from '../money';
import { applySign, isKindChangeAllowed, kindOfCategoryTree, KINDS, signForKind } from '../kinds';
import {
  convertOpeningBalanceOnTypeChange,
  openingBalanceForDisplay,
  openingBalanceForSubmit,
} from '../sources';

describe('parseMoney / formatMoney4 round-trip', () => {
  test.each([
    ['-38', '-38.0000'],
    ['38.5', '38.5000'],
    ['−38.00', '-38.0000'], // U+2212 minus sign
    [' 1,299.00 ', '1299.0000'], // thousands separator + surrounding whitespace
    ['0', '0.0000'],
    ['-0.0001', '-0.0001'],
  ])('parseMoney(%j) formats back to %j', (input, expected) => {
    expect(formatMoney4(parseMoney(input))).toBe(expected);
  });

  test('rejects more than 4 decimal places', () => {
    expect(() => parseMoney('1.23456')).toThrow();
  });

  test('rejects non-numeric input', () => {
    expect(() => parseMoney('abc')).toThrow();
    expect(() => parseMoney('')).toThrow();
  });
});

describe('normalizeAmountInput', () => {
  test.each([
    ['1,299.00', '1299.0000'],
    ['12．5', '12.5000'], // full-width decimal point (U+FF0E)
    ['  38  ', '38.0000'],
    ['-3204', '-3204.0000'],
  ])('normalizeAmountInput(%j) -> %j', (input, expected) => {
    expect(normalizeAmountInput(input)).toBe(expected);
  });

  test('rejects more than 4 decimal places', () => {
    expect(normalizeAmountInput('1.23456')).toBeNull();
  });

  test('rejects garbage', () => {
    expect(normalizeAmountInput('abc')).toBeNull();
    expect(normalizeAmountInput('')).toBeNull();
    expect(normalizeAmountInput('12.3.4')).toBeNull();
  });
});

describe('arithmetic helpers stay on bigint, never float', () => {
  test('addMoney sums without float drift', () => {
    // 0.1 + 0.2 famously !== 0.3 in IEEE floats; decimal-string math must get this exactly right.
    expect(addMoney('0.1', '0.2')).toBe('0.3000');
    expect(addMoney('10.10', '20.20', '30.30')).toBe('60.6000');
  });

  test('subMoney / negMoney / absMoney', () => {
    expect(subMoney('10.00', '3.50')).toBe('6.5000');
    expect(negMoney('38.0000')).toBe('-38.0000');
    expect(negMoney('-38.0000')).toBe('38.0000');
    expect(absMoney('-38.0000')).toBe('38.0000');
    expect(absMoney('38.0000')).toBe('38.0000');
  });

  test('cmpMoney / isZeroMoney / isPositiveMoney', () => {
    expect(cmpMoney('1.00', '2.00')).toBe(-1);
    expect(cmpMoney('2.00', '1.00')).toBe(1);
    expect(cmpMoney('2.00', '2.00')).toBe(0);
    expect(isZeroMoney('0.0000')).toBe(true);
    expect(isZeroMoney('0.0001')).toBe(false);
    expect(isPositiveMoney('0.0001')).toBe(true);
    expect(isPositiveMoney('-0.0001')).toBe(false);
  });

  test('sumMoney sums a picked field', () => {
    const rows = [{ amount: '10.00' }, { amount: '-3.50' }, { amount: '0.75' }];
    expect(sumMoney(rows, (r) => r.amount)).toBe('7.2500');
  });
});

describe('decimalPlaces', () => {
  test.each([
    ['12', 0],
    ['12.5', 1],
    ['12.345', 3],
  ])('decimalPlaces(%j) === %d', (input, expected) => {
    expect(decimalPlaces(input)).toBe(expected);
  });
});

describe('kind -> amount sign (04 §1, decision §1)', () => {
  test('KINDS lists all four', () => {
    expect(KINDS).toEqual(['expense', 'income', 'refund', 'transfer']);
  });

  test('expense is negative, income/refund positive', () => {
    expect(signForKind('expense')).toBe(-1);
    expect(signForKind('income')).toBe(1);
    expect(signForKind('refund')).toBe(1);
  });

  test('transfer sign depends on role: out negative, in positive', () => {
    expect(signForKind('transfer', 'out')).toBe(-1);
    expect(signForKind('transfer', 'in')).toBe(1);
  });

  test('applySign forces the magnitude to the right sign regardless of input sign', () => {
    expect(applySign('38.00', 'expense')).toBe('-38.0000');
    expect(applySign('-38.00', 'expense')).toBe('-38.0000');
    expect(applySign('38.00', 'income')).toBe('38.0000');
    expect(applySign('1000.00', 'transfer', 'out')).toBe('-1000.0000');
    expect(applySign('1000.00', 'transfer', 'in')).toBe('1000.0000');
  });

  test('kindOfCategoryTree: expense/refund -> expense tree, income -> income tree, transfer -> null', () => {
    expect(kindOfCategoryTree('expense')).toBe('expense');
    expect(kindOfCategoryTree('refund')).toBe('expense');
    expect(kindOfCategoryTree('income')).toBe('income');
    expect(kindOfCategoryTree('transfer')).toBeNull();
  });

  test('isKindChangeAllowed: transfer <-> non-transfer forbidden, others free (decision §14.3)', () => {
    expect(isKindChangeAllowed('expense', 'income')).toBe(true);
    expect(isKindChangeAllowed('income', 'refund')).toBe(true);
    expect(isKindChangeAllowed('refund', 'expense')).toBe(true);
    expect(isKindChangeAllowed('expense', 'transfer')).toBe(false);
    expect(isKindChangeAllowed('transfer', 'expense')).toBe(false);
    expect(isKindChangeAllowed('transfer', 'transfer')).toBe(true);
  });
});

describe('credit opening balance sign (04 §4.9, decision §14.52 A13)', () => {
  test('credit: user types owed amount as positive, it stores negative', () => {
    expect(openingBalanceForSubmit('3204', 'credit')).toBe('-3204.0000');
    expect(openingBalanceForSubmit('3204.5', 'credit')).toBe('-3204.5000');
  });

  test('non-credit types store what the user typed', () => {
    expect(openingBalanceForSubmit('3204', 'checking')).toBe('3204.0000');
    expect(openingBalanceForSubmit('-50', 'cash')).toBe('-50.0000');
  });

  test('invalid input returns null', () => {
    expect(openingBalanceForSubmit('abc', 'credit')).toBeNull();
  });

  test('display is the inverse of submit for credit', () => {
    expect(openingBalanceForDisplay('-3204.0000', 'credit')).toBe('3204.0000');
    expect(openingBalanceForDisplay('3204.0000', 'checking')).toBe('3204.0000');
  });

  test('switching type flips the sign only when crossing the credit boundary', () => {
    expect(convertOpeningBalanceOnTypeChange('-3204.0000', 'credit', 'checking')).toBe(
      '3204.0000'
    );
    expect(convertOpeningBalanceOnTypeChange('3204.0000', 'checking', 'credit')).toBe(
      '-3204.0000'
    );
    expect(convertOpeningBalanceOnTypeChange('100.0000', 'checking', 'cash')).toBe('100.0000');
  });
});
