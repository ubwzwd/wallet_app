/**
 * The five ways an upload can be refused (04 §4.10 step 1's table).
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
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { type ApiClientError } from '@/api/errors';
import type { ImportFileError } from '@/api/types';
import { errorMessage } from '@/i18n/errorCodes';
import { space } from '@/theme/tokens';
import { Button, Card, Text, toast } from '@/ui';

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

export function UploadErrorCard({
  error,
  onReselect,
  onOpenGuide,
  testID = 'upload-error',
}: UploadErrorCardProps): React.JSX.Element {
  const { t } = useTranslation();
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
      variant="secondary"
      size="sm"
      onPress={onReselect}
    />
  );

  if (error.code === 'import_format_invalid') {
    const shown = expanded ? lineErrors : lineErrors.slice(0, MAX_LISTED_ERRORS);
    const hidden = lineErrors.length - shown.length;
    return (
      <Card variant="outlined" style={{ gap: space['2'] }} testID={testID}>
        <Text variant="heading" tone="danger" testID={`${testID}-title`}>
          {t('import:upload.error.structure_title')}
        </Text>
        <Text variant="body" tone="secondary">
          {errorMessage(t, error)}
        </Text>
        <View style={{ gap: space['1'] }} testID={`${testID}-lines`}>
          {shown.map((e, i) => (
            <Text key={`${e.line}-${i}`} variant="caption" mono testID={`${testID}-line-${i}`}>
              {t('import:upload.error.line_error', { line: e.line, message: e.message })}
            </Text>
          ))}
        </View>
        {hidden > 0 ? (
          <Button
            testID={`${testID}-more`}
            label={t('import:upload.error.more_hidden', { count: hidden })}
            variant="ghost"
            size="sm"
            onPress={() => setExpanded(true)}
          />
        ) : null}
        <Text variant="caption" tone="muted" testID={`${testID}-copy-hint`}>
          {t('import:upload.error.copy_hint')}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space['2'] }}>
          <Button
            testID={`${testID}-copy`}
            label={t('import:upload.error.copy_errors')}
            icon="copy"
            variant="secondary"
            size="sm"
            onPress={() => {
              void copyText(errorText).then((ok) => {
                if (ok) toast.success(t('import:upload.error.copied_toast'));
              });
            }}
          />
          {reselect}
        </View>
      </Card>
    );
  }

  if (error.code === 'skill_outdated') {
    return (
      <Card variant="outlined" style={{ gap: space['2'] }} testID={testID}>
        <Text variant="heading" tone="warning" testID={`${testID}-title`}>
          {t('import:upload.error.skill_outdated_title')}
        </Text>
        <Text variant="body" tone="secondary" testID={`${testID}-versions`}>
          {t('import:upload.error.skill_outdated_body', {
            fileVersion: body?.file_version ?? '—',
            currentVersion: body?.current_version ?? '—',
          })}
        </Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space['2'] }}>
          <Button
            testID={`${testID}-guide`}
            label={t('import:upload.error.go_to_guide')}
            size="sm"
            onPress={() => onOpenGuide(body?.guide_url)}
          />
          {reselect}
        </View>
      </Card>
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
    <Card variant="outlined" style={{ gap: space['2'] }} testID={testID}>
      <Text variant="heading" tone="danger" testID={`${testID}-title`}>
        {t('import:upload.error.generic_title')}
      </Text>
      <Text variant="body" tone="secondary" testID={`${testID}-message`}>
        {message}
      </Text>
      <View style={{ flexDirection: 'row', gap: space['2'] }}>{reselect}</View>
    </Card>
  );
}

export default UploadErrorCard;
