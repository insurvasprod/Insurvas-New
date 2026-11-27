import { useState } from "react";
import { Platform } from "react-native";
import { useLocalSearchParams } from "expo-router";

import { reachable } from "@/lib/links";
import { callsPartsFor, tabsFor, type TabKey, type TabOptions } from "@/lib/roles";

/**
 * Boards L3 (long-press the app icon) and L5 (ask Siri or Google). Each shortcut is a plain link,
 * insurvas://<id>, so the icon menu, Siri's App Intents, Google's App Actions, a widget tap and a
 * notification all land the same way: src/app/+native-intent.tsx hands the link to resolveIntentPath,
 * which names the screen. Nothing here writes: "Serve next lead" opens the dialer with its next lead
 * at the top; the server still runs every check when the person taps Call.
 */
export type IntentId = "serve-next" | "add-lead" | "check-number" | "search" | "next-callback";

export type Intent = {
  id: IntentId;
  /** The words on the icon menu and the phrase Siri / Google learn. */
  title: string;
  /** SF Symbol (iOS quick action) and the drawable name the Android shortcut uses. */
  iosSymbol: string;
  androidIcon: string;
  /**
   * Whether this person can use what the shortcut opens; the screen enforces it again either way.
   * `tabs` are the tabs this phone shows: a shortcut into a hidden tab (an owner on Team · Money) would land nowhere.
   */
  allowed: (role: string | null | undefined, tabs: TabKey[], features?: readonly string[] | null) => boolean;
};

const dials = (role: string | null | undefined) => callsPartsFor(role).includes("dialer");

export const INTENTS: Record<IntentId, Intent> = {
  "serve-next": { id: "serve-next", title: "Serve next lead", iosSymbol: "phone.arrow.up.right", androidIcon: "shortcut_serve_next", allowed: (role, tabs) => dials(role) && tabs.includes("calls") },
  "add-lead": { id: "add-lead", title: "Add a lead", iosSymbol: "person.badge.plus", androidIcon: "shortcut_add_lead", allowed: (role, tabs) => tabs.includes("leads") && role !== "setter" },
  // Check a number is its own screen (not a tab). The check runs on POST /api/app/dial/preflight, which answers
  // owners and producers (base roles; an admin or a manager holds one of them) on a plan with outbound_dialing,
  // the same gate as the Menu row (components/menu/pages.ts); a setter or an assistant would only be refused.
  "check-number": { id: "check-number", title: "Check a number", iosSymbol: "checkmark.shield", androidIcon: "shortcut_check_number",
    allowed: (role, _tabs, features) => (role === "owner" || role === "producer") && (!features || features.includes("outbound_dialing")) },
  search: { id: "search", title: "Search", iosSymbol: "magnifyingglass", androidIcon: "shortcut_search", allowed: (role) => Boolean(role) },
  "next-callback": { id: "next-callback", title: "What’s my next callback?", iosSymbol: "calendar.badge.clock", androidIcon: "shortcut_next_callback", allowed: (role, tabs) => callsPartsFor(role).includes("callbacks") && tabs.includes("calls") },
};

/** Board L3's four, in the board's order. */
export const ICON_SHORTCUTS: IntentId[] = ["serve-next", "add-lead", "check-number", "search"];
/** Board L5's four phrases. */
export const VOICE_SHORTCUTS: IntentId[] = ["serve-next", "next-callback", "add-lead", "check-number"];

const SCHEME = "insurvas";

/** The id a link names, from insurvas://serve-next, insurvas:///serve-next, /serve-next or serve-next. */
function intentOf(path: string): { id: IntentId; query: URLSearchParams; spoken: boolean } | null {
  let rest = path.trim();
  // Expo Go and dev builds wrap app paths as exp://host:port/--/serve-next.
  const dev = rest.indexOf("/--/");
  if (dev >= 0) rest = rest.slice(dev + 3);
  const scheme = new RegExp(`^${SCHEME}:`, "i");
  if (scheme.test(rest)) rest = rest.replace(scheme, "");
  else if (/^[a-z][a-z0-9+.-]*:/i.test(rest)) return null; // https: and other schemes are not shortcuts
  rest = rest.replace(/^\/+/, "");
  const [head, search = ""] = rest.split("?", 2);
  const id = head.split("#")[0].replace(/\/+$/, "").toLowerCase();
  const query = new URLSearchParams(search.split("#")[0]);
  // Google Assistant (board L5): "Open next callback in Insurvas" arrives as insurvas://open?feature=<the words heard>.
  if (id === "open") {
    const heard = spokenFeature(query.get("feature"));
    return heard ? { id: heard, query, spoken: true } : null;
  }
  return id in INTENTS ? { id: id as IntentId, query, spoken: query.get("ask") === "1" } : null;
}

