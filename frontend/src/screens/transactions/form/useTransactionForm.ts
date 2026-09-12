/**
 * The shared brain of "记一笔" and both edit screens (04 §4.6).
 *
 * It owns the `react-hook-form` instance, the three queries every tab needs (accounts,
 * categories, currencies), the per-device memory behind the entry aids (last account,
 * recent categories, recent merchants — 04 §4.6, decision §14.52 A19) and the two body
 * builders that turn the form into a `POST`/`PATCH` payload.
 *
 * Nothing here knows about the router: the create screen mirrors `kind` into the URL,
 * the edit screens prefill from their own query.
 */
import React from 'react';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import type {
  FinanceSource,
  IsoDateTime,
  Transaction,
  TransactionCreate,
  TransactionUpdate,
  TransferCreate,
  TransferPair,
  TransferUpdate,
  TxKind,
  Uuid,
} from '@/api/types';
import type { CategoryIndex } from '@/domain/categories';
import { kindOfCategoryTree } from '@/domain/kinds';
import { absMoney, cmpMoney, normalizeAmountInput } from '@/domain/money';
import { useLang, type Lang } from '@/i18n';
import { todayLocalIso } from '@/i18n/format';
import { useCategories, useCurrencies, useSources, type CurrenciesResult } from '@/queries';
import { PREF_NAMES, getJsonPref, setJsonPref, setPref, getPref } from '@/utils/prefs';

import {
  emptyTxFormValues,
  orNull,
  showsSecondLeg,
  signedAmount,
  txFormSchema,
  type TxFormValues,
} from './schemas';

/** One entry of the `recent_merchants:<ledgerId>` preference. */
export interface RecentMerchant {
  name: string;
  /** The level-1 category it was last used with, so suggestions can prefer a match. */
  l1: string | null;
}

/** How many merchants / categories the preferences keep. */
export const RECENT_MERCHANT_STORE = 24;
export const RECENT_MERCHANT_SHOWN = 8;
export const RECENT_CATEGORY_STORE = 6;

function dedupe(list: readonly string[]): string[] {
  return list.filter((v, i) => list.indexOf(v) === i);
}

/** Most-recent-first, the matching category's merchants pinned to the front (04 §4.6). */
export function suggestMerchants(
  recent: readonly RecentMerchant[],
  categoryL1: string | null,
  query: string,
): string[] {
  const q = query.trim().toLowerCase();
  const matches = recent.filter((m) => q === '' || m.name.toLowerCase().includes(q));
  const preferred = categoryL1 === null ? [] : matches.filter((m) => m.l1 === categoryL1);
  const rest = matches.filter((m) => !preferred.includes(m));
  return dedupe([...preferred, ...rest].map((m) => m.name)).slice(0, RECENT_MERCHANT_SHOWN);
}

export interface UseTransactionFormOptions {
  ledgerId: Uuid;
  mode: 'create' | 'edit';
  /** Values known before the form mounts (URL parameters, a copied transaction). */
  initial?: Partial<TxFormValues>;
  /** Edit mode: the archived account this entry already sits on stays selectable (04 §4.7). */
  allowArchivedId?: Uuid | null;
  /** Skip the "default to the last used account" pass — the edit screens prefill instead. */
  autoFillSource?: boolean;
}

export interface TxFormController {
  form: UseFormReturn<TxFormValues>;
  values: TxFormValues;
  kind: TxKind;
  /** Switch tab, keeping amount / date / account / note and clearing a stale category. */
  setKind(next: TxKind): void;
  /** Every account of the ledger, archived ones included (the picker filters). */
  sources: FinanceSource[];
  sourcesLoading: boolean;
  sourceById(id: string | null): FinanceSource | undefined;
  /** Pick the (only / outgoing) account and follow its currency. */
  selectSource(id: string | null): void;
  /** Pick the receiving account of a two-leg transfer and follow its currency. */
  selectToSource(id: string | null): void;
  index: CategoryIndex | null;
  currencies: CurrenciesResult;
  lang: Lang;
  recentCategories: string[];
  recentMerchants: RecentMerchant[];
  allowArchivedId: Uuid | null;
  mode: 'create' | 'edit';
  /**
   * The account came from the caller (`?source_id=`), not from the "last used" default —
   * so nothing may quietly replace it (04 §4.6.3's refund prefill checks this).
   */
  sourcePinned: boolean;
  /** Persist the per-device memory after a successful save. */
  remember(values: TxFormValues): void;
}

