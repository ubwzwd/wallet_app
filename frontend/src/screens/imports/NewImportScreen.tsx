/**
 * `/l/:ledgerId/imports/new` — the import page of 屏幕稿 10 (04 §4.10, decisions §5, §14.47,
 * §14.56: the guide and the upload form are one page).
 *
 * Two columns on a wide screen, 1.15 : 1 — 「怎么做」 on the left (`ImportSteps`: the three
 * steps and the skill text), 「现在做」 on the right (the target account, the drop zone, the
 * paste box). Narrow stacks them in the same order.
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
import { StyleSheet, View } from 'react-native';
import { type Href, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { isApiClientError, type ApiClientError } from '@/api/errors';
import type { Uuid } from '@/api/types';
import { routes } from '@/domain/routes';
import { formatBytes } from '@/i18n/format';
import { useLang } from '@/i18n';
import { useTopBar } from '@/navigation';
import {
  useImportFormat,
  useImports,
  useSources,
  useUploadImport,
  useUploadImportText,
} from '@/queries';
import { useLedgerContext } from '@/store';
import { space } from '@/theme/tokens';
import { useIsWide } from '@/theme/useBreakpoint';
import {
  Button,
  Page,
  PageHeader,
  ProgressBar,
  Skeleton,
  Text,
  TextField,
} from '@/ui';

import { ImportSteps } from './ImportSteps';
import { UploadErrorCard } from './UploadErrorCard';
import {
  DropZone,
  PasteDivider,
  RecentImports,
  TargetSourceRow,
  UploadCard,
} from './UploadPanel';
import { pickFile } from './useCopyText';

/** 04 §4.10 / decision §9: the same 2 MB the server enforces, checked before the request. */
export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

/** What the file picker offers, and what the precheck insists on. */
const CSV_ACCEPT = '.csv,text/csv';

