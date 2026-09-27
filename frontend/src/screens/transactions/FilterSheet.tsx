/**
 * The narrow layout's filter drawer (屏幕稿 02 · 交易筛选 375), and the account field — the
 * one control the drawer draws completely differently from the wide card, which is why it
 * lives here rather than with the other fields.
 *
 * The drawer stacks the same fields the wide 「筛选」 card lays out in a grid
 * (`FilterFields.tsx`): 「筛选」 and 重置 on one baseline, then keyword / 种类 / 账户 / 币种 / 日期区间 / 分类 /
 * 金额区间 down the body, and one 「应用 · N 笔」 button that says how many entries the filters
 * match before it is pressed.
 *
 * There is no 「取消」: every control writes the filters as it is touched (04 §4.5), so the
 * list behind the drawer is already showing the result and there is nothing to roll back —
 * the button confirms and closes.
 */
import React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { density, radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import {
  Button,
  Checkbox,
  MultiSelect,
  Sheet,
  SourceGroupLabel,
  Text,
  groupSources,
  isSourceGroupTitle,
  renderSourceGroupTitle,
  showsSourceGroups,
  sourceGroupOptions,
  sourceTypeLabelKey,
  type SelectOption,
} from '@/ui';

import { useAmountText } from './amount';
import {
  AmountRangeField,
  CategoryField,
  CurrencyChips,
  DateRangeField,
  FilterField,
  KeywordField,
  KindChips,
  type FilterFieldProps,
} from './FilterFields';

/**
 * 屏幕稿 02 draws the accounts two ways: a dropdown reading 「招行储蓄卡 +2」 on the wide card,
 * and — in the drawer, where there is room — the accounts themselves as a tinted list of
 * tick rows carrying each account's type, currency and balance.
 *
 * Every account the ledger can see is offered, including ones that can no longer be booked
 * onto (archived, or no longer shared — decision §14.62): filtering is about the entries
 * already written. Both the drawer and the wide dropdown split them into 「我的」 and
 * 「成员共享的」 once there are others', whose balances stay the owner's business.
 */
export function SourceField(props: FilterFieldProps & { inline?: boolean }): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  // 屏幕稿 02 · 筛选 375 lists 「12,480.35」 and 「S$4,120.80」 side by side (§14.59a).
  const money = useAmountText();
  const values = props.filters.source_id ?? [];

  const toggle = (id: string): void => {
    const next = values.includes(id) ? values.filter((v) => v !== id) : [...values, id];
    props.onPatch({ source_id: next.length > 0 ? next : undefined });
  };

  // The trigger names the first account and counts the rest, rather than a bare number that
  // says nothing about which ones.
  const summary = (count: number): string => {
    const first = props.sources.find((s) => s.id === values[0])?.name;
    if (first === undefined) return t('transaction:list.filter.source_selected', { count });
    if (count === 1) return first;
    return t('transaction:list.filter.source_summary', { name: first, count: count - 1 });
  };

  const groups = groupSources(props.sources);
  const titled = showsSourceGroups(groups);

  // The wide dropdown groups the same way; its titles are disabled pseudo-options, so they
  // can never land in `source_id`.
  const options = sourceGroupOptions(
    groups,
    titled,
    (s): SelectOption => ({ value: s.id, label: s.name, hint: s.default_currency }),
    (key) => t(`transaction:picker.group_${key}`),
  );

  const renderOption = (option: SelectOption): React.ReactNode =>
    isSourceGroupTitle(option) ? (
      renderSourceGroupTitle(option)
    ) : (
      <>
        <Text variant="body" numberOfLines={1}>
          {option.label}
        </Text>
        {option.hint !== undefined ? (
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {option.hint}
          </Text>
        ) : null}
      </>
    );

  return (
    <FilterField
      label={t('transaction:list.filter.source_label')}
      hint={
        props.inline === true && values.length > 0
          ? t('transaction:list.filter.source_selected', { count: values.length })
          : t('transaction:list.filter.multi_hint')
      }
    >
      {props.inline === true ? (
        <View
          testID={`${props.id}-source-list`}
          style={{
            borderRadius: radius.md,
            backgroundColor: colors['bg.subtle'],
            paddingVertical: space['1'],
          }}
        >
          {groups.map((group) => (
            <React.Fragment key={group.key}>
              {titled ? (
                <SourceGroupLabel
                  group={group.key}
                  testID={`${props.id}-source-group-${group.key}`}
                />
              ) : null}
              {group.sources.map((source) => (
                <Pressable
                  key={source.id}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: values.includes(source.id) }}
                  accessibilityLabel={source.name}
                  onPress={() => toggle(source.id)}
                  testID={`${props.id}-source-${source.id}`}
                  style={{
                    minHeight: 48,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: space['3'],
                    paddingHorizontal: density.rowInnerPadding,
                    paddingVertical: space['2'],
                  }}
                >
                  <View pointerEvents="none" accessibilityElementsHidden>
                    <Checkbox checked={values.includes(source.id)} onChange={() => {}} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text variant="subheading" numberOfLines={1}>
                      {source.name}
                    </Text>
                    <Text variant="micro" tone="muted" mono>
                      {t('transaction:list.row.meta', {
                        category: t(sourceTypeLabelKey(source.type)),
                        source: source.default_currency,
                      })}
                    </Text>
                  </View>
                  {source.balance === null ? null : (
                    <Text variant="caption" tone="secondary" mono numberOfLines={1}>
                      {money(source.balance, source.default_currency)}
                    </Text>
                  )}
                </Pressable>
              ))}
            </React.Fragment>
          ))}
        </View>
      ) : (
        <MultiSelect
          placeholder={t('transaction:list.filter.source_placeholder')}
          closeLabel={t('common:button.close')}
          options={options}
          values={values}
          selectedLabel={summary}
          renderOption={titled ? renderOption : undefined}
          onChange={(next) => props.onPatch({ source_id: next.length > 0 ? next : undefined })}
          testID={`${props.id}-source`}
        />
      )}
    </FilterField>
  );
}

