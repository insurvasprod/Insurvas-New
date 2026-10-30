// Settings › Sales › Disclosures, as pure reads (LA-3.10 and LA-2.23). Client-safe: no `server-only`,
// no `@/` imports, so the panel, the call-wording route and the node tests share one reading.
//
//   · documents(): the library, one row per code — the agency's newest version if it has any, else the
//     Insurvas one; `live` is what applications attach today; `versions` is every version, newest first.
//   · attention(): what the owner should act on — a live document no rule ever requires, a draft
//     waiting to be published.
//   · versionChanges(): what a draft changes against the live version, in words.
//   · tryCase(): which live documents an application would need, through the workspace's own rules.
//   · callCoverage(): per product and state, the wording the dialer would serve today (LA-2.23).

import { applicableDisclosures } from "../applications/disclosureRules.ts";
import type { DisclosureItem } from "./disclosures.ts";

export type LibraryDoc = {
  code: string;
  /** The row the list shows: the agency's newest version, else the Insurvas one. */
  shown: DisclosureItem;
  /** What applies now: the agency's published version, else the Insurvas one. */
  live: DisclosureItem | null;
  platform: DisclosureItem | null;
  /** The agency's own versions, newest first. */
  own: DisclosureItem[];
  /** Every version this agency can open, newest first (Insurvas ones after its own). */
  versions: DisclosureItem[];
  /** The agency's draft, when one is waiting. */
  draft: DisclosureItem | null;
};

export type DocFilter = "all" | "live" | "draft" | "platform" | "retired";

export function documents(items: DisclosureItem[]): LibraryDoc[] {
  const byCode = new Map<string, DisclosureItem[]>();
  for (const item of items) byCode.set(item.code, [...(byCode.get(item.code) ?? []), item]);
  return [...byCode.entries()].map(([code, list]) => {
    const own = list.filter((i) => !i.platform).sort((a, b) => b.version - a.version);
    const platforms = list.filter((i) => i.platform && i.status === "published").sort((a, b) => b.version - a.version);
    const platform = platforms[0] ?? null;
    const live = own.find((i) => i.status === "published") ?? platform;
    return { code, own, platform, live, shown: own[0] ?? platform!, versions: [...own, ...platforms], draft: own.find((i) => i.status === "draft") ?? null };
  }).filter((d) => d.shown).sort((a, b) => a.shown.title.localeCompare(b.shown.title));
}

/** Which filter chip a document falls under. A live document with a draft waiting counts as both. */
export function docMatches(doc: LibraryDoc, filter: DocFilter): boolean {
  if (filter === "all") return true;
  if (filter === "draft") return doc.draft !== null;
  if (filter === "platform") return doc.shown.platform;
  if (filter === "retired") return !doc.live;
  return doc.live !== null && !doc.live.platform;
}

export function searchDocs(docs: LibraryDoc[], query: string): LibraryDoc[] {
  const q = query.trim().toLowerCase();
  if (!q) return docs;
  // The wording too: people remember a phrase from it more often than the code.
  return docs.filter((d) => [d.shown.title, d.code, d.shown.body, d.live?.body ?? ""].some((text) => text.toLowerCase().includes(q)));
}

export type Attention = { noRule: LibraryDoc[]; drafts: LibraryDoc[] };

/** A live agency document with no rule is attached to nothing; a draft applies to nothing until published. */
export function attention(docs: LibraryDoc[]): Attention {
  return {
    noRule: docs.filter((d) => d.live && !d.live.platform && d.live.rules.length === 0),
    drafts: docs.filter((d) => d.draft !== null),
  };
}

const sameList = (a: readonly string[], b: readonly string[]) => [...a].sort().join(",") === [...b].sort().join(",");

/** What `next` changes against `base`, one short line each; empty when nothing differs. */
export function versionChanges(base: Pick<DisclosureItem, "title" | "body" | "states" | "carrierIds" | "rules" | "hasAttachment">, next: Pick<DisclosureItem, "title" | "body" | "states" | "carrierIds" | "rules" | "hasAttachment">): string[] {
  const out: string[] = [];
  if (base.title.trim() !== next.title.trim()) out.push("Title");
  if (base.body.trim() !== next.body.trim()) {
    const delta = wordCount(next.body) - wordCount(base.body);
    out.push(delta === 0 ? "Wording" : `Wording (${delta > 0 ? "+" : "−"}${Math.abs(delta)} ${Math.abs(delta) === 1 ? "word" : "words"})`);
  }
  if (!sameList(base.states, next.states)) out.push(`States: ${next.states.length ? next.states.join(", ") : "every state"}`);
  if (!sameList(base.carrierIds, next.carrierIds)) out.push(`Carriers: ${next.carrierIds.length ? `${next.carrierIds.length} picked` : "every carrier"}`);
  if (JSON.stringify(base.rules) !== JSON.stringify(next.rules)) out.push(`Rules: ${next.rules.length} ${next.rules.length === 1 ? "rule" : "rules"}`);
  if (base.hasAttachment !== next.hasAttachment) out.push(next.hasAttachment ? "PDF added" : "PDF removed");
  return out;
}

