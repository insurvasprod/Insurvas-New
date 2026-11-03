"use client";

import { useEffect, useState } from "react";
import { notify } from "@/lib/notify";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toolbarControl } from "@/components/ui/data-toolbar";
import { SectionLoading } from "@/components/ui/page-states";
import { BasisChip, Money } from "./money";
import { sendJson } from "./use-agency-data";

type Preview = { displayName: string; balanceCents: number; policiesInWindow: number; advanceAtRiskCents: number; seatReleasedOn: string; reactivatableUntil: string; sentence: string };

/**
 * AG-0.7 · the offboarding confirmation — the point of the task. Before the button the owner sees the producer's
 * frozen balance (negative included), the policies still inside the chargeback window and what they could cost,
 * and one plain sentence saying the agency, not the producer, pays for their lapses from today. The button needs
 * the word OFFBOARD typed, so it cannot be pressed without the numbers having been read.
 */
export function OffboardDialog({ producerId, open, onOpenChange, onDone }: { producerId: string; open: boolean; onOpenChange: (open: boolean) => void; onDone: () => void }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clear the last producer's figures as the dialog opens
    setPreview(null); setError(null); setTyped("");
    fetch(`/api/app/agency/producers/${producerId}/offboard`, { cache: "no-store" })
      .then(async (res) => { const body = await res.json().catch(() => null); if (!res.ok) setError(body?.error ?? "Could not load the offboarding figures"); else setPreview(body); })
      .catch(() => setError("Could not load the offboarding figures. Check your connection."));
  }, [open, producerId]);

  async function confirm() {
    setBusy(true);
    const { error: message } = await sendJson(`/api/app/agency/producers/${producerId}/offboard`, "POST", { confirm: typed.trim() });
    setBusy(false);
    if (message) { setError(message); return; }
    notify.done(`${preview?.displayName ?? "The producer"} is offboarded. Their balance is frozen and their policies stay in the book.`);
    onOpenChange(false);
    onDone();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Offboard {preview?.displayName ?? "producer"}</DialogTitle>
          <DialogDescription>Their login stops today. Their policies stay in the agency book under their name.</DialogDescription>
        </DialogHeader>
        {!preview && !error ? <SectionLoading rows={3} columns={2} label="Loading the figures" /> : null}
        {preview && (
          <div className="grid gap-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-border p-3"><div className="text-xs font-semibold uppercase text-[var(--muted)]">Frozen balance <BasisChip basis="reported" /></div><div className="mt-1 text-xl font-semibold"><Money cents={preview.balanceCents} /></div><div className="text-xs text-[var(--muted)]">{preview.balanceCents < 0 ? "They owe the agency" : preview.balanceCents > 0 ? "The agency owes them" : "Nothing owed either way"}</div></div>
              <div className="rounded-lg border border-border p-3"><div className="text-xs font-semibold uppercase text-[var(--muted)]">Still in the chargeback window</div><div className="mt-1 text-xl font-semibold tabular-nums">{preview.policiesInWindow} {preview.policiesInWindow === 1 ? "policy" : "policies"}</div><div className="text-xs text-[var(--muted)]"><Money cents={preview.advanceAtRiskCents} /> advanced, at risk</div></div>
            </div>
            <p role="alert" className="rounded-md border-l-[3px] border-l-[var(--error)] bg-[var(--error-surface)] p-2 font-medium text-[var(--error-ink)]">{preview.sentence}</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="text-[var(--muted)]">Their seat</dt><dd>released on {preview.seatReleasedOn} (end of period)</dd>
              <dt className="text-[var(--muted)]">Undo</dt><dd>reactivate until {preview.reactivatableUntil} (30 days)</dd>
            </dl>
            <label className="grid gap-1 font-medium">Type OFFBOARD to confirm<input className={toolbarControl} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" /></label>
          </div>
        )}
        {error && <p role="alert" className="rounded-md border-l-[3px] border-l-[var(--error)] bg-[var(--error-surface)] p-2 text-sm text-[var(--error-ink)]">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="destructive" disabled={!preview || typed.trim() !== "OFFBOARD" || busy} onClick={confirm}>{busy ? "Offboarding…" : `Offboard ${preview?.displayName ?? ""}`.trim()}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** AG-0.7 · suspend (or reactivate): a short confirm, reversible. */
export function StatusDialog({ producerId, name, action, open, onOpenChange, onDone }: { producerId: string; name: string; action: "suspend" | "reactivate"; open: boolean; onOpenChange: (open: boolean) => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function go() {
    setBusy(true);
    const { error: message } = await sendJson(`/api/app/agency/producers/${producerId}/${action}`, "POST", {});
    setBusy(false);
    if (message) { setError(message); return; }
    notify.done(action === "suspend" ? `${name} is suspended. Their book is untouched and their seat is kept.` : `${name} is active again. Their licences are re-checked before they can submit.`);
    onOpenChange(false);
    onDone();
  }
  return (
    <Dialog open={open} onOpenChange={(next) => { setError(null); onOpenChange(next); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{action === "suspend" ? `Suspend ${name}` : `Reactivate ${name}`}</DialogTitle>
          <DialogDescription>{action === "suspend" ? "They cannot sign in to this agency or submit business. Their book and seat stay as they are. You can reactivate them in one click." : "They can sign in again. They can submit once their licences and appointments check out."}</DialogDescription>
        </DialogHeader>
        {error && <p role="alert" className="rounded-md border-l-[3px] border-l-[var(--error)] bg-[var(--error-surface)] p-2 text-sm text-[var(--error-ink)]">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant={action === "suspend" ? "destructive" : "default"} onClick={go} disabled={busy}>{busy ? "Saving…" : action === "suspend" ? "Suspend" : "Reactivate"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** AG-0.3 / AG-1.2 · change a producer's manager from a date (a new hierarchy row; history is never rewritten). */
export function ManagerDialog({ producerId, name, managers, open, onOpenChange, onDone }: { producerId: string; name: string; managers: Array<{ id: string; name: string }>; open: boolean; onOpenChange: (open: boolean) => void; onDone: () => void }) {
  const [manager, setManager] = useState("");
  const [from, setFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setBusy(true);
    const { error: message } = await sendJson(`/api/app/agency/producers/${producerId}/manager`, "PUT", { managerProducerId: manager || null, effectiveFrom: from });
    setBusy(false);
    if (message) { setError(message); return; }
    notify.done(`${name} reports to ${managers.find((m) => m.id === manager)?.name ?? "the owner"} from ${from}. Reports before that date are unchanged.`);
    onOpenChange(false);
    onDone();
  }
  return (
    <Dialog open={open} onOpenChange={(next) => { setError(null); onOpenChange(next); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change {name}&apos;s manager</DialogTitle>
          <DialogDescription>From the date you choose. Reports dated before it keep the old manager.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <label className="grid gap-1 text-sm font-medium">Reports to
            <select className={toolbarControl} value={manager} onChange={(e) => setManager(e.target.value)}>
              <option value="">The owner</option>
              {managers.filter((m) => m.id !== producerId).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          <label className="grid gap-1 text-sm font-medium">From<input type="date" className={toolbarControl} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          {error && <p role="alert" className="rounded-md border-l-[3px] border-l-[var(--error)] bg-[var(--error-surface)] p-2 text-sm text-[var(--error-ink)]">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={busy || !from}>{busy ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
