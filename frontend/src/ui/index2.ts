/**
 * The domain-aware half of the component library (04 §6.4): pickers, money/date inputs,
 * charts and the operations timeline. Unlike `./index.ts` these components know about the
 * app's types, formatters and language pack — but still nothing about the API, the query
 * cache or the router: everything they render arrives as props.
 *
 * Kept separate from `index.ts` only so two parallel tasks don't fight over one barrel;
 * the shell task merges them.
 */
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
