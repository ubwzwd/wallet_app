/**
 * The rows of the fact list, built once per shape (屏幕稿 07 / 08).
 *
 * Pure functions: the screens hand in what they already have (the row, the accounts, the
 * members, the language pack) and get back the list `KeyFacts` renders. Keeping them out of
 * the screens is what keeps both screens readable — and it is the only place that decides
 * when 原币金额 and 折算 are two rows rather than one.
 */
import type { LedgerMember, Money, Transaction, TransferPair, Uuid } from '@/api/types';
import type { Lang } from '@/i18n';
import { formatMoney } from '@/i18n/format';

import type { Fact } from './KeyFacts';
import type { SourceMap } from './TransferLegs';
import { longDate } from './parts';

type T = (key: string | string[], vars?: Record<string, unknown>) => string;

export interface FactContext {
  t: T;
  lang: Lang;
  baseCurrency: string;
  sources: SourceMap;
  members: readonly LedgerMember[];
  /**
   * Whether `members` is the answered list rather than the empty placeholder a pending query
   * hands over. While it is false 「记录人」 is left out altogether: an empty list makes every
   * author look like a member who left, and narrow has no sidebar to warm that query up.
   */
  membersReady: boolean;
  /** Opens the import batch a row came from; omitted when there is nothing to open. */
  onOpenBatch?(batchId: Uuid): void;
}

/** 「我 · owner」 — who typed this in, and what they are in this ledger. */
function recordedBy(ctx: FactContext, userId: Uuid): string {
  const member = ctx.members.find((m) => m.user_id === userId);
  if (!member) return ctx.t('transaction:detail.recorded_by_unknown');
  const name = member.is_me
    ? ctx.t('transaction:detail.events_actor_me')
    : (member.display_name ?? member.email.split('@')[0]);
  const role = ctx.t(
    member.role === 'owner' ? 'ledger:list.card.role_owner' : 'ledger:list.card.role_member',
  );
  return `${name} · ${role}`;
}

/** 手动录入, or the short id of the import batch with that batch's page behind it. */
function originFact(ctx: FactContext, raw: Uuid | null | undefined): Fact {
  // A leg read off `GET .../transfer/{pair_id}` need not carry every column of a full row,
  // so an absent batch is treated exactly like a null one: 手动录入.
  const batchId = raw ?? null;
  return {
    id: 'origin',
    label: ctx.t('transaction:detail.source_label'),
    value:
      batchId === null
        ? ctx.t('transaction:detail.source_manual')
        : ctx.t('transaction:detail.source_import', { batch: batchId.slice(0, 8) }),
    onPress:
      batchId === null || ctx.onOpenBatch === undefined
        ? undefined
        : () => ctx.onOpenBatch?.(batchId),
  };
}

function moneyFacts(
  ctx: FactContext,
  amount: Money,
  currency: string,
  amountBase: Money | null,
): Fact[] {
  const foreign = currency.toUpperCase() !== ctx.baseCurrency.toUpperCase();
  const own: Fact = {
    id: 'amount',
    label: ctx.t(foreign ? 'transaction:detail.amount_original' : 'transaction:form.amount'),
    value: formatMoney(amount, currency, ctx.lang),
    mono: true,
  };
  if (!foreign || amountBase === null) return [own];
  return [
    own,
    {
      id: 'amount-base',
      label: ctx.t('transaction:detail.amount_base', { currency: ctx.baseCurrency }),
      value: formatMoney(amountBase, ctx.baseCurrency, ctx.lang),
      mono: true,
    },
  ];
}

/** 屏幕稿 08: 日期 / 分类 / 账户 / 原币金额 / 折算 / 备注 / 记录人 / 来源. */
export function transactionFacts(
  ctx: FactContext,
  tx: Transaction,
  category: string | null,
): Fact[] {
  const transfer = tx.kind === 'transfer';
  return [
    {
      id: 'date',
      label: ctx.t('transaction:form.date'),
      value: longDate(tx.occurred_at, ctx.t),
      mono: true,
    },
    ...(category !== null
      ? [{ id: 'category', label: ctx.t('transaction:list.filter.category_label'), value: category }]
      : []),
    ...(transfer
      ? [
          {
            id: 'subtype',
            label: ctx.t('transaction:transfer.subtype_label'),
            value: ctx.t(`transaction:transfer.subtype.${tx.transfer_subtype ?? 'plain'}`),
          },
          {
            id: 'counterparty',
            label: ctx.t('transaction:transfer.counterparty_label'),
            value:
              tx.counterparty === null
                ? ctx.t('transaction:detail.counterparty_external')
                : ctx.t('transaction:detail.counterparty_text', { name: tx.counterparty }),
          },
        ]
      : [
          {
            id: 'source',
            label: ctx.t('transaction:form.source'),
            value: ctx.sources[tx.source_id]?.name ?? tx.source_id,
          },
        ]),
    ...moneyFacts(ctx, tx.amount, tx.currency, tx.amount_base),
    ...(tx.note !== null
      ? [{ id: 'note', label: ctx.t('transaction:form.note'), value: tx.note, wrap: true }]
      : []),
    ...(ctx.membersReady
      ? [
          {
            id: 'recorded-by',
            label: ctx.t('transaction:form.summary_author'),
            value: recordedBy(ctx, tx.created_by),
          },
        ]
      : []),
    originFact(ctx, tx.import_batch_id),
  ];
}

/**
 * 屏幕稿 07 (two legs): 日期 / 子类型 / 备注 / 记录人 / 来源.
 *
 * `GET .../transfer/{pair_id}` answers with the *reduced* leg shape (03 §5.30a): no
 * `created_by`, no `import_batch_id`. Those two rows therefore come from the out leg's own
 * detail, which the page already loads for the timeline, and are simply left out until it
 * arrives rather than shown as an unknown author.
 */
export function transferFacts(
  ctx: FactContext,
  pair: TransferPair,
  outDetail?: Transaction,
): Fact[] {
  return [
    {
      id: 'date',
      label: ctx.t('transaction:form.date'),
      value: longDate(pair.occurred_at, ctx.t),
      mono: true,
    },
    {
      id: 'subtype',
      label: ctx.t('transaction:transfer.subtype_label'),
      value: ctx.t(`transaction:transfer.subtype.${pair.subtype}`),
    },
    ...(pair.note !== null
      ? [{ id: 'note', label: ctx.t('transaction:form.note'), value: pair.note, wrap: true }]
      : []),
    ...(outDetail === undefined
      ? []
      : [
          ...(ctx.membersReady
            ? [
                {
                  id: 'recorded-by',
                  label: ctx.t('transaction:form.summary_author'),
                  value: recordedBy(ctx, outDetail.created_by),
                },
              ]
            : []),
          originFact(ctx, outDetail.import_batch_id),
        ]),
  ];
}
