"use client";

import { useCallback, useId, useMemo, useState, useSyncExternalStore, type FormEvent } from "react";
import { Bookmark, Check, ChevronDown, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import {
  addSavedView, matchView, MAX_VIEW_NAME, parseSavedViews, removeSavedView, serializeSavedViews, viewsStorageKey,
  type SavedView, type ViewState,
} from "@/lib/views/tableViews";

export type { SavedView, ViewState };

/** A view the page offers out of the box: a name and the filter state it stands for. */
export type BuiltInView = {
  id: string;
  name: string;
  /** Partial is fine: keys left out (or empty) mean "not filtered". */
  state: ViewState;
  /** Rows the view would show, when the page knows it cheaply. */
  count?: number;
  disabled?: boolean;
  /** Why it is disabled, or what it shows. */
  title?: string;
};

/**
 * Saved views (2026-10-09): one 36px toolbar control, in a DataToolbar after the filters. It shows
 * the view the filters currently are ("All" when nothing narrows the list) and lists the page's
 * built-in views, the person's own saved views (each with Delete), and "Save current view…".
 *
 * The page owns its filter state. This control only reads `current` (serialisable) and hands a
 * state back through `onApply`; the page fills in defaults for any key the state leaves out.
 *
 * PER-BROWSER FOR NOW: saved views live in this browser's localStorage under
 * `insurvas.views.v1:<storageKey>`, so they do not follow the person to another device. A
 * server-backed version needs its own table and migration, which cannot be applied from here.
 * Every read and write is guarded: with storage blocked (private window, policy) the control still
 * works with the built-ins, and saving is switched off.
 */
export function SavedViews({
  storageKey,
  current,
  builtIns,
  onApply,
}: {
  /** Which list these views belong to, e.g. "leads.table". */
  storageKey: string;
  current: ViewState;
  builtIns: readonly BuiltInView[];
  onApply: (state: ViewState) => void;
}) {
  const key = viewsStorageKey(storageKey);
  const raw = useSyncExternalStore(subscribeStorage, () => readStorage(key), () => UNAVAILABLE);
  const storageOk = raw !== UNAVAILABLE;
  const saved = useMemo(() => (storageOk ? parseSavedViews(raw) : []), [raw, storageOk]);
  const active = matchView(current, builtIns, saved);
  const label = active ? active.view.name : "Custom view";

  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const nameId = useId();

  const write = useCallback((next: SavedView[]) => {
    if (writeStorage(key, serializeSavedViews(next))) return true;
    notify.block("Could not save views in this browser", { detail: "Browser storage is blocked or full." });
    return false;
  }, [key]);

  function save(event: FormEvent) {
    event.preventDefault();
    const clean = name.trim();
    if (!clean) return;
    if (write(addSavedView(saved, clean, current, newId()))) {
      notify.done(`View “${clean.slice(0, MAX_VIEW_NAME)}” saved`);
      setNaming(false);
      setName("");
    }
  }

  function remove(view: SavedView) {
    if (write(removeSavedView(saved, view.id))) notify.done(`View “${view.name}” deleted`);
  }

  return (
    <>
      {/* Not modal: "Save current view…" opens a Dialog from the menu, and a modal menu closing
          under an opening dialog can leave the page unclickable. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" aria-label={`View: ${label}`} className="max-w-[16rem]">
            <Bookmark aria-hidden="true" />
            <span className="truncate">{label}</span>
            <ChevronDown aria-hidden="true" className="opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>Views</DropdownMenuLabel>
          {builtIns.map((view) => {
            const on = active?.kind === "built-in" && active.view.id === view.id;
            return (
              <DropdownMenuItem key={view.id} disabled={view.disabled} title={view.title} onSelect={() => onApply(view.state)} aria-current={on ? "true" : undefined}>
                <Check aria-hidden="true" className={cn(!on && "invisible")} />
                <span className="min-w-0 flex-1 truncate">{view.name}</span>
                {view.count !== undefined && <span className="text-xs tabular-nums text-muted-foreground">{view.count.toLocaleString()}</span>}
              </DropdownMenuItem>
            );
          })}
          {saved.length > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Your views</DropdownMenuLabel>
              {saved.map((view) => {
                const on = active?.kind === "saved" && active.view.id === view.id;
                return (
                  <div key={view.id} className="flex items-center gap-0.5">
                    <DropdownMenuItem className="min-w-0 flex-1" onSelect={() => onApply(view.state)} aria-current={on ? "true" : undefined}>
                      <Check aria-hidden="true" className={cn(!on && "invisible")} />
                      <span className="min-w-0 flex-1 truncate">{view.name}</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem aria-label={`Delete view ${view.name}`} title="Delete view" className="shrink-0" onSelect={() => remove(view)}>
                      <X aria-hidden="true" />
                    </DropdownMenuItem>
                  </div>
                );
              })}
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!storageOk} title={storageOk ? undefined : "Browser storage is blocked, so views cannot be saved here"} onSelect={() => { setName(""); setNaming(true); }}>
            <Plus aria-hidden="true" />
            Save current view…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={naming} onOpenChange={setNaming}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Save current view</DialogTitle>
            <DialogDescription>Saved in this browser only.</DialogDescription>
          </DialogHeader>
          <form onSubmit={save} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={nameId}>Name</Label>
              <Input id={nameId} value={name} maxLength={MAX_VIEW_NAME} autoFocus onChange={(event) => setName(event.target.value)} placeholder="e.g. My overdue" />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setNaming(false)}>Cancel</Button>
              <Button type="submit" disabled={!name.trim()}>Save view</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── storage, guarded ─────────────────────────────────────────────────────────────────────────

/** The snapshot when storage cannot be read (and on the server). Not a value JSON can produce. */
const UNAVAILABLE = "\u0000unavailable";
/** Same-tab writes: the browser's `storage` event only fires in the other tabs. */
const LOCAL_EVENT = "insurvas:views-changed";

function subscribeStorage(onChange: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", onChange);
  window.addEventListener(LOCAL_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(LOCAL_EVENT, onChange);
  };
}

function readStorage(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return UNAVAILABLE;
  }
}

function writeStorage(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    return false;
  }
  try {
    window.dispatchEvent(new Event(LOCAL_EVENT));
  } catch {
    /* the write landed; the control catches up on its next read */
  }
  return true;
}

function newId() {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch {
    /* fall through */
  }
  return `v${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
