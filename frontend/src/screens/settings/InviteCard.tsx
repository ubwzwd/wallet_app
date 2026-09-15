/**
 * Ledger settings → invite code (屏幕稿 12, 04 §4.12, decisions §2, §14.29, §14.35, §14.52 A2 / B7).
 *
 * The panel lives inside the members card. Idle it is one line of prose plus 「生成邀请码」;
 * live it is the mockup's tinted block — six white digit tiles in mono, a mono countdown
 * with a progress bar, and 复制 / 作废 underneath.
 *
 * The code exists only in this component's state: the server returns it once and never
 * again, and a join deletes the row outright — so "used" is not a state we can poll for.
 * What we can see is the member list growing while a code is outstanding, which is what
 * turns the panel into "used by <name>".
 */
import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import type { LedgerInvite, LedgerMember, Uuid } from '@/api/types';
import { formatCountdown } from '@/i18n/format';
import { memberLabel, useCreateInvite, useRevokeInvite } from '@/queries';
import { radius, space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { useIsWide } from '@/theme/useBreakpoint';
import { Button, Icon, ProgressBar, Text, confirm, toast } from '@/ui';

import { MAX_MEMBERS } from './MembersCard';

/** Decision §2: a code lives ten minutes; the bar is drawn against that span. */
const DEFAULT_LIFETIME_SECONDS = 600;

/** Seconds left until `expires_at`, floored at 0. */
function secondsUntil(expiresAt: string, now: number): number {
  return Math.max(0, Math.floor((new Date(expiresAt).getTime() - now) / 1000));
}

/** How long the code was issued for, from the pair the server returned. */
function lifetimeSeconds(invite: LedgerInvite): number {
  const span = (new Date(invite.expires_at).getTime() - new Date(invite.created_at).getTime()) / 1000;
  return Number.isFinite(span) && span > 0 ? span : DEFAULT_LIFETIME_SECONDS;
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

/** One of the six white tiles the mockup draws the code in. */
function CodeTile({ char, muted }: { char: string; muted: boolean }): React.JSX.Element {
  const colors = useColors();
  const wide = useIsWide();
  return (
    <View
      style={{
        width: wide ? 46 : 44,
        height: wide ? 58 : 56,
        borderRadius: radius.md - 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors['bg.raised'],
      }}
    >
      <Text
        variant="title"
        mono
        weight={500}
        style={{
          fontSize: 27,
          lineHeight: 34,
          letterSpacing: 0,
          color: muted ? colors['fg.muted'] : colors['fg.primary'],
        }}
      >
        {char}
      </Text>
    </View>
  );
}

export interface InviteCardProps {
  ledgerId: Uuid;
  members: readonly LedgerMember[];
  /** `false` while `GET /ledgers/{id}/members` is still in flight. */
  membersLoaded: boolean;
}

export function InviteCard({
  ledgerId,
  members,
  membersLoaded,
}: InviteCardProps): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  const wide = useIsWide();
  const create = useCreateInvite(ledgerId);
  const revoke = useRevokeInvite(ledgerId);

  const [invite, setInvite] = React.useState<LedgerInvite | null>(null);
  const [usedBy, setUsedBy] = React.useState<string | null>(null);
  const [now, setNow] = React.useState(() => Date.now());
  // Who was in the ledger when the current code was handed out, so a newcomer stands out.
  // The baseline is only meaningful once it was taken from a loaded member list: taking
  // it from an empty, still-pending list would make every member look like a newcomer and
  // throw the one-shot code away.
  const knownIds = React.useRef<readonly Uuid[]>([]);
  const baselineReady = React.useRef(false);
  // The latest list, so the baseline is taken when the code actually arrives.
  const membersRef = React.useRef(members);
  membersRef.current = members;
  const loadedRef = React.useRef(membersLoaded);
  loadedRef.current = membersLoaded;

  const secondsLeft = invite ? secondsUntil(invite.expires_at, now) : 0;
  const expired = invite !== null && secondsLeft === 0;

  // One ticking interval, alive only while a live code is on screen (04 §4.12).
  React.useEffect(() => {
    if (invite === null || expired) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [invite, expired]);

  // A code that arrived before the member list did still gets a baseline, from the first
  // list that lands — the code is kept, only the "used by" comparison starts later.
  React.useEffect(() => {
    if (invite === null || baselineReady.current || !membersLoaded) return;
    knownIds.current = members.map((m) => m.user_id);
    baselineReady.current = true;
  }, [invite, members, membersLoaded]);

  // Decision §14.29: joining deletes the code server-side. A member who was not there
  // when the code was issued is the person who used it.
  React.useEffect(() => {
    if (invite === null || !baselineReady.current) return;
    const newcomer = members.find((m) => !knownIds.current.includes(m.user_id));
    if (!newcomer) return;
    setUsedBy(memberLabel(newcomer));
    setInvite(null);
  }, [invite, members]);

  const atLimit = members.length >= MAX_MEMBERS;
  // Without a loaded member list there is no baseline to compare a newcomer against.
  const canGenerate = membersLoaded && !atLimit;

  const generate = (): void => {
    baselineReady.current = false;
    setUsedBy(null);
    create.mutate(undefined, {
      onSuccess: (next) => {
        // Taken here, from the list as it stands when the code lands, so a member list
        // that resolved during the request is part of the baseline rather than a newcomer.
        knownIds.current = membersRef.current.map((m) => m.user_id);
        baselineReady.current = loadedRef.current;
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
        icon: 'x',
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

  if (invite === null) {
    return (
      <View
        testID="invite-card"
        style={{
          flexDirection: wide ? 'row' : 'column',
          alignItems: wide ? 'center' : 'stretch',
          gap: space['3'] + 2,
        }}
      >
        <View style={{ flex: wide ? 1 : undefined, minWidth: 0, gap: space['1'] }}>
          {usedBy === null ? null : (
            <Text tone="success" weight={600} testID="invite-used-by">
              {t('ledger:settings.invite.used_by', { name: usedBy })}
            </Text>
          )}
          <Text variant="body" tone="muted" testID="invite-hint">
            {t('ledger:settings.invite.idle_hint')}
          </Text>
          {atLimit ? (
            <Text variant="caption" tone="warning" testID="invite-limit">
              {t('ledger:settings.invite.limit_reached')}
            </Text>
          ) : null}
        </View>
        <Button
          testID="invite-generate"
          label={t('ledger:settings.invite.generate')}
          icon="users"
          onPress={generate}
          loading={create.isPending}
          disabled={!canGenerate}
          fullWidth={!wide}
        />
      </View>
    );
  }

  const digits = [...invite.code];
  const fraction = Math.max(0, Math.min(1, secondsLeft / lifetimeSeconds(invite)));
  // The countdown is one sentence with one mono number in it, and the number sits before
  // the words in Chinese and after them in English — so the template is split rather than
  // interpolated, and the two halves keep the language pack's own word order.
  const [before, after] = t('ledger:settings.invite.expires_in', { time: ' ' }).split(' ');

  return (
    <View
      testID="invite-card"
      style={{
        borderRadius: radius.lg - 2,
        padding: wide ? space['5'] : space['4'],
        gap: space['4'],
        backgroundColor: colors['bg.selected'],
        flexDirection: wide ? 'row' : 'column',
        alignItems: wide ? 'flex-start' : 'stretch',
      }}
    >
      <View style={{ gap: space['2'], alignItems: wide ? 'flex-start' : 'center' }}>
        <Text
          variant="micro"
          mono
          weight={600}
          style={{ color: colors['accent.solid'], letterSpacing: 0.9 }}
        >
          {t('ledger:settings.invite.title')}
        </Text>
        <View
          accessibilityLabel={t('ledger:settings.invite.code_label', { code: invite.code })}
          testID="invite-code"
          style={{ flexDirection: 'row', gap: space['1'] + 2 }}
        >
          {digits.map((char, i) => (
            <CodeTile key={i} char={char} muted={expired} />
          ))}
        </View>
      </View>

      <View style={{ flex: wide ? 1 : undefined, minWidth: 0, gap: space['2'] + 2 }}>
        {expired ? (
          <Text variant="body" tone="warning" weight={600} testID="invite-expired">
            {t('ledger:settings.invite.expired')}
          </Text>
        ) : (
          <>
            <Text
              variant="body"
              style={{ color: colors['accent.solid'] }}
              testID="invite-countdown"
            >
              {before}
              <Text
                mono
                weight={500}
                // 20/26 — the mockup's countdown, one step above the prose around it.
                style={{ fontSize: 20, lineHeight: 26, color: colors['accent.solid'] }}
              >
                {formatCountdown(secondsLeft)}
              </Text>
              {after}
            </Text>
            <ProgressBar
              value={fraction}
              accessibilityLabel={t('ledger:settings.invite.countdown_label')}
              // The bar sits on the tinted panel, where its own `bg.subtle` track is all
              // but invisible; `border.strong` is the darker track the mockup draws.
              style={{ backgroundColor: colors['border.strong'] }}
              testID="invite-progress"
            />
          </>
        )}

        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space['2'] + 2 }}>
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
          {expired ? (
            <Button
              testID="invite-regenerate"
              label={t('ledger:settings.invite.regenerate')}
              variant="secondary"
              size="sm"
              onPress={generate}
              loading={create.isPending}
              disabled={!canGenerate}
            />
          ) : (
            <Button
              testID="invite-revoke"
              label={t('ledger:settings.invite.revoke')}
              variant="danger"
              size="sm"
              onPress={onRevoke}
              loading={revoke.isPending}
            />
          )}
        </View>
        <Text variant="caption" tone="secondary" testID="invite-retry-hint">
          {t('ledger:settings.invite.retry_hint')}
        </Text>
      </View>
    </View>
  );
}

export default InviteCard;
