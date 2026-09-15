/**
 * The five ways an upload can be refused (04 §4.10 step 1's table), drawn as 屏幕稿 10's
 * two failure cards: a tinted strip carrying the icon, the headline and the explanation,
 * then the detail, then a foot strip with the hint on the left and the actions on the
 * right. Structural failures wear the red tint, an outdated skill the warm one.
 *
 * All five stop the user on the upload page and none of them produces a batch, so the
 * card is the whole failure UI — the mutations that feed it are `{ silent: true }` and
 * the global error toast stays out of the way (04 §3.9).
 *
 * Two of the five carry structured fields (04 §3.3 `ImportFileError`, decision §14.53f):
 *  - `import_format_invalid` → `errors[{line, message}]`, rendered by **file line number**
 *    (1-based physical lines: `# version:` is line 1, the header line 2), capped at 20
 *    with the rest folded away, plus `[copy error list]` which copies the same `errors[]`
 *    as plain text (decision §14.52 A18);
 *  - `skill_outdated` → `current_version` / `file_version` and `guide_url`, which is the
 *    button's navigation target — this path is never hardcoded here. There is deliberately
 *    no "ignore and continue": a version mismatch is a hard refusal (decision §14.30).
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { type ApiClientError } from '@/api/errors';
import type { ImportFileError } from '@/api/types';
import { errorMessage } from '@/i18n/errorCodes';
import { space } from '@/theme/tokens';
import { useColors } from '@/theme/ThemeProvider';
import { Button, Icon, ListCard, Text, toast } from '@/ui';

import { copyText } from './useCopyText';

/** 04 §4.10: at most 20 line errors are listed, the rest collapse into a counter. */
export const MAX_LISTED_ERRORS = 20;

export interface UploadErrorCardProps {
  error: ApiClientError;
  /** Clears the chosen file / pasted text and puts the user back on the picker. */
  onReselect(): void;
  /** Navigates to the guide — the caller decides the target from `guide_url`. */
  onOpenGuide(guideUrl: string | undefined): void;
  testID?: string;
}

/** The structured half of the response body, when the server sent one. */
function fileError(error: ApiClientError): ImportFileError | null {
  const payload = error.payload;
  if (typeof payload !== 'object' || payload === null) return null;
  return payload as ImportFileError;
}

/** The row count the backend names in `detail` ("文件有 2431 行，…"), when it is there. */
function rowCountFromDetail(detail: string): number | null {
  const match = /\d+/.exec(detail);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : null;
}

interface StripProps {
  tone: 'danger' | 'warning';
  title: string;
  body: string;
  bodyTestID?: string;
  testID: string;
}

/** The card's tinted head: icon well, headline, one explaining sentence. */
function Strip({ tone, title, body, bodyTestID, testID }: StripProps): React.JSX.Element {
  const colors = useColors();
  return (
    <View
      style={[
        styles.strip,
        { backgroundColor: colors[tone === 'danger' ? 'status.danger.bg' : 'status.warning.bg'] },
      ]}
    >
      <Icon
        name="alert-triangle"
        size={20}
        color={colors[tone === 'danger' ? 'status.danger.fg' : 'status.warning.fg']}
      />
      <View style={styles.stripText}>
        <Text variant="subheading" weight={700} testID={`${testID}-title`}>
          {title}
        </Text>
        <Text variant="body" tone={tone} testID={bodyTestID}>
          {body}
        </Text>
      </View>
    </View>
  );
}

