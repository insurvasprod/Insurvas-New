/**
 * The pure half of saved views and row selection (components/ui/saved-views.tsx,
 * components/ui/bulk-bar.tsx), kept apart so it can be tested without a browser.
 *
 * Saved views are per-browser for now: a list of { name, filter state } in localStorage under
 * `insurvas.views.v1:<storageKey>`. A server-backed version (shared across devices, or with a team)
 * needs its own table and migration, which cannot be applied from here (2026-10-09).
 */

/** One filter value a page keeps: a select's value, a search, a toggle, a multi-select. */
export type ViewValue = string | number | boolean | null | string[];
/** A page's filter state, as it saves it. The page owns the shape; this file only compares and stores it. */
export type ViewState = Record<string, ViewValue>;
export type SavedView = { id: string; name: string; state: ViewState };

export const VIEWS_STORAGE_PREFIX = "insurvas.views.v1:";
/** Enough for anyone's own shortcuts; a list longer than this stops being a shortcut. */
export const MAX_SAVED_VIEWS = 30;
export const MAX_VIEW_NAME = 60;

export function viewsStorageKey(key: string) {
  return `${VIEWS_STORAGE_PREFIX}${key}`;
}

/** A value that filters nothing: an empty search, an unset select, a toggle that is off. */
function isEmptyValue(value: unknown) {
  return value === undefined || value === null || value === "" || value === false || (Array.isArray(value) && value.length === 0);
}

/**
 * The state as one comparable string: keys sorted, values that filter nothing dropped. So a
 * built-in written as `{ scope: "mine" }` matches the page's full `{ scope: "mine", product: "" … }`.
 */
export function canonicalView(state: Readonly<Record<string, unknown>>): string {
  const entries = Object.keys(state)
    .sort()
    .filter((key) => !isEmptyValue(state[key]))
    .map((key) => {
      const value = state[key];
      return [key, Array.isArray(value) ? [...value].map(String).sort() : value] as const;
    });
  return JSON.stringify(entries);
}

export function sameView(a: Readonly<Record<string, unknown>>, b: Readonly<Record<string, unknown>>) {
  return canonicalView(a) === canonicalView(b);
}

function isViewValue(value: unknown): value is ViewValue {
  if (value === null) return true;
  if (Array.isArray(value)) return value.every((item) => typeof item === "string");
  return typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));
}

/** Only the values a filter can hold: anything else (an object, a function) is dropped. */
export function cleanViewState(state: unknown): ViewState {
  if (!state || typeof state !== "object" || Array.isArray(state)) return {};
  const clean: ViewState = {};
  for (const [key, value] of Object.entries(state as Record<string, unknown>)) {
    if (isViewValue(value)) clean[key] = Array.isArray(value) ? [...value] : value;
  }
  return clean;
}

/**
 * What localStorage held, as saved views. Never throws: a missing, corrupted or hand-edited entry
 * reads as fewer views (or none), so the control still opens with its built-ins.
 */
export function parseSavedViews(raw: string | null | undefined): SavedView[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const list = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" && Array.isArray((parsed as { views?: unknown }).views) ? (parsed as { views: unknown[] }).views : [];
  const out: SavedView[] = [];
  const seen = new Set<string>();
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const { id, name, state } = entry as { id?: unknown; name?: unknown; state?: unknown };
    if (typeof id !== "string" || !id || seen.has(id)) continue;
    if (typeof name !== "string" || !name.trim()) continue;
    seen.add(id);
    out.push({ id, name: name.trim().slice(0, MAX_VIEW_NAME), state: cleanViewState(state) });
    if (out.length >= MAX_SAVED_VIEWS) break;
  }
  return out;
}

export function serializeSavedViews(views: readonly SavedView[]): string {
  return JSON.stringify({ version: 1, views: views.slice(0, MAX_SAVED_VIEWS).map((view) => ({ id: view.id, name: view.name, state: cleanViewState(view.state) })) });
}

/**
 * Adds a view, or replaces the one already under that name (names compare without case), newest
 * last. The name is trimmed and capped; an empty name adds nothing.
 */
export function addSavedView(views: readonly SavedView[], name: string, state: ViewState, id: string): SavedView[] {
  const clean = name.trim().slice(0, MAX_VIEW_NAME);
  if (!clean) return [...views];
  const kept = views.filter((view) => view.name.toLowerCase() !== clean.toLowerCase());
  return [...kept, { id, name: clean, state: cleanViewState(state) }].slice(-MAX_SAVED_VIEWS);
}

export function removeSavedView(views: readonly SavedView[], id: string): SavedView[] {
  return views.filter((view) => view.id !== id);
}

/** The view the current filters are: a built-in first (in the order given), then the person's own. */
export function matchView<T extends { id: string; name: string; state: Readonly<Record<string, unknown>> }>(
  current: Readonly<Record<string, unknown>>,
  builtIns: readonly T[],
  saved: readonly SavedView[],
): { kind: "built-in"; view: T } | { kind: "saved"; view: SavedView } | null {
  const key = canonicalView(current);
  const builtIn = builtIns.find((view) => canonicalView(view.state) === key);
  if (builtIn) return { kind: "built-in", view: builtIn };
  const own = saved.find((view) => canonicalView(view.state) === key);
  return own ? { kind: "saved", view: own } : null;
}

// ── row selection ────────────────────────────────────────────────────────────────────────────

/**
 * The selection with every id that has left the list removed. Returns the same set when nothing
 * left, so a caller can tell a real change from a re-render.
 */
export function pruneSelection(selected: ReadonlySet<string>, visibleIds: readonly string[]): ReadonlySet<string> {
  if (selected.size === 0) return selected;
  const visible = new Set(visibleIds);
  let changed = false;
  for (const id of selected) if (!visible.has(id)) { changed = true; break; }
  if (!changed) return selected;
  return new Set([...selected].filter((id) => visible.has(id)));
}

export function toggleSelected(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

/** Every one of `ids` selected → unselects them; otherwise selects them all. Ids outside `ids` keep their state. */
export function toggleAllSelected(selected: ReadonlySet<string>, ids: readonly string[]): Set<string> {
  const next = new Set(selected);
  const all = ids.length > 0 && ids.every((id) => next.has(id));
  for (const id of ids) {
    if (all) next.delete(id);
    else next.add(id);
  }
  return next;
}

/** How much of `ids` is selected, for a header checkbox: none, some (indeterminate) or all. */
export function selectionCoverage(selected: ReadonlySet<string>, ids: readonly string[]): "none" | "some" | "all" {
  if (ids.length === 0) return "none";
  let hits = 0;
  for (const id of ids) if (selected.has(id)) hits += 1;
  return hits === 0 ? "none" : hits === ids.length ? "all" : "some";
}
