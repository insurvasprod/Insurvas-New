/**
 * LA-2.23 · the rebuttal library: its objection keys and how the dialer searches it.
 *
 * The keys mirror tenant_rebuttals_objection_key_check (20260929200100 widened it from six to eight).
 * Pure and free of `server-only`, so the route, the workspace and the tests share it.
 */

export const REBUTTAL_OBJECTIONS = [
  "too_expensive",
  "already_covered",
  "send_me_something",
  "not_interested",
  "call_me_later",
  "how_did_you_get_my_number",
  "need_to_think",
  "talk_to_spouse",
] as const;

export type RebuttalItem = { id: string; objectionKey: string; label: string; body: string };

function fold(value: string): string {
  return value.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * LA-2.23-3 · "searchable": every word typed must appear in the objection's label, its response or
 * its key ("number" finds "How did you get my number?", "spouse wife" finds nothing unless both are
 * there). Apostrophes and accents are ignored, so "dont" finds "don't". Order is the library's.
 */
export function searchRebuttals<T extends RebuttalItem>(items: readonly T[], query: string): T[] {
  const words = fold(query).split(" ").filter(Boolean);
  if (words.length === 0) return [...items];
  return items.filter((item) => {
    const haystack = fold(`${item.label} ${item.body} ${item.objectionKey.replaceAll("_", " ")}`);
    return words.every((word) => haystack.includes(word));
  });
}
