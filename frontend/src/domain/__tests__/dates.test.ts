/** 04 §4.6.5, §4.5: maxAllowedDate, range presets, month arithmetic across year boundaries. */
import {
  daysAgo,
  dateRangePreset,
  isAfterMonth,
  isValidIsoDate,
  maxAllowedDate,
  monthOf,
  monthRange,
  secondsUntil,
  shiftMonth,
} from '../dates';

describe('shiftMonth', () => {
  test('shifts within a year', () => {
    expect(shiftMonth('2026-08', -1)).toBe('2026-07');
    expect(shiftMonth('2026-08', 1)).toBe('2026-09');
  });

  test('wraps across a year boundary in either direction', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -13)).toBe('2024-12');
  });
});

describe('monthOf / isAfterMonth', () => {
  test('monthOf extracts YYYY-MM', () => {
    expect(monthOf('2026-08-14')).toBe('2026-08');
  });

  test('isAfterMonth compares chronologically, including across years', () => {
    expect(isAfterMonth('2026-08', '2026-07')).toBe(true);
    expect(isAfterMonth('2026-07', '2026-08')).toBe(false);
    expect(isAfterMonth('2027-01', '2026-12')).toBe(true);
  });
});

describe('maxAllowedDate', () => {
  test('is exactly one calendar day after today', () => {
    const today = new Date();
    const expected = new Date(today);
    expected.setDate(expected.getDate() + 1);
    const pad = (n: number) => n.toString().padStart(2, '0');
    const expectedIso = `${expected.getFullYear()}-${pad(expected.getMonth() + 1)}-${pad(expected.getDate())}`;
    expect(maxAllowedDate()).toBe(expectedIso);
  });
});

describe('isValidIsoDate', () => {
  test.each([
    ['2026-08-14', true],
    ['2026-02-29', false], // 2026 is not a leap year
    ['2024-02-29', true], // 2024 is a leap year
    ['2026-13-01', false],
    ['2026-08-32', false],
    ['not-a-date', false],
    ['2026-8-14', false], // must be zero-padded
  ])('isValidIsoDate(%j) === %s', (input, expected) => {
    expect(isValidIsoDate(input)).toBe(expected);
  });
});

describe('daysAgo', () => {
  test('subtracts calendar days from a fixed reference date', () => {
    const ref = new Date(2026, 7, 14); // 2026-08-14 local
    expect(daysAgo(0, ref)).toBe('2026-08-14');
    expect(daysAgo(14, ref)).toBe('2026-07-31');
    expect(daysAgo(90, ref)).toBe('2026-05-16');
  });
});

describe('monthRange', () => {
  test('first and last day of the month, including a leap February', () => {
    expect(monthRange('2026-08')).toEqual({ from: '2026-08-01', to: '2026-08-31' });
    expect(monthRange('2024-02')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
    expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });
});

describe('dateRangePreset', () => {
  const today = new Date(2026, 7, 14); // 2026-08-14 local

  test('this_month runs from the 1st to today', () => {
    expect(dateRangePreset('this_month', today)).toEqual({ from: '2026-08-01', to: '2026-08-14' });
  });

  test('last_month is the full previous calendar month', () => {
    expect(dateRangePreset('last_month', today)).toEqual({ from: '2026-07-01', to: '2026-07-31' });
  });

  test('last_3_months starts two months back and runs to today', () => {
    expect(dateRangePreset('last_3_months', today)).toEqual({ from: '2026-06-01', to: '2026-08-14' });
  });

  test('this_year starts January 1st and runs to today', () => {
    expect(dateRangePreset('this_year', today)).toEqual({ from: '2026-01-01', to: '2026-08-14' });
  });

  test('this_month at a year boundary', () => {
    const jan = new Date(2027, 0, 5);
    expect(dateRangePreset('last_month', jan)).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });
});

describe('secondsUntil', () => {
  test('counts down to a future instant', () => {
    const now = new Date('2026-09-12T10:00:00.000000Z');
    const target = '2026-09-12T10:10:00.000000Z'; // 10 minutes later (invite expiry, decision §14.29)
    expect(secondsUntil(target, now)).toBe(600);
  });

  test('clamps to 0 once the deadline has passed', () => {
    const now = new Date('2026-09-12T10:20:00.000000Z');
    const target = '2026-09-12T10:10:00.000000Z';
    expect(secondsUntil(target, now)).toBe(0);
  });
});
