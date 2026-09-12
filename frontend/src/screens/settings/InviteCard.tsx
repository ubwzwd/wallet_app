/**
 * Ledger settings → invite code (04 §4.12, decisions §2, §14.29, §14.35, §14.52 A2 / B7).
 *
 * The code exists only in this component's state: the server returns it once and never
 * again, and a join deletes the row outright — so "used" is not a state we can poll for.
 * What we can see is the member list growing while a code is outstanding, which is what
 * turns the card into "used by <name>".
 */
import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { LedgerInvite, LedgerMember, Uuid } from '@/api/types';
import { formatCountdown } from '@/i18n/format';
import { memberLabel, useCreateInvite, useRevokeInvite } from '@/queries';
import { radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { Button, Card, Text, confirm, toast } from '@/ui';

import { MAX_MEMBERS } from './MembersSection';

/** Seconds left until `expires_at`, floored at 0. */
function secondsUntil(expiresAt: string, now: number): number {
  return Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000));
}

/**
 * Copy to the system clipboard where the platform offers one. `expo-clipboard` is not a
 * dependency of this phase, so the web's `navigator.clipboard` is the only route; on a
 * platform without it the button simply isn't rendered.
 */
function clipboard(): { writeText(text: string): Promise<void> } | null {
  if (typeof navigator === 'undefined') return null;
  const c = (navigator as Navigator & { clipboard?: { writeText(t: string): Promise<void> } })
    .clipboard;
  return c && typeof c.writeText === 'function' ? c : null;
}

export interface InviteCardProps {
  ledgerId: Uuid;
  members: readonly LedgerMember[];
}

export function InviteCard({ ledgerId, members }: InviteCardProps): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  const create = useCreateInvite(ledgerId);
  const revoke = useRevokeInvite(ledgerId);

  const [invite, setInvite] = React.useState<LedgerInvite | null>(null);
  const [usedBy, setUsedBy] = React.useState<string | null>(null);
  const [now, setNow] = React.useState(() => Date.now());
  // Who was in the ledger when the current code was handed out, so a newcomer stands out.
  const knownIds = React.useRef<readonly Uuid[]>([]);

  const secondsLeft = invite ? secondsUntil(invite.expires_at, now) : 0;
  const expired = invite !== null && secondsLeft === 0;

  // One ticking interval, alive only while a live code is on screen (04 §4.12).
  React.useEffect(() => {
    if (invite === null || expired) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [invite, expired]);

  // Decision §14.29: joining deletes the code server-side. A member who was not there
  // when the code was issued is the person who used it.
  React.useEffect(() => {
    if (invite === null) return;
    const newcomer = members.find((m) => !knownIds.current.includes(m.user_id));
    if (!newcomer) return;
    setUsedBy(memberLabel(newcomer));
    setInvite(null);
  }, [invite, members]);

  const atLimit = members.length >= MAX_MEMBERS;

  const generate = (): void => {
    knownIds.current = members.map((m) => m.user_id);
    setUsedBy(null);
    create.mutate(undefined, {
      onSuccess: (next) => {
        setInvite(next);
        setNow(Date.now());
      },
    });
  };

  const onRevoke = (): void => {
    const code = invite?.code;
    if (!code) return;
    void (async () => {
      const ok = await confirm({
        title: t('ledger:settings.invite.revoke_title'),
        body: t('ledger:settings.invite.revoke_confirm'),
        tone: 'danger',
        confirmLabel: t('ledger:settings.invite.revoke'),
      });
      if (!ok) return;
      revoke.mutate(code, {
        onSuccess: () => {
          setInvite(null);
          toast.success(t('ledger:settings.invite.revoked_toast'));
        },
      });
    })();
  };

  const onCopy = (): void => {
    const code = invite?.code;
    const target = clipboard();
    if (!code || !target) return;
    void target.writeText(code).then(
      () => toast.success(t('ledger:settings.invite.copied_toast')),
      () => undefined,
    );
  };

  return (
    <Card variant="outlined" style={{ gap: space['3'] }} testID="invite-card">
      <Text variant="heading" accessibilityRole="header">
        {t('ledger:settings.invite.title')}
      </Text>

      {invite === null ? (
        <View style={{ gap: space['2'] }}>
          {usedBy === null ? null : (
            <Text tone="success" testID="invite-used-by">
              {t('ledger:settings.invite.used_by', { name: usedBy })}
            </Text>
          )}
          <Button
            testID="invite-generate"
            label={t('ledger:settings.invite.generate')}
            size="sm"
            onPress={generate}
            loading={create.isPending}
            disabled={atLimit}
          />
          {atLimit ? (
            <Text variant="caption" tone="warning" testID="invite-limit">
              {t('ledger:settings.invite.limit_reached')}
            </Text>
          ) : null}
        </View>
      ) : (
        <View style={{ gap: space['2'] }}>
          <Text
            variant="title"
            mono
            accessibilityLabel={t('ledger:settings.invite.code_label', { code: invite.code })}
            testID="invite-code"
            style={{
              letterSpacing: 8,
              paddingVertical: space['2'],
              paddingHorizontal: space['3'],
              borderRadius: radius.md,
              backgroundColor: colors['bg.subtle'],
              color: expired ? colors['fg.muted'] : colors['fg.primary'],
            }}
          >
            {invite.code}
          </Text>
          {expired ? (
            <Text variant="caption" tone="warning" testID="invite-expired">
              {t('ledger:settings.invite.expired')}
            </Text>
          ) : (
            <Text variant="caption" tone="secondary" testID="invite-countdown">
              {t('ledger:settings.invite.expires_in', { time: formatCountdown(secondsLeft) })}
            </Text>
          )}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space['2'] }}>
            {!expired && clipboard() !== null ? (
              <Button
                testID="invite-copy"
                label={t('common:button.copy')}
                icon="copy"
                variant="secondary"
                size="sm"
                onPress={onCopy}
              />
            ) : null}
            <Button
              testID="invite-revoke"
              label={t('ledger:settings.invite.revoke')}
              variant="secondary"
              size="sm"
              onPress={onRevoke}
              loading={revoke.isPending}
            />
            <Button
              testID="invite-regenerate"
              label={t('ledger:settings.invite.regenerate')}
              variant="secondary"
              size="sm"
              onPress={generate}
              loading={create.isPending}
              disabled={atLimit}
            />
          </View>
        </View>
      )}

      <Text variant="caption" tone="secondary" testID="invite-hint">
        {t('ledger:settings.invite.hint')}
      </Text>
      <Text variant="caption" tone="muted" testID="invite-retry-hint">
        {t('ledger:settings.invite.retry_hint')}
      </Text>
    </Card>
  );
}

export default InviteCard;
