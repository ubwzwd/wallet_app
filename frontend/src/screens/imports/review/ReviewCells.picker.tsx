/**
 * The review cells whose editor is a picker (04 §4.11.2, §4.11.5): currency, kind and the
 * two category levels. A picker commits the moment it closes — there is no draft to debounce.
 *
 * `kindChangePatch` is here too, because changing the kind is what makes the other pickers
 * appear and disappear: a transfer has no category (decision §10/§1.3) but *must* carry a
 * direction and a subtype (03 §5.41), and leaving a transfer drops both again.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';

import type { ImportRow, ImportRowPatch, TransferRole, TxKind } from '@/api/types';
import { KINDS, applySign } from '@/domain/kinds';
import { categoryName } from '@/i18n/category';
import { radius } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import {
  Button,
  CategoryPickerPanel,
  type CategoryValue,
  CurrencyPicker,
  Select,
  Sheet,
} from '@/ui';

import { type CellProps, CellFrame, Dash } from './ReviewRow';

/**
 * The patch a kind change implies (04 §4.11.2, §8.4 case 3): the sign follows the new kind,
 * a transfer loses its category and gains the two fields a leg cannot be without, and
 * leaving `transfer`/`refund` drops the fields that only mean something there.
 * `changedFields` trims whatever was already in that state.
 *
 * `transfer_role` / `transfer_subtype` are not optional: 03 §5.41 refuses a transfer row
 * with either one null, and §5.43 checks again at commit time. The row has no way to set
 * them before it *is* a transfer — the link cell only appears afterwards — so the change
 * that makes it one has to fill them in. `out` is the same default the sign already uses.
 */
export function kindChangePatch(row: ImportRow, kind: TxKind): ImportRowPatch {
  const patch: ImportRowPatch = { kind };
  const role: TransferRole = row.transfer_role ?? 'out';
  if (row.amount !== null) {
    patch.amount = applySign(row.amount, kind, role);
  }
  if (kind === 'transfer') {
    patch.category_l1 = null;
    patch.category_l2 = null;
    // A transfer has no merchant either (03 §5.41, decision §14.52 B16): the CSV's own
    // merchant column is meaningless on a leg, and the commit refuses the row otherwise.
    patch.merchant = null;
    patch.transfer_role = role;
    patch.transfer_subtype = row.transfer_subtype ?? 'plain';
  } else {
    patch.counterpart_source_id = null;
    patch.counterparty = null;
    patch.transfer_role = null;
    patch.transfer_subtype = null;
  }
  // A link never survives a change of kind: a refund points at the expense it refunds and a
  // transfer at its opposite leg, and neither claim means anything under the other kind —
  // keeping it would paint the wrong cell and earn a `pair_invalid` /
  // `refund_target_invalid` at commit time, whose `detail` names no row. `changedFields`
  // drops the key again for a row that was not linked in the first place.
  patch.matched_transaction_id = null;
  return patch;
}

// --------------------------------------------------------------------- currency

export function CurrencyCell({ row, env, testID }: CellProps): React.JSX.Element {
  return (
    <CellFrame row={row} env={env} field="currency" testID={testID}>
      <CurrencyPicker
        testID={testID}
        variant="inline"
        codes={env.currencyCodes}
        names={env.currencyNames}
        value={row.currency}
        onChange={(next) => env.ctrl.patch(row, { currency: next })}
      />
    </CellFrame>
  );
}

// --------------------------------------------------------------------- kind

export function KindCell({ row, env, testID }: CellProps): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <CellFrame row={row} env={env} field="kind" testID={testID}>
      <Select
        testID={testID}
        value={row.kind}
        options={KINDS.map((kind) => ({ value: kind, label: t(`transaction:kind.${kind}`) }))}
        label={t('import:review.column.kind')}
        onChange={(next) => {
          if (next === null || next === row.kind) return;
          env.ctrl.patch(row, kindChangePatch(row, next as TxKind));
        }}
      />
    </CellFrame>
  );
}

// --------------------------------------------------------------------- category

export interface CategoryCellProps extends CellProps {
  level: 'l1' | 'l2';
  /** Controlled so `C` (04 §4.11.7) can open the level-1 picker of the focused row. */
  open: boolean;
  onOpenChange(open: boolean): void;
}

export function CategoryCell({
  row,
  env,
  level,
  open,
  onOpenChange,
  testID,
}: CategoryCellProps): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  const [stage, setStage] = React.useState<'l1' | 'l2'>(level);

  const index = env.index;
  // Transfers have no category (decision §1.3); a level-2 cell needs its parent first.
  const dead =
    row.kind === 'transfer' || index === null || (level === 'l2' && row.category_l1 === null);

  const value: CategoryValue = { l1: row.category_l1, l2: row.category_l2 };
  const code = level === 'l1' ? row.category_l1 : row.category_l2;
  const label =
    code !== null && index !== null && index.byCode[code]
      ? categoryName(index.byCode[code], env.lang)
      : null;

  React.useEffect(() => {
    if (open) setStage(level === 'l2' && row.category_l1 !== null ? 'l2' : 'l1');
  }, [open, level, row.category_l1]);

  const close = (): void => {
    onOpenChange(false);
  };

  if (dead) return <Dash testID={testID} />;

  return (
    <CellFrame
      row={row}
      env={env}
      field={level === 'l1' ? 'category_l1' : 'category_l2'}
      testID={testID}
    >
      <Button
        testID={`${testID}-trigger`}
        size="sm"
        variant="ghost"
        label={
          label ??
          t(level === 'l1' ? 'import:review.pick_category' : 'import:review.pick_category_l2')
        }
        onPress={() => onOpenChange(true)}
        style={{
          borderWidth: 1,
          borderRadius: radius.sm,
          borderColor:
            label === null && level === 'l1' ? colors['flag.uncategorized'] : 'transparent',
        }}
      />
      <Sheet
        open={open}
        onClose={close}
        title={t('import:review.column.category_l1')}
        closeLabel={t('common:button.close')}
        testID={`${testID}-sheet`}
      >
        {index !== null ? (
          <CategoryPickerPanel
            id={testID}
            index={index}
            kind={row.kind ?? 'expense'}
            lang={env.lang}
            value={value}
            wide={false}
            activeL1={stage === 'l2' ? row.category_l1 : null}
            stage={stage}
            onPickL1={(next) => {
              env.ctrl.patch(row, { category_l1: next, category_l2: null });
              setStage('l2');
            }}
            onPickL2={(next) => {
              env.ctrl.patch(row, { category_l2: next });
              close();
            }}
            onBack={() => setStage('l1')}
          />
        ) : null}
      </Sheet>
    </CellFrame>
  );
}
