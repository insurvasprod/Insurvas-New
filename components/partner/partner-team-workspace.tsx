"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ShieldCheck } from "lucide-react";
import { notify } from "@/lib/notify";

import { PartnerInviteResultPanel, type PartnerInviteResult } from "@/components/app/partner-invite-result";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile } from "@/components/ui/stat";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { activityLabel, dayMonth, dayMonthTime, expiresInLabel } from "@/lib/format/ago";
import type { PartnerRole } from "@/lib/partnerAuth/roles";

type PartnerUser = {
  id: string;
  user_id: string;
  name: string;
  email: string;
  role: PartnerRole;
  status: "active" | "revoked";
  invited_at: string;
  accepted_at: string | null;
  deactivated_at: string | null;
  has_password: boolean;
  last_login_at: string | null;
  invite_expires_at: string | null;
};

type FieldError = { field: "name" | "email"; message: string } | null;

export function PartnerTeamWorkspace({ role, partnerStatus, partnerName }: { role: PartnerRole; partnerStatus: "draft" | "active" | "paused" | "offboarded"; partnerName?: string }) {
  const [users, setUsers] = useState<PartnerUser[]>([]);
  const [loading, setLoading] = useState(role === "partner_admin");
  const [busy, setBusy] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [fieldError, setFieldError] = useState<FieldError>(null);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<PartnerInviteResult | null>(null);
  const [search, setSearch] = useState("");
  const [seatLimit, setSeatLimit] = useState<number | null>(null);
  // "12 min ago" and "expires in 2 days" keep moving while the page is open.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const clock = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(clock);
  }, []);

  const load = useCallback(async () => {
    if (role !== "partner_admin") return;
    setLoading(true);
    try {
      const response = await fetch("/api/partner/users", { cache: "no-store", signal: AbortSignal.timeout(10000) });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(body?.error ?? "Could not load team members");
        notify.block(body?.error ?? "Could not load team members");
        return;
      }
      setUsers((body?.users ?? []) as PartnerUser[]);
      setSeatLimit(typeof body?.seatLimit === "number" ? body.seatLimit : null);
      setError(null);
    } catch {
      setError("Could not load team members. Check your connection and try again.");
      notify.fail("Could not load team members. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [role]);

  useEffect(() => {
    if (role !== "partner_admin") return;
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load, role]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFieldError(null);
    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    if (!trimmedName) {
      setFieldError({ field: "name", message: "Enter the user's name" });
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(trimmedEmail)) {
      setFieldError({ field: "email", message: "Enter a valid email address" });
      return;
    }

    setBusy("invite");
    try {
      const response = await fetch("/api/partner/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(10000),
        body: JSON.stringify({ name: trimmedName, email: trimmedEmail, role: "partner_user" }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        notify.block(body?.error ?? "Could not send invitation");
        return;
      }
      setName("");
      setEmail("");
      setInvite({ url: body.invite.url, expiresAt: body.invite.expiresAt, delivered: Boolean(body.invite.delivered), recipient: body.user.email, mode: body.invite.mode });
      notify.done(body.invite.delivered ? "Invitation sent" : "Invitation created; copy the secure link");
      await load();
    } catch {
      notify.fail("Could not send invitation. Your form is still available to try again.");
    } finally {
      setBusy(null);
    }
  }

  async function resend(user: PartnerUser) {
    setBusy(user.id);
    try {
      const response = await fetch(`/api/partner/users/${user.user_id}/resend-invite`, { method: "POST", signal: AbortSignal.timeout(10000) });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        notify.block(body?.error ?? "Could not resend invitation");
        return;
      }
      setInvite({ url: body.invite.url, expiresAt: body.invite.expiresAt, delivered: Boolean(body.invite.delivered), recipient: user.email, mode: body.invite.mode });
      notify.done(body.invite.delivered ? "Invitation resent" : "Invitation reissued; copy the secure link");
    } catch {
      notify.fail("Could not resend invitation. Try again in a moment.");
    } finally {
      setBusy(null);
    }
  }

  async function changeStatus(user: PartnerUser) {
    setBusy(user.id);
    const action = user.status === "active" ? "deactivate" : "reactivate";
    try {
      const response = await fetch(`/api/partner/users/${user.user_id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(10000),
        body: JSON.stringify({ action }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        notify.block(body?.error ?? "Could not change user status");
        return;
      }
      notify.done(action === "deactivate" ? (user.accepted_at ? "Partner user deactivated" : "Invitation withdrawn") : "Partner user reactivated");
      await load();
    } catch {
      notify.fail("Could not change user status. Try again in a moment.");
    } finally {
      setBusy(null);
    }
  }

  if (role !== "partner_admin") {
    return (
      <Card className="mx-auto w-full max-w-3xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ShieldCheck className="size-5 text-[var(--color-accent-ink)]" aria-hidden="true" />Team access is managed by your admin</CardTitle>
          <CardDescription>Partner users can submit and track leads, but cannot invite, activate, or deactivate people.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg border border-[var(--color-blue)]/25 bg-[var(--color-blue-faint)] p-4 text-sm text-muted-foreground">Ask your partner admin to update team access. Your lead and message permissions are unchanged.</div>
        </CardContent>
      </Card>
    );
  }

  const active = users.filter((user) => user.status === "active" && user.accepted_at).length;
  const pendingUsers = users.filter((user) => user.status === "active" && !user.accepted_at);
  const pending = pendingUsers.length;
  const deactivated = users.filter((user) => user.status !== "active").length;
  // A seat is any member who can sign in or is about to: the invite and reactivate paths count
  // pending invitations too, so the footnote does.
  const seatsUsed = active + pending;
  const soonestExpiry = pendingUsers
    .map((user) => (user.invite_expires_at ? Date.parse(user.invite_expires_at) : NaN))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => a - b)[0];
  const needle = search.trim().toLowerCase();
  const shown = users.filter((user) => !needle || `${user.name} ${user.email}`.toLowerCase().includes(needle));

  function lastActivity(user: PartnerUser) {
    if (user.status !== "active") return user.deactivated_at ? dayMonth(new Date(user.deactivated_at), new Date(now)) : "—";
    if (!user.accepted_at) {
      if (!user.invite_expires_at) return "Invitation sent";
      const at = Date.parse(user.invite_expires_at);
      return `${at <= now ? "Expired" : "Expires"} ${dayMonthTime(new Date(at), new Date(now))}`;
    }
    return user.last_login_at ? activityLabel(Date.parse(user.last_login_at), now) : "Not signed in yet";
  }

  return (
    <div className="m-stagger portal-partner-team-view">
      <PageHeader eyebrow="Organization" title="Team access" description="Invite and manage your own teammates. Partner admins only." />
      {partnerStatus === "paused" && <div className="portal-partner-team-callout is-warning" role="status"><strong>This partner is paused</strong><p>New lead submissions are stopped. Existing leads and team history remain available.</p></div>}
      {error && <div className="portal-partner-team-callout is-error" role="alert"><strong>Team access could not be refreshed.</strong><p>{error}</p><Button variant="outline" size="sm" onClick={() => void load()}>Try again</Button></div>}

      <div className="portal-partner-team-tiles">
        <StatTile label="Active members" value={loading ? "—" : active} valueTone={loading ? undefined : "good"} footnote={loading ? " " : seatLimit ? `${seatsUsed} of ${seatLimit} seats used` : "no seat limit"} />
        <StatTile label="Pending invitations" value={loading ? "—" : pending} valueTone={loading || !pending ? undefined : "warning"} footnote={loading ? " " : soonestExpiry ? expiresInLabel(soonestExpiry, now) : "none waiting"} />
        <StatTile label="Deactivated" value={loading ? "—" : deactivated} valueTone={loading || !deactivated ? undefined : "danger"} footnote="history retained" />
      </div>

      <div className="portal-partner-team-body">
        <section className="portal-partner-team-panel portal-partner-team-members" aria-labelledby="partner-team-members-heading">
          <div className="portal-partner-team-members-bar">
            <h2 id="partner-team-members-heading">Members &amp; invitations</h2>
            {users.length > 3 && <input type="search" aria-label="Search members by name or email" placeholder="Search members…" value={search} onChange={(event) => setSearch(event.target.value)} />}
          </div>
          {loading ? <div className="portal-partner-team-empty" role="status" aria-live="polite"><p>Loading team members…</p></div>
            : users.length === 0 ? <div className="portal-partner-team-empty"><strong>No team members yet</strong><p>Invite the first teammate to start working leads together.</p></div>
            : shown.length === 0 ? <div className="portal-partner-team-empty"><strong>No members match this search</strong><p>Try a different name or email address.</p></div>
            : <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Member</TableHead>
                  <TableHead className="w-[124px]">Role</TableHead>
                  <TableHead className="w-[124px]">Status</TableHead>
                  <TableHead className="w-[150px]">Last activity</TableHead>
                  <TableHead className="w-[118px] text-right"><span className="sr-only">Actions</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((user) => {
                  const pendingInvite = user.status === "active" && !user.accepted_at;
                  const status = user.status !== "active" ? "deactivated" : pendingInvite ? "invited" : "active";
                  return <TableRow key={user.id}>
                    <TableCell className="portal-partner-team-member">
                      <strong>{user.name}</strong>
                      <span title={user.email}>{user.email}</span>
                    </TableCell>
                    <TableCell><span className={`portal-status-chip${user.role === "partner_admin" ? " is-accent" : ""}`}>{user.role === "partner_admin" ? "Partner admin" : "Partner user"}</span></TableCell>
                    <TableCell><span className={`portal-status-chip ${status === "active" ? "is-success" : status === "invited" ? "is-warning" : "is-error"}`}><span aria-hidden="true" />{status === "active" ? "Active" : status === "invited" ? "Invited" : "Deactivated"}</span></TableCell>
                    <TableCell className="tabular-nums">{lastActivity(user)}</TableCell>
                    <TableCell className="text-right">
                      <span className="portal-partner-team-actions">
                        {pendingInvite && <Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={() => void resend(user)}>{busy === user.id ? "Sending…" : "Resend"}</Button>}
                        <Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={() => void changeStatus(user)} aria-label={pendingInvite ? `Withdraw the invitation for ${user.name}` : undefined}>{user.status !== "active" ? "Reactivate" : pendingInvite ? "Withdraw" : "Deactivate"}</Button>
                      </span>
                    </TableCell>
                  </TableRow>;
                })}
              </TableBody>
            </Table>}
        </section>

        <aside className="portal-partner-team-side">
          <section className="portal-partner-team-panel is-padded" aria-labelledby="partner-team-invite-heading">
            <h2 id="partner-team-invite-heading">Invite a teammate</h2>
            <form className="portal-partner-team-form" onSubmit={(event) => void submit(event)} noValidate>
              <label className="portal-partner-team-field">
                <span>Full name</span>
                <input id="partner-team-name" autoComplete="name" maxLength={120} value={name} aria-invalid={fieldError?.field === "name"} onChange={(event) => { setName(event.target.value); if (fieldError?.field === "name") setFieldError(null); }} />
                {fieldError?.field === "name" && <small className="is-error" role="alert">{fieldError.message}</small>}
              </label>
              <label className="portal-partner-team-field">
                <span>Work email</span>
                <input id="partner-team-email" type="email" autoComplete="email" maxLength={254} value={email} aria-invalid={fieldError?.field === "email"} onChange={(event) => { setEmail(event.target.value); if (fieldError?.field === "email") setFieldError(null); }} />
                {fieldError?.field === "email" && <small className="is-error" role="alert">{fieldError.message}</small>}
              </label>
              <label className="portal-partner-team-field">
                <span>Role</span>
                <select value="partner_user" onChange={() => undefined}>
                  <option value="partner_user">Partner user</option>
                  {/* A partner admin can grant only what they cannot use to widen their own access. */}
                  <option value="partner_admin" disabled>Partner admin — added by your agent</option>
                </select>
                <small>Partner users can submit leads, track your organization&rsquo;s pipeline, and message the agent.</small>
              </label>
              <Button type="submit" className="w-full" disabled={busy !== null}>{busy === "invite" ? "Sending…" : "Send invitation"}</Button>
            </form>
            <p className="portal-partner-team-note">Invitations expire after 72 hours. If sending fails, your form is still here to try again.</p>
            {invite && <PartnerInviteResultPanel result={invite} />}
          </section>
          <div className="portal-partner-team-callout is-info">
            <strong>Access rules</strong>
            <p>Only partner admins manage members. Access is limited to {partnerName ?? "your organization"}&rsquo;s data. <strong>Deactivation retains submission and message history</strong> &mdash; nobody is ever deleted.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
