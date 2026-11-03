"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { notify } from "@/lib/notify";

import { Button } from "@/components/ui/button";
import { TableCard } from "@/components/ui/table-card";
import { toolbarControl } from "@/components/ui/data-toolbar";
import { dollars } from "@/lib/agency/constants";
import { sendJson } from "./use-agency-data";

/** A form field: the toolbar control, filling its grid cell so a narrow column never scrolls sideways. */
const field = `${toolbarControl} w-full min-w-0`;

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
 * AG-0.6 · invite into the agency, Home › Agency › Producers › Invite producer — a page of its own (foundation pass
 * 2026-11-03; it was a pop-up, and pop-ups are only for confirming). One flow (LA-8.6's POST /api/app/team). The
 * producer row exists from the moment of the invite; the link is valid 7 days. A full band answers with the band it
 * needs and its price, shown in place of the form, and the account owner upgrades in one click.
 */
export function InviteProducerForm({ isAccountOwner }: { isAccountOwner: boolean }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("producer");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bandFull, setBandFull] = useState<BandFull | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const { error: message, data } = await sendJson("/api/app/team", "POST", { name, email, role });
    setBusy(false);
    if (data?.code === "band_full") { setBandFull(data as unknown as BandFull); return; }
    if (message) { setError(message); return; }
    notify.done(`Invitation sent to ${email}. It is valid for 7 days.`);
    router.push("/app/producers?status=invited");
  }

  if (bandFull) {
    return (
      <TableCard title="Your plan is full" description={`All ${bandFull.limit} seats in your band are in use.`}
        footer={<div className="flex w-full justify-end gap-2"><Button variant="outline" onClick={() => setBandFull(null)}>Back</Button>{isAccountOwner ? <Button asChild><Link href="/app/settings#billing">Upgrade to {bandFull.neededLabel}</Link></Button> : <Button disabled title="Only the account owner changes the plan">Ask the owner to upgrade</Button>}</div>}>
        <dl className="grid max-w-xl grid-cols-[auto_1fr] gap-x-6 gap-y-2 p-4 text-sm">
          <dt className="text-[var(--muted)]">Needed</dt><dd className="font-medium">{bandFull.neededLabel} · {dollars(bandFull.neededPriceCents)}/month</dd>
          <dt className="text-[var(--muted)]">Seats in use</dt><dd className="tabular-nums">{bandFull.usage} of {bandFull.limit}</dd>
          <dt className="text-[var(--muted)]">Who uses one</dt><dd>Active and suspended members. Invited and offboarded do not.</dd>
          <dt className="text-[var(--muted)]">Charged</dt><dd>Pro rata for the rest of this month.</dd>
        </dl>
      </TableCard>
    );
  }

  return (
    <form onSubmit={submit} className="contents">
      <TableCard title="Who to invite" description="They get a single-use link that expires in 7 days. Their row appears in the roster at once, as invited."
        footer={<div className="flex w-full justify-end gap-2"><Button asChild variant="outline"><Link href="/app/producers">Cancel</Link></Button><Button type="submit" disabled={busy || !name.trim() || !email.trim()}>{busy ? "Sending…" : "Send invite"}</Button></div>}>
        <div className="grid max-w-3xl gap-4 p-4 md:grid-cols-2">
          <label className="grid gap-1 text-sm font-medium">Name<input className={field} value={name} onChange={(e) => setName(e.target.value)} required maxLength={120} autoComplete="off" /></label>
          <label className="grid gap-1 text-sm font-medium">Email<input className={field} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={254} autoComplete="off" /></label>
          <label className="grid gap-1 text-sm font-medium md:col-span-2">Role
            <select className={`${field} max-w-md`} value={role} onChange={(e) => setRole(e.target.value)}>
              {ROLES.filter((r) => !r.ownerOnly || isAccountOwner).map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </label>
          {error && <p role="alert" className="text-sm text-[var(--error-ink)] md:col-span-2">{error}</p>}
        </div>
      </TableCard>
    </form>
  );
}
