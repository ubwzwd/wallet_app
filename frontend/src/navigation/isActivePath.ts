/**
 * Whether a chrome entry is the page the user is on (04 §1.4, decision §14.66): `/home` is
 * 首页, `/transactions*` 交易, `/imports*` 导入, `/accounts*` 账户, `/settings` 我的.
 * `/ledger` and `/ledgers*` light nothing.
 *
 * Its own module because both the sidebar and the bottom tab bar highlight rows with it,
 * and the sidebar's cards need it too — one shared leaf keeps those three from importing
 * each other in a circle.
 */

/** `exact` matches only `href` itself; otherwise the entry also owns its sub-paths. */
export function isActivePath(pathname: string, href: string, exact: boolean): boolean {
  if (pathname === href) return true;
  return !exact && pathname.startsWith(`${href}/`);
}
