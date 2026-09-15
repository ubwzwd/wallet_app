/**
 * Whether a chrome entry is the page the user is on.
 *
 * Its own module because both the sidebar and the bottom tab bar highlight rows with it,
 * and the sidebar's cards need it too — one shared leaf keeps those three from importing
 * each other in a circle.
 */

/** `/l/<id>` matches only itself; every other entry also owns its sub-paths. */
export function isActivePath(pathname: string, href: string, exact: boolean): boolean {
  if (pathname === href) return true;
  return !exact && pathname.startsWith(`${href}/`);
}
