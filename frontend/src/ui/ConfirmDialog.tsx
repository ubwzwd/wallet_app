/**
 * Confirmation dialog (04 §3.9): `await confirm({...})` anywhere, one Modal implementation
 * for both platforms — no more `Alert.alert` (a no-op on web) or `window.confirm`.
 *
 * Dangerous operations (delete ledger, undo an import, delete an account) take either
 * `requireText` — the user must type the word back — or `doubleTap`.
 */
import React from 'react';
import { Modal, StyleSheet, View } from 'react-native';
import { radius, space, z } from '@/theme/tokens';
import { useTheme } from '@/theme/ThemeProvider';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';
import { TextField } from './TextField';

export interface ConfirmOptions {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'default' | 'danger';
  /** The user must type this word exactly before the confirm button unlocks. */
  requireText?: string;
  /** The first press arms the button, the second confirms. */
  doubleTap?: boolean;
  /** Label while armed; falls back to the host's `labels.confirmAgain`. */
  confirmAgainLabel?: string;
  /** Accessible name / placeholder for the `requireText` input; falls back to the word. */
  requireTextLabel?: string;
  /** The glyph in the dialog's round well (mockups 11 / 12); omit for no well. */
  icon?: IconName;
  /** The mono line under the title: which file, which batch, which ledger. */
  meta?: string;
}

interface PendingConfirm {
  id: number;
  options: ConfirmOptions;
  resolve(result: boolean): void;
}

type Listener = () => void;

let pending: PendingConfirm | null = null;
const listeners = new Set<Listener>();
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

function getSnapshot(): PendingConfirm | null {
  return pending;
}

function settle(result: boolean): void {
  const current = pending;
  pending = null;
  emit();
  current?.resolve(result);
}

/** Resolves `true` only if the user confirms; a second call supersedes the first. */
export function confirm(options: ConfirmOptions): Promise<boolean> {
  if (pending !== null) settle(false);
  seq += 1;
  return new Promise<boolean>((resolve) => {
    pending = { id: seq, options, resolve };
    emit();
  });
}

export interface ConfirmHostLabels {
  confirm: string;
  cancel: string;
  /** Shown on the armed button when `doubleTap` is set. */
  confirmAgain: string;
}

export interface ConfirmHostProps {
  /** Defaults for calls that do not pass their own labels; supplied from the language pack. */
  labels: ConfirmHostLabels;
}

export function ConfirmHost({ labels }: ConfirmHostProps): React.JSX.Element | null {
  const current = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const { colors } = useTheme();
  const [typed, setTyped] = React.useState('');
  const [armed, setArmed] = React.useState(false);

  const id = current?.id;
  React.useEffect(() => {
    setTyped('');
    setArmed(false);
  }, [id]);

  if (!current) return null;
  const o = current.options;
  const danger = o.tone === 'danger';
  const textOk = o.requireText === undefined || typed.trim() === o.requireText;

  const onConfirm = (): void => {
    if (!textOk) return;
    if (o.doubleTap === true && !armed) {
      setArmed(true);
      return;
    }
    settle(true);
  };

  const confirmLabel =
    o.doubleTap === true && armed
      ? (o.confirmAgainLabel ?? labels.confirmAgain)
      : (o.confirmLabel ?? labels.confirm);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => settle(false)}>
      <View style={[styles.root, { zIndex: z.overlay }]}>
        <View
          style={[styles.backdrop, { backgroundColor: colors['fg.primary'], opacity: 0.4 }]}
        />
        <View
          accessibilityViewIsModal
          accessibilityRole="alert"
          testID="confirm-dialog"
          style={[
            styles.dialog,
            {
              backgroundColor: colors['bg.raised'],
              // A dangerous dialog wears a warm edge so it does not look like a save prompt.
              borderColor: danger ? colors['status.danger.bg'] : colors['border.default'],
            },
          ]}
        >
          <View style={styles.head}>
            {o.icon !== undefined ? (
              <View
                style={[
                  styles.well,
                  {
                    backgroundColor: danger ? colors['status.danger.bg'] : colors['accent.subtle'],
                  },
                ]}
              >
                <Icon
                  name={o.icon}
                  size={22}
                  color={danger ? colors['status.danger.fg'] : colors['accent.solid']}
                />
              </View>
            ) : null}
            <View style={styles.headText}>
              <Text variant="heading" weight={700}>
                {o.title}
              </Text>
              {o.meta !== undefined ? (
                <Text variant="caption" tone="muted" mono testID="confirm-meta">
                  {o.meta}
                </Text>
              ) : null}
            </View>
          </View>
          {o.body !== undefined ? (
            <Text variant="body" tone="secondary">
              {o.body}
            </Text>
          ) : null}
          {o.requireText !== undefined ? (
            <TextField
              value={typed}
              onChangeText={setTyped}
              label={o.requireTextLabel ?? o.requireText}
              accessibilityLabel={o.requireTextLabel ?? o.requireText}
              autoCapitalize="none"
              autoCorrect={false}
              testID="confirm-require-text"
            />
          ) : null}
          <View style={styles.actions}>
            <Button
              label={o.cancelLabel ?? labels.cancel}
              variant="secondary"
              onPress={() => settle(false)}
              testID="confirm-cancel"
            />
            <Button
              label={confirmLabel}
              variant={danger ? 'danger' : 'primary'}
              disabled={!textOk}
              onPress={onConfirm}
              testID="confirm-accept"
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space['4'] },
  backdrop: { ...StyleSheet.absoluteFillObject },
  dialog: {
    width: '100%',
    maxWidth: 420,
    gap: space['3'],
    padding: space['5'],
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: space['2'],
    marginTop: space['1'],
  },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: space['3'] + 2 },
  headText: { flex: 1, minWidth: 0, gap: space['1'] },
  well: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
