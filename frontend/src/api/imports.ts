/**
 * `/ledgers/{id}/imports*` — upload / paste, draft rows, bulk edit, commit, revert
 * (03 §5.37–§5.44). Validation is synchronous: a 201 already carries the batch and
 * every draft row (decision §5).
 */
import { apiClient, uploadClient } from './client';
import type {
  ImportBatch,
  ImportBatchListItem,
  ImportCommitResult,
  ImportDeleteResult,
  ImportRow,
  ImportRowListParams,
  ImportRowPatch,
  ImportRowsBulkPatch,
  ImportRowsBulkResult,
  ImportStatus,
  ImportUploadResult,
  Paged,
  Uuid,
} from './types';

/** Upload progress as a fraction in [0, 1]; `undefined` total yields 0. */
export type UploadProgressHandler = (progress: number) => void;

export const importsApi = {
  /** multipart/form-data upload — goes through `uploadClient` so the boundary is set by FormData. */
  upload: (
    l: Uuid,
    b: { source_id: Uuid; file: Blob },
    onProgress?: UploadProgressHandler,
  ): Promise<ImportUploadResult> => {
    const form = new FormData();
    form.append('source_id', b.source_id);
    form.append('file', b.file);
    return uploadClient
      .post<ImportUploadResult>(`/ledgers/${l}/imports`, form, {
        onUploadProgress: onProgress
          ? (e) => onProgress(e.total ? e.loaded / e.total : 0)
          : undefined,
      })
      .then((r) => r.data);
  },

  /** Pasted CSV text — plain JSON, same validation pipeline (decision §14.47). */
  uploadText: (l: Uuid, b: { source_id: Uuid; text: string }): Promise<ImportUploadResult> =>
    apiClient.post<ImportUploadResult>(`/ledgers/${l}/imports`, b).then((r) => r.data),

  list: (
    l: Uuid,
    p?: { status?: ImportStatus[]; limit?: number; offset?: number },
  ): Promise<Paged<ImportBatchListItem>> =>
    apiClient
      .get<Paged<ImportBatchListItem>>(`/ledgers/${l}/imports`, { params: p })
      .then((r) => r.data),

  get: (l: Uuid, bid: Uuid): Promise<ImportBatch> =>
    apiClient.get<ImportBatch>(`/ledgers/${l}/imports/${bid}`).then((r) => r.data),

  rows: (l: Uuid, bid: Uuid, p?: ImportRowListParams): Promise<Paged<ImportRow>> =>
    apiClient
      .get<Paged<ImportRow>>(`/ledgers/${l}/imports/${bid}/rows`, { params: p })
      .then((r) => r.data),

  patchRow: (l: Uuid, bid: Uuid, rid: Uuid, b: ImportRowPatch): Promise<ImportRow> =>
    apiClient
      .patch<ImportRow>(`/ledgers/${l}/imports/${bid}/rows/${rid}`, b)
      .then((r) => r.data),

  /** All-or-nothing bulk edit: set a category or skip a selection (decision §14.52 A4). */
  patchRows: (l: Uuid, bid: Uuid, b: ImportRowsBulkPatch): Promise<ImportRowsBulkResult> =>
    apiClient
      .patch<ImportRowsBulkResult>(`/ledgers/${l}/imports/${bid}/rows`, b)
      .then((r) => r.data),

  /** No request body (decision §14.18). */
  commit: (l: Uuid, bid: Uuid): Promise<ImportCommitResult> =>
    apiClient
      .post<ImportCommitResult>(`/ledgers/${l}/imports/${bid}/commit`)
      .then((r) => r.data),

  /** `ready` = discard the draft; `committed` = revert. Ask with `dry_run` first. */
  remove: (l: Uuid, bid: Uuid, p?: { dry_run?: boolean }): Promise<ImportDeleteResult> =>
    apiClient
      .delete<ImportDeleteResult>(`/ledgers/${l}/imports/${bid}`, { params: p })
      .then((r) => r.data),
};