export function useTransactionForm(opts: UseTransactionFormOptions): TxFormController {
  const { ledgerId, mode, initial, allowArchivedId = null, autoFillSource = true } = opts;
  const lang = useLang();
  const sourcesQuery = useSources(ledgerId, { include_archived: true });
  const categories = useCategories();
  const currencies = useCurrencies();

  const form = useForm<TxFormValues>({
    resolver: zodResolver(txFormSchema),
    mode: 'onSubmit',
    defaultValues: { ...emptyTxFormValues(todayLocalIso()), ...initial },
  });

  const values = form.watch();
  const { setValue, getValues } = form;

  const sources = React.useMemo(
    () => sourcesQuery.data?.items ?? [],
    [sourcesQuery.data?.items],
  );

  const sourceById = React.useCallback(
    (id: string | null): FinanceSource | undefined =>
      id === null ? undefined : sources.find((s) => s.id === id),
    [sources],
  );

  // ------------------------------------------------------------- preferences
  const [recentCategories, setRecentCategories] = React.useState<string[]>([]);
  const [recentMerchants, setRecentMerchants] = React.useState<RecentMerchant[]>([]);
  const [lastSource, setLastSource] = React.useState<string | null>(null);
  const [prefsRead, setPrefsRead] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    void (async () => {
      const [cats, merchants, last] = await Promise.all([
        getJsonPref<string[]>(PREF_NAMES.recentCategories(ledgerId)),
        getJsonPref<RecentMerchant[]>(PREF_NAMES.recentMerchants(ledgerId)),
        getPref(PREF_NAMES.lastSource(ledgerId)),
      ]);
      if (!alive) return;
      setRecentCategories(Array.isArray(cats) ? cats : []);
      setRecentMerchants(Array.isArray(merchants) ? merchants : []);
      setLastSource(typeof last === 'string' && last !== '' ? last : null);
      setPrefsRead(true);
    })();
    return () => {
      alive = false;
    };
  }, [ledgerId]);

  // ------------------------------------- default account, and the currency behind it
  React.useEffect(() => {
    if (!autoFillSource || !prefsRead || sources.length === 0) return;
    if (getValues('source_id') !== '') return;
    const usable = sources.filter((s) => !s.archived);
    if (usable.length === 0) return;
    const preferred = usable.find((s) => s.id === lastSource) ?? usable[0];
    setValue('source_id', preferred.id);
    if (getValues('currency') === '') setValue('currency', preferred.default_currency);
  }, [autoFillSource, getValues, lastSource, prefsRead, setValue, sources]);

  // An edit screen prefills `source_id` but cannot know the currency list yet; and a form
  // that opened before the accounts arrived has no currency either. Fill the hole once.
  React.useEffect(() => {
    if (getValues('currency') !== '') return;
    const current = sources.find((s) => s.id === getValues('source_id'));
    if (current) setValue('currency', current.default_currency);
  }, [getValues, setValue, sources, values.source_id]);

  const selectSource = React.useCallback(
    (id: string | null): void => {
      const next = id ?? '';
      setValue('source_id', next, { shouldDirty: true });
      const source = sources.find((s) => s.id === next);
      if (!source) return;
      setValue('currency', source.default_currency, { shouldDirty: true });
      // A single-leg transfer's currency is the account's, full stop (decision §14.52 A11).
      if (getValues('kind') === 'transfer' && getValues('external')) return;
      if (getValues('kind') === 'transfer' && getValues('currency_in') === '') {
        setValue('currency_in', source.default_currency);
      }
    },
    [getValues, setValue, sources],
  );

  const selectToSource = React.useCallback(
    (id: string | null): void => {
      const next = id ?? '';
      setValue('to_source_id', next, { shouldDirty: true });
      const source = sources.find((s) => s.id === next);
      if (source) setValue('currency_in', source.default_currency, { shouldDirty: true });
    },
    [setValue, sources],
  );

  const setKind = React.useCallback(
    (next: TxKind): void => {
      const current = getValues('kind');
      if (current === next) return;
      setValue('kind', next, { shouldDirty: true });
      // The category tree changes with the kind (decision §1.3), so a category picked in
      // the other tree has to go; expense ⇄ refund share a tree and keep theirs.
      if (kindOfCategoryTree(current) !== kindOfCategoryTree(next)) {
        setValue('category_l1', null);
        setValue('category_l2', null);
      }
      // While creating, leaving the refund tab simply drops the link. While editing it is
      // kept on purpose: decision §14.3 wants the user to unlink an existing original
      // explicitly, and `EditTransactionScreen` reads this value to say so.
      if (next !== 'refund' && mode === 'create') setValue('refund_of', null);
    },
    [getValues, mode, setValue],
  );

  const remember = React.useCallback(
    (saved: TxFormValues): void => {
      if (saved.source_id !== '') void setPref(PREF_NAMES.lastSource(ledgerId), saved.source_id);

      if (saved.kind !== 'transfer' && saved.category_l1) {
        const nextCategories = dedupe([saved.category_l1, ...recentCategories]).slice(
          0,
          RECENT_CATEGORY_STORE,
        );
        setRecentCategories(nextCategories);
        void setJsonPref(PREF_NAMES.recentCategories(ledgerId), nextCategories);
      }

      const merchant = saved.kind === 'transfer' ? null : orNull(saved.merchant);
      if (merchant !== null) {
        const entry: RecentMerchant = { name: merchant, l1: saved.category_l1 };
        const nextMerchants = [
          entry,
          ...recentMerchants.filter((m) => m.name !== merchant),
        ].slice(0, RECENT_MERCHANT_STORE);
        setRecentMerchants(nextMerchants);
        void setJsonPref(PREF_NAMES.recentMerchants(ledgerId), nextMerchants);
      }
    },
    [ledgerId, recentCategories, recentMerchants],
  );

  return {
    form,
    values,
    kind: values.kind,
    setKind,
    sources,
    sourcesLoading: sourcesQuery.isPending,
    sourceById,
    selectSource,
    selectToSource,
    index: categories.index,
    currencies,
    lang,
    recentCategories,
    recentMerchants,
    allowArchivedId,
    mode,
    sourcePinned: typeof initial?.source_id === 'string' && initial.source_id !== '',
    remember,
  };
}

