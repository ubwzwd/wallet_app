/**
 * Inline calculator for the amount field (04 §4.6, decision §14.52 A19): `12.5+8.8*2`,
 * parentheses, `× ÷` as well as `* /` and a bare `x`/`X` for multiply. No `eval` — a small
 * recursive-descent parser over `bigint` scaled to 8 fractional digits internally (rounded
 * down to the 4-digit `Money` scale only in the final result), so nothing touches floats.
 */
import type { Money } from '@/api/types';
import { formatMoney4 } from './money';

const INNER_SCALE = 100000000n; // 8 fractional digits while evaluating
const MONEY_SCALE = 10000n; // 4 fractional digits in the result
const SCALE_RATIO = INNER_SCALE / MONEY_SCALE;

/** Round-half-up integer division that works for either sign of numerator/denominator. */
function roundDivBigInt(num: bigint, den: bigint): bigint {
  const negative = num < 0n !== den < 0n;
  const an = num < 0n ? -num : num;
  const ad = den < 0n ? -den : den;
  const q = an / ad;
  const r = an % ad;
  const rounded = r * 2n >= ad ? q + 1n : q;
  return negative ? -rounded : rounded;
}

function parseDecimalScaled(numStr: string): bigint {
  if (numStr === '' || numStr === '.') throw new Error('bad number literal');
  const [ip = '', fp = ''] = numStr.split('.');
  if (fp.length > 8) throw new Error('too precise');
  const intPart = ip === '' ? '0' : ip;
  return BigInt(intPart) * INNER_SCALE + BigInt(fp.padEnd(8, '0') || '0');
}

type Token =
  | { kind: 'num'; value: bigint }
  | { kind: 'op'; op: '+' | '-' | '*' | '/' }
  | { kind: 'lparen' }
  | { kind: 'rparen' };

function tokenize(src: string): Token[] | null {
  const s = src.replace(/[\s,，]/g, '');
  const tokens: Token[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '(') {
      tokens.push({ kind: 'lparen' });
      i++;
    } else if (c === ')') {
      tokens.push({ kind: 'rparen' });
      i++;
    } else if (c === '+') {
      tokens.push({ kind: 'op', op: '+' });
      i++;
    } else if (c === '-' || c === '−') {
      tokens.push({ kind: 'op', op: '-' });
      i++;
    } else if (c === '×' || c === '*' || c === 'x' || c === 'X') {
      tokens.push({ kind: 'op', op: '*' });
      i++;
    } else if (c === '÷' || c === '/') {
      tokens.push({ kind: 'op', op: '/' });
      i++;
    } else if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      const numStr = s.slice(i, j);
      if ((numStr.match(/\./g) ?? []).length > 1) return null;
      try {
        tokens.push({ kind: 'num', value: parseDecimalScaled(numStr) });
      } catch {
        return null;
      }
      i = j;
    } else {
      return null; // unrecognized character
    }
  }
  return tokens;
}

class ParseState {
  pos = 0;
  constructor(private tokens: Token[]) {}
  peek(): Token | undefined {
    return this.tokens[this.pos];
  }
  next(): Token | undefined {
    return this.tokens[this.pos++];
  }
  atEnd(): boolean {
    return this.pos >= this.tokens.length;
  }
}

function parseExpr(st: ParseState): bigint | null {
  let left = parseTerm(st);
  if (left === null) return null;
  for (;;) {
    const tok = st.peek();
    if (tok?.kind === 'op' && (tok.op === '+' || tok.op === '-')) {
      st.next();
      const right = parseTerm(st);
      if (right === null) return null;
      left = tok.op === '+' ? left + right : left - right;
    } else break;
  }
  return left;
}

function parseTerm(st: ParseState): bigint | null {
  let left = parseFactor(st);
  if (left === null) return null;
  for (;;) {
    const tok = st.peek();
    if (tok?.kind === 'op' && (tok.op === '*' || tok.op === '/')) {
      st.next();
      const right = parseFactor(st);
      if (right === null) return null;
      if (tok.op === '*') {
        left = roundDivBigInt(left * right, INNER_SCALE);
      } else {
        if (right === 0n) return null; // division by zero
        left = roundDivBigInt(left * INNER_SCALE, right);
      }
    } else break;
  }
  return left;
}

function parseFactor(st: ParseState): bigint | null {
  const tok = st.peek();
  if (!tok) return null;
  if (tok.kind === 'op' && tok.op === '-') {
    st.next();
    const v = parseFactor(st);
    return v === null ? null : -v;
  }
  if (tok.kind === 'op' && tok.op === '+') {
    st.next();
    return parseFactor(st);
  }
  if (tok.kind === 'lparen') {
    st.next();
    const v = parseExpr(st);
    if (v === null) return null;
    const close = st.peek();
    if (close?.kind !== 'rparen') return null;
    st.next();
    return v;
  }
  if (tok.kind === 'num') {
    st.next();
    return tok.value;
  }
  return null;
}

/** Evaluate an arithmetic expression to a 4-decimal `Money` string, or `null` if it's not a
 *  well-formed expression (unbalanced parens, division by zero, stray characters, ...). */
export function evaluateExpression(src: string): Money | null {
  if (typeof src !== 'string' || src.trim() === '') return null;
  const tokens = tokenize(src);
  if (!tokens || tokens.length === 0) return null;
  const st = new ParseState(tokens);
  const result = parseExpr(st);
  if (result === null || !st.atEnd()) return null;
  return formatMoney4(roundDivBigInt(result, SCALE_RATIO));
}

/** Whether `src` contains an operator (beyond a single leading sign) and should therefore be
 *  evaluated instead of parsed as a plain amount. */
export function isExpression(src: string): boolean {
  const body = src.trim().replace(/^[-−]/, '');
  return /[+\-−×÷*/xX]/.test(body);
}
