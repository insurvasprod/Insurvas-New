/**
 * The last screen the person worked on, outside the Menu and its pages: what Help's "For this screen"
 * is about (board J4). Set by the root layout on every navigation; kept in memory only.
 */
let last: { pathname: string; part: string | null } = { pathname: "/", part: null };

/** Menu, settings and the sheets over them are not "a screen you work on". */
const SKIP = /^\/(menu|settings|profile|devices|notifications|workspaces|computer|search|help)(\/|$)/;

export function noteScreen(pathname: string, part?: string | string[] | null) {
  if (SKIP.test(pathname)) return;
  last = { pathname, part: typeof part === "string" ? part : null };
}

export function lastScreen() {
  return last;
}
