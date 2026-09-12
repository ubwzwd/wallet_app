/**
 * Toast (04 §3.9, §6.4): an imperative API backed by a module-level store, so any layer —
 * mutation callbacks, the axios error normaliser, a screen — can raise one without a ref.
 * success / warning / info disappear after 4s; errors stay until dismissed and can expand
 * their `detail`. Bottom-right on wide layouts, above the tab bar on narrow ones.
 */
import React from 'react';
import { Pressable, type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';
import { type ColorToken, radius, space, z } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { useIsWide } from '@/theme/useBreakpoint';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export type ToastKind = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: string;
  kind: ToastKind;
  message: string;
  /** Errors only: the technical detail behind the message, hidden until expanded. */
  detail?: string;
}

export interface ToastOptions {
  detail?: string;
  /** Milliseconds; `0` pins the toast. Defaults to 4000, or 0 for errors. */
  duration?: number;
}

/** 04 §3.9: 4 seconds for everything that is not an error. */
export const TOAST_DURATION = 4000;

type Listener = () => void;

let items: readonly ToastItem[] = [];
const listeners = new Set<Listener>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
let seq = 0;

function emit(): void {
  for (const l of listeners) l();
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): readonly ToastItem[] {
  return items;
}

function dismiss(id: string): void {
  const timer = timers.get(id);
  if (timer !== undefined) {
    clearTimeout(timer);
    timers.delete(id);
  }
  const next = items.filter((t) => t.id !== id);
  if (next.length === items.length) return;
  items = next;
  emit();
}

function push(kind: ToastKind, message: string, options?: ToastOptions): string {
  seq += 1;
  const id = `toast-${seq}`;
  items = [...items, { id, kind, message, detail: options?.detail }];
  emit();
  const duration = options?.duration ?? (kind === 'error' ? 0 : TOAST_DURATION);
  if (duration > 0) timers.set(id, setTimeout(() => dismiss(id), duration));
  return id;
}

export const toast = {
  success: (message: string, options?: ToastOptions) => push('success', message, options),
  error: (message: string, options?: ToastOptions) => push('error', message, options),
  warning: (message: string, options?: ToastOptions) => push('warning', message, options),
  info: (message: string, options?: ToastOptions) => push('info', message, options),
  dismiss,
  /** Test / logout helper: drop everything on screen. */
  clear(): void {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    if (items.length === 0) return;
    items = [];
    emit();
  },
  peek(): readonly ToastItem[] {
    return items;
  },
};

const KIND_STYLE: Readonly<Record<ToastKind, { fg: ColorToken; bg: ColorToken; icon: IconName }>> =
  {
    success: { fg: 'status.success.fg', bg: 'status.success.bg', icon: 'check' },
    error: { fg: 'status.danger.fg', bg: 'status.danger.bg', icon: 'alert-triangle' },
    warning: { fg: 'status.warning.fg', bg: 'status.warning.bg', icon: 'alert-triangle' },
    info: { fg: 'status.info.fg', bg: 'status.info.bg', icon: 'info' },
  };

export interface ToastHostProps {
  /** Clearance for the bottom tab bar on narrow layouts. */
  bottomOffset?: number;
  /** Accessible name of the × button; falls back to the toast message. */
  closeLabel?: string;
  /** Label of the "show detail" toggle; falls back to the message. */
  detailLabel?: string;
  style?: StyleProp<ViewStyle>;
}

function ToastRow({
  item,
  closeLabel,
  detailLabel,
}: {
  item: ToastItem;
  closeLabel?: string;
  detailLabel?: string;
}): React.JSX.Element {
  const colors = useColors();
  const [expanded, setExpanded] = React.useState(false);
  const paint = KIND_STYLE[item.kind];
  return (
    <View
      accessibilityLiveRegion="polite"
      testID={`toast-${item.kind}`}
      style={[
        styles.toast,
        { backgroundColor: colors[paint.bg], borderColor: colors[paint.fg] },
      ]}
    >
      <View style={styles.toastRow}>
        <Icon name={paint.icon} size={18} color={colors[paint.fg]} />
        <View style={styles.toastBody}>
          <Text variant="body" style={{ color: colors[paint.fg] }}>
            {item.message}
          </Text>
          {expanded && item.detail !== undefined ? (
            <Text variant="caption" tone="muted" testID="toast-detail">
              {item.detail}
            </Text>
          ) : null}
        </View>
        {item.detail !== undefined ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={detailLabel ?? item.message}
            accessibilityState={{ expanded }}
            onPress={() => setExpanded((v) => !v)}
            hitSlop={space['2']}
            testID="toast-detail-toggle"
          >
            <Icon
              name={expanded ? 'chevron-down' : 'chevron-right'}
              size={18}
              color={colors[paint.fg]}
            />
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={closeLabel ?? item.message}
          onPress={() => dismiss(item.id)}
          hitSlop={space['2']}
          testID="toast-close"
        >
          <Icon name="x" size={18} color={colors[paint.fg]} />
        </Pressable>
      </View>
    </View>
  );
}

export function ToastHost({
  bottomOffset = 0,
  closeLabel,
  detailLabel,
  style,
}: ToastHostProps): React.JSX.Element | null {
  const current = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const wide = useIsWide();
  if (current.length === 0) return null;
  return (
    <View
      pointerEvents="box-none"
      testID="toast-host"
      style={[
        styles.host,
        {
          zIndex: z.toast,
          bottom: space['4'] + bottomOffset,
          alignItems: wide ? 'flex-end' : 'stretch',
        },
        style,
      ]}
    >
      {current.map((item) => (
        <ToastRow key={item.id} item={item} closeLabel={closeLabel} detailLabel={detailLabel} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: space['4'],
    right: space['4'],
    gap: space['2'],
  },
  toast: {
    borderRadius: radius.md,
    borderWidth: 1,
    padding: space['3'],
    maxWidth: 420,
    width: '100%',
  },
  toastRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space['2'] },
  toastBody: { flex: 1, gap: space['1'] },
});
