/**
 * The "Table · Chart" switch's address (Reports round 7, owner pick 0·A, 2026-11-11): `?show=table` or
 * `?show=chart`. Pure, with no React and no "use client", so a server page can read it from its
 * `searchParams` and a client view or `ViewSwitch` (components/ui/view-switch.tsx) can read the same way.
 *
 * Reports default to the chart; a drill (the rows behind a figure) defaults to the table. A value the switch
 * does not know falls back to the page's default, so an old or hand-typed address never draws nothing.
 */

export const SHOW_MODES = ["table", "chart"] as const;
export type ShowMode = (typeof SHOW_MODES)[number];

/** The address parameter the switch reads and writes. */
export const SHOW_PARAM = "show";

type ParamsLike =
  | URLSearchParams
  | { get(name: string): string | null }
  | Record<string, string | string[] | undefined>
  | null
  | undefined;

function rawOf(params: ParamsLike, name: string): string | null {
  if (!params) return null;
  if (typeof (params as { get?: unknown }).get === "function") return (params as { get(name: string): string | null }).get(name);
  const value = (params as Record<string, string | string[] | undefined>)[name];
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

/** Whether a string is one of the switch's two values. */
export function isShowMode(value: unknown): value is ShowMode {
  return typeof value === "string" && (SHOW_MODES as readonly string[]).includes(value);
}

/**
 * Which view the page shows: `?show=` when it is "table" or "chart", the page's default otherwise. Takes a
 * server page's awaited `searchParams` object, a `URLSearchParams`, or `useSearchParams()`'s result.
 */
export function showOf(params: ParamsLike, fallback: ShowMode = "chart"): ShowMode {
  const raw = rawOf(params, SHOW_PARAM);
  return isShowMode(raw) ? raw : fallback;
}

/**
 * An address with `?show=` set and every other parameter kept: a chart's bar opening the table filtered to its
 * rows (`showHref("/app/true-cpa?tab=vendors", "table", { carrier: "aflac" })`). `extra` values of null or ""
 * remove that parameter. The hash is kept.
 */
export function showHref(href: string, mode: ShowMode, extra?: Record<string, string | number | null | undefined>): string {
  const hashAt = href.indexOf("#");
  const hash = hashAt >= 0 ? href.slice(hashAt) : "";
  const bare = hashAt >= 0 ? href.slice(0, hashAt) : href;
  const queryAt = bare.indexOf("?");
  const path = queryAt >= 0 ? bare.slice(0, queryAt) : bare;
  const params = new URLSearchParams(queryAt >= 0 ? bare.slice(queryAt + 1) : "");
  params.set(SHOW_PARAM, mode);
  for (const [key, value] of Object.entries(extra ?? {})) {
    if (value === null || value === undefined || value === "") params.delete(key);
    else params.set(key, String(value));
  }
  const query = params.toString();
  return `${path}${query ? `?${query}` : ""}${hash}`;
}
