"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Send, ShieldCheck, UserCheck, UserMinus, UserPlus } from "lucide-react";
import { notify } from "@/lib/notify";

import { PartnerInviteResultPanel, type PartnerInviteResult } from "@/components/app/partner-invite-result";
import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, ToolbarSearch } from "@/components/ui/data-toolbar";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { SelectMenu } from "@/components/ui/select-menu";
import { PageLoading } from "@/components/ui/page-loading";
import { Pager, paginate } from "@/components/ui/pager";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { activityLabel, dayMonth, dayMonthTime } from "@/lib/format/ago";
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

type Filter = "all" | "active" | "invited" | "deactivated";
const CRUMBS = [{ label: "Organization" }, { label: "Team Access" }];

type FieldError = { field: "name" | "email"; message: string } | null;

export function PartnerTeamWorkspace({ role }: { role: PartnerRole; partnerStatus: "draft" | "active" | "paused" | "offboarded"; partnerName?: string }) {
  const [users, setUsers] = useState<PartnerUser[]>([]);
  const [loading, setLoading] = useState(role === "partner_admin");
  // The first read draws the page skeleton; a reload after an invite keeps the page and its form.
  const [loaded, setLoaded] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = useFittingPageSize(420, 45);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [fieldError, setFieldError] = useState<FieldError>(null);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<PartnerInviteResult | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [seatLimit, setSeatLimit] = useState<number | null>(null);
  // Agency-wide (every partner's members), the count the invite path enforces.
  const [agencySeatsUsed, setAgencySeatsUsed] = useState<number | null>(null);
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
      setAgencySeatsUsed(typeof body?.seatsUsed === "number" ? body.seatsUsed : null);
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
      <div className="m-stagger flex min-h-[calc(100dvh_-_7rem)] w-full min-w-0 flex-col gap-6">
        <PageHeader title="Team access" description="See who has access to your partner workspace." hideTitle breadcrumbs={CRUMBS} />
        <p role="status" className="flex items-center gap-2 rounded-md border border-border bg-[var(--surface-alt)] px-4 py-2.5 text-sm text-[var(--body)]"><ShieldCheck className="size-4 shrink-0" aria-hidden="true" />Team access is managed by your partner admin.</p>
      </div>
    );
  }

  if (!loaded) return <PageLoading />;

  const memberState = (user: PartnerUser): Exclude<Filter, "all"> => (user.status !== "active" ? "deactivated" : user.accepted_at ? "active" : "invited");
  const active = users.filter((user) => memberState(user) === "active").length;
  const pending = users.filter((user) => memberState(user) === "invited").length;
  const deactivated = users.filter((user) => memberState(user) === "deactivated").length;
  // A seat is any member who can sign in or is about to: the invite and reactivate paths count
  // pending invitations too.
  const seatsUsed = active + pending;
  const needle = search.trim().toLowerCase();
  const shown = users.filter((user) => (filter === "all" || memberState(user) === filter) && (!needle || `${user.name} ${user.email}`.toLowerCase().includes(needle)));
  const visible = paginate(shown, page, pageSize);
  const seatText = seatLimit ? `${agencySeatsUsed ?? seatsUsed} of ${seatLimit} seats` : null;

  function lastActivity(user: PartnerUser) {
    if (user.status !== "active") return user.deactivated_at ? dayMonth(new Date(user.deactivated_at), new Date(now)) : "—";
    if (!user.accepted_at) {
      if (!user.invite_expires_at) return "Invitation sent";
      const at = Date.parse(user.invite_expires_at);
      return `${at <= now ? "Expired" : "Expires"} ${dayMonthTime(new Date(at), new Date(now))}`;
    }
    return user.last_login_at ? activityLabel(Date.parse(user.last_login_at), now) : "Not signed in yet";
  }

  const iconAction = "text-muted-foreground hover:text-foreground";
  const clearFilters = () => { setSearch(""); setFilter("all"); setPage(1); };

  return (
    <div className="m-stagger flex min-h-[calc(100dvh_-_7rem)] w-full min-w-0 flex-col gap-6">
      <PageHeader
        title="Team access"
        description="See who has access to your partner workspace. Partner users can submit leads, track your organization's pipeline, and message the agent."
        hideTitle
        breadcrumbs={CRUMBS}
        actions={<Button type="button" variant="secondary" size="sm" onClick={() => setInviteOpen(true)} aria-haspopup="dialog"><UserPlus aria-hidden="true" />Invite teammate</Button>}
      />
      {error && <p role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--error)] bg-[var(--error-surface)] px-4 py-2 text-sm text-[var(--error-ink)]">Team access could not be refreshed: {error}<Button type="button" variant="outline" size="sm" onClick={() => void load()}>Try again</Button></p>}
      {invite && <PartnerInviteResultPanel result={invite} />}

      <TableCard
        className="flex min-h-[24rem] min-w-0 flex-1 flex-col"
        bodyClassName="flex min-h-0 flex-1 flex-col"
        toolbar={
          <DataToolbar actions={<>
            {seatText && <span className="text-sm tabular-nums text-muted-foreground">{seatText}</span>}
            {(pending > 0 || deactivated > 0) && (
              <SelectMenu
                label="Show members"
                value={filter}
                onChange={(next) => { setFilter(next as Filter); setPage(1); }}
                className="w-44"
                panelClassName="w-52"
                panelAlign="end"
                defaultValue="all"
                options={[
                  { value: "all", label: `All (${users.length})` },
                  { value: "active", label: `Active (${active})` },
                  ...(pending > 0 ? [{ value: "invited", label: `Invited (${pending})` }] : []),
                  ...(deactivated > 0 ? [{ value: "deactivated", label: `Deactivated (${deactivated})` }] : []),
                ]}
              />
            )}
            <RefreshButton onClick={() => void load()} refreshing={loading} labelClassName="sr-only" className="px-2.5" /></>}>
            <ToolbarSearch value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="Search members" label="Search members by name or email" />
          </DataToolbar>
        }
        footer={shown.length > pageSize ? <Pager page={visible.current} total={shown.length} noun="members" pageSize={pageSize} onPage={setPage} /> : undefined}
      >
        <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last activity</TableHead>
                <TableHead className="text-right"><span className="sr-only">Actions</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.length === 0 ? <TableRow><TableCell colSpan={4} className="h-64 text-center align-middle"><p className="m-0 font-semibold text-foreground">No team members yet</p></TableCell></TableRow> : shown.length === 0 ? <TableRow><TableCell colSpan={4} className="h-64 text-center align-middle"><div className="mx-auto max-w-md"><p className="m-0 font-semibold text-foreground">No members match</p><Button type="button" variant="link" className="mt-1" onClick={clearFilters}>Clear filters</Button></div></TableCell></TableRow> : visible.rows.map((user) => {
                const state = memberState(user);
                const pendingInvite = state === "invited";
                return <TableRow key={user.id}>
                  <TableCell className="max-w-[320px]">
                    <strong className="flex items-center gap-2 truncate font-semibold text-foreground">{user.name}{user.role === "partner_admin" && <StatusChip tone="action">Admin</StatusChip>}</strong>
                    <span className="block truncate text-xs text-muted-foreground" title={user.email}>{user.email}</span>
                  </TableCell>
                  <TableCell><StatusChip tone={state === "active" ? "good" : state === "invited" ? "warning" : "danger"}>{state === "active" ? "Active" : state === "invited" ? "Invited" : "Deactivated"}</StatusChip></TableCell>
                  <TableCell className="tabular-nums">{lastActivity(user)}</TableCell>
                  <TableCell className="text-right">
                    <span className="inline-flex justify-end gap-1">
                      {pendingInvite && <Button type="button" variant="ghost" size="icon" className={iconAction} disabled={busy !== null} onClick={() => void resend(user)} title="Resend the invitation" aria-label={`Resend the invitation to ${user.name}`}><Send aria-hidden="true" /></Button>}
                      <Button type="button" variant="ghost" size="icon" className={iconAction} disabled={busy !== null} onClick={() => void changeStatus(user)} title={state === "deactivated" ? "Reactivate" : pendingInvite ? "Withdraw the invitation" : "Deactivate"} aria-label={state === "deactivated" ? `Reactivate ${user.name}` : pendingInvite ? `Withdraw the invitation for ${user.name}` : `Deactivate ${user.name}`}>{state === "deactivated" ? <UserCheck aria-hidden="true" /> : <UserMinus aria-hidden="true" />}</Button>
                    </span>
                  </TableCell>
                </TableRow>;
              })}
            </TableBody>
        </Table>
      </TableCard>

      <Dialog open={inviteOpen} onOpenChange={(open) => { setInviteOpen(open); if (!open) setFieldError(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Invite a teammate</DialogTitle></DialogHeader>
          <form className="space-y-4" onSubmit={(event) => void submit(event)} noValidate>
            <Field label="Full name" htmlFor="partner-team-name" error={fieldError?.field === "name" ? fieldError.message : undefined}>
              <Input id="partner-team-name" className="mt-1.5" autoComplete="name" maxLength={120} value={name} aria-invalid={fieldError?.field === "name"} onChange={(event) => { setName(event.target.value); if (fieldError?.field === "name") setFieldError(null); }} />
            </Field>
            <Field label="Work email" htmlFor="partner-team-email" error={fieldError?.field === "email" ? fieldError.message : undefined}>
              <Input id="partner-team-email" className="mt-1.5" type="email" autoComplete="email" maxLength={254} value={email} aria-invalid={fieldError?.field === "email"} onChange={(event) => { setEmail(event.target.value); if (fieldError?.field === "email") setFieldError(null); }} />
            </Field>
            <Field label="Role" info="Partner users can submit leads, track your organization's pipeline, and message the agent. A partner admin is added by your agent.">
              {/* The one option a partner admin cannot pick is shown disabled with the reason rather than hidden. */}
              <SelectMenu
                label="Role"
                value="partner_user"
                onChange={() => undefined}
                className="mt-1.5 w-full"
                panelClassName="w-72 max-w-[calc(100vw-2rem)]"
                panelAlign="start"
                searchPlaceholder="Search roles"
                options={[
                  { value: "partner_user", label: "Partner user" },
                  { value: "partner_admin", label: "Partner admin", description: "Added by your agent", disabled: true },
                ]}
              />
            </Field>
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