// --------------------------------------------------------------- body builders

/** 04 §4.6.1 / §4.6.3 / §4.6.4 (single leg): the flat `POST .../transactions` body. */
export function toTransactionCreate(v: TxFormValues): TransactionCreate {
  const base: TransactionCreate = {
    source_id: v.source_id,
    kind: v.kind,
    amount: signedAmount(v),
    currency: v.currency,
    occurred_at: v.occurred_at,
    note: orNull(v.note),
  };
  if (v.kind === 'transfer') {
    return {
      ...base,
      transfer_role: v.direction,
      transfer_subtype: v.subtype,
      counterparty: orNull(v.counterparty),
    };
  }
  return {
    ...base,
    merchant: orNull(v.merchant),
    category_l1: v.category_l1,
    category_l2: v.category_l2,
    ...(v.kind === 'refund' ? { refund_of: v.refund_of } : {}),
  };
}

/** 04 §4.6.4: the flat `POST .../transactions/transfer` body — `subtype`, not
 *  `transfer_subtype`, and both magnitudes positive. */
export function toTransferCreate(v: TxFormValues): TransferCreate {
  const amountOut = normalizeAmountInput(v.amount) ?? '0.0000';
  // While the second group is collapsed there is one amount box, so both legs take it;
  // once it is open (different currency **or** different amount) each leg keeps its own.
  const secondLeg = showsSecondLeg(v);
  return {
    from_source_id: v.source_id,
    to_source_id: v.to_source_id,
    amount_out: amountOut,
    currency_out: v.currency,
    amount_in: secondLeg ? (normalizeAmountInput(v.amount_in) ?? amountOut) : amountOut,
    currency_in: secondLeg && v.currency_in !== '' ? v.currency_in : v.currency,
    occurred_at: v.occurred_at,
    subtype: v.subtype,
    note: orNull(v.note),
  };
}

function sameValue(a: unknown, b: unknown): boolean {
  return (a ?? null) === (b ?? null);
}

/**
 * 04 §4.7: a PATCH carries `updated_at` plus **only the fields that actually changed** —
 * anything else would overwrite a concurrent edit of a field this user never touched.
 */
