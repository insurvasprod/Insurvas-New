/**
 * Board J4 · Help and guides. The guides are the web's own (/app/docs/<slug>, lib/docs/tasks.ts: slug and
 * title copied as they are there); "For this screen" picks the ones for the screen you were on before
 * opening Help, and "Popular" is the phone's everyday work, less what is already listed above it.
 * Pure, so it is unit-tested.
 */
export type Guide = { slug: string; title: string };

const G = {
  claim: { slug: "claim-transfer", title: "Claim a transfer" },
  next: { slug: "call-next-lead", title: "Call your next lead" },
  callback: { slug: "book-callback", title: "Book a callback" },
  apply: { slug: "submit-application", title: "Submit an application" },
  quote: { slug: "quote-client", title: "Quote a client" },
  pending: { slug: "follow-pending-case", title: "Follow a pending case" },
  consent: { slug: "find-consent", title: "Find a lead's consent" },
  recycle: { slug: "recycle-leads", title: "Recycle leads nobody reached" },
  duplicates: { slug: "check-duplicates", title: "Check duplicates" },
  chat: { slug: "partner-chat", title: "Chat with a partner" },
  home: { slug: "start-the-day", title: "Start your day from Home" },
} satisfies Record<string, Guide>;

const POPULAR: Guide[] = [G.claim, G.callback, G.apply, G.next];

/** The screen a person was on (its path and, for Calls, the `part`), as Help names it. */
export function screenFor(pathname: string | null | undefined, part?: string | null): { name: string; guides: Guide[] } | null {
  const path = pathname ?? "";
  if (path === "/calls") {
    if (part === "dialer") return { name: "Dialer", guides: [G.next, G.callback, G.consent] };
    if (part === "callbacks") return { name: "Callbacks", guides: [G.callback, G.next] };
    return { name: "Incoming calls", guides: [G.claim, G.apply] };
  }
  if (path.startsWith("/call/")) return { name: "On a call", guides: [G.claim, G.quote, G.apply] };
  if (path === "/leads" || path.startsWith("/lead/")) return { name: "Leads", guides: [G.recycle, G.duplicates, G.next] };
  if (path === "/inbox") return { name: "Inbox", guides: [G.chat, G.pending] };
  if (path === "/calendar" || path.startsWith("/appointment/")) return { name: "Calendar", guides: [G.callback] };
  if (path === "/" || path === "") return { name: "Home", guides: [G.home, G.next] };
  return null;
}

export function helpGroups(pathname: string | null | undefined, part?: string | null): { screen: { name: string; guides: Guide[] } | null; popular: Guide[] } {
  const screen = screenFor(pathname, part);
  const shown = new Set(screen?.guides.map((g) => g.slug));
  return { screen, popular: POPULAR.filter((g) => !shown.has(g.slug)).slice(0, 3) };
}
