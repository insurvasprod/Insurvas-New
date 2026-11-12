"use client";

import { useState } from "react";

import { notify } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toolbarControl } from "@/components/ui/data-toolbar";
import { sendJson } from "./use-agency-data";

type Person = { id: string; name: string; managerId: string | null };

const longDay = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", timeZone: "UTC" });

/** The first day of next month: overrides follow the new line from a month's start, so the month in hand is unchanged. */
function nextMonthStart(now = new Date()): string {
  const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return at.toISOString().slice(0, 10);
}

/**
 * Reports › Hierarchy & overrides › More › Change a manager (6·5, owner pick 2026-11-11): the producer, who he reports to,
 * and from when (the first of next month unless changed). It writes the same effective-dated move the producer page's
 * Change manager does (PUT /api/app/agency/producers/[id]/manager); cycles are refused by the database and said here.
 */
export function ChangeManagerDialog({ people, open, onOpenChange, onDone }: { people: readonly Person[]; open: boolean; onOpenChange: (open: boolean) => void; onDone: () => void }) {
  const [producer, setProducer] = useState(people[0]?.id ?? "");
  const [manager, setManager] = useState(people[0]?.managerId ?? "");
  const [from, setFrom] = useState(nextMonthStart);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = people.find((p) => p.id === producer)?.name ?? "The producer";

  async function save() {
    setBusy(true);
    setError(null);
    const { error: message } = await sendJson(`/api/app/agency/producers/${producer}/manager`, "PUT", { managerProducerId: manager || null, effectiveFrom: from });
    setBusy(false);
    if (message) {
      setError(message);
      notify.fail("That didn't save.", { detail: "Try again; nothing was changed." });
      return;
    }
    notify.done(`${name} now reports to ${people.find((p) => p.id === manager)?.name ?? "the owner"}.`, { detail: `From ${longDay(from)}; reports before that date are unchanged.` });
    onOpenChange(false);
    onDone();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { setError(null); onOpenChange(next); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change a manager</DialogTitle>
          <DialogDescription>Overrides follow the new line from the date you choose; months before it are unchanged.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <label className="grid gap-1 text-sm font-medium">Producer
            <select className={toolbarControl} value={producer} onChange={(e) => { setProducer(e.target.value); setManager(people.find((p) => p.id === e.target.value)?.managerId ?? ""); }}>
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm font-medium">Reports to
            <select className={toolbarControl} value={manager} onChange={(e) => setManager(e.target.value)}>
              <option value="">Owner</option>
              {people.filter((p) => p.id !== producer).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm font-medium">From<input type="date" className={toolbarControl} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          {error && <p role="alert" className="text-sm text-[var(--error-ink)]">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={busy || !from || !producer}>{busy ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
