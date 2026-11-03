"use client";

import { useMemo, useState } from "react";
import { Check, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toolbarControl } from "@/components/ui/data-toolbar";
import { cn } from "@/lib/utils";

/**
 * Give to… (Callbacks A, owner 2026-10-28): pick the agent who takes over one or more callbacks. Only
 * people who may hold callbacks are offered (active owners, producers and assistants in this session's
 * scope); the database checks again (reassign_callback).
 */
export type Assignee = { id: string; name: string; role: string };

const ROLE_WORD: Record<string, string> = { owner: "Owner", producer: "Producer", assistant: "Assistant" };

export function GiveToDialog({ open, onOpenChange, count, people, currentHolder, viewerId, busy, onGive }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  count: number;
  people: Assignee[];
  /** When every chosen callback is held by one person, that person (not offered). */
  currentHolder: string | null;
  viewerId: string | null;
  busy: boolean;
  onGive: (assigneeId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [chosen, setChosen] = useState<string | null>(null);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return people.filter((person) => person.id !== currentHolder && (!q || person.name.toLowerCase().includes(q)));
  }, [people, currentHolder, query]);
  const name = people.find((person) => person.id === chosen)?.name;
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) { onOpenChange(next); if (!next) { setChosen(null); setQuery(""); } } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Give {count === 1 ? "this callback" : `${count} callbacks`} to…</DialogTitle>
          <DialogDescription>They keep their times. The new agent is reminded and calls them; the history says who handed them over.</DialogDescription>
        </DialogHeader>
        <label className="relative block">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <span className="sr-only">Search the team</span>
          <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search the team" className={cn(toolbarControl, "w-full pl-9")} />
        </label>
        <div role="radiogroup" aria-label="Agent" className="max-h-72 overflow-y-auto rounded-lg border border-border p-1">
          {shown.length === 0 ? <p className="m-0 px-3 py-6 text-center text-sm text-muted-foreground">{people.length ? "Nobody matches." : "Nobody else on the team can hold callbacks."}</p> : shown.map((person) => {
            const on = chosen === person.id;
            return (
              <button key={person.id} type="button" role="radio" aria-checked={on} onClick={() => setChosen(person.id)} className={cn("flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors", on ? "bg-[var(--primary-soft)]" : "hover:bg-[var(--surface-alt)]")}>
                <span aria-hidden="true" className="inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--surface-alt)] text-xs font-semibold text-[var(--body)]">{person.name.split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase() ?? "").join("")}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">{person.name}{person.id === viewerId && <span className="font-normal text-muted-foreground"> (you)</span>}</span>
                  <span className="block text-xs text-muted-foreground">{ROLE_WORD[person.role] ?? person.role}</span>
                </span>
                <span aria-hidden="true" className={cn("inline-flex size-5 shrink-0 items-center justify-center rounded-full border", on ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]" : "border-[var(--border-strong)]")}>{on && <Check className="size-3.5" />}</span>
              </button>
            );
          })}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" disabled={busy || !chosen} onClick={() => chosen && onGive(chosen)}>{busy ? "Handing over…" : name ? `Give to ${name}` : "Give"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
