"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TENANT_ROLE_LABELS, TENANT_ROLES, type TenantRole } from "@/lib/tenantAuth/roles";
import type { TeamSnapshot } from "@/lib/tenantTeam/service";

export function TeamSettings({ initial }: { initial: TeamSnapshot }) {
  const [snapshot, setSnapshot] = useState(initial);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TenantRole>("assistant");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function refresh() {
    const response = await fetch("/api/app/team", { cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (response.ok) setSnapshot(body);
  }

  async function invite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError("");
    const response = await fetch("/api/app/team", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, email, role }) });
    const body = await response.json().catch(() => null);
    setBusy(false);
    if (!response.ok) { setError(body?.error ?? "Could not invite this teammate"); return; }
    setName(""); setEmail(""); setRole("assistant");
    toast.success(body.invite?.delivered ? "Invitation sent" : "Teammate invited — copy the link from the server log if email is not configured");
    await refresh();
  }

  async function changeRole(userId: string, nextRole: TenantRole) {
    setError("");
    const response = await fetch(`/api/app/team/${userId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: nextRole }) });
    const body = await response.json().catch(() => null);
    if (!response.ok) { setError(body?.error ?? "Could not change this teammate's role"); await refresh(); return; }
    toast.success("Role updated");
    await refresh();
  }

  const seatLabel = snapshot.seats.max === null ? `${snapshot.seats.used} used · unlimited seats` : `${snapshot.seats.used} used · ${snapshot.seats.max} included`;
  const bufferAtLimit = snapshot.bufferSeats.max !== null && snapshot.bufferSeats.used >= snapshot.bufferSeats.max;
  return <Card data-testid="team-settings"><CardHeader><CardTitle className="text-base">Team access</CardTitle><p className="text-sm text-muted-foreground">Invite teammates and control what each person can see. Role changes apply on their next request.</p></CardHeader><CardContent className="space-y-6">
    <div className="rounded-md border bg-muted/30 p-3 text-sm"><p className="font-semibold">Seats</p><p className="text-muted-foreground">{seatLabel}</p><p className="mt-2 text-muted-foreground">Buffer seats: {snapshot.bufferSeats.max === null ? `${snapshot.bufferSeats.used} used · unlimited` : `${snapshot.bufferSeats.used} of ${snapshot.bufferSeats.max}`}</p><div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">{TENANT_ROLES.map((item) => <span key={item}>{TENANT_ROLE_LABELS[item]}: {snapshot.seats.byRole[item]}</span>)}</div></div>
    <form className="grid gap-3 rounded-md border p-4 md:grid-cols-[1fr_1fr_180px_auto] md:items-end" onSubmit={(event) => void invite(event)}><div className="space-y-2"><Label htmlFor="team-name">Name</Label><Input id="team-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required /></div><div className="space-y-2"><Label htmlFor="team-email">Email</Label><Input id="team-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} maxLength={254} required /></div><div className="space-y-2"><Label htmlFor="team-role">Role</Label><select id="team-role" className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm" value={role} onChange={(event) => setRole(event.target.value as TenantRole)}>{TENANT_ROLES.map((item) => <option key={item} value={item}>{TENANT_ROLE_LABELS[item]}</option>)}</select></div><Button type="submit" disabled={busy || (role === "assistant" && bufferAtLimit)}>{busy ? "Inviting…" : "Invite teammate"}</Button>{role === "assistant" && bufferAtLimit && <p className="text-sm text-destructive md:col-span-4" role="alert">Your plan has reached <code>max_buffer_seats</code> ({snapshot.bufferSeats.used} of {snapshot.bufferSeats.max}). Upgrade to invite another buffer agent.</p>}</form>
    {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-sm"><thead><tr className="border-b text-left"><th className="px-2 py-2 font-medium">Person</th><th className="px-2 py-2 font-medium">Status</th><th className="px-2 py-2 font-medium">Role</th><th className="px-2 py-2 font-medium">Access</th></tr></thead><tbody>{snapshot.members.map((member) => <tr key={member.id} className="border-b last:border-0"><td className="px-2 py-3"><p className="font-medium">{member.name}</p><p className="text-xs text-muted-foreground">{member.email}</p></td><td className="px-2 py-3 text-muted-foreground">{member.acceptedAt ? member.status === "active" ? "Active" : member.status : "Invited"}</td><td className="px-2 py-3"><select aria-label={`Role for ${member.name}`} className="border-input bg-background h-8 rounded-md border px-2 text-sm" value={member.role} onChange={(event) => void changeRole(member.id, event.target.value as TenantRole)}>{TENANT_ROLES.map((item) => <option key={item} value={item}>{TENANT_ROLE_LABELS[item]}</option>)}</select></td><td className="px-2 py-3 text-xs text-muted-foreground">{member.role === "assistant" ? "Leads and calendar; no money" : member.role === "bookkeeper" ? "Money and exports; no dialing" : member.role === "producer" ? "Sales and own commissions" : "Full account access"}</td></tr>)}</tbody></table></div>
  </CardContent></Card>;
}
