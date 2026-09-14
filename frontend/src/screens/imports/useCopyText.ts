/**
 * The three browser affordances the import flow needs — clipboard, file download, file
 * picker — behind functions that never throw and keep every platform check out of the
 * screens (04 §6.6: pages and routes stay platform-agnostic; the guard lives here).
 *
 * Downloads are built from a `Blob` + `URL.createObjectURL` and never go through the
 * backend (04 §4.10 step 0): the SKILL.md and the sample CSV already arrived in the
 * `GET /import-format` response, so there is nothing to ask the server for.
 *
 * On a platform without a DOM every function degrades to "did nothing" (`false` / `null`)
 * and the caller simply skips its success toast.
 */
import React from 'react';

/** Minimal shape of the clipboard we use — `navigator.clipboard` where it exists. */
interface ClipboardLike {
  writeText(text: string): Promise<void>;
}

/** Minimal shape of the DOM we use, so the guards are typed without `lib.dom`. */
interface DocumentLike {
  createElement(tag: string): Record<string, unknown> & { click(): void };
  body?: { appendChild(node: unknown): void; removeChild(node: unknown): void };
}

function clipboard(): ClipboardLike | null {
  if (typeof navigator === 'undefined') return null;
  const c = (navigator as Navigator & { clipboard?: ClipboardLike }).clipboard;
  return c && typeof c.writeText === 'function' ? c : null;
}

function dom(): DocumentLike | null {
  const d = (globalThis as { document?: DocumentLike }).document;
  return d && typeof d.createElement === 'function' ? d : null;
}

/** Copy `text`; resolves `false` when there is no clipboard or the write was refused. */
export async function copyText(text: string): Promise<boolean> {
  const target = clipboard();
  if (!target) return false;
  try {
    await target.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Save `text` as `filename`. The object URL is revoked on the next tick — revoking it
 * synchronously would cancel the download in some browsers.
 */
export function downloadTextFile(
  filename: string,
  text: string,
  mime = 'text/plain;charset=utf-8',
): boolean {
  const d = dom();
  if (d === null || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    return false;
  }
  try {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const anchor = d.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    d.body?.appendChild(anchor);
    anchor.click();
    d.body?.removeChild(anchor);
    setTimeout(() => URL.revokeObjectURL?.(url), 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Open the system file picker and resolve with what the user chose, or `null` when they
 * cancelled or the platform has no picker. `accept` is the input's `accept` attribute —
 * a hint only, which is why the caller still runs its own precheck (04 §4.10 step 1).
 */
export function pickFile(accept: string): Promise<File | null> {
  const d = dom();
  if (d === null) return Promise.resolve(null);
  return new Promise<File | null>((resolve) => {
    const input = d.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.hidden = true;
    input.onchange = () => {
      const files = (input as { files?: ArrayLike<File> | null }).files;
      resolve(files && files.length > 0 ? files[0] : null);
      d.body?.removeChild(input);
    };
    // A cancelled picker fires no `change` event in every browser, so the promise may
    // simply never settle — the caller treats that as "nothing was chosen".
    d.body?.appendChild(input);
    input.click();
  });
}

export interface CopyAndDownload {
  /** Copies and returns whether it worked, so the caller can toast only on success. */
  copy(text: string): Promise<boolean>;
  download(filename: string, text: string, mime?: string): boolean;
}

/** Stable callbacks over the two guards above, for components that need both. */
export function useCopyText(): CopyAndDownload {
  return React.useMemo<CopyAndDownload>(
    () => ({
      copy: copyText,
      download: downloadTextFile,
    }),
    [],
  );
}