export function UploadErrorCard({
  error,
  onReselect,
  onOpenGuide,
  testID = 'upload-error',
}: UploadErrorCardProps): React.JSX.Element {
  const { t } = useTranslation();
  const colors = useColors();
  const [expanded, setExpanded] = React.useState(false);
  const body = fileError(error);

  // Every `[{line, message}]` as one plain-text block — exactly what is on screen.
  const lineErrors = React.useMemo(
    () => (Array.isArray(body?.errors) ? body.errors : []),
    [body],
  );
  const errorText = React.useMemo(
    () =>
      lineErrors
        .map((e) => t('import:upload.error.line_error', { line: e.line, message: e.message }))
        .join('\n'),
    [lineErrors, t],
  );

  const reselect = (
    <Button
      testID={`${testID}-reselect`}
      label={t('import:upload.error.reselect')}
      onPress={onReselect}
    />
  );

  const foot = (hint: string, actions: React.ReactNode): React.JSX.Element => (
    <View style={[styles.foot, { backgroundColor: colors['bg.canvas'] }]}>
      <Text variant="caption" tone="muted" style={styles.hint} testID={`${testID}-copy-hint`}>
        {hint}
      </Text>
      <View style={styles.actions}>{actions}</View>
    </View>
  );

  if (error.code === 'import_format_invalid') {
    const shown = expanded ? lineErrors : lineErrors.slice(0, MAX_LISTED_ERRORS);
    const hidden = lineErrors.length - shown.length;
    return (
      <ListCard
        divided
        testID={testID}
        header={
          <Strip
            tone="danger"
            testID={testID}
            title={t('import:upload.error.structure_title')}
            body={errorMessage(t, error)}
          />
        }
        footer={foot(
          t('import:upload.error.copy_hint'),
          <>
            <Button
              testID={`${testID}-copy`}
              label={t('import:upload.error.copy_errors')}
              icon="copy"
              variant="soft"
              onPress={() => {
                void copyText(errorText).then((ok) => {
                  if (ok) toast.success(t('import:upload.error.copied_toast'));
                });
              }}
            />
            {reselect}
          </>,
        )}
      >
        <View style={styles.lines} testID={`${testID}-lines`}>
          {shown.map((e, i) => (
            <Text
              key={`${e.line}-${i}`}
              variant="caption"
              mono
              tone="danger"
              style={styles.line}
              testID={`${testID}-line-${i}`}
            >
              {t('import:upload.error.line_error', { line: e.line, message: e.message })}
            </Text>
          ))}
          {hidden > 0 ? (
            <Button
              testID={`${testID}-more`}
              label={t('import:upload.error.more_hidden', { count: hidden })}
              variant="ghost"
              size="sm"
              onPress={() => setExpanded(true)}
            />
          ) : null}
        </View>
      </ListCard>
    );
  }

  if (error.code === 'skill_outdated') {
    return (
      <ListCard
        testID={testID}
        header={
          <Strip
            tone="warning"
            testID={testID}
            bodyTestID={`${testID}-versions`}
            title={t('import:upload.error.skill_outdated_title')}
            body={t('import:upload.error.skill_outdated_body', {
              fileVersion: body?.file_version ?? '—',
              currentVersion: body?.current_version ?? '—',
            })}
          />
        }
      >
        <View style={styles.plainActions}>
          <Button
            testID={`${testID}-guide`}
            label={t('import:upload.error.go_to_guide')}
            onPress={() => onOpenGuide(body?.guide_url)}
          />
          <Button
            testID={`${testID}-reselect`}
            label={t('import:upload.error.reselect')}
            variant="soft"
            onPress={onReselect}
          />
        </View>
      </ListCard>
    );
  }

  const message =
    error.code === 'file_too_large'
      ? t('import:upload.error.file_too_large')
      : error.code === 'import_rate_limited'
        ? t('import:upload.error.rate_limited')
        : error.code === 'rows_exceed_limit'
          ? ((): string => {
              const rows = rowCountFromDetail(error.detail);
              return rows === null
                ? errorMessage(t, error)
                : t('import:upload.error.rows_exceed_limit', { rows });
            })()
          : errorMessage(t, error);

  return (
    <ListCard
      testID={testID}
      header={
        <Strip
          tone="danger"
          testID={testID}
          bodyTestID={`${testID}-message`}
          title={t('import:upload.error.generic_title')}
          body={message}
        />
      }
    >
      <View style={styles.plainActions}>{reselect}</View>
    </ListCard>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space['3'],
    paddingHorizontal: space['5'],
    paddingVertical: space['4'],
  },
  stripText: { flex: 1, minWidth: 0, gap: space['1'] },
  lines: { paddingHorizontal: space['5'], paddingVertical: space['3'], gap: space['2'] },
  line: { lineHeight: 18 },
  foot: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: space['3'],
    paddingHorizontal: space['5'],
    paddingVertical: space['3'],
  },
  hint: { flexShrink: 1, minWidth: 0 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: space['2'] },
  plainActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space['2'],
    paddingHorizontal: space['5'],
    paddingVertical: space['4'],
  },
});

export default UploadErrorCard;
