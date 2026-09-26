/**
 * Shared shape of the `modules.test.ts` case tables (04 §3.4).
 */
export type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

export interface Case {
  name: string;
  method: Method;
  path: string;
  /** Expected serialised query string, without the leading `?`. */
  query?: string;
  /** Expected JSON request body; omit when the request must carry none. */
  body?: unknown;
  status?: number;
  reply?: unknown;
  call: () => Promise<unknown>;
  expected?: unknown;
}

/** A list envelope around a single item (list functions never unwrap it). */
export const paged = <T,>(item: T) => ({ items: [item], total: 1 });

export const PAIR_ID = 'c0ffee00-5555-4666-8777-888899990000';
export const BATCH_ID = 'd1e2f3a4-5566-4778-899a-bbccddeeff00';
export const ROW_ID = 'e5f6a7b8-9999-4aaa-8bbb-ccccddddeeee';
export const NOW = '2026-09-01T12:00:00.000000Z';
