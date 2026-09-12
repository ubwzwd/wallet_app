/**
 * Lookup tables and search over the (server-constant) category tree (04 §2.3, decision §1.3).
 */
import type { Category, CategoryTree, TxKind } from '@/api/types';

export interface CategoryIndex {
  byL1: Record<string, Category>;
  byCode: Record<string, Category>;
  /** The `children` of a level-1 code, or `[]` if the code is unknown. */
  l2Of(l1: string): Category[];
  /** Which tree a `kind` may pick categories from: `expense`/`refund` → expense tree,
   *  `income` → income tree, `transfer` → `[]` (decision §1.3). */
  kindAllows(kind: TxKind): Category[];
  /** Whether `(l1, l2)` is a legal pair for `kind` — `l1` required and known, `l2` (if given)
   *  must be one of `l1`'s children; `transfer` requires both `null`. */
  isValidPair(l1: string | null, l2: string | null, kind: TxKind): boolean;
  /** The level-1 code a level-2 code belongs to, or `null` if `l2Code` is unknown. */
  parentOf(l2Code: string): string | null;
}

export function buildCategoryIndex(tree: CategoryTree): CategoryIndex {
  const byL1: Record<string, Category> = {};
  const byCode: Record<string, Category> = {};
  const parent: Record<string, string> = {};

  for (const l1 of [...tree.expense, ...tree.income]) {
    byL1[l1.code] = l1;
    byCode[l1.code] = l1;
    for (const l2 of l1.children) {
      byCode[l2.code] = l2;
      parent[l2.code] = l1.code;
    }
  }

  function kindAllows(kind: TxKind): Category[] {
    if (kind === 'expense' || kind === 'refund') return tree.expense;
    if (kind === 'income') return tree.income;
    return [];
  }

  function l2Of(l1: string): Category[] {
    return byL1[l1]?.children ?? [];
  }

  function isValidPair(l1: string | null, l2: string | null, kind: TxKind): boolean {
    if (kind === 'transfer') return l1 === null && l2 === null;
    if (l1 === null) return false;
    const l1Cat = kindAllows(kind).find((c) => c.code === l1);
    if (!l1Cat) return false;
    if (l2 === null) return true;
    return l1Cat.children.some((c) => c.code === l2);
  }

  function parentOf(l2Code: string): string | null {
    return parent[l2Code] ?? null;
  }

  return { byL1, byCode, l2Of, kindAllows, isValidPair, parentOf };
}

export interface CategoryHit {
  l1: string;
  l2?: string;
}

/**
 * Search the tree `kind` may use, matching `query` (case-insensitive) against both category
 * names and the level-1 `desc_*` classification hint (decision §1.3's "用完就没了" example) —
 * finding "纸巾算哪类" by searching the judging criterion, not just the name.
 */
export function searchCategories(
  index: CategoryIndex,
  kind: TxKind,
  query: string,
  lang: 'zh' | 'en'
): CategoryHit[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [];

  const hits: CategoryHit[] = [];
  for (const l1 of index.kindAllows(kind)) {
    const name = (lang === 'zh' ? l1.name_zh : l1.name_en).toLowerCase();
    const desc = (lang === 'zh' ? l1.desc_zh : l1.desc_en) ?? '';
    if (name.includes(q) || desc.toLowerCase().includes(q)) {
      hits.push({ l1: l1.code });
    }
    for (const l2 of l1.children) {
      const l2Name = (lang === 'zh' ? l2.name_zh : l2.name_en).toLowerCase();
      if (l2Name.includes(q)) hits.push({ l1: l1.code, l2: l2.code });
    }
  }
  return hits;
}
