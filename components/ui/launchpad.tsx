"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Maximize2, Minimize2, Plus, X } from "lucide-react";

import { isTypingTarget } from "@/lib/keyboard/listNavigation";
import { cn } from "@/lib/utils";

export type LaunchCell = {
  id: string;
  title: string;
  /** Columns at xl (2 is a wide tile) and rows (2 is a tall tile), as Dashboard C draws them. */
  w: 1 | 2;
  h: 1 | 2;
  /** Where its number key goes. */
  href: string;
  node: ReactNode;
};
export type LaunchSpace = { key: string; label: string; cells: LaunchCell[] };

type Prefs = { hidden: string[]; wide: Record<string, 1 | 2> };
type CellApi = { number: number | null; setEmpty: (empty: boolean) => void };

const CellContext = createContext<CellApi>({ number: null, setEmpty: () => {} });

/** The tile's number in its corner (1–9), drawn by the cell it sits in. */
export function LaunchKey() {
  const { number } = useContext(CellContext);
  // Each badge waits for its own mount: a tile streamed in later hydrates exactly as the server sent
  // it (no number), and only then takes its place in the order.
  const [ready, setReady] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setReady(true), []);
  if (!ready || number === null || number > 9) return null;
  return (
    <kbd aria-hidden="true" className="inline-flex size-[22px] shrink-0 items-center justify-center rounded-[7px] bg-[var(--primary)] text-xs font-bold text-[var(--on-primary)]">
      {number}
    </kbd>
  );
}

/** A tile body that loads for itself says when it has nothing, and the cell leaves the grid. */
export function useLaunchCell() {
  return useContext(CellContext);
}

