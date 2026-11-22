/**
 * Language-pack consistency tests (04 §8.1, §3.7):
 *  1. `errors` is a bidirectional match with the backend registry (03 §4.2) plus the
 *     two local-only keys, in both languages.
 *  2. The other nine namespaces have identical key sets between `zh` and `en`, no
 *     empty strings, matching interpolation variables, and paired plural suffixes.
 */
import i18next, { type TFunction } from 'i18next';
import { BACKEND_ERROR_CODES, LOCAL_ERROR_CODES, errorMessage } from '../errorCodes';
import { namespaces, resources } from '../resources';

type JsonObject = { [key: string]: string | JsonObject };

function flatten(obj: JsonObject, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') {
      out[key] = v;
    } else if (v && typeof v === 'object') {
      Object.assign(out, flatten(v as JsonObject, key));
    }
  }
  return out;
}

/** Strips a trailing `_one`/`_other` plural suffix so `foo_one` and `foo_other`
 *  normalize to the same base key `foo` for the cross-language key-set comparison —
 *  zh only ever defines `_other` (04 §5.2), en may define both. */
function pluralBase(key: string): string {
  if (key.endsWith('_one')) return key.slice(0, -'_one'.length);
  if (key.endsWith('_other')) return key.slice(0, -'_other'.length);
  return key;
}

function normalizedKeySet(flat: Record<string, string>): Set<string> {
  return new Set(Object.keys(flat).map(pluralBase));
}

function interpVars(s: string): string[] {
  const matches = [...s.matchAll(/{{\s*([a-zA-Z0-9_]+)\s*}}/g)].map((m) => m[1]);
  return Array.from(new Set(matches)).sort();
}

describe('errors.json <-> backend error-code registry (03 §4.2, 04 §3.7)', () => {
  const expected = new Set<string>([...BACKEND_ERROR_CODES, ...LOCAL_ERROR_CODES]);

  test('registry has exactly 45 backend codes and 2 local codes (47 total)', () => {
    expect(BACKEND_ERROR_CODES.length).toBe(45);
    expect(LOCAL_ERROR_CODES.length).toBe(2);
    expect(expected.size).toBe(47);
  });

  for (const lang of ['zh', 'en'] as const) {
    test(`${lang}/errors.json has exactly the 47 registry keys, no more, no less`, () => {
      const keys = new Set(Object.keys(resources[lang].errors));
      const missing = [...expected].filter((k) => !keys.has(k));
      const extra = [...keys].filter((k) => !expected.has(k));
      expect({ missing, extra }).toEqual({ missing: [], extra: [] });
      expect(keys.size).toBe(47);
    });

    test(`${lang}/errors.json has no empty strings`, () => {
      for (const [k, v] of Object.entries(resources[lang].errors)) {
        expect((v as string).trim().length).toBeGreaterThan(0);
      }
    });
  }

  test('unknown interpolates {{detail}} in both languages', () => {
    expect(resources.zh.errors.unknown).toMatch('{{detail}}');
    expect(resources.en.errors.unknown).toMatch('{{detail}}');
  });
});

const OTHER_NAMESPACES = namespaces.filter((ns) => ns !== 'errors');

describe('the other nine namespaces: zh/en parity', () => {
  test('exactly nine non-error namespaces are registered', () => {
    expect(OTHER_NAMESPACES.length).toBe(9);
  });

  for (const ns of OTHER_NAMESPACES) {
    describe(`namespace "${ns}"`, () => {
      const zhFlat = flatten(resources.zh[ns] as JsonObject);
      const enFlat = flatten(resources.en[ns] as JsonObject);

      test('zh and en have the same key set (plural suffixes normalized)', () => {
        const zhKeys = normalizedKeySet(zhFlat);
        const enKeys = normalizedKeySet(enFlat);
        const missingInEn = [...zhKeys].filter((k) => !enKeys.has(k));
        const missingInZh = [...enKeys].filter((k) => !zhKeys.has(k));
        expect({ missingInEn, missingInZh }).toEqual({ missingInEn: [], missingInZh: [] });
      });

      test('no empty strings', () => {
        const emptyZh = Object.entries(zhFlat).filter(([, v]) => v.trim().length === 0);
        const emptyEn = Object.entries(enFlat).filter(([, v]) => v.trim().length === 0);
        expect({ emptyZh, emptyEn }).toEqual({ emptyZh: [], emptyEn: [] });
      });

      test('interpolation variables match for every key shared verbatim', () => {
        for (const key of Object.keys(zhFlat)) {
          if (key in enFlat) {
            expect(interpVars(enFlat[key])).toEqual(interpVars(zhFlat[key]));
          }
        }
      });

      test('zh never defines a `_one` suffix (only `_other`, 04 §5.2)', () => {
        const oneKeys = Object.keys(zhFlat).filter((k) => k.endsWith('_one'));
        expect(oneKeys).toEqual([]);
      });

      test('every en `_one` key has a paired `_other` key', () => {
        const keys = new Set(Object.keys(enFlat));
        const unpaired = [...keys]
          .filter((k) => k.endsWith('_one'))
          .map((k) => k.slice(0, -'_one'.length) + '_other')
          .filter((other) => !keys.has(other));
        expect(unpaired).toEqual([]);
      });
    });
  }
});

describe('errorMessage() (04 §3.7)', () => {
  let t: TFunction;

  beforeAll(async () => {
    const instance = i18next.createInstance();
    await instance.init({
      lng: 'zh',
      fallbackLng: 'zh',
      ns: ['errors'],
      defaultNS: 'errors',
      resources: { zh: { errors: resources.zh.errors }, en: { errors: resources.en.errors } },
      interpolation: { escapeValue: false },
    });
    t = instance.t as unknown as TFunction;
  });

  test('a known backend code resolves to its own copy', () => {
    expect(errorMessage(t, { code: 'invalid_credentials', detail: 'ignored' })).toBe(
      resources.zh.errors.invalid_credentials,
    );
  });

  test('an unknown code falls back to errors.unknown with detail interpolated', () => {
    const msg = errorMessage(t, { code: 'totally_made_up_code', detail: 'boom' });
    expect(msg).toBe(resources.zh.errors.unknown.replace('{{detail}}', 'boom'));
  });

  test('non-ApiClientError values never throw and fall back to unknown', () => {
    expect(() => errorMessage(t, new Error('oops'))).not.toThrow();
    expect(errorMessage(t, new Error('oops'))).toContain('oops');
    expect(() => errorMessage(t, 'plain string reason')).not.toThrow();
    expect(() => errorMessage(t, null)).not.toThrow();
    expect(() => errorMessage(t, undefined)).not.toThrow();
    expect(() => errorMessage(t, { foo: 'bar' })).not.toThrow();
  });
});
