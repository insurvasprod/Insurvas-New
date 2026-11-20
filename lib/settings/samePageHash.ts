// A Next <Link> to the page already open that differs only by "#section" is a router push: it calls
// history.pushState, which never fires `hashchange`. The settings shell and its panels pick their section
// from `hashchange`, so such a link (Settings › Products "+ Form" → "/app/settings#form-templates") changed
// the address and nothing else until a reload. The shell sends these clicks through `location.hash` instead.
// Pure and client-safe.

type Here = { origin: string; pathname: string; search: string; hash: string };

/**
 * The hash (without "#") a link should set on the page already open, or null when the link goes anywhere
 * else: another page, another query, another origin, no hash, or the hash already showing.
 */
export function samePageHash(href: string | null | undefined, here: Here): string | null {
  if (!href || !href.includes("#")) return null;
  let url: URL;
  try { url = new URL(href, `${here.origin}${here.pathname}${here.search}`); } catch { return null; }
  if (url.origin !== here.origin || url.pathname !== here.pathname || url.search !== here.search) return null;
  const hash = url.hash.replace(/^#/, "");
  if (!hash || url.hash === here.hash) return null;
  return hash;
}
