"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { PartnerRole } from "@/lib/partnerAuth/roles";

type PartnerUser = { id: string; name: string; email: string; role: PartnerRole; status: "active" | "revoked"; accepted_at: string | null; has_password: boolean };
type ApprovedProduct = { code: string; name: string; category: string };

export function PartnerPortalWorkspace({ role }: { role: PartnerRole }) {
  const [users, setUsers] = useState<PartnerUser[]>([]);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<PartnerRole>("partner_user");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [inviteFieldError, setInviteFieldError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [approvedProducts, setApprovedProducts] = useState<ApprovedProduct[]>([]);

  async function loadUsers() {
    const response = await fetch("/api/partner/users");
    const body = await response.json().catch(() => null);
    if (response.ok) setUsers(body?.users ?? []); else setError(body?.error ?? "Could not load users");
    setLoading(false);
  }
  useEffect(() => {
    let cancelled = false;
    Promise.all([fetch("/api/partner/users"), fetch("/api/partner/products", { cache: "no-store" })])
      .then(async ([userResponse, productResponse]) => ({ userResponse, userBody: await userResponse.json().catch(() => null), productResponse, productBody: await productResponse.json().catch(() => null) }))
      .then(({ userResponse, userBody, productResponse, productBody }) => {
        if (cancelled) return;
        if (userResponse.ok) setUsers(userBody?.users ?? []); else setError(userBody?.error ?? "Could not load users");
        if (productResponse.ok) setApprovedProducts(productBody?.products ?? []); else setError(productBody?.error ?? "Could not load approved products");
        setLoading(false);
      })
      .catch(() => { if (!cancelled) { setError("Could not load users"); setLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  async function invite(event: FormEvent) {
    event.preventDefault(); setError(null); setMessage(null); setInviteFieldError(null);
    if (!name.trim()) { setInviteFieldError("Enter the user's name"); return; }
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setInviteFieldError("Enter a valid email address"); return; }
    const response = await fetch("/api/partner/users", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, email, role: inviteRole }) });
    const body = await response.json().catch(() => null);
    if (!response.ok) { setError(body?.error ?? "Could not send invitation"); return; }
    setName(""); setEmail(""); setMessage(body?.invite?.delivered ? "Invitation sent." : "Invitation created. Copy the link from the administrator if email is not configured."); await loadUsers();
  }

  async function changeStatus(user: PartnerUser) {
    setError(null); setMessage(null);
    const action = user.status === "active" ? "deactivate" : "reactivate";
    const response = await fetch(`/api/partner/users/${user.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
    const body = await response.json().catch(() => null);
    if (!response.ok) { setError(body?.error ?? "Could not change user status"); return; }
    setMessage(user.status === "active" ? "User deactivated." : "User reactivated."); await loadUsers();
  }

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      <div><p className="text-sm font-semibold uppercase tracking-wide text-[var(--color-blue)]">Partner workspace</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">Lead partnership</h1><p className="mt-1 text-sm text-muted-foreground">Submit and manage partner activity from this portal.</p></div>
      {(message || error) && <div role="status" className={`rounded-lg border p-3 text-sm ${error ? "border-[var(--color-danger)]/40 text-[var(--color-danger)]" : "border-[var(--color-success)]/40 text-[var(--color-success)]"}`}>{error ?? message}</div>}
      <Card><CardHeader><CardTitle>Lead submissions</CardTitle><CardDescription>The lead submission workspace will appear here. Your partner access is isolated from Insurvas configuration and commission data.</CardDescription></CardHeader><CardContent><div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Submission tools are being connected to this partner portal.</div></CardContent></Card>
      <Card><CardHeader><CardTitle>Approved products</CardTitle><CardDescription>Your product picker will only offer products currently enabled by the agent and approved for this partner.</CardDescription></CardHeader><CardContent>{approvedProducts.length > 0 ? <label className="block max-w-md space-y-1.5"><Label htmlFor="partner-product-picker">Product</Label><select id="partner-product-picker" className="flex h-9 w-full rounded-md border bg-transparent px-3 text-sm" defaultValue=""><option value="" disabled>Choose a product when submitting a lead…</option>{approvedProducts.map((product) => <option key={product.code} value={product.code}>{product.name}</option>)}</select></label> : <p className="text-sm text-muted-foreground">No products are approved for this partner yet.</p>}</CardContent></Card>
      <Card>
        <CardHeader><CardTitle>Partner users</CardTitle><CardDescription>{role === "partner_admin" ? "Invite and deactivate people in your partner account." : "People with access to this partner account."}</CardDescription></CardHeader>
        <CardContent className="space-y-6">
          {role === "partner_admin" && <form className="grid gap-3 rounded-lg border bg-muted/20 p-4 sm:grid-cols-[1fr_1fr_180px_auto] sm:items-end" onSubmit={invite}><div className="space-y-1.5"><Label htmlFor="invite-name">Name</Label><Input id="invite-name" maxLength={120} aria-invalid={Boolean(inviteFieldError && !name.trim())} value={name} onChange={(event) => { setName(event.target.value); setInviteFieldError(null); }} />{inviteFieldError && !name.trim() && <p className="text-sm text-[var(--color-danger)]">{inviteFieldError}</p>}</div><div className="space-y-1.5"><Label htmlFor="invite-email">Email</Label><Input id="invite-email" type="text" inputMode="email" maxLength={254} aria-invalid={Boolean(inviteFieldError && !/^\S+@\S+\.\S+$/.test(email.trim()))} value={email} onChange={(event) => { setEmail(event.target.value); setInviteFieldError(null); }} />{inviteFieldError && !/^\S+@\S+\.\S+$/.test(email.trim()) && <p className="text-sm text-[var(--color-danger)]">{inviteFieldError}</p>}</div><div className="space-y-1.5"><Label htmlFor="invite-role">Role</Label><select id="invite-role" className="flex h-9 w-full rounded-md border bg-transparent px-3 text-sm" value={inviteRole} onChange={(event) => setInviteRole(event.target.value as PartnerRole)}><option value="partner_user">Partner user</option><option value="partner_admin">Partner admin</option></select></div><Button type="submit">Send invite</Button></form>}
          {loading ? <p className="text-sm text-muted-foreground">Loading users…</p> : users.length === 0 ? <p className="text-sm text-muted-foreground">No users yet.</p> : <div className="divide-y rounded-lg border">{users.map((user) => <div key={user.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-medium">{user.name}</p><p className="text-sm text-muted-foreground">{user.email} · {user.role === "partner_admin" ? "Partner admin" : "Partner user"}</p></div><div className="flex items-center gap-3"><span className={`text-xs font-semibold ${user.status === "active" ? "text-[var(--color-success)]" : "text-muted-foreground"}`}>{user.status === "active" ? "Active" : "Deactivated"}</span>{role === "partner_admin" && <Button variant="outline" size="sm" onClick={() => void changeStatus(user)}>{user.status === "active" ? "Deactivate" : "Reactivate"}</Button>}</div></div>)}</div>}
        </CardContent>
      </Card>
    </div>
  );
}