/** 屏幕稿 10 keeps a short 「最近导入」 list next to the upload box. */
const RECENT_LIMIT = 3;

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
  const wide = useIsWide();
  const router = useRouter();
  const { ledgerId } = useLedgerContext();
  useTopBar(t('import:upload.title'));

  const sourcesQuery = useSources(ledgerId);
  const formatQuery = useImportFormat();
  const recentQuery = useImports(ledgerId, { limit: RECENT_LIMIT });
  // Both mutations render their own failure in the card below, so neither raises the
  // global error toast (04 §3.9).
  const upload = useUploadImport(ledgerId, { silent: true });
  const uploadText = useUploadImportText(ledgerId, { silent: true });

  const [sourceId, setSourceId] = React.useState<Uuid | null>(null);
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
    if (file) {
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
  }, [file, sourceId, text, toReview, upload, uploadText]);

  const canSubmit =
    sourceId !== null && !pending && (file !== null || text.trim().length > 0);

  const localMessage =
    localProblem === null
      ? null
      : localProblem === 'not_csv'
        ? t('import:upload.non_csv_hint')
        : t('import:upload.error.file_too_large');

  // What the red card below the zone shouts, in one line, so the zone is never red and mute.
  const failureHeadline =
    failure === null
      ? null
      : failure.code === 'import_format_invalid'
        ? t('import:upload.error.structure_title')
        : failure.code === 'skill_outdated'
          ? t('import:upload.error.skill_outdated_title')
          : t('import:upload.error.generic_title');

  const steps = formatQuery.data ? (
    <ImportSteps format={formatQuery.data} onOpenFormat={() => goGuide(undefined)} />
  ) : (
    <Skeleton variant="card" testID="guide-skeleton" />
  );

  const uploadBox = (
    <UploadCard testID="upload-card">
      <TargetSourceRow
        testID="upload-source-picker"
        sources={sources}
        value={sourceId}
        onChange={setSourceId}
        lang={lang}
      />
      <Text variant="caption" tone="muted" testID="upload-source-note">
        {t('import:upload.source_note')}
      </Text>
      {selected ? (
        <Text variant="caption" tone="secondary" testID="upload-source-hint">
          {t('import:upload.source_hint', { currency: selected.default_currency })}
        </Text>
      ) : null}

      {/* 屏幕稿 10's error branch paints the ring in kind.expense whenever the upload was
          refused — by the local precheck or by the server. The card below keeps the detail;
          the zone repeats its headline so the two do not disagree. */}
      <DropZone
        tone={localProblem === null && failure === null ? 'default' : 'danger'}
        title={
          file
            ? t('import:upload.selected_file', { name: file.name, size: formatBytes(file.size) })
            : t('import:upload.drop_title')
        }
        titleTestID={file ? 'upload-selected-file' : 'upload-drop-title'}
        body={localMessage ?? failureHeadline ?? t('import:upload.drop_body')}
        bodyTestID={
          localMessage !== null
            ? 'upload-local-error'
            : failureHeadline !== null
              ? 'upload-server-error-hint'
              : 'upload-dropzone-hint'
        }
        onChoose={choose}
      />

      <PasteDivider />
      <TextField
        testID="upload-paste-input"
        accessibilityLabel={t('import:upload.paste_label')}
        placeholder={t('import:upload.paste_placeholder')}
        value={text}
        onChangeText={(next) => {
          setText(next);
          setFailure(null);
          // Switching to pasting clears a refused file's rejection too, so the drop zone
          // stops shouting about a file the user has already moved on from.
          setLocalProblem(null);
        }}
        multiline
        mono
        autoCapitalize="none"
        autoCorrect={false}
        numberOfLines={5}
      />

      <View style={styles.submitRow}>
        <Button
          testID="upload-submit"
          label={pending ? t('import:upload.uploading') : t('import:upload.submit')}
          onPress={submit}
          disabled={!canSubmit}
          loading={pending}
          fullWidth={!wide}
        />
        {/* Both inputs are live at once, and `submit` sends the file. Say so rather than
            dropping the other one silently. */}
        {file !== null && text.trim().length > 0 ? (
          <Text variant="caption" tone="muted" testID="upload-file-wins-hint">
            {t('import:upload.file_wins_hint', { name: file.name })}
          </Text>
        ) : null}
      </View>
      {progress !== null && upload.isPending ? (
        <ProgressBar
          testID="upload-progress"
          value={progress}
          accessibilityLabel={t('import:upload.uploading')}
        />
      ) : null}

      <RecentImports
        batches={recentQuery.data?.items ?? []}
        onPress={(batchId) => router.push(routes.l(ledgerId).importBatch(batchId) as Href)}
      />
    </UploadCard>
  );

  const right = (
    <View style={wide ? styles.columnWide : styles.stack}>
      {uploadBox}
      {failure ? (
        <UploadErrorCard error={failure} onReselect={reset} onOpenGuide={goGuide} />
      ) : null}
    </View>
  );

  return (
    <Page testID="import-new-screen">
      <PageHeader
        title={t('import:upload.title')}
        // 屏幕稿 10 keeps the explainer on the title's own baseline, in sans, not mono.
        meta={
          <Text variant="caption" tone="muted" style={styles.subtitle} testID="import-new-subtitle">
            {t('import:upload.subtitle')}
          </Text>
        }
        testID="import-new-header"
      />
      {wide ? (
        <View style={styles.grid}>
          <View style={styles.left}>{steps}</View>
          {right}
        </View>
      ) : (
        <>
          {steps}
          {right}
        </>
      )}
    </Page>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', alignItems: 'flex-start', gap: space['6'] },
  left: { flex: 1.15, minWidth: 0 },
  columnWide: { flex: 1, minWidth: 0, gap: space['4'] },
  stack: { alignSelf: 'stretch', gap: space['3'] },
  submitRow: { alignItems: 'flex-start', gap: space['2'] },
  subtitle: { maxWidth: 560 },
});
