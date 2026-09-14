/**
 * `/l/:ledgerId/imports/new` — step 1 of the import flow (04 §4.10, decisions §5, §14.47).
 *
 * One account, one file: the CSV carries no account column, so the target account is
 * picked here and archived accounts are not offered (decision §3). The two entry points —
 * a `.csv` upload and a pasted block of CSV text — post to the same endpoint and run the
 * same validation; there is no JSON entry point.
 *
 * Validation is synchronous (decision §5): a 201 already carries the batch and every draft
 * row, both of which `useUploadImport` seeds into the cache, so this screen `router.replace`s
 * straight into review and **no second request is made**.
 *
 * The client-side precheck (2 MB, `.csv`) only saves a round trip — the server checks
 * again, and a non-CSV that slips past lands on `import_format_invalid` like any other
 * unreadable file (decision §14.53d).
 */
import React from 'react';
import { View } from 'react-native';
import { type Href, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { isApiClientError, type ApiClientError } from '@/api/errors';
import type { Uuid } from '@/api/types';
import { routes } from '@/domain/routes';
import { formatBytes } from '@/i18n/format';
import { useLang } from '@/i18n';
import { useTopBar } from '@/navigation';
import { useSources, useUploadImport, useUploadImportText } from '@/queries';
import { useLedgerContext } from '@/store';
import { space } from '@/theme/tokens';
import {
  Button,
  Card,
  ProgressBar,
  Page,
  SegmentedControl,
  SourcePicker,
  Text,
  TextField,
} from '@/ui';

import { UploadErrorCard } from './UploadErrorCard';
import { pickFile } from './useCopyText';

type UploadMode = 'file' | 'paste';

/** 04 §4.10 / decision §9: the same 2 MB the server enforces, checked before the request. */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

/** What the file picker offers, and what the precheck insists on. */
const CSV_ACCEPT = '.csv,text/csv';

export type LocalFileProblem = 'not_csv' | 'too_large' | null;

/** The client-side precheck of 04 §4.10 step 1; `null` means "send it". */
export function checkCsvFile(file: { name: string; size: number }): LocalFileProblem {
  if (!file.name.toLowerCase().endsWith('.csv')) return 'not_csv';
  if (file.size > MAX_UPLOAD_BYTES) return 'too_large';
  return null;
}

export default function NewImportScreen(): React.JSX.Element {
  const { t } = useTranslation();
  const lang = useLang();
  const router = useRouter();
  const { ledgerId } = useLedgerContext();
  useTopBar(t('import:upload.title'));

  const sourcesQuery = useSources(ledgerId);
  // Both mutations render their own failure in the card below, so neither raises the
  // global error toast (04 §3.9).
  const upload = useUploadImport(ledgerId, { silent: true });
  const uploadText = useUploadImportText(ledgerId, { silent: true });

  const [sourceId, setSourceId] = React.useState<Uuid | null>(null);
  const [mode, setMode] = React.useState<UploadMode>('file');
  const [file, setFile] = React.useState<File | null>(null);
  const [text, setText] = React.useState('');
  const [localProblem, setLocalProblem] = React.useState<LocalFileProblem>(null);
  const [failure, setFailure] = React.useState<ApiClientError | null>(null);
  const [progress, setProgress] = React.useState<number | null>(null);

  const sources = sourcesQuery.data?.items ?? [];
  const selected = sources.find((s) => s.id === sourceId) ?? null;
  const pending = upload.isPending || uploadText.isPending;

  const goGuide = React.useCallback(
    (guideUrl?: string) => {
      // The server hands back where the guide lives (decision §14.53f); anything that is
      // not a same-site path falls back to this ledger's own guide route.
      const target =
        guideUrl && guideUrl.startsWith('/') && !guideUrl.startsWith('//')
          ? guideUrl
          : routes.l(ledgerId).importsGuide();
      router.push(target as Href);
    },
    [ledgerId, router],
  );

  const reset = React.useCallback((): void => {
    setFailure(null);
    setLocalProblem(null);
    setFile(null);
    setProgress(null);
  }, []);

  const choose = React.useCallback((): void => {
    void pickFile(CSV_ACCEPT).then((chosen) => {
      if (!chosen) return;
      setFailure(null);
      const problem = checkCsvFile(chosen);
      setLocalProblem(problem);
      // A refused file is not kept: the next thing the user does is pick another one.
      setFile(problem === null ? chosen : null);
    });
  }, []);

  const toReview = React.useCallback(
    (batchId: Uuid): void => {
      router.replace(routes.l(ledgerId).importBatch(batchId) as Href);
    },
    [ledgerId, router],
  );

  const submit = React.useCallback((): void => {
    if (!sourceId) return;
    setFailure(null);
    const onError = (e: unknown): void => {
      setProgress(null);
      if (isApiClientError(e)) setFailure(e);
    };
    if (mode === 'file') {
      if (!file) return;
      setProgress(0);
      upload.mutate(
        { source_id: sourceId, file, onProgress: setProgress },
        { onSuccess: (result) => toReview(result.batch.id), onError },
      );
      return;
    }
    if (text.trim().length === 0) return;
    uploadText.mutate(
      { source_id: sourceId, text },
      { onSuccess: (result) => toReview(result.batch.id), onError },
    );
  }, [file, mode, sourceId, text, toReview, upload, uploadText]);

  const canSubmit =
    sourceId !== null &&
    !pending &&
    (mode === 'file' ? file !== null : text.trim().length > 0);

  return (
    <Page testID="import-new-screen">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space['2'] }}>
        <Text variant="title" accessibilityRole="header" style={{ flex: 1 }}>
          {t('import:upload.title')}
        </Text>
        <Button
          testID="upload-guide-link"
          label={t('import:upload.guide_link')}
          variant="ghost"
          size="sm"
          onPress={() => goGuide(undefined)}
        />
      </View>

      <Card variant="outlined" style={{ gap: space['2'] }} testID="upload-source">
        <SourcePicker
          testID="upload-source-picker"
          sources={sources}
          value={sourceId}
          onChange={setSourceId}
          lang={lang}
          label={t('import:upload.source_label')}
        />
        {selected ? (
          <Text variant="caption" tone="secondary" testID="upload-source-hint">
            {t('import:upload.source_hint', { currency: selected.default_currency })}
          </Text>
        ) : null}
      </Card>

      <SegmentedControl<UploadMode>
        testID="upload-mode"
        value={mode}
        onChange={(next) => {
          setMode(next);
          setFailure(null);
          setLocalProblem(null);
        }}
        options={[
          { value: 'file', label: t('import:upload.mode.file') },
          { value: 'paste', label: t('import:upload.mode.paste') },
        ]}
      />

      {mode === 'file' ? (
        <Card variant="outlined" style={{ gap: space['2'] }} testID="upload-file">
          <Text variant="body" tone="secondary" testID="upload-dropzone-hint">
            {t('import:upload.dropzone_hint')}
          </Text>
          <Button
            testID="upload-choose-file"
            label={t('import:upload.choose_file')}
            icon="upload"
            variant="secondary"
            size="sm"
            onPress={choose}
            style={{ alignSelf: 'flex-start' }}
          />
          {file ? (
            <Text variant="caption" mono testID="upload-selected-file">
              {t('import:upload.selected_file', {
                name: file.name,
                size: formatBytes(file.size),
              })}
            </Text>
          ) : null}
          {localProblem !== null ? (
            <Text variant="caption" tone="danger" testID="upload-local-error">
              {localProblem === 'not_csv'
                ? t('import:upload.non_csv_hint')
                : t('import:upload.error.file_too_large')}
            </Text>
          ) : null}
        </Card>
      ) : (
        <Card variant="outlined" style={{ gap: space['2'] }} testID="upload-paste">
          <TextField
            testID="upload-paste-input"
            label={t('import:upload.paste_label')}
            accessibilityLabel={t('import:upload.paste_label')}
            placeholder={t('import:upload.paste_placeholder')}
            value={text}
            onChangeText={setText}
            multiline
            mono
            autoCapitalize="none"
            autoCorrect={false}
            numberOfLines={8}
          />
        </Card>
      )}

      <Button
        testID="upload-submit"
        label={pending ? t('import:upload.uploading') : t('import:upload.submit')}
        onPress={submit}
        disabled={!canSubmit}
        loading={pending}
        style={{ alignSelf: 'flex-start' }}
      />

      {progress !== null && upload.isPending ? (
        <ProgressBar
          testID="upload-progress"
          value={progress}
          accessibilityLabel={t('import:upload.uploading')}
        />
      ) : null}

      {failure ? (
        <UploadErrorCard error={failure} onReselect={reset} onOpenGuide={goGuide} />
      ) : null}
    </Page>
  );
}
