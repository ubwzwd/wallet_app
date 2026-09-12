/**
 * Category display names (04 §5.3, decision §1.3). Categories are a backend constant,
 * not UI copy — `GET /categories` gives `name_zh` / `name_en` and (for level-1 codes
 * only) `desc_zh` / `desc_en`, so the language pack must never carry a second copy of
 * them (it would drift the moment the category table changes on a release).
 */
import type { Category } from '@/api/types';

/** Accepts any BCP-47-ish tag, not just the exact `Lang` union — i18next's
 *  `i18n.language` can be `'zh-CN'` etc. */
export function categoryName(c: Category, lang: string): string {
  return lang.startsWith('zh') ? c.name_zh : c.name_en;
}

/** Level-1 categorization hint text; always `null` for level-2 categories — callers
 *  use the `null` to decide whether to render the second line at all (04 §4.6.1). */
export function categoryDesc(c: Category, lang: string): string | null {
  return lang.startsWith('zh') ? c.desc_zh : c.desc_en;
}