/** The shortcut a spoken feature name means ("next lead", "my next callback", "add a lead", "check a number", "search"). */
export function spokenFeature(words: string | null | undefined): IntentId | null {
  const w = (words ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  if (!w) return null;
  if (w in INTENTS) return w as IntentId;
  if (/callback/.test(w)) return "next-callback";
  if (/(add|new|create) (a )?lead/.test(w)) return "add-lead";
  if (/check|do not call|dnc|number/.test(w)) return "check-number";
  if (/search|find|look up/.test(w)) return "search";
  if (/next lead|serve|start calling|dial|call/.test(w)) return "serve-next";
  return null;
}

/**
 * The app route for a shortcut link, or null when the link is not a shortcut (it then goes through as
 * it came). `nonce` makes each "Add a lead" a fresh request, so a second tap reopens the sheet.
 */
export function resolveIntentPath(path: string, nonce: number = Date.now(), tabs?: readonly string[] | null): string | null {
  const hit = intentOf(path);
  if (!hit) return null;
  switch (hit.id) {
    case "serve-next": return reachable("/calls?part=dialer", tabs);
    // L5: asked aloud ("What's my next callback?"), the answer is spoken back on a card (/ask), not the list. The
    // same link from a widget, a notification or the icon opens the callbacks themselves.
    case "next-callback": return hit.spoken ? `/ask?q=next-callback&n=${nonce}` : reachable("/calls?part=callbacks", tabs);
    case "add-lead": return reachable(`/leads?add=${nonce}`, tabs);
    case "search": return "/search";
    case "check-number": {
      // Siri / Google may pass the number they heard; only digits travel, never words.
      const digits = (hit.query.get("number") ?? "").replace(/\D/g, "").slice(0, 15);
      return digits ? `/compliance/check-number?number=${digits}` : "/compliance/check-number";
    }
  }
}

/** The link a shortcut sends, for the native side (shortcuts.xml, App Intents, widgets). */
export function intentUrl(id: IntentId): string {
  return `${SCHEME}://${id}`;
}

/**
 * The icon-menu items for this person, ready for expo-quick-actions' setItems once it is installed
 * (a development build; Expo Go has no icon menu). `params.href` is what its useQuickActionRouting
 * pushes, so it is the resolved app route, not the insurvas:// link.
 */
export function quickActionItems(role: string | null | undefined, nonce: number = Date.now(), options: TabOptions = {}) {
  // Signed out: no shortcuts (the role helpers fall back to a producer's tabs for an unknown role).
  if (!role) return [];
  const tabs = tabsFor(role, options);
  return ICON_SHORTCUTS.filter((id) => INTENTS[id].allowed(role, tabs, options.features)).map((id) => ({
    id,
    title: INTENTS[id].title,
    // iOS draws an SF Symbol; Android a drawable the expo-quick-actions plugin builds (app.json androidIcons).
    icon: Platform.OS === "android" ? INTENTS[id].androidIcon : `symbol:${INTENTS[id].iosSymbol}`,
    params: { href: resolveIntentPath(intentUrl(id), nonce, tabs) ?? "/" },
  }));
}

/**
 * A screen's side of a shortcut that opens something on it (`/leads?add=<nonce>` opens Add a lead).
 * Open while the link's nonce is new; `done()` marks it handled so closing the sheet keeps it closed,
 * and the next shortcut (a new nonce) opens it again. No effect: the state is derived from the link.
 */
export function useIntentOpen(param: string): { open: boolean; done: () => void } {
  const params = useLocalSearchParams<Record<string, string | undefined>>();
  const asked = typeof params[param] === "string" ? params[param] : null;
  const [handled, setHandled] = useState<string | null>(null);
  return { open: asked !== null && asked !== handled, done: () => setHandled(asked) };
}