/** Rendered in place of a tile that has nothing to show: its cell leaves the grid and the numbering. */
export function LaunchEmpty() {
  const { setEmpty } = useContext(CellContext);
  useEffect(() => {
    setEmpty(true);
    return () => setEmpty(false);
    // Once per mount: the cell's setter changes identity every render, its effect does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

const readPrefs = (key: string): Prefs => {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? (JSON.parse(raw) as Partial<Prefs>) : {};
    return { hidden: Array.isArray(parsed.hidden) ? parsed.hidden : [], wide: parsed.wide && typeof parsed.wide === "object" ? parsed.wide : {} };
  } catch {
    return { hidden: [], wide: {} };
  }
};

/**
 * The launchpad (redesign 2026-10-25, owner: "take dashboard C, all of the tiles and the design that
 * it is, copy the exact pattern"). Dashboard C, as a component:
 *
 *   workspaces  the tabs over the grid — each a set of tiles for one job (Today, Money, Everything);
 *   tiles       frosted cards in a dense four-column grid, wide (2×1) and tall (1×2) where C has them,
 *               numbered so 1–9 open the first nine of the workspace on screen;
 *   Arrange     resize a tile, take one off, put it back ("+ Add a tile"). Kept in this browser, per
 *               person and home (`storageKey`) — a layout preference, never a permission: a tile the
 *               server did not send cannot be added back.
 *
 * The tiles themselves are server-rendered (`DashTile`), streamed in their own Suspense where they
 * read; this only arranges them. A tile that loads for itself and finds nothing (the close-out list
 * on most mornings) hides its cell through `useLaunchCell().setEmpty`.
 */
export function Launchpad({ storageKey, spaces, label = "Your launchpad" }: { storageKey: string; spaces: LaunchSpace[]; label?: string }) {
  const router = useRouter();
  const [space, setSpace] = useState(0);
  const [editing, setEditing] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>({ hidden: [], wide: {} });
  const [empty, setEmptyIds] = useState<string[]>([]);
  // Numbers appear once the grid has settled in the browser: streamed tiles that turn out empty
  // leave the numbering while the page hydrates, and a number the server guessed would be wrong.
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // Browser storage is only readable after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPrefs(readPrefs(storageKey));
    setMounted(true);
  }, [storageKey]);

  const save = useCallback((next: Prefs) => {
    setPrefs(next);
    try { window.localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* storage blocked: the change holds for this visit */ }
  }, [storageKey]);

  const current = spaces[Math.min(space, spaces.length - 1)];
  const visible = useMemo(
    () => (current?.cells ?? []).filter((cell) => !prefs.hidden.includes(cell.id) && !empty.includes(cell.id)),
    [current, prefs.hidden, empty],
  );
  const hiddenHere = (current?.cells ?? []).filter((cell) => prefs.hidden.includes(cell.id));

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || editing) return;
      if (!/^[1-9]$/.test(event.key) || isTypingTarget(event.target as HTMLElement | null)) return;
      if (document.querySelector("[role='dialog'], [role='alertdialog']")) return;
      const cell = visible[Number(event.key) - 1];
      if (!cell) return;
      event.preventDefault();
      router.push(cell.href);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [visible, editing, router]);

  const setEmptyFor = useCallback((id: string, isEmpty: boolean) => {
    setEmptyIds((list) => (isEmpty ? (list.includes(id) ? list : [...list, id]) : list.filter((item) => item !== id)));
  }, []);

  if (!current) return null;

  return (
    <section aria-label={label} className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        {spaces.length > 1 ? (
          <div role="tablist" aria-label="Workspaces" className="m-glass flex gap-1 rounded-xl border border-border p-1">
            {spaces.map((item, index) => (
              <button
                key={item.key}
                type="button"
                role="tab"
                onClick={() => { setSpace(index); setEditing(false); }}
                aria-selected={index === space}
                className={cn(
                  "h-8 rounded-lg px-3.5 text-sm font-semibold leading-normal tracking-[-0.02em] transition-colors",
                  index === space ? "bg-[var(--primary)] text-[var(--on-primary)]" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        ) : (
          <h2 className="m-0 text-sm font-semibold leading-normal tracking-[-0.02em] text-foreground">{current.label}</h2>
        )}
        <span className="flex-1" />
        {!editing && <span className="hidden text-xs leading-normal text-muted-foreground md:inline">Press 1–9 to open</span>}
        <button
          type="button"
          onClick={() => setEditing((value) => !value)}
          aria-pressed={editing}
          className={cn(
            "h-9 rounded-lg border px-3.5 text-sm font-semibold leading-normal transition-colors",
            editing ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--on-primary)]" : "m-glass border-border text-foreground hover:border-[var(--border-strong)]",
          )}
        >
          {editing ? "Done" : "Arrange"}
        </button>
      </div>

      <div className={cn("grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4 xl:auto-rows-[minmax(196px,auto)] [grid-auto-flow:dense]", editing && "m-launch-editing")}>
        {current.cells.map((cell) => {
          const shown = visible.indexOf(cell);
          const wide = (prefs.wide[cell.id] ?? cell.w) === 2;
          return (
            <CellContext.Provider key={cell.id} value={{ number: mounted && shown >= 0 ? shown + 1 : null, setEmpty: (isEmpty) => setEmptyFor(cell.id, isEmpty) }}>
              <div
                hidden={shown < 0}
                data-launch-cell={cell.id}
                className={cn("relative flex min-w-0 flex-col [&>*]:flex-1", wide && "sm:col-span-2", cell.h === 2 && "xl:row-span-2", editing && "m-launch-wiggle")}
              >
                {cell.node}
                {editing && (
                  <span className="absolute right-3 top-3 z-[1] flex gap-1">
                    <button
                      type="button"
                      onClick={() => save({ ...prefs, wide: { ...prefs.wide, [cell.id]: wide ? 1 : 2 } })}
                      aria-label={`${wide ? "Narrow" : "Widen"} ${cell.title}`}
                      className="inline-flex size-8 items-center justify-center rounded-lg border border-border bg-[var(--surface)] text-foreground"
                    >
                      {wide ? <Minimize2 className="size-4" aria-hidden="true" /> : <Maximize2 className="size-4" aria-hidden="true" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => save({ ...prefs, hidden: [...prefs.hidden, cell.id] })}
                      aria-label={`Take ${cell.title} off`}
                      className="inline-flex size-8 items-center justify-center rounded-lg border border-[color-mix(in_srgb,var(--error)_45%,transparent)] bg-[var(--surface)] text-[var(--error-ink)]"
                    >
                      <X className="size-4" aria-hidden="true" />
                    </button>
                  </span>
                )}
              </div>
            </CellContext.Provider>
          );
        })}
        {editing && (
          <div className="flex min-h-[196px] flex-col gap-2 rounded-xl border border-dashed border-[color-mix(in_srgb,var(--primary)_50%,transparent)] p-4">
            <span className="flex items-center gap-2 text-sm font-semibold leading-normal text-[var(--accent-ink)]"><Plus className="size-4" aria-hidden="true" />Add a tile</span>
            {hiddenHere.length === 0 ? (
              <span className="text-xs leading-normal text-muted-foreground">Every tile is on. A tile you take off waits here.</span>
            ) : (
              hiddenHere.map((cell) => (
                <button
                  key={cell.id}
                  type="button"
                  onClick={() => save({ ...prefs, hidden: prefs.hidden.filter((id) => id !== cell.id) })}
                  className="h-9 rounded-lg border border-border px-3 text-left text-sm font-semibold leading-normal text-foreground hover:border-[var(--border-strong)]"
                >
                  {cell.title}
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </section>
  );
}
