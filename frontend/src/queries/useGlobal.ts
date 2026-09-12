/**
 * The four app-wide queries (04 §2.3, §3.5): `/config`, `/categories`, `/rates/currencies`
 * and `/import-format`. All of them are anonymous-readable and change rarely.
 */
import React from 'react';
import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';

import { categoriesApi } from '@/api/categories';
import { configApi } from '@/api/config';
import { importFormatApi } from '@/api/importFormat';
import { ratesApi } from '@/api/rates';
import type { AppConfig, CategoryTree, CurrencyList, ImportFormat } from '@/api/types';
import { buildCategoryIndex, type CategoryIndex } from '@/domain/categories';
import { PREF_NAMES, getJsonPref, getJsonPrefSync, setJsonPref } from '@/utils/prefs';

import { qk } from './keys';

const DAY_MS = 24 * 60 * 60 * 1000;

/** `GET /config` — read once on boot; the register page needs `registration_open`. */
export function useConfig(): UseQueryResult<AppConfig> {
  return useQuery({
    queryKey: qk.global.config(),
    queryFn: configApi.get,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}

export type CategoriesResult = UseQueryResult<CategoryTree> & {
  /** The tree, or `null` while nothing (neither cache nor network) has arrived. */
  tree: CategoryTree | null;
  /** Lookup tables derived from `tree`, memoised; `null` until the tree is known. */
  index: CategoryIndex | null;
};

/**
 * `GET /categories` (04 §2.3, decision §1.3): cached forever by `version`, mirrored into
 * the local `categories` preference so an offline start can still paint category names.
 * The persisted copy lights the UI up first (synchronously on web, one tick later on
 * native), then the background request replaces it whenever `version` differs.
 */
export function useCategories(): CategoriesResult {
  // Lazy initialiser: the synchronous preference is read exactly once per mount, not on
  // every render.
  const [syncCached] = React.useState<CategoryTree | null>(() =>
    getJsonPrefSync<CategoryTree>(PREF_NAMES.categories),
  );
  const [asyncCached, setAsyncCached] = React.useState<CategoryTree | null>(null);

  React.useEffect(() => {
    if (syncCached) return; // web already had it before the first paint
    let alive = true;
    void getJsonPref<CategoryTree>(PREF_NAMES.categories).then((v) => {
      if (alive && v) setAsyncCached(v);
    });
    return () => {
      alive = false;
    };
  }, [syncCached]);

  const query = useQuery({
    queryKey: qk.global.categories(),
    queryFn: categoriesApi.get,
    staleTime: Infinity,
    gcTime: Infinity,
    networkMode: 'offlineFirst',
    refetchOnWindowFocus: false,
    // The persisted copy seeds the cache so an offline start still has names; `updatedAt: 0`
    // marks it as never-fetched for the one-shot revalidation below (`staleTime: Infinity`
    // means staleness alone would never trigger it).
    initialData: syncCached ?? undefined,
    initialDataUpdatedAt: syncCached ? 0 : undefined,
    placeholderData: asyncCached ?? undefined,
  });

  // 04 §2.3: the seeded tree must still be checked against the server once, so a new
  // `version` replaces it. Exactly once per cache entry — `dataUpdatedAt` stops being 0
  // as soon as the request lands.
  const qc = useQueryClient();
  React.useEffect(() => {
    const state = qc.getQueryState<CategoryTree>(qk.global.categories());
    if (state?.data && state.dataUpdatedAt === 0 && state.fetchStatus === 'idle') {
      void qc.refetchQueries({ queryKey: qk.global.categories() });
    }
  }, [qc]);

  const persistedVersion = React.useRef<string | null>(syncCached?.version ?? null);
  const data = query.data;
  React.useEffect(() => {
    if (!data || query.isPlaceholderData) return;
    if (persistedVersion.current === data.version) return;
    persistedVersion.current = data.version;
    void setJsonPref(PREF_NAMES.categories, data);
  }, [data, query.isPlaceholderData]);

  const tree = data ?? null;
  const index = React.useMemo(() => (tree ? buildCategoryIndex(tree) : null), [tree]);

  return { ...query, tree, index };
}

export type CurrenciesResult = UseQueryResult<CurrencyList> & {
  /** Currency codes, sorted alphabetically. */
  codes: string[];
  /** Code → English name. */
  names: Record<string, string>;
};

/** `GET /rates/currencies` — the currency picker's source; barely ever changes. */
export function useCurrencies(): CurrenciesResult {
  const query = useQuery({
    queryKey: qk.global.currencies(),
    queryFn: ratesApi.currencies,
    staleTime: DAY_MS,
  });

  const names = query.data?.currencies;
  const codes = React.useMemo(() => (names ? Object.keys(names).sort() : []), [names]);

  return { ...query, codes, names: names ?? {} };
}

/** `GET /import-format` — the whole import guide page (decision §6). */
export function useImportFormat(): UseQueryResult<ImportFormat> {
  return useQuery({
    queryKey: qk.global.importFormat(),
    queryFn: importFormatApi.get,
    staleTime: Infinity,
    gcTime: Infinity,
    refetchOnWindowFocus: false,
  });
}
