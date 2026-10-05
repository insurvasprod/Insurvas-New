"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  ArrowLeft,
  Settings2,
  ShieldCheck,
  UserPlus,
  X,
} from "lucide-react";
import { notify } from "@/lib/notify";

import { PartnerFormStudio } from "@/components/app/partner-form-studio";
import { PartnerInviteResultPanel, type PartnerInviteResult } from "@/components/app/partner-invite-result";
import { PartnerMarketAccessPanel } from "@/components/app/partner-market-access-panel";
import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { EmptyState, ErrorState, NoMatches, SectionLoading } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import type { PartnerRole } from "@/lib/partnerAuth/roles";
import { capacityLabel } from "@/lib/partners/limits";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 25;
const TIMEOUT_MS = 10000;

type Member = {
  id: string;
  user_id: string;
  name: string;
  email: string;
  role: PartnerRole;
  status: "active" | "revoked";
  accepted_at: string | null;
  invite_expires_at?: string | null;
  partner_admin_user_id: string | null;
};

type Selected = Member & { parentName: string | null };
type TeamScope = "all" | "admins" | "users" | "unassigned";
type ConfigTab = "overview" | "lead" | "markets";
type FieldError = { field: "name" | "email"; message: string } | null;

function roleLabel(role: PartnerRole) {
  return role === "partner_admin" ? "Partner admin" : "Partner user";
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function MemberAvatar({ member }: { member: Member }) {
  return (
    <span className="portal-team-member-avatar" aria-hidden="true">
      {initials(member.name)}
    </span>
  );
}

/** Invited and not yet accepted, and not withdrawn: the only state a link can be resent for. */
function isPendingInvite(member: Member) {
  return member.status === "active" && !member.accepted_at;
}

function statusLabel(member: Member) {
  if (member.status !== "active") return "Deactivated";
  return member.accepted_at ? "Active" : "Invitation pending";
}

/**
 * The agency's view of one partner's team (LA-1.2). The agency issues a partner's first partner
 * admin from here — the partner portal's own Team page can only add partner users — and can resend,
 * withdraw, deactivate and reactivate any member. Every refusal is the route's own `body.error`.
 */
export function PartnerUsersPanel({
  partnerId,
  readOnly,
  offboarded = false,
  canAssignAdmin = false,
  seatUsage,
  seatLimit = null,
  onSeatsChanged,
}: {
  partnerId: string;
  /** Billing read-only: the write routes refuse, so no write action is drawn. */
  readOnly: boolean;
  offboarded?: boolean;
  /** Reporting-line assignment is owner-only (admin-assignment route); invite and status are owner or bookkeeper. */
  canAssignAdmin?: boolean;
  /** Account-wide partner-user seats in use and the plan's limit (null = unlimited). */
  seatUsage?: number;
  seatLimit?: number | null;
  /** Called after a change that moves the seat count, so the page can re-read its capacity. */
  onSeatsChanged?: () => void;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<TeamScope>("all");
  const [adminFilter, setAdminFilter] = useState<string>("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Selected | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // The first read draws the skeleton; a reload after an action keeps the rows on screen.
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [invite, setInvite] = useState<PartnerInviteResult | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<PartnerRole>("partner_admin");
  const [reportsTo, setReportsTo] = useState("");
  const [fieldError, setFieldError] = useState<FieldError>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [confirmFor, setConfirmFor] = useState<Member | null>(null);
  const workspaceRef = useRef<HTMLElement | null>(null);

  const canWrite = !readOnly && !offboarded;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/app/partners/${partnerId}/users`, {
        cache: "no-store",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setLoadError(body?.error ?? "Could not load the team");
        notify.block(body?.error ?? "Could not load the team");
        return;
      }
      setMembers(body.users ?? []);
      setLoadError(null);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Could not load the team";
      setLoadError(message);
      notify.fail(message);
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, [partnerId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const admins = useMemo(
    () => members.filter((member) => member.role === "partner_admin"),
    [members],
  );
  const activeAdmins = useMemo(
    () => admins.filter((admin) => admin.status === "active"),
    [admins],
  );
  const users = useMemo(
    () => members.filter((member) => member.role === "partner_user"),
    [members],
  );
  const unassigned = useMemo(
    () => users.filter((member) => !member.partner_admin_user_id),
    [users],
  );
  const parentByUserId = useMemo(
    () => new Map(admins.map((admin) => [admin.user_id, admin.name])),
    [admins],
  );
  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    const source =
      scope === "admins" ? admins : scope === "users" ? users : scope === "unassigned" ? unassigned : members;
    return source.filter((member) => {
      const matchesQuery =
        !text || `${member.name} ${member.email}`.toLowerCase().includes(text);
      const matchesAdmin =
        scope !== "users" || !adminFilter || member.partner_admin_user_id === adminFilter;
      return matchesQuery && matchesAdmin;
    });
  }, [adminFilter, admins, members, query, scope, unassigned, users]);
  const visible = paginate(filtered, page, PAGE_SIZE);

  useEffect(() => {
    if (!selected) return;
    const frame = window.requestAnimationFrame(() => {
      const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      workspaceRef.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selected]);

  function changeScope(value: TeamScope) {
    setScope(value);
    setPage(1);
    if (value !== "users") setAdminFilter("");
  }

  function viewUsersOf(admin: Member) {
    setScope("users");
    setAdminFilter(admin.user_id);
    setPage(1);
  }

  function openInvite() {
    setName("");
    setEmail("");
    // A partner with no admin yet needs one first: that is who runs the partner portal's own team page.
    setRole(admins.length ? "partner_user" : "partner_admin");
    setReportsTo("");
    setFieldError(null);
    setInviteError(null);
    setInviteOpen(true);
  }

  async function assign(member: Member, adminId: string) {
    setBusy(member.user_id);
    try {
      const response = await fetch(
        `/api/app/partners/${partnerId}/users/${member.user_id}/admin-assignment`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          signal: AbortSignal.timeout(TIMEOUT_MS),
          body: JSON.stringify({ partner_admin_user_id: adminId }),
        },
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        notify.block(body?.error ?? "Could not assign the partner admin");
        return;
      }
      notify.arrive("Partner user assigned");
      await load();
    } catch (reason) {
      notify.fail(reason instanceof Error ? reason.message : "Could not assign the partner admin");
    } finally {
      setBusy(null);
    }
  }

  async function submitInvite(event: FormEvent) {
    event.preventDefault();
    setFieldError(null);
    setInviteError(null);
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
      const response = await fetch(`/api/app/partners/${partnerId}/users`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        body: JSON.stringify({ name: trimmedName, email: trimmedEmail, role }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        // Seat limit (the plan-limit sentence), an agency account's email, a duplicate email, a
        // partner that is gone: the route words each one, and the form stays filled to fix it.
        setInviteError(body?.error ?? "Could not send invitation");
        return;
      }
      setInvite({
        url: body.invite.url,
        expiresAt: body.invite.expiresAt,
        delivered: Boolean(body.invite.delivered),
        recipient: body.user.email,
        mode: body.invite.mode,
      });
      setInviteOpen(false);
      notify.done(body.invite.delivered ? "Invitation sent" : "Invitation created; copy the secure link");

      // The invite route takes no reporting line, so a chosen admin is set by the assignment route.
      if (role === "partner_user" && reportsTo && canAssignAdmin && body.user?.id) {
        const assigned = await fetch(
          `/api/app/partners/${partnerId}/users/${body.user.id}/admin-assignment`,
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            signal: AbortSignal.timeout(TIMEOUT_MS),
            body: JSON.stringify({ partner_admin_user_id: reportsTo }),
          },
        );
        const assignedBody = await assigned.json().catch(() => null);
        if (!assigned.ok) {
          notify.block(assignedBody?.error ?? "Could not assign the partner admin", {
            detail: "The invitation was created. Assign a partner admin from the Unassigned users view.",
          });
        }
      }
      await load();
      onSeatsChanged?.();
    } catch {
      setInviteError("Could not send invitation. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  async function resend(member: Member) {
    setBusy(member.user_id);
    try {
      const response = await fetch(
        `/api/app/partners/${partnerId}/users/${member.user_id}/resend-invite`,
        { method: "POST", signal: AbortSignal.timeout(TIMEOUT_MS) },
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        notify.block(body?.error ?? "Could not resend invitation");
        return;
      }
      setInvite({
        url: body.invite.url,
        expiresAt: body.invite.expiresAt,
        delivered: Boolean(body.invite.delivered),
        recipient: member.email,
        mode: body.invite.mode,
      });
      notify.done(body.invite.delivered ? "Invitation resent" : "Invitation reissued; copy the secure link");
      await load();
    } catch {
      notify.fail("Could not resend invitation. Try again in a moment.");
    } finally {
      setBusy(null);
    }
  }

  async function changeStatus(member: Member) {
    const action = member.status === "active" ? "deactivate" : "reactivate";
    setBusy(member.user_id);
    try {
      const response = await fetch(`/api/app/partners/${partnerId}/users/${member.user_id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        body: JSON.stringify({ action }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        // A reactivation over the plan's seats returns the plan-limit sentence here.
        notify.block(body?.error ?? "Could not change user status");
        return;
      }
      setConfirmFor(null);
      notify.done(
        action === "deactivate"
          ? member.accepted_at ? `${member.name} deactivated` : "Invitation withdrawn"
          : `${member.name} reactivated`,
      );
      await load();
      onSeatsChanged?.();
    } catch {
      notify.fail("Could not change user status. Try again in a moment.");
    } finally {
      setBusy(null);
      setConfirmFor(null);
    }
  }

  function configure(member: Member) {
    setSelected({
      ...member,
      parentName: member.partner_admin_user_id
        ? parentByUserId.get(member.partner_admin_user_id) ?? null
        : null,
    });
  }

  const seats = seatUsage == null ? undefined : capacityLabel(seatUsage, seatLimit, "partner-user seats used across your account");
  const labelText = "text-sm font-semibold text-[var(--body)]";
  const hasFilters = Boolean(query.trim()) || scope !== "all" || Boolean(adminFilter);
  const confirmPending = confirmFor ? !confirmFor.accepted_at : false;

  return (
    <div className="portal-partner-team space-y-4">
      {offboarded ? (
        <p role="status" className="rounded-md border border-border bg-[var(--surface-alt)] px-4 py-2 text-sm text-[var(--body)]">
          This partner is offboarded. Its team stays as history and cannot be changed.
        </p>
      ) : null}

      {invite ? <PartnerInviteResultPanel result={invite} /> : null}

      <TableCard
        toolbar={
          <DataToolbar
            actions={
              <>
                {canWrite ? (
                  <Button type="button" onClick={openInvite}>
                    <UserPlus aria-hidden="true" />
                    Invite user
                  </Button>
                ) : null}
                <RefreshButton onClick={() => void load()} refreshing={loaded && loading} />
              </>
            }
          >
            <ToolbarSearch
              value={query}
              onChange={(value) => { setQuery(value); setPage(1); }}
              placeholder="Search team members"
              label="Search team members by name or email"
            />
            <select
              aria-label="Filter by role"
              className={toolbarControl}
              value={scope}
              onChange={(event) => changeScope(event.target.value as TeamScope)}
            >
              <option value="all">All members · {members.length}</option>
              <option value="admins">Partner admins · {admins.length}</option>
              <option value="users">Partner users · {users.length}</option>
              <option value="unassigned">Unassigned users · {unassigned.length}</option>
            </select>
            {scope === "users" ? (
              <select
                aria-label="Filter by reporting line"
                className={toolbarControl}
                value={adminFilter}
                onChange={(event) => { setAdminFilter(event.target.value); setPage(1); }}
              >
                <option value="">All partner admins</option>
                {admins.map((admin) => (
                  <option key={admin.user_id} value={admin.user_id}>
                    Reports to {admin.name}
                  </option>
                ))}
              </select>
            ) : null}
          </DataToolbar>
        }
        footer={
          loaded && members.length ? (
            <Pager page={visible.current} total={filtered.length} noun="members" pageSize={PAGE_SIZE} onPage={setPage} suffix={seats} />
          ) : seats ? (
            <span>{seats[0].toUpperCase() + seats.slice(1)}</span>
          ) : undefined
        }
      >
        {!loaded ? (
          <SectionLoading rows={5} columns={5} label="Loading team" />
        ) : loadError && !members.length ? (
          <ErrorState detail={loadError} action={<Button type="button" variant="outline" onClick={() => void load()}>Try again</Button>} />
        ) : members.length === 0 ? (
          <EmptyState
            title="No team members yet"
            hint={canWrite ? "Invite this partner's first partner admin. They can then add their own partner users from the partner portal." : "Nobody has been invited to this partner's portal."}
            action={canWrite ? <Button type="button" variant="outline" onClick={openInvite}>Invite user</Button> : undefined}
          />
        ) : filtered.length === 0 ? (
          <NoMatches
            noun="team members"
            onClear={hasFilters ? () => { setQuery(""); changeScope("all"); } : undefined}
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Reporting line</TableHead>
                <TableHead className="text-right"><span className="sr-only">Actions</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.rows.map((member) => {
                const pending = isPendingInvite(member);
                const parent = member.partner_admin_user_id
                  ? parentByUserId.get(member.partner_admin_user_id) ?? null
                  : null;
                const userCount = users.filter((user) => user.partner_admin_user_id === member.user_id).length;
                const rowBusy = busy === member.user_id;
                return (
                  <TableRow key={member.id} className={member.user_id === selected?.user_id ? "bg-[var(--surface-alt)]" : undefined}>
                    <TableCell className="max-w-[320px]">
                      <strong className="block truncate font-semibold text-foreground">{member.name}</strong>
                      <span className="block truncate text-xs text-muted-foreground" title={member.email}>{member.email}</span>
                    </TableCell>
                    <TableCell>
                      <StatusChip tone={member.role === "partner_admin" ? "action" : "neutral"}>{roleLabel(member.role)}</StatusChip>
                    </TableCell>
                    <TableCell>
                      <StatusChip
                        tone={member.status !== "active" ? "danger" : pending ? "warning" : "good"}
                        title={pending && member.invite_expires_at ? `Link expires ${new Date(member.invite_expires_at).toLocaleString()}` : undefined}
                      >
                        {member.status !== "active" ? "Deactivated" : pending ? "Invited" : "Active"}
                      </StatusChip>
                    </TableCell>
                    <TableCell>
                      {member.role === "partner_admin" ? (
                        userCount ? (
                          <Button type="button" size="sm" variant="ghost" className="-ml-2" onClick={() => viewUsersOf(member)}>
                            View users ({userCount})
                          </Button>
                        ) : (
                          <span className="text-sm text-muted-foreground">No users yet</span>
                        )
                      ) : parent ? (
                        <span className="text-sm">Reports to {parent}</span>
                      ) : canWrite && canAssignAdmin && activeAdmins.length ? (
                        <select
                          aria-label={`Assign ${member.name} to a partner admin`}
                          className={cn(toolbarControl, "h-8")}
                          value=""
                          disabled={busy !== null}
                          onChange={(event) => {
                            if (event.target.value) void assign(member, event.target.value);
                          }}
                        >
                          <option value="" disabled>
                            Assign…
                          </option>
                          {activeAdmins.map((admin) => (
                            <option key={admin.user_id} value={admin.user_id}>
                              {admin.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <StatusChip tone="warning">Unassigned</StatusChip>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="inline-flex justify-end gap-2">
                        {member.role === "partner_admin" ? (
                          <Button type="button" size="sm" variant="outline" onClick={() => configure(member)}>
                            <Settings2 aria-hidden="true" />
                            Configure
                          </Button>
                        ) : null}
                        {canWrite && pending ? (
                          <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => void resend(member)}>
                            {rowBusy ? "Sending…" : "Resend invite"}
                          </Button>
                        ) : null}
                        {canWrite ? (
                          member.status === "active" ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={busy !== null}
                              aria-label={pending ? `Withdraw the invitation for ${member.name}` : `Deactivate ${member.name}`}
                              onClick={() => setConfirmFor(member)}
                            >
                              {pending ? "Withdraw" : "Deactivate"}
                            </Button>
                          ) : (
                            <Button type="button" size="sm" variant="outline" disabled={busy !== null} onClick={() => void changeStatus(member)}>
                              {rowBusy ? "Reactivating…" : "Reactivate"}
                            </Button>
                          )
                        ) : null}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </TableCard>

      {selected ? (
        <section
          ref={workspaceRef}
          className="portal-team-member-workspace motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2 motion-safe:duration-300"
          aria-label={`${selected.name} configuration`}
        >
          <PartnerUserWorkspace
            partnerId={partnerId}
            member={selected}
            readOnly={readOnly || offboarded}
            onClose={() => setSelected(null)}
          />
        </section>
      ) : null}

      <Dialog open={inviteOpen} onOpenChange={(open) => { if (busy !== "invite") setInviteOpen(open); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Invite user</DialogTitle>
            <DialogDescription>They get a secure link to set a password and sign in to the partner portal.</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={(event) => void submitInvite(event)} noValidate>
            {inviteError ? (
              <p role="alert" className="rounded-md border border-[var(--error)] bg-[var(--error-surface)] px-3 py-2 text-sm text-[var(--error-ink)]">
                {inviteError}
              </p>
            ) : null}
            <label className="block">
              <span className={labelText}>Full name</span>
              <Input
                className="mt-1.5"
                autoComplete="name"
                maxLength={120}
                value={name}
                aria-invalid={fieldError?.field === "name"}
                onChange={(event) => { setName(event.target.value); if (fieldError?.field === "name") setFieldError(null); }}
              />
              {fieldError?.field === "name" && <small className="mt-1.5 block text-xs text-[var(--error-ink)]" role="alert">{fieldError.message}</small>}
            </label>
            <label className="block">
              <span className={labelText}>Work email</span>
              <Input
                className="mt-1.5"
                type="email"
                autoComplete="email"
                maxLength={254}
                value={email}
                aria-invalid={fieldError?.field === "email"}
                onChange={(event) => { setEmail(event.target.value); if (fieldError?.field === "email") setFieldError(null); }}
              />
              {fieldError?.field === "email" && <small className="mt-1.5 block text-xs text-[var(--error-ink)]" role="alert">{fieldError.message}</small>}
            </label>
            <label className="block">
              <span className={labelText}>Role</span>
              <select
                value={role}
                onChange={(event) => { setRole(event.target.value as PartnerRole); setReportsTo(""); }}
                className={cn(toolbarControl, "mt-1.5 w-full")}
              >
                <option value="partner_admin">Partner admin</option>
                <option value="partner_user">Partner user</option>
              </select>
              <small className="mt-1.5 block text-xs text-muted-foreground">
                {role === "partner_admin"
                  ? "Partner admins manage their organization's team, submit leads, and message the agent."
                  : "Partner users can submit leads, track their organization's pipeline, and message the agent."}
              </small>
            </label>
            {role === "partner_user" && canAssignAdmin && activeAdmins.length ? (
              <label className="block">
                <span className={labelText}>Reports to</span>
                <select
                  value={reportsTo}
                  onChange={(event) => setReportsTo(event.target.value)}
                  className={cn(toolbarControl, "mt-1.5 w-full")}
                >
                  <option value="">Assign later</option>
                  {activeAdmins.map((admin) => (
                    <option key={admin.user_id} value={admin.user_id}>
                      {admin.name}
                    </option>
                  ))}
                </select>
                <small className="mt-1.5 block text-xs text-muted-foreground">They inherit this partner admin&apos;s lead form and market defaults.</small>
              </label>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={busy === "invite"} onClick={() => setInviteOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={busy !== null}>{busy === "invite" ? "Sending…" : "Send invitation"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmFor !== null} onOpenChange={(open) => { if (!open && busy === null) setConfirmFor(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {confirmFor ? (confirmPending ? `Withdraw the invitation for ${confirmFor.name}?` : `Deactivate ${confirmFor.name}?`) : ""}
            </DialogTitle>
            <DialogDescription>
              {confirmPending
                ? "Their invitation link stops working. You can reactivate them later."
                : "They can no longer sign in to the partner portal. Their history stays, and you can reactivate them later."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy !== null} onClick={() => setConfirmFor(null)}>Cancel</Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy !== null}
              onClick={() => { if (confirmFor) void changeStatus(confirmFor); }}
            >
              {busy !== null ? "Saving…" : confirmPending ? "Withdraw invitation" : "Deactivate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function PartnerUserWorkspace({
  partnerId,
  member,
  readOnly,
  onClose,
}: {
  partnerId: string;
  member: Selected;
  readOnly: boolean;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<ConfigTab>("overview");
  const target = {
    userId: member.user_id,
    name: member.name,
    role: member.role,
  };
  const inheritance = member.role === "partner_admin"
    ? "Using publisher defaults"
    : member.parentName
      ? `Using ${member.parentName} defaults`
      : "Unassigned — direct user override";

  return (
    <div className="portal-team-config">
      <div className="portal-team-config-header">
        <button type="button" className="portal-team-back" onClick={onClose}>
          <ArrowLeft aria-hidden="true" />
          Back to team
        </button>
        <div className="portal-team-config-identity">
          <MemberAvatar member={member} />
          <div>
            <h3>{member.name}</h3>
            <p>{member.email} <span>·</span> {roleLabel(member.role)} <span>·</span> {statusLabel(member)}</p>
          </div>
        </div>
        <Button type="button" size="icon" variant="ghost" aria-label="Close configuration" onClick={onClose}>
          <X aria-hidden="true" />
        </Button>
      </div>

      <div className="portal-team-inheritance" role="status">
        <ShieldCheck aria-hidden="true" />
        <strong>{inheritance}</strong>
        <span>
          {member.role === "partner_admin"
            ? "Changes here become the default for this admin and users who inherit from them."
            : member.parentName
              ? "Direct changes create a user override and do not change the admin."
              : "Assign an admin from the Users view to use inherited defaults."}
        </span>
      </div>

      <nav className="portal-team-config-tabs" role="tablist" aria-label="Member configuration">
        {(
          [
            ["overview", "Overview"],
            ["lead", "Lead form"],
            ["markets", "Markets"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </nav>

      <div className="portal-team-config-body">
        {tab === "overview" ? (
          <div className="portal-team-config-overview">
            <div className="portal-team-config-summary-grid">
              <div><span>Role</span><strong>{roleLabel(member.role)}</strong></div>
              <div><span>Status</span><strong>{member.status === "active" ? "Active" : "Deactivated"}</strong></div>
              <div><span>Reports to</span><strong>{member.parentName ?? "No admin assigned"}</strong></div>
              <div><span>Access source</span><strong>{inheritance}</strong></div>
            </div>
            <div className="portal-team-next-step">
              <div className="portal-team-next-step-icon"><Settings2 aria-hidden="true" /></div>
              <div>
                <strong>Choose what to configure next</strong>
                <p>Keep member identity here, then use one focused workspace for lead intake or market access.</p>
              </div>
              <div className="portal-team-next-step-actions">
                <Button type="button" variant="outline" onClick={() => setTab("lead")}>Open lead form</Button>
                <Button type="button" variant="outline" onClick={() => setTab("markets")}>Open markets</Button>
              </div>
            </div>
          </div>
        ) : tab === "lead" ? (
          <div className="portal-team-form-workspace">
            <PartnerFormStudio partnerId={partnerId} target={target} readOnly={readOnly} compact />
          </div>
        ) : (
          <div className="portal-team-form-workspace">
            <PartnerMarketAccessPanel partnerId={partnerId} target={target} readOnly={readOnly} compact />
          </div>
        )}
      </div>
    </div>
  );
}
