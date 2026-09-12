/** 04 §8.1: calculator — precedence, parentheses, division by zero -> null, thousands separator. */
import { evaluateExpression, isExpression } from '../calc';

describe('evaluateExpression', () => {
  test('respects operator precedence: 12.5+8.8*2 = 30.1000', () => {
    expect(evaluateExpression('12.5+8.8*2')).toBe('30.1000');
  });

  test('parentheses override precedence', () => {
    expect(evaluateExpression('(12.5+8.8)*2')).toBe('42.6000');
  });

  test('division by zero returns null', () => {
    expect(evaluateExpression('5/0')).toBeNull();
    expect(evaluateExpression('5÷0')).toBeNull();
  });

  test('thousands separator is accepted: 1,000×2', () => {
    expect(evaluateExpression('1,000×2')).toBe('2000.0000');
  });

  test('accepts alternate operator glyphs (÷ * x)', () => {
    expect(evaluateExpression('10÷4')).toBe('2.5000');
    expect(evaluateExpression('3*4')).toBe('12.0000');
    expect(evaluateExpression('3x4')).toBe('12.0000');
  });

  test('unary minus and nested parens', () => {
    expect(evaluateExpression('-(2+3)*2')).toBe('-10.0000');
  });

  test('a plain amount with no operator still evaluates', () => {
    expect(evaluateExpression('38')).toBe('38.0000');
    expect(evaluateExpression('-38.5')).toBe('-38.5000');
  });

  test('malformed expressions return null', () => {
    expect(evaluateExpression('12+')).toBeNull();
    expect(evaluateExpression('(12+3')).toBeNull();
    expect(evaluateExpression('12+3)')).toBeNull();
    expect(evaluateExpression('12..3')).toBeNull();
    expect(evaluateExpression('abc')).toBeNull();
    expect(evaluateExpression('')).toBeNull();
    expect(evaluateExpression('   ')).toBeNull();
  });

  test('rounds the final result to 4 decimal places (round-half-up)', () => {
    expect(evaluateExpression('1/3')).toBe('0.3333');
    expect(evaluateExpression('2/3')).toBe('0.6667');
  });
});

describe('isExpression', () => {
  test('a bare (possibly negative) number is not an expression', () => {
    expect(isExpression('38')).toBe(false);
    expect(isExpression('-38.5')).toBe(false);
    expect(isExpression('  12.50  ')).toBe(false);
  });

  test('anything with an operator is an expression', () => {
    expect(isExpression('12.5+8.8*2')).toBe(true);
    expect(isExpression('(1+2)')).toBe(true);
    expect(isExpression('3x4')).toBe(true);
    expect(isExpression('10÷4')).toBe(true);
  });
});