export function toTransactionUpdate(
  v: TxFormValues,
  original: Transaction,
  updatedAt: IsoDateTime,
): TransactionUpdate {
  const next = toTransactionCreate(v);
  const patch: TransactionUpdate = { updated_at: updatedAt };

  if (!sameValue(next.source_id, original.source_id)) patch.source_id = next.source_id;
  if (!sameValue(next.kind, original.kind)) patch.kind = next.kind;
  // Money is compared as money, never through a float (`src/domain/money.ts` exists for
  // exactly this): `cmpMoney` sees `-38.5` and `-38.5000` as the same amount.
  if (cmpMoney(next.amount, original.amount) !== 0) patch.amount = next.amount;
  if (!sameValue(next.currency, original.currency)) patch.currency = next.currency;
  if (!sameValue(next.occurred_at, original.occurred_at)) patch.occurred_at = next.occurred_at;
  if (!sameValue(next.note, original.note)) patch.note = next.note;

  if (v.kind === 'transfer') {
    // The leg's direction and the sign of its amount are one fact (backend
    // `_validate_single` / the `transfer_role` CHECK): flipping 转出 ⇄ 转入 has to send both.
    if (!sameValue(next.transfer_role, original.transfer_role)) {
      patch.transfer_role = next.transfer_role;
    }
    if (!sameValue(next.transfer_subtype, original.transfer_subtype)) {
      patch.transfer_subtype = next.transfer_subtype;
    }
    if (!sameValue(next.counterparty, original.counterparty)) {
      patch.counterparty = next.counterparty;
    }
    return patch;
  }

  if (!sameValue(next.merchant, original.merchant)) patch.merchant = next.merchant;
  if (!sameValue(next.category_l1, original.category_l1)) patch.category_l1 = next.category_l1;
  if (!sameValue(next.category_l2, original.category_l2)) patch.category_l2 = next.category_l2;
  if (v.kind === 'refund' || original.refund_of !== null) {
    const refundOf = v.kind === 'refund' ? v.refund_of : null;
    if (!sameValue(refundOf, original.refund_of)) patch.refund_of = refundOf;
  }
  return patch;
}

/**
 * 04 §4.7: one `PATCH .../transactions/transfer/{pair_id}` for both legs — and, like
 * `toTransactionUpdate`, **only the fields that actually changed**.
 *
 * This is not just politeness towards a concurrent editor: 03 §5.31 writes `occurred_at`
 * / `subtype` / `note` to *both* legs whenever the request names them, so a pair that
 * `POST .../pair` built out of two legs with their own dates and notes (decision §14.53a)
 * would be flattened by a save that only touched the amount.
 */
export function toTransferUpdate(
  v: TxFormValues,
  original: TransferPair,
  updatedAt: IsoDateTime,
): TransferUpdate {
  const next = toTransferCreate(v);
  const patch: TransferUpdate = { updated_at: updatedAt };

  if (!sameValue(next.from_source_id, original.out.source_id)) {
    patch.from_source_id = next.from_source_id;
  }
  if (!sameValue(next.to_source_id, original.in.source_id)) patch.to_source_id = next.to_source_id;
  // The legs are stored signed; the form holds magnitudes (decision §1.2).
  if (cmpMoney(next.amount_out, absMoney(original.out.amount)) !== 0) {
    patch.amount_out = next.amount_out;
  }
  if (!sameValue(next.currency_out, original.out.currency)) patch.currency_out = next.currency_out;
  if (cmpMoney(next.amount_in, absMoney(original.in.amount)) !== 0) patch.amount_in = next.amount_in;
  if (!sameValue(next.currency_in, original.in.currency)) patch.currency_in = next.currency_in;
  if (!sameValue(next.occurred_at, original.occurred_at)) patch.occurred_at = next.occurred_at;
  if (!sameValue(next.subtype, original.subtype)) patch.subtype = next.subtype;
  if (!sameValue(next.note, original.note)) patch.note = next.note;
  return patch;
}

/** The form values that show an existing single transaction (04 §4.7 prefill). */
export function valuesFromTransaction(tx: Transaction): Partial<TxFormValues> {
  const magnitude = tx.amount.startsWith('-') ? tx.amount.slice(1) : tx.amount;
  return {
    kind: tx.kind,
    source_id: tx.source_id,
    amount: magnitude,
    currency: tx.currency,
    occurred_at: tx.occurred_at,
    merchant: tx.merchant ?? '',
    note: tx.note ?? '',
    category_l1: tx.category_l1,
    category_l2: tx.category_l2,
    refund_of: tx.refund_of,
    subtype: tx.transfer_subtype ?? 'plain',
    external: tx.kind === 'transfer' && tx.transfer_pair_id === null,
    direction: tx.transfer_role ?? 'out',
    counterparty: tx.counterparty ?? '',
  };
}
