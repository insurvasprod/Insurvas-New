/**
 * Where the application workspace's back link goes. The agent reaches an application from the
 * inbound verification panel, a lead, the dialer, Pending or a policy; the link takes them back
 * there (`?from=`), and to the Applications list when nothing says where they came from.
 *
 * Only a path inside the agent app is accepted, so a crafted link can never send the agent to
 * another site.
 */
const PLACES: Array<{ match: RegExp; label: string }> = [
  { match: /^\/app\/inbound\/[^/]+\/verification/, label: "Verification" },
  { match: /^\/app\/inbound/, label: "Inbound" },
  { match: /^\/app\/floor/, label: "Agent floor" },
  { match: /^\/app\/leads\/[^/?]+/, label: "Lead" },
  { match: /dialer/, label: "Dialer" },
  { match: /^\/app\/pending/, label: "Pending" },
  { match: /^\/app\/policies/, label: "Policy" },
  { match: /^\/app\/quotes/, label: "Quotes" },
];

export const DEFAULT_BACK = { href: "/app/applications", label: "Applications" };

export function backLink(from: string | null | undefined): { href: string; label: string } {
  if (!from || !/^\/app\/[A-Za-z0-9]/.test(from) || /[\\\s]/.test(from) || from.length > 300) return DEFAULT_BACK;
  if (from.startsWith("/app/applications")) return DEFAULT_BACK;
  return { href: from, label: PLACES.find((place) => place.match.test(from))?.label ?? "Back" };
}

/** Adds `from` to an application link, keeping any query it already has. */
export function withFrom(href: string, from: string): string {
  return `${href}${href.includes("?") ? "&" : "?"}from=${encodeURIComponent(from)}`;
}
