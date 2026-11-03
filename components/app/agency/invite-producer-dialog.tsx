"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { notify } from "@/lib/notify";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toolbarControl } from "@/components/ui/data-toolbar";
import { dollars } from "@/lib/agency/constants";
import { sendJson } from "./use-agency-data";

type BandFull = { error: string; code: "band_full"; usage: number; limit: number; neededLabel: string; neededPriceCents: number };

const ROLES: Array<{ value: string; label: string; ownerOnly?: boolean }> = [
  { value: "producer", label: "Producer" },
  { value: "manager", label: "Manager — a producer with direct reports" },
  { value: "admin", label: "Admin — everything except billing", ownerOnly: true },
  { value: "assistant", label: "Assistant — works for a producer, sees no money" },
  { value: "bookkeeper", label: "Bookkeeper — money only" },
  { value: "retention", label: "Retention rep" },
  { value: "setter", label: "Setter" },
];

/**
 * AG-0.6 · invite into the agency. One flow (LA-8.6's POST /api/app/team). The producer row exists from the moment
 * of the invite; the link is valid 7 days. A full band answers with the band it needs and its price, and the owner
 * can upgrade in one click.
 */
export function InviteProducerDialog({ open, onOpenChange, isAccountOwner, onInvited }: { open: boolean; onOpenChange: (open: boolean) => void; isAccountOwner: boolean; onInvited: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("producer");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bandFull, setBandFull] = useState<BandFull | null>(null);

  const reset = () => { setName(""); setEmail(""); setRole("producer"); setError(null); setBandFull(null); };

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { error: message, data } = await sendJson("/api/app/team", "POST", { name, email, role });
    setBusy(false);
    if (data?.code === "band_full") { setBandFull(data as unknown as BandFull); return; }
    if (message) { setError(message); return; }
    notify.done(`Invitation sent to ${email}. It is valid for 7 days.`);
    reset();
    onOpenChange(false);
    onInvited();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) reset(); onOpenChange(next); }}>
      <DialogContent>
        {bandFull ? (
          <>
            <DialogHeader>
              <DialogTitle>Your plan is full</DialogTitle>
              <DialogDescription>All {bandFull.limit} seats in your band are in use.</DialogDescription>
            </DialogHeader>
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
              <dt className="text-[var(--muted)]">Needed</dt><dd className="text-right font-medium">{bandFull.neededLabel} · {dollars(bandFull.neededPriceCents)}/month</dd>
              <dt className="text-[var(--muted)]">Seats in use</dt><dd className="text-right tabular-nums">{bandFull.usage} of {bandFull.limit}</dd>
            </dl>
            <p className="text-sm text-[var(--muted)]">Invited and offboarded producers do not use a seat. Active and suspended producers do. An upgrade is charged pro rata for the rest of this month.</p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setBandFull(null)}>Back</Button>
              {isAccountOwner ? <Button asChild><Link href="/app/settings#billing">Upgrade to {bandFull.neededLabel}</Link></Button> : <Button disabled title="Only the account owner changes the plan">Ask the owner to upgrade</Button>}
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={submit} className="contents">
            <DialogHeader>
              <DialogTitle>Invite producer</DialogTitle>
              <DialogDescription>They get a single-use link that expires in 7 days.</DialogDescription>
            </DialogHeader>
            <div className="grid gap-3">
              <label className="grid gap-1 text-sm font-medium">Name<input className={toolbarControl} value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} autoComplete="off" /></label>
              <label className="grid gap-1 text-sm font-medium">Email<input className={toolbarControl} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={254} autoComplete="off" /></label>
              <label className="grid gap-1 text-sm font-medium">Role
                <select className={toolbarControl} value={role} onChange={(e) => setRole(e.target.value)}>
                  {ROLES.filter((r) => !r.ownerOnly || isAccountOwner).map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </label>
              {error && <p role="alert" className="rounded-md border-l-[3px] border-l-[var(--error)] bg-[var(--error-surface)] p-2 text-sm text-[var(--error-ink)]">{error}</p>}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={busy || !name.trim() || !email.trim()}>{busy ? "Sending…" : "Send invite"}</Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
