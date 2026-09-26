/**
 * What the account form's 创建 / 保存 does (04 §4.9, decision §14.62).
 *
 *  - create: one `POST /sources`, carrying `share_to` when any ledger is ticked, so the new
 *    account is shared in the same request that makes it.
 *  - edit: the `PATCH /sources/{sid}` first (only the fields that changed, plus the
 *    `updated_at` stamp — never the locked currency), then one `PUT` / `DELETE
 *    /sources/{sid}/ledgers/{lid}` per ledger whose chip changed. A failure stops the run
 *    where it is, says so, and keeps the form open; nothing already sent is undone.
 *    When only the chips changed, the PATCH is skipped: there is nothing for it to carry.
 *  - an opening-balance change asks first, previewing my net worth before and after.
 *
 * All three mutations are `silent`: the form owns its error toasts, except the
 * `stale_update` 409 whose refetch-and-warn the global handler already did (04 §3.8).
 */
import React from 'react';
import { useTranslation } from 'react-i18next';

import { isApiClientError } from '@/api/errors';
import type {
  FinanceSource,
  FinanceSourceCreate,
  FinanceSourceUpdate,
  Money,
  Uuid,
} from '@/api/types';
import { addMoney, parseMoney, subMoney } from '@/domain/money';
import { errorMessage } from '@/i18n/errorCodes';
import { formatMoney } from '@/i18n/format';
import { useLang } from '@/i18n';
import { useCreateSource, useShareSource, useUpdateSource } from '@/queries';
import { confirm, toast } from '@/ui';

import { ZERO, shareDiff, storedValue, toBase } from './formValues';
import type { SourceFormValues } from './schemas';

export interface SourceSubmitOptions {
  /** The account being edited; `undefined` creates one. */
  sourceId: Uuid | undefined;
  /** The server row the form was last synchronised with (edit only). */
  baseline: FinanceSource | null;
  /** Ids of the ledgers I belong to — the only ones a chip can name. */
  ledgerIds: ReadonlySet<Uuid>;
  /** My base currency and current net worth (`GET /sources`), for the preview. */
  baseCurrency: string;
  netWorth: Money | null;
  /** Leaves the form once everything has been saved. */
  onSaved(): void;
}

export interface SourceSubmit {
  submit(values: SourceFormValues): Promise<void>;
  busy: boolean;
}

export function useSourceSubmit(opts: SourceSubmitOptions): SourceSubmit {
  const { t } = useTranslation();
  const lang = useLang();
  const { sourceId, baseline, ledgerIds, baseCurrency, netWorth, onSaved } = opts;
  const create = useCreateSource({ silent: true });
  const update = useUpdateSource(sourceId ?? '', { silent: true });
  const share = useShareSource({ silent: true });
  const [sharing, setSharing] = React.useState(false);

  const createOne = React.useCallback(
    async (values: SourceFormValues): Promise<void> => {
      const shareTo = values.share_to.filter((id) => ledgerIds.has(id));
      const body: FinanceSourceCreate = {
        name: values.name.trim(),
        type: values.type,
        default_currency: values.default_currency,
        opening_balance: storedValue(values.opening_balance, values.type),
        ...(shareTo.length > 0 ? { share_to: shareTo } : {}),
      };
      try {
        const source = await create.mutateAsync(body);
        toast.success(t('source:form.created_toast', { name: source.name }));
        onSaved();
      } catch (e) {
        toast.error(errorMessage(t, e));
      }
    },
    [create, ledgerIds, onSaved, t],
  );

  /** "Net worth ¥52,300 → ¥49,096" for the opening-balance confirmation, or nothing when
   *  my net worth is unknown (an account has no rate). */
  const previewLine = React.useCallback(
    (source: FinanceSource, nextStored: Money): string | null => {
      if (netWorth === null) return null;
      const delta = toBase(subMoney(nextStored, source.opening_balance ?? ZERO), source, baseCurrency);
      return t('source:form.net_worth_preview', {
        from: formatMoney(netWorth, baseCurrency, lang),
        to: formatMoney(addMoney(netWorth, delta), baseCurrency, lang),
      });
    },
    [baseCurrency, lang, netWorth, t],
  );

  /** The share / unshare calls after the PATCH, one at a time; `false` if one failed. */
  const syncShares = React.useCallback(
    async (sid: Uuid, before: readonly Uuid[], after: readonly Uuid[]): Promise<boolean> => {
      const diff = shareDiff(before, after, ledgerIds);
      const steps = [
        ...diff.share.map((lid) => ({ lid, share: true })),
        ...diff.unshare.map((lid) => ({ lid, share: false })),
      ];
      if (steps.length === 0) return true;
      setSharing(true);
      try {
        for (const step of steps) {
          await share.mutateAsync({ sid, lid: step.lid, share: step.share });
        }
        return true;
      } catch (e) {
        toast.error(t('source:share.save_failed_toast'), { detail: errorMessage(t, e) });
        return false;
      } finally {
        setSharing(false);
      }
    },
    [ledgerIds, share, t],
  );

  const editOne = React.useCallback(
    async (values: SourceFormValues, current: FinanceSource): Promise<void> => {
      const stored = storedValue(values.opening_balance, values.type);
      const body: FinanceSourceUpdate = { updated_at: current.updated_at };
      if (values.name.trim() !== current.name) body.name = values.name.trim();
      if (values.type !== current.type) body.type = values.type;
      const openingChanged = parseMoney(stored) !== parseMoney(current.opening_balance ?? ZERO);
      if (openingChanged) body.opening_balance = stored;

      if (openingChanged) {
        const preview = previewLine(current, stored);
        const confirmText = t('source:form.opening_balance_change_confirm');
        const ok = await confirm({
          title: t('source:form.opening_balance_change_title'),
          body: preview === null ? confirmText : `${preview}\n${confirmText}`,
          confirmLabel: t('common:button.save'),
          tone: 'danger',
        });
        if (!ok) return;
      }

      const before = current.shared_to ?? [];
      const diff = shareDiff(before, values.share_to, ledgerIds);
      const onlyShares =
        Object.keys(body).length === 1 && diff.share.length + diff.unshare.length > 0;
      let name = values.name.trim();
      if (!onlyShares) {
        try {
          name = (await update.mutateAsync(body)).name;
        } catch (e) {
          // A 409 `stale_update` is the global handler's business (04 §3.8): it has already
          // refetched the row and warned; the screen merges it into the form.
          if (!(isApiClientError(e) && e.code === 'stale_update')) toast.error(errorMessage(t, e));
          return;
        }
      }
      if (!(await syncShares(current.id, before, values.share_to))) return;
      toast.success(t('source:form.saved_toast', { name }));
      onSaved();
    },
    [ledgerIds, onSaved, previewLine, syncShares, t, update],
  );

  const submit = React.useCallback(
    async (values: SourceFormValues): Promise<void> => {
      if (sourceId === undefined) return createOne(values);
      if (baseline) return editOne(values, baseline);
    },
    [baseline, createOne, editOne, sourceId],
  );

  return { submit, busy: create.isPending || update.isPending || sharing };
}
