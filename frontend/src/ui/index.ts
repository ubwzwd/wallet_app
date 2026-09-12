/**
 * The component library (04 §6.4). One barrel for everything under `src/ui/`.
 *
 * The first group is presentation-only: nothing there knows about the API, the router or
 * i18n — user-facing strings arrive as props. The second group is domain-aware (pickers,
 * money/date inputs, charts, the operations timeline): those components know the app's
 * types, formatters and language pack, but still nothing about the API, the query cache
 * or the router — everything they render arrives as props.
 */
export * from './Badge';
export * from './Button';
export * from './Card';
export * from './Checkbox';
export * from './Chip';
export * from './ConfirmDialog';
export * from './Divider';
export * from './EmptyState';
export * from './Icon';
export * from './Page';
export * from './ProgressBar';
export * from './SegmentedControl';
export * from './Select';
export * from './Sheet';
export * from './Skeleton';
export * from './StatTile';
export * from './Switch';
export * from './Text';
export * from './TextField';
export * from './Toast';

export * from './AmountField';
export * from './BarList';
export * from './CategoryPicker';
export * from './CurrencyPicker';
export * from './DateField';
export * from './EventTimeline';
export * from './FilterChips';
export * from './KeyboardHint';
export * from './KindBadge';
export * from './MoneyText';
export * from './MonthSwitcher';
export * from './SourcePicker';
export * from './TrendChart';
