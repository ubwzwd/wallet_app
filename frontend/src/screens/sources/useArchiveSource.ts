/**
 * Archiving / unarchiving one account (04 §4.8, decision §14.50).
 *
 * Both the list row and the edit form's switch go through here, so the confirmation copy
 * — including the "this balance leaves net worth" number — is written exactly once.
 *
 * The mutation is deliberately **not** silent: archiving is a one-tap operation with no
 * form to render an error into, so the global `MutationCache` toast is the right place
 * for a failure (04 §3.9). Only the success branch belongs to the caller.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';

import type { FinanceSource, Uuid } from '@/api/types';
import { formatMoney } from '@/i18n/format';
import { useLang } from '@/i18n';
import { useUpdateSource } from '@/queries';
import { confirm, toast } from '@/ui';

export interface ArchiveSourceController {
  /** Confirms, then PATCHes `{archived, updated_at}`. Resolves `true` only if it stuck. */
  setArchived(source: FinanceSource, next: boolean): Promise<boolean>;
  pending: boolean;
}

/**
 * `baseCurrency` is the owner's (`GET /sources`'s `base_currency`): an account belongs to a
 * person, not a ledger, so its converted balance is in my currency (decision §14.62).
 */
export function useArchiveSource(sourceId: Uuid, baseCurrency: string): ArchiveSourceController {
  const { t } = useTranslation();
  const lang = useLang();
  const update = useUpdateSource(sourceId);

  const setArchived = React.useCallback(
    async (source: FinanceSource, next: boolean): Promise<boolean> => {
      // The balance the user is about to add to / remove from net worth is the converted
      // one when there is a rate, and the account's own otherwise (decision §14.50).
      const balance = formatMoney(
        source.balance_base ?? source.balance ?? '0',
        source.balance_base === null ? source.default_currency : baseCurrency,
        lang,
      );
      const ok = await confirm({
        title: next
          ? t('source:list.archive_confirm_title')
          : t('source:list.unarchive_confirm_title'),
        body: next
          ? t('source:list.archive_confirm', { balance })
          : t('source:list.unarchive_confirm', { balance }),
        confirmLabel: next ? t('source:list.archive_action') : t('source:list.unarchive_action'),
        tone: next ? 'danger' : 'default',
      });
      if (!ok) return false;

      try {
        await update.mutateAsync({ archived: next, updated_at: source.updated_at });
      } catch {
        // The global error toast already said what went wrong (04 §3.8, §3.9).
        return false;
      }
      toast.success(
        next
          ? t('source:list.archived_toast', { name: source.name })
          : t('source:list.unarchived_toast', { name: source.name }),
      );
      return true;
    },
    [baseCurrency, lang, t, update],
  );

  return { setArchived, pending: update.isPending };
}
