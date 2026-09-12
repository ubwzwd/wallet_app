/**
 * Query-parameter normalisation (04 §3.5), the mirror image of the URL rules in §1.3.
 *
 * One filter state must have exactly one serialisation, so that it can be used as
 * part of a TanStack Query key and as a shareable URL at the same time.
 */

type ParamValue = string | number | boolean | null | undefined | Array<string | number>;

function compare(a: unknown, b: unknown): number {
  const sa = String(a);
  const sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

function isEmptyScalar(v: unknown): boolean {
  return v === undefined || v === null || v === '';
}

/**
 * Drop `undefined` / `null` / `''` / empty arrays, de-duplicate and sort array
 * values, and emit the keys in lexicographic order. Stable: the same filter state
 * produces a deeply equal object no matter how the caller ordered its keys.
 */
export function normalizeParams<T extends object>(p: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(p).sort()) {
    const value = (p as Record<string, unknown>)[key];
    if (Array.isArray(value)) {
      const cleaned = Array.from(new Set(value.filter((v) => !isEmptyScalar(v)))).sort(compare);
      if (cleaned.length === 0) continue;
      out[key] = cleaned;
      continue;
    }
    if (isEmptyScalar(value)) continue;
    out[key] = value;
  }
  return out as Partial<T>;
}

/**
 * Serialise params the way FastAPI's `Query(list)` expects: repeated keys for
 * arrays (`kind=expense&kind=refund`), never a comma-joined string.
 */
export function toSearchParams(p: object | undefined | null): URLSearchParams {
  const search = new URLSearchParams();
  if (!p) return search;
  const normalized = normalizeParams(p) as Record<string, ParamValue>;
  for (const key of Object.keys(normalized)) {
    const value = normalized[key];
    if (Array.isArray(value)) {
      for (const item of value) search.append(key, String(item));
    } else if (typeof value === 'boolean') {
      search.append(key, value ? 'true' : 'false');
    } else if (value !== undefined && value !== null) {
      search.append(key, String(value));
    }
  }
  return search;
}

/** axios `paramsSerializer` built on the two functions above. */
export function serializeParams(p: object | undefined | null): string {
  return toSearchParams(p).toString();
}
