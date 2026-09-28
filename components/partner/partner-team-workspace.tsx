"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ShieldCheck, UserPlus } from "lucide-react";
import { notify } from "@/lib/notify";

import { PartnerInviteResultPanel, type PartnerInviteResult } from "@/components/app/partner-invite-result";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { PageLoading } from "@/components/ui/page-loading";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import { activityLabel, dayMonth, dayMonthTime, expiresInLabel } from "@/lib/format/ago";
import type { PartnerRole } from "@/lib/partnerAuth/roles";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 25;

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

export function PartnerTeamWorkspace({ role }: { role: PartnerRole; partnerStatus: "draft" | "active" | "paused" | "offboarded"; partnerName?: string }) {
  const [users, setUsers] = useState<PartnerUser[]>([]);
  const [loading, setLoading] = useState(role === "partner_admin");
  // The first read draws the page skeleton; a reload after an invite keeps the page and its form.
  const [loaded, setLoaded] = useState(false);
  const [page, setPage] = useState(1);
  const [inviteOpen, setInviteOpen] = useState(false);
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
      setLoaded(true);
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
      // The result (and its copyable link) shows on the page, where a resend's result shows too.
      setInviteOpen(false);
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
      <div className="m-stagger space-y-6">
        <PageHeader title="Team access" />
        <p role="status" className="flex items-center gap-2 rounded-md border border-border bg-[var(--surface-alt)] px-4 py-2.5 text-sm text-[var(--body)]"><ShieldCheck className="size-4 shrink-0" aria-hidden="true" />Team access is managed by your partner admin.</p>
      </div>
    );
  }

  if (!loaded) return <PageLoading />;

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
  const visible = paginate(shown, page, PAGE_SIZE);

  function lastActivity(user: PartnerUser) {
    if (user.status !== "active") return user.deactivated_at ? dayMonth(new Date(user.deactivated_at), new Date(now)) : "—";
    if (!user.accepted_at) {
      if (!user.invite_expires_at) return "Invitation sent";
      const at = Date.parse(user.invite_expires_at);
      return `${at <= now ? "Expired" : "Expires"} ${dayMonthTime(new Date(at), new Date(now))}`;
    }
    return user.last_login_at ? activityLabel(Date.parse(user.last_login_at), now) : "Not signed in yet";
  }

  const labelText = "text-sm font-semibold text-[var(--body)]";

  return (
    <div className="m-stagger space-y-6">
      <PageHeader title="Team access" actions={<Button type="button" onClick={() => setInviteOpen(true)}><UserPlus aria-hidden="true" />Invite teammate</Button>} />
      {error &&<p role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--error)] bg-[var(--error-surface)] px-4 py-2 text-sm text-[var(--error-ink)]">Team access could not be refreshed: {error}<Button type="button" variant="outline" onClick={() => void load()}>Try again</Button></p>}

      <StatStrip label="Team totals">
        <StatTile label="Active members" value={active} valueTone="good" footnote={seatLimit ? `${seatsUsed} of ${seatLimit} seats used` : "no seat limit"} />
        <StatTile label="Pending invitations" value={pending} valueTone={pending ? "warning" : undefined} footnote={soonestExpiry ? expiresInLabel(soonestExpiry, now) : "none waiting"} />
        <StatTile label="Deactivated" value={deactivated} valueTone={deactivated ? "danger" : undefined} footnote="history retained" />
      </StatStrip>
      {invite && <PartnerInviteResultPanel result={invite} />}

      <TableCard
        toolbar={
          <DataToolbar actions={<RefreshButton onClick={() => void load()} refreshing={loading} />}>
            <ToolbarSearch value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Search members" label="Search members by name or email" />
          </DataToolbar>
        }
        footer={users.length ? <Pager page={visible.current} total={shown.length} noun="members" pageSize={PAGE_SIZE} onPage={setPage} /> : undefined}
      >
        {users.length === 0 ? <EmptyState title="No team members yet" hint="Invite the first teammate to start working leads together." action={<Button type="button" variant="outline" onClick={() => setInviteOpen(true)}>Invite teammate</Button>} />
          : shown.length === 0 ? <NoMatches noun="members" onClear={() => setSearch("")} />
          : <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last activity</TableHead>
                <TableHead className="text-right"><span className="sr-only">Actions</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.rows.map((user) => {
                const pendingInvite = user.status === "active" && !user.accepted_at;
                const status = user.status !== "active" ? "deactivated" : pendingInvite ? "invited" : "active";
                return <TableRow key={user.id}>
                  <TableCell className="max-w-[320px]">
                    <strong className="block truncate font-semibold text-foreground">{user.name}</strong>
                    <span className="block truncate text-xs text-muted-foreground" title={user.email}>{user.email}</span>
                  </TableCell>
                  <TableCell><StatusChip tone={user.role === "partner_admin" ? "action" : "neutral"}>{user.role === "partner_admin" ? "Partner admin" : "Partner user"}</StatusChip></TableCell>
                  <TableCell><StatusChip tone={status === "active" ? "good" : status === "invited" ? "warning" : "danger"}>{status === "active" ? "Active" : status === "invited" ? "Invited" : "Deactivated"}</StatusChip></TableCell>
                  <TableCell className="tabular-nums">{lastActivity(user)}</TableCell>
                  <TableCell className="text-right">
                    <span className="inline-flex justify-end gap-2">
                      {pendingInvite && <Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={() => void resend(user)}>{busy === user.id ? "Sending…" : "Resend"}</Button>}
                      <Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={() => void changeStatus(user)} aria-label={pendingInvite ? `Withdraw the invitation for ${user.name}` : undefined}>{user.status !== "active" ? "Reactivate" : pendingInvite ? "Withdraw" : "Deactivate"}</Button>
                    </span>
                  </TableCell>
                </TableRow>;
              })}
            </TableBody>
          </Table>}
      </TableCard>

      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Invite a teammate</DialogTitle></DialogHeader>
          <form className="space-y-4" onSubmit={(event) => void submit(event)} noValidate>
            <label className="block">
              <span className={labelText}>Full name</span>
              <Input id="partner-team-name" className="mt-1.5" autoComplete="name" maxLength={120} value={name} aria-invalid={fieldError?.field === "name"} onChange={(event) => { setName(event.target.value); if (fieldError?.field === "name") setFieldError(null); }} />
              {fieldError?.field === "name" && <small className="mt-1.5 block text-xs text-[var(--error-ink)]" role="alert">{fieldError.message}</small>}
            </label>
            <label className="block">
              <span className={labelText}>Work email</span>
              <Input id="partner-team-email" className="mt-1.5" type="email" autoComplete="email" maxLength={254} value={email} aria-invalid={fieldError?.field === "email"} onChange={(event) => { setEmail(event.target.value); if (fieldError?.field === "email") setFieldError(null); }} />
              {fieldError?.field === "email" && <small className="mt-1.5 block text-xs text-[var(--error-ink)]" role="alert">{fieldError.message}</small>}
            </label>
            <label className="block">
              <span className={labelText}>Role</span>
              <select value="partner_user" onChange={() => undefined} className={cn(toolbarControl, "mt-1.5 w-full")}>
                <option value="partner_user">Partner user</option>
                {/* A partner admin can grant only what they cannot use to widen their own access. */}
                <option value="partner_admin" disabled>Partner admin — added by your agent</option>
              </select>
              <small className="mt-1.5 block text-xs text-muted-foreground">Partner users can submit leads, track your organization&rsquo;s pipeline, and message the agent.</small>
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setInviteOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={busy !== null}>{busy === "invite" ? "Sending…" : "Send invitation"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