export function wordCount(text: string) {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

/** Read aloud at about 150 words a minute, the pace a disclosure is read on a call. */
export function readAloudSeconds(text: string) {
  return Math.round((wordCount(text) / 150) * 60);
}

export function readAloudLine(text: string) {
  const words = wordCount(text);
  if (!words) return "No wording yet";
  const secs = readAloudSeconds(text);
  const time = secs < 60 ? `about ${Math.max(5, Math.round(secs / 5) * 5)} seconds` : `about ${Math.round(secs / 30) / 2} minutes`;
  return `${words} ${words === 1 ? "word" : "words"} · ${time} read aloud`;
}

/** A free code for a duplicate: CODE_2, CODE_3… (at most 64 characters, the code's limit). */
export function duplicateCode(code: string, taken: Iterable<string>) {
  const used = new Set(taken);
  const base = code.replace(/_\d+$/, "").slice(0, 60);
  for (let n = 2; n < 1000; n++) if (!used.has(`${base}_${n}`)) return `${base}_${n}`;
  return `${base}_COPY`;
}

export type DiffPart = { text: string; kind: "same" | "add" | "del" };

/**
 * Word-level difference between two wordings, for Compare. A longest-common-subsequence over words,
 * whitespace kept with the word before it; past 1,500 words a side it gives up and shows the whole
 * text as removed and added rather than freeze the page.
 */
export function wordDiff(before: string, after: string): DiffPart[] {
  const a = before.match(/\S+\s*/g) ?? [];
  const b = after.match(/\S+\s*/g) ?? [];
  if (a.length > 1500 || b.length > 1500) return [{ text: before, kind: "del" }, { text: after, kind: "add" }].filter((p) => p.text) as DiffPart[];
  const key = (w: string) => w.trim();
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i][j] = key(a[i]) === key(b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: DiffPart[] = [];
  const push = (text: string, kind: DiffPart["kind"]) => { const last = out[out.length - 1]; if (last?.kind === kind) last.text += text; else out.push({ text, kind }); };
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    if (key(a[i]) === key(b[j])) { push(b[j], "same"); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) push(a[i++], "del");
    else push(b[j++], "add");
  }
  while (i < a.length) push(a[i++], "del");
  while (j < b.length) push(b[j++], "add");
  return out;
}

export type CaseInput ={ state: string | null; carrierId: string | null; values: Record<string, unknown>; answers: Record<string, unknown> };

/** The live documents an application with these answers would need, in library order. */
export function tryCase(docs: LibraryDoc[], input: CaseInput): LibraryDoc[] {
  const lives = docs.map((d) => d.live).filter((i): i is DisclosureItem => i !== null);
  const rules = lives.flatMap((i) => i.rules.map((r) => ({ disclosureId: i.id, clauses: r.clauses })));
  const scopes = new Map(lives.map((i) => [i.id, { states: i.states, carrierIds: i.carrierIds }]));
  const hit = applicableDisclosures({ rules, scopes, values: input.values, answers: input.answers, state: input.state, carrierId: input.carrierId });
  return docs.filter((d) => d.live && hit.has(d.live.id));
}

// ── what is read on the call (state_disclosures, LA-2.23) ───────────────────

export type StateWordingRow = { id: string; state: string; product_code: string; required_text: string; effective_from: string };
export type CallStatus = "approved" | "placeholder" | "missing";
export type CallState = { state: string; status: CallStatus; text: string | null; effectiveFrom: string | null; next: { effectiveFrom: string; approved: boolean } | null };
export type CallProduct = { code: string; states: CallState[]; approved: number; placeholder: number; missing: number };

// The seed's marker line (scripts/seed-state-disclosures.mjs); the dialer reads it the same way.
const PLACEHOLDER = /^\s*\[\s*PLACEHOLDER\b/i;
export const isPlaceholderWording = (text: string | null | undefined) => PLACEHOLDER.test(String(text ?? ""));

/**
 * The dialer serves, per state and product, the newest row whose effective date has arrived; with
 * none, dialing that state is blocked. A row dated later is shown as the next change.
 */
export function callCoverage(rows: StateWordingRow[], stateCodes: readonly string[], productCodes: readonly string[], today: string): CallProduct[] {
  const codes = [...new Set([...rows.map((r) => r.product_code), ...productCodes])];
  return codes.map((code) => {
    const states = stateCodes.map((state): CallState => {
      const mine = rows.filter((r) => r.product_code === code && r.state === state);
      const live = mine.filter((r) => r.effective_from <= today).sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0] ?? null;
      const upcoming = mine.filter((r) => r.effective_from > today).sort((a, b) => a.effective_from.localeCompare(b.effective_from))[0] ?? null;
      return {
        state,
        status: !live ? "missing" : isPlaceholderWording(live.required_text) ? "placeholder" : "approved",
        text: live?.required_text ?? null,
        effectiveFrom: live?.effective_from ?? null,
        next: upcoming ? { effectiveFrom: upcoming.effective_from, approved: !isPlaceholderWording(upcoming.required_text) } : null,
      };
    });
    const n = (s: CallStatus) => states.filter((x) => x.status === s).length;
    return { code, states, approved: n("approved"), placeholder: n("placeholder"), missing: n("missing") };
  }).sort((a, b) => (b.states.length - b.missing) - (a.states.length - a.missing) || a.code.localeCompare(b.code));
}
