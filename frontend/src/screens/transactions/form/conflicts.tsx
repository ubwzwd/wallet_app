/**
 * Two things every screen that submits this form needs, and neither of which is layout:
 * pushing a 422's `fields` back onto the controls (04 §4.6.5), and the 409 merge of
 * 04 §3.8 — server values become the new baseline, the user's own edits survive, and each
 * field the two disagree about gets a 「服务器上现在是…」 line with a button that takes the
 * server's value.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { isApiClientError } from '@/api/errors';
import { categoryName } from '@/i18n/category';
import { formatDate, formatMoney } from '@/i18n/format';
import { useCategories } from '@/queries';
import { space } from '@/theme/tokens';
import { Button, Card, Text } from '@/ui';

import { rawMessage, type TxFormValues } from './schemas';
import type { TxFormController } from './useTransactionForm';

/**
 * Server field name → the control that shows it.
 *
 * The two-leg transfer endpoint names the same three boxes differently (04 §4.6.4:
 * `from_source_id` / `amount_out` / `currency_out`), so its aliases map onto the same
 * controls; anything missing here has no box to sit next to and goes to the toast instead.
 */
const SERVER_FIELDS: Readonly<Record<string, keyof TxFormValues>> = {
  source_id: 'source_id',
  amount: 'amount',
  currency: 'currency',
  occurred_at: 'occurred_at',
  merchant: 'merchant',
  note: 'note',
  category_l1: 'category_l1',
  category_l2: 'category_l2',
  refund_of: 'refund_of',
  counterparty: 'counterparty',
  to_source_id: 'to_source_id',
  amount_in: 'amount_in',
  currency_in: 'currency_in',
  from_source_id: 'source_id',
  amount_out: 'amount',
  currency_out: 'currency',
  subtype: 'subtype',
};

/**
 * Push a 422's `fields` onto the form (04 §4.6.5). Anything that does not map onto a
 * control — or an error that carries no `fields` at all — falls back to the toast.
 */
export function applyFieldErrors(
  ctrl: TxFormController,
  error: unknown,
  fallback: () => void,
): void {
  if (!isApiClientError(error) || !error.fields) {
    fallback();
    return;
  }
  let unplaced = Object.keys(error.fields).length === 0;
  for (const [name, message] of Object.entries(error.fields)) {
    const field = SERVER_FIELDS[name];
    if (!field) {
      // A field with no box of its own must not disappear just because another one
      // happened to match — the toast is where it is still readable.
      unplaced = true;
      continue;
    }
    // Every control renders its error through `txValidationMessage`, which resolves a
    // `validation` key — so the server's own prose has to be marked as finished copy,
    // otherwise it would be looked up and come out as 「这是必填项」.
    ctrl.form.setError(field, { type: 'server', message: rawMessage(message) });
  }
  if (unplaced) fallback();
}

// --------------------------------------------------------- the 409 merge (04 §3.8)

/** One field the server disagrees about after a 409 (04 §3.8 step 4). */
export interface FormConflict {
  field: keyof TxFormValues;
  /** The server's value, already in form shape. */
  value: string | null;
}

/**
 * The fields the user changed that the server now says something else about. Fields the
 * user never touched are not conflicts: they are simply taken over.
 */
export function findConflicts(
  fields: readonly (keyof TxFormValues)[],
  server: Partial<TxFormValues>,
  ctrl: TxFormController,
): FormConflict[] {
  const current = ctrl.form.getValues();
  const dirty = ctrl.form.formState.dirtyFields as Partial<
    Record<keyof TxFormValues, boolean>
  >;
  const found: FormConflict[] = [];
  for (const field of fields) {
    if (dirty[field] !== true) continue;
    const serverValue = (server[field] ?? null) as string | null;
    const mine = (current[field] ?? null) as string | null;
    if (serverValue === mine) continue;
    found.push({ field, value: serverValue });
  }
  return found;
}

/** 「服务器上现在是：X」 + [用服务器的], per conflicting field (04 §3.8 step 4). */
export function ConflictBanner({
  ctrl,
  conflicts,
  onResolve,
  idPrefix = 'tx-edit',
}: {
  ctrl: TxFormController;
  conflicts: readonly FormConflict[];
  /** Called after the server's value has been written into the form. */
  onResolve(field: keyof TxFormValues): void;
  /** Which screen is showing it — `tx-edit` or `transfer-edit`. */
  idPrefix?: string;
}): React.JSX.Element | null {
  const { t } = useTranslation();
  const { index } = useCategories();
  if (conflicts.length === 0) return null;

  function label(field: keyof TxFormValues, value: string | null): string {
    if (value === null || value === '') return t('common:status.none');
    if (field === 'amount' || field === 'amount_in') {
      const currency = field === 'amount' ? ctrl.values.currency : ctrl.values.currency_in;
      return formatMoney(value, currency, ctrl.lang);
    }
    if (field === 'occurred_at') return formatDate(value);
    if (field === 'source_id' || field === 'to_source_id') {
      return ctrl.sourceById(value)?.name ?? value;
    }
    if (field === 'category_l1' || field === 'category_l2') {
      const category = index?.byCode[value];
      return category ? categoryName(category, ctrl.lang) : value;
    }
    if (field === 'subtype') return t(`transaction:transfer.subtype.${value}`);
    if (field === 'direction') return t(`transaction:transfer.role.${value}`);
    // A refund link is an id with no copy of its own: "已关联" is all it can say, and the
    // `null` case above has already answered with 「无」.
    if (field === 'refund_of') return t('transaction:picker.linked_title');
    return value;
  }

  return (
    <Card variant="outlined" testID={`${idPrefix}-conflict`}>
      <Text variant="caption" tone="warning">
        {t('transaction:form.conflict_title')}
      </Text>
      {conflicts.map((conflict) => (
        <View key={conflict.field} style={styles.conflictRow}>
          <Text variant="caption" tone="secondary">
            {`${t(`transaction:form.field.${conflict.field}`)} · ${t(
              'transaction:form.conflict_server_value',
              { value: label(conflict.field, conflict.value) },
            )}`}
          </Text>
          <Button
            testID={`${idPrefix}-use-server-${conflict.field}`}
            variant="ghost"
            size="sm"
            label={t('transaction:form.conflict_use_server')}
            onPress={() => {
              ctrl.form.setValue(conflict.field, conflict.value as never, {
                shouldDirty: false,
              });
              onResolve(conflict.field);
            }}
          />
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  conflictRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space['2'],
  },
});