export interface FilterSheetProps extends FilterFieldProps {
  open: boolean;
  onClose(): void;
  onClear(): void;
  qDraft: string;
  onQChange(value: string): void;
  /** How many entries the filters currently match — the 「应用 · N 笔」 button's number. */
  total: number;
}

export function FilterSheet(props: FilterSheetProps): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();

  return (
    <Sheet
      open={props.open}
      onClose={props.onClose}
      testID={`${props.id}-sheet`}
    >
      {/* 屏幕稿 02 · 交易筛选 375 sets 「筛选」 and 「重置」 on one baseline, and draws no ×:
          the drag handle, the backdrop and the pinned 「应用 · N 笔」 button are the three
          ways out. `Sheet` takes a plain string title and no action slot, and would put its
          own × on a row of its own, so neither `title` nor `closeLabel` is passed and the
          title row is drawn here. */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: space['3'],
          paddingBottom: space['2'],
        }}
      >
        <Text variant="subheading" weight={700} testID={`${props.id}-sheet-title`}>
          {t('transaction:list.filter.title')}
        </Text>
        <Button
          variant="ghost"
          size="sm"
          label={t('transaction:list.filter.reset')}
          onPress={props.onClear}
          testID={`${props.id}-reset`}
        />
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" style={{ flexGrow: 0 }}>
        <View
          testID={`${props.id}-controls`}
          style={{ gap: space['4'], paddingBottom: space['4'] }}
        >
          <KeywordField
            value={props.qDraft}
            onChange={props.onQChange}
            id={`${props.id}-sheet-q`}
          />
          <KindChips {...props} />
          <SourceField {...props} inline />
          <CurrencyChips {...props} />
          <DateRangeField {...props} />
          <View style={{ flexDirection: 'row', gap: space['2'] }}>
            <View style={{ flex: 1 }}>
              <CategoryField {...props} level={1} />
            </View>
            <View style={{ flex: 1 }}>
              <CategoryField {...props} level={2} />
            </View>
          </View>
          <AmountRangeField {...props} longHint />
        </View>
      </ScrollView>

      <View
        style={{
          borderTopWidth: 1,
          borderTopColor: colors['border.default'],
          paddingTop: space['3'],
        }}
      >
        <Button
          label={t('transaction:list.filter.apply', { count: props.total })}
          size="lg"
          fullWidth
          onPress={props.onClose}
          testID={`${props.id}-done`}
        />
      </View>
    </Sheet>
  );
}
