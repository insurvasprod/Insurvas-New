"use client";

import { useMemo, useState, type FormEvent } from "react";
import { notify } from "@/lib/notify";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { SettingsSaveBar } from "@/components/ui/settings-layout";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { TableCard } from "@/components/ui/table-card";
import {
  Callout,
  Field,
  Pill,
  SettingsSectionHeader,
  SettingsStack,
  control,
  st,
  type PillTone,
} from "@/components/app/settings/primitives";
import { cn } from "@/lib/utils";
import { TENANT_ROLE_LABELS, TENANT_ROLES, type TenantRole } from "@/lib/tenantAuth/roles";
import { US_STATES } from "@/lib/appointments/constants";
import { SCHEMA_PENDING_MESSAGE } from "@/lib/appointments/pendingSchema";
import type { WorkspaceSnapshot } from "@/lib/settings/workspaceSnapshot";
import type { TeamMember, TeamSnapshot } from "@/lib/tenantTeam/service";
import { lastSeenCell } from "@/lib/tenantTeam/lastSeen";
import { dayMonth } from "@/lib/format/dates";
import { useViewerTimeZone } from "@/components/app/use-viewer-time-zone";

type MemberStatus = "active" | "invited" | "expired" | "suspended" | "other";
const STATUS_FILTERS: { key: Exclude<MemberStatus, "other" | "expired">; label: string }[] = [
  { key: "active", label: "Active" },
  { key: "invited", label: "Invited" },
  { key: "suspended", label: "Suspended" },
];
/** Roles whose leads are gated on licences; a setter books only, and the others do not sell. */
const LICENSED_ROLES: readonly TenantRole[] = ["owner", "producer"];

/** One line per role, shown under the role picker. */
function roleReach(role: TenantRole) {
  const row = ROLE_REACH.find((item) => item.role === role);
  return row ? `Leads: ${row.leads}. Money: ${row.money}. Settings: ${row.settings}.` : undefined;
}

/**
 * What each role can reach, read off the real guards rather than the board's sample copy:
 * lib/tenantAuth/permissions.ts (ROLE_PERMISSIONS) and the required_roles in lib/menu/definition.ts.
 * Settings is owner-only (settings.root, and /app/settings refuses every other role); a producer can
 * read Carrier appointments but not change it.
 */
const ROLE_REACH: { role: TenantRole; leads: string; money: string; settings: string }[] = [
  { role: "owner", leads: "Everything", money: "Everything", settings: "Everything" },
  { role: "producer", leads: "Leads, dialer, calendar and quoting", money: "Policies and own commissions", settings: "None (reads carrier appointments)" },
  { role: "setter", leads: "Dial and book only", money: "None", settings: "None" },
  { role: "assistant", leads: "Leads, imports and inbound; no dialer", money: "None", settings: "None" },
  { role: "bookkeeper", leads: "None", money: "Policies, all commissions, statements, payouts", settings: "None" },
];


function statusOf(member: TeamMember, now: number): MemberStatus {
  if (!member.acceptedAt) {
    if (member.inviteExpiresAt && new Date(member.inviteExpiresAt).getTime() < now) return "expired";
    return "invited";
  }
  if (member.status === "active") return "active";
  if (member.status === "suspended") return "suspended";
  return "other";
}

const STATUS_PILL: Record<MemberStatus, { tone: PillTone; label: string }> = {
  active: { tone: "success", label: "Active" },
  invited: { tone: "warning", label: "Invited" },
  expired: { tone: "error", label: "Invite expired" },
  suspended: { tone: "neutral", label: "Suspended" },
  other: { tone: "neutral", label: "" },
};


/** expiries: the day each personal licence lapses, by state; null clears one. Sent with the states. */
type PendingChange = { role?: TenantRole; states?: string[]; expiries?: Record<string, string | null> };

const sameExpiries = (a: Record<string, string | null>, b: Record<string, string | null>, states: string[]) =>
  states.every((state) => (a[state] ?? null) === (b[state] ?? null));

export function TeamSettings({ initial, workspace }: { initial: TeamSnapshot; workspace?: WorkspaceSnapshot }) {
  const [snapshot, setSnapshot] = useState(initial);
  const viewerId = initial.viewerId;
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<TenantRole | "">("");
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [refreshing, setRefreshing] = useState(false);
  const [pending, setPending] = useState<Record<string, PendingChange>>({});
  const [saving, setSaving] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [managing, setManaging] = useState<TeamMember | null>(null);
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  // Fixed at mount: relative times and invite expiry do not need to tick while the page is open.
  const [now] = useState(() => Date.now());
  // Dates read in UTC in the server render, then in the viewer's own zone once mounted.
  const zone = useViewerTimeZone() ?? "UTC";

  async function refresh() {
    const response = await fetch("/api/app/team", { cache: "no-store" });
    const body = await response.json().catch(() => null);
    if (response.ok) setSnapshot(body);
  }

  async function reload() {
    setRefreshing(true);
    try { await refresh(); } finally { setRefreshing(false); }
  }

  const dirty = Object.keys(pending).length > 0;
  const effectiveRole = (member: TeamMember) => pending[member.id]?.role ?? member.role;
  const effectiveStates = (member: TeamMember) => pending[member.id]?.states ?? member.licensedStates ?? [];
  const effectiveExpiries = (member: TeamMember): Record<string, string | null> => pending[member.id]?.expiries ?? member.licensedStateExpiries ?? {};

  /** Save changes: every staged role and licensed-states edit, one request each. */
  async function saveChanges() {
    setSaving(true);
    setError("");
    const failures: string[] = [];
    const remaining: Record<string, PendingChange> = {};
    for (const [userId, change] of Object.entries(pending)) {
      const member = snapshot.members.find((item) => item.id === userId);
      const name = member?.name ?? "A teammate";
      const left: PendingChange = {};
      if (change.role && change.role !== member?.role) {
        const response = await fetch(`/api/app/team/${userId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role: change.role }) });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          failures.push(`${name}: ${body?.error ?? "Could not change this teammate's role"}`);
          // A refused role change (the last owner, a seat limit) is not retried: the draft drops it.
        }
      }
      if (change.states || change.expiries) {
        const states = change.states ?? member?.licensedStates ?? [];
        const expiries = change.expiries ? Object.fromEntries(states.map((state) => [state, change.expiries?.[state] ?? null])) : undefined;
        const response = await fetch(`/api/app/team/${userId}/licensed-states`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(expiries ? { states, expiries } : { states }) });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          failures.push(`${name}: ${response.status === 503 ? SCHEMA_PENDING_MESSAGE : (body?.error ?? "Could not save licensed states")}`);
          if (response.status !== 503) { left.states = change.states; left.expiries = change.expiries; }
        }
      }
      if (left.states || left.expiries) remaining[userId] = left;
    }
    setSaving(false);
    setPending(remaining);
    await refresh();
    if (failures.length) setError(failures.join(" "));
    else notify.done("Team changes saved");
  }

  async function resend(member: TeamMember) {
    setRowBusy(member.id);
    setError("");
    const response = await fetch(`/api/app/team/${member.id}/resend-invite`, { method: "POST" });
    const body = await response.json().catch(() => null);
    setRowBusy(null);
    if (!response.ok) {
      setError(body?.error ?? "Could not resend this invitation");
      return;
    }
    notify.done(body.invite?.delivered ? `Invitation resent to ${member.email}` : "New invitation issued — copy the link from the server log if email is not configured");
    await refresh();
  }

  async function revoke(member: TeamMember) {
    setRowBusy(member.id);
    setError("");
    const response = await fetch(`/api/app/team/${member.id}/invite`, { method: "DELETE" });
    const body = await response.json().catch(() => null);
    setRowBusy(null);
    if (!response.ok) {
      setError(body?.error ?? "Could not revoke this invitation");
      return;
    }
    setPending((current) => {
      const next = { ...current };
      delete next[member.id];
      return next;
    });
    setManaging(null);
    notify.done(body.accountRemoved ? `Invitation to ${member.email} revoked; the seat is free` : `Invitation revoked; the seat is free. The unused account for ${member.email} could not be removed, so inviting that address again needs support.`);
    await refresh();
  }

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return snapshot.members.filter((member) => {
      if (needle && !member.name.toLowerCase().includes(needle) && !member.email.toLowerCase().includes(needle)) return false;
      if (roleFilter && roleFilter !== (pending[member.id]?.role ?? member.role)) return false;
      if (statusFilter) {
        const status = statusOf(member, now);
        if (statusFilter !== (status === "expired" ? "invited" : status)) return false;
      }
      return true;
    });
  }, [snapshot.members, query, roleFilter, statusFilter, pending, now]);

  const seats = snapshot.seats;
  const pendingInvites = snapshot.members.filter((member) => !member.acceptedAt).length;
  const atSeatLimit = seats.max !== null && seats.used >= seats.max;
  const bufferAtLimit = snapshot.bufferSeats.max !== null && snapshot.bufferSeats.used >= snapshot.bufferSeats.max;
  const filtersOn = Boolean(roleFilter || statusFilter || query.trim());
  const planName = workspace?.planName ?? "Your plan";
  const outbound = snapshot.outboundLimits?.filter((item) => ["max_setter_seats", "max_active_campaigns"].includes(item.key)) ?? [];
  // LA-2.22: the setter-seat cap is its own limit, apart from total seats. At 80% it is named as a
  // warning, and at the cap the prompt says which limit refuses the next setter invite.
  const setterSeats = outbound.find((item) => item.key === "max_setter_seats" && item.limit !== null) ?? null;
  const setterAtLimit = setterSeats !== null && setterSeats.usage >= (setterSeats.limit ?? 0);
  const setterNearLimit = setterSeats !== null && !setterAtLimit && (setterSeats.limit ?? 0) > 0 && setterSeats.usage / (setterSeats.limit ?? 1) >= 0.8;

  return (
    <SettingsStack>
      <SettingsSectionHeader />

      <StatStrip label="Seats">
        <StatTile
          label="Seats"
          value={seats.used}
          valueTone={atSeatLimit ? "warning" : undefined}
          meter={seats.max !== null ? { value: seats.used, max: seats.max, tone: atSeatLimit ? "warning" : "info", label: `${seats.used} of ${seats.max} seats used` } : undefined}
          footnote={seats.max === null ? "unlimited" : `of ${seats.max} on ${planName}`}
        />
        <StatTile label="Pending invites" value={pendingInvites} footnote={pendingInvites ? "each holds a seat" : "none outstanding"} />
        <StatTile
          label="Buffer seats"
          value={snapshot.bufferSeats.used}
          valueTone={bufferAtLimit ? "warning" : undefined}
          footnote={snapshot.bufferSeats.max === null ? "unlimited" : `of ${snapshot.bufferSeats.max}`}
        />
        {outbound.map((item) => (
          <StatTile
            key={item.key}
            label={item.label}
            value={item.usage}
            valueTone={item.limit !== null && item.usage >= item.limit ? "warning" : undefined}
            footnote={item.limit === null ? "unlimited" : `of ${item.limit}`}
          />
        ))}
      </StatStrip>

      {atSeatLimit && <Callout tone="warning" title="Every seat is in use — revoke a pending invite or upgrade the plan before inviting anyone else." />}
      {setterSeats && (setterAtLimit || setterNearLimit) && (
        <Callout
          tone="warning"
          title={setterAtLimit
            ? `All ${setterSeats.limit ?? 0} setter seats are in use — another setter invite will be refused until one is freed or the plan is upgraded.`
            : `Setter seats are nearly full: ${setterSeats.usage} of ${setterSeats.limit ?? 0} in use.`}
        />
      )}
      {error && <Callout tone="error" title={error} />}

      <TableCard
        toolbar={
          <DataToolbar
            actions={
              <>
                <Button type="button" onClick={() => setInviteOpen(true)}>
                  <UserPlus aria-hidden="true" />
                  Invite someone
                </Button>
                <RefreshButton onClick={() => void reload()} refreshing={refreshing} />
              </>
            }
          >
            <ToolbarSearch value={query} onChange={setQuery} placeholder="Search people" />
            <select aria-label="Filter by access" className={toolbarControl} value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as TenantRole | "")}>
              <option value="">All access</option>
              {TENANT_ROLES.map((role) => <option key={role} value={role}>{TENANT_ROLE_LABELS[role]}</option>)}
            </select>
            <select aria-label="Filter by status" className={toolbarControl} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="">All statuses</option>
              {STATUS_FILTERS.map((status) => <option key={status.key} value={status.key}>{status.label}</option>)}
            </select>
          </DataToolbar>
        }
        footer={<span className="tabular-nums">{TENANT_ROLES.map((role) => `${TENANT_ROLE_LABELS[role]} ${seats.byRole[role]}`).join(" · ")}</span>}
      >
        {snapshot.members.length === 0 ? (
          <EmptyState title="No one is on this workspace yet" hint="Invite a teammate to give them access." />
        ) : filtered.length === 0 ? (
          <NoMatches noun="people" onClear={filtersOn ? () => { setQuery(""); setRoleFilter(""); setStatusFilter(""); } : undefined} />
        ) : (
        <table className={cn(st.table, "min-w-[760px]")} data-testid="team-settings">
          <thead>
            <tr className={st.headRow}>
              <th scope="col" className={st.th}>Person</th>
              <th scope="col" className={cn(st.th, "w-[120px]")}>Access</th>
              <th scope="col" className={cn(st.th, "w-[150px]")}>Licensed in</th>
              <th scope="col" className={cn(st.th, "w-[120px]")}>Status</th>
              <th
                scope="col"
                className={cn(st.th, st.num, "w-[130px]")}
                title={snapshot.presenceRecorded === false ? "Presence is not recorded until a database update is applied, so this shows the last sign-in." : "When they last had Insurvas open. “Now” means within the last two minutes."}
              >
                Last seen
              </th>
              <th scope="col" className={cn(st.th, st.num, "w-[150px]")}><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((member) => {
              const status = statusOf(member, now);
              const role = effectiveRole(member);
              const states = effectiveStates(member);
              const changed = Boolean(pending[member.id]);
              const pill = status === "other" ? { tone: "neutral" as PillTone, label: member.status } : STATUS_PILL[status];
              return (
                <tr key={member.id}>
                  <td className={st.td}>
                    {/* The name opens Manage on every row — the only way in on your own row and on an
                        invited one, whose action column carries nothing or Resend only (the board). */}
                    <button
                      type="button"
                      className="rounded-[4px] text-left text-[var(--body)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-500)]"
                      onClick={() => setManaging(member)}
                      aria-label={`Manage ${member.name}`}
                    >
                      {member.name}
                    </button>
                    {changed && <Pill tone="info" className="ml-2">Unsaved</Pill>}
                    <span className={cn(st.sub, "break-all")}>{member.email}</span>
                  </td>
                  <td className={st.td}>
                    <Pill tone={role === "owner" ? "brand" : "neutral"}>{TENANT_ROLE_LABELS[role]}</Pill>
                  </td>
                  <td className={st.td}>
                    {role === "setter" ? (
                      <>&mdash; books only</>
                    ) : !LICENSED_ROLES.includes(role) ? (
                      <>&mdash;</>
                    ) : states.length ? (
                      <span title={Object.entries(effectiveExpiries(member)).filter(([state, date]) => date && states.includes(state)).map(([state, date]) => `${state} licence valid through ${dayMonth(`${date}T12:00:00Z`, "UTC")}`).join("; ") || undefined}>
                        {states.join(", ")}
                      </span>
                    ) : (
                      <span className="text-[var(--muted)]" title="No personal licences recorded, so lead assignment judges this person on the agency's licences.">
                        Any agency state
                      </span>
                    )}
                  </td>
                  <td className={st.td}>
                    <Pill tone={pill.tone}>{pill.label}</Pill>
                  </td>
                  <td className={cn(st.td, st.num)}>
                    {status === "invited" || status === "expired"
                      ? member.inviteExpiresAt
                        ? `${status === "expired" ? "Expired" : "Expires"} ${dayMonth(member.inviteExpiresAt, zone)}`
                        : <>&mdash;</>
                      : lastSeenCell(member, now, zone)}
                  </td>
                  <td className={cn(st.td, st.num, "whitespace-nowrap")}>
                    {status === "invited" || status === "expired" ? (
                      <Button type="button" variant="outline" size="sm" disabled={rowBusy === member.id} onClick={() => void resend(member)} aria-label={`Resend invitation to ${member.name}`}>
                        {rowBusy === member.id ? "Sending…" : "Resend"}
                      </Button>
                    ) : member.id === viewerId ? (
                      <span className="text-[var(--muted)]" title="This is you. Select your name to change your own licensed states.">&mdash;</span>
                    ) : (
                      <Button type="button" variant="outline" size="sm" onClick={() => setManaging(member)} aria-label={`Manage ${member.name}`}>
                        Manage
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        )}
      </TableCard>

      <SettingsSaveBar visible={dirty} note={`${Object.keys(pending).length} ${Object.keys(pending).length === 1 ? "teammate" : "teammates"} changed`}>
        <Button type="button" variant="outline" onClick={() => { setPending({}); setError(""); }} disabled={saving}>Discard</Button>
        <Button type="button" onClick={() => void saveChanges()} disabled={saving}>{saving ? "Saving…" : "Save changes"}</Button>
      </SettingsSaveBar>

      {inviteOpen && (
        <InviteDialog
          onClose={() => setInviteOpen(false)}
          bufferAtLimit={bufferAtLimit}
          bufferSeats={snapshot.bufferSeats}
          atSeatLimit={atSeatLimit}
          setterSeats={setterAtLimit && setterSeats ? { used: setterSeats.usage, max: setterSeats.limit ?? 0 } : null}
          onInvited={async () => {
            setInviteOpen(false);
            await refresh();
          }}
        />
      )}
      {managing && (
        <ManageDialog
          member={managing}
          role={effectiveRole(managing)}
          states={effectiveStates(managing)}
          expiries={effectiveExpiries(managing)}
          statesAvailable={snapshot.licensedStatesAvailable !== false}
          revoking={rowBusy === managing.id}
          onRevoke={() => void revoke(managing)}
          onClose={() => setManaging(null)}
          onApply={(change) => {
            setPending((current) => {
              const next = { ...current };
              const base = managing;
              const merged: PendingChange = {};
              if (change.role !== base.role) merged.role = change.role;
              const before = [...(base.licensedStates ?? [])].sort().join(",");
              if ([...change.states].sort().join(",") !== before) merged.states = [...change.states].sort();
              if (!sameExpiries(change.expiries, base.licensedStateExpiries ?? {}, change.states)) merged.expiries = change.expiries;
              if (merged.role || merged.states || merged.expiries) next[base.id] = merged;
              else delete next[base.id];
              return next;
            });
            setManaging(null);
          }}
        />
      )}
    </SettingsStack>
  );
}

function TeamDialog({ title, description, onClose, children }: { title: string; description: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto border-[var(--border)] bg-[var(--surface)] sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-[var(--ink)]">{title}</DialogTitle>
          <DialogDescription className="text-[14px] text-[var(--muted)]">{description}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

function InviteDialog({
  onClose,
  onInvited,
  bufferAtLimit,
  bufferSeats,
  atSeatLimit,
  setterSeats,
}: {
  onClose: () => void;
  onInvited: () => Promise<void>;
  bufferAtLimit: boolean;
  bufferSeats: TeamSnapshot["bufferSeats"];
  atSeatLimit: boolean;
  /** Set only when the plan's setter seats are all in use. */
  setterSeats: { used: number; max: number } | null;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TenantRole>("assistant");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const response = await fetch("/api/app/team", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, email, role }) });
    const body = await response.json().catch(() => null);
    setBusy(false);
    if (!response.ok) {
      setError(body?.error ?? "Could not invite this teammate");
      return;
    }
    notify.done(body.invite?.delivered ? "Invitation sent" : "Teammate invited — copy the link from the server log if email is not configured");
    await onInvited();
  }

  return (
    <TeamDialog title="Invite someone" description="They get an email link to set a password. The invite holds a seat until it is accepted or revoked." onClose={onClose}>
      {atSeatLimit && <Callout tone="warning" title="Every seat is in use — this invite will be refused until one is freed." />}
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => void invite(event)}>
        <Field label="Name" htmlFor="team-name" required>
          <input id="team-name" className={control} value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required />
        </Field>
        <Field label="Email" htmlFor="team-email" required>
          <input id="team-email" type="email" className={control} value={email} onChange={(event) => setEmail(event.target.value)} maxLength={254} required />
        </Field>
        <Field label="Role" htmlFor="team-role" className="sm:col-span-2" hint={roleReach(role)}>
          <select id="team-role" className={control} value={role} onChange={(event) => setRole(event.target.value as TenantRole)}>
            {TENANT_ROLES.map((item) => (
              <option key={item} value={item}>{TENANT_ROLE_LABELS[item]}</option>
            ))}
          </select>
        </Field>
        {role === "assistant" && bufferAtLimit && (
          <p className="text-[14px] text-[var(--error-ink)] sm:col-span-2" role="alert">
            Your plan has reached <code>max_buffer_seats</code> ({bufferSeats.used} of {bufferSeats.max}). Upgrade to invite another buffer agent.
          </p>
        )}
        {role === "setter" && setterSeats && (
          <p className="text-[14px] text-[var(--error-ink)] sm:col-span-2" role="alert">
            Your plan has reached its setter-seat limit ({setterSeats.used} of {setterSeats.max} setter seats). Upgrade the plan to invite another setter.
          </p>
        )}
        {error && (
          <p role="alert" className="text-[14px] text-[var(--error-ink)] sm:col-span-2">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy || (role === "assistant" && bufferAtLimit) || (role === "setter" && Boolean(setterSeats))}>
            {busy ? "Inviting…" : "Invite teammate"}
          </Button>
        </div>
      </form>
    </TeamDialog>
  );
}

function ManageDialog({
  member,
  role: initialRole,
  states: initialStates,
  expiries: initialExpiries,
  statesAvailable,
  revoking,
  onRevoke,
  onClose,
  onApply,
}: {
  member: TeamMember;
  role: TenantRole;
  states: string[];
  expiries: Record<string, string | null>;
  statesAvailable: boolean;
  revoking: boolean;
  onRevoke: () => void;
  onClose: () => void;
  onApply: (change: { role: TenantRole; states: string[]; expiries: Record<string, string | null> }) => void;
}) {
  const [role, setRole] = useState(initialRole);
  const [states, setStates] = useState<Set<string>>(new Set(initialStates));
  const [expiries, setExpiries] = useState<Record<string, string | null>>(initialExpiries);
  const stateNames = new Map<string, string>(US_STATES.map(([code, name]) => [code, name]));
  const [stateQuery, setStateQuery] = useState("");
  const invited = !member.acceptedAt;
  const licensed = LICENSED_ROLES.includes(role);
  const visibleStates = US_STATES.filter(([code, name]) => !stateQuery.trim() || name.toLowerCase().includes(stateQuery.trim().toLowerCase()) || code === stateQuery.trim().toUpperCase());

  return (
    <TeamDialog title={`Manage ${member.name}`} description="Held until you save the section." onClose={onClose}>
      <div className="grid gap-4">
        <Field label="Access" htmlFor="manage-role" hint={roleReach(role)}>
          <select id="manage-role" className={control} value={role} onChange={(event) => setRole(event.target.value as TenantRole)}>
            {TENANT_ROLES.map((item) => (
              <option key={item} value={item}>{TENANT_ROLE_LABELS[item]}</option>
            ))}
          </select>
        </Field>
        <fieldset disabled={!licensed || !statesAvailable} className="min-w-0">
          <legend className="text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--body)]">Licensed in</legend>
          <span className="mt-1 block text-[12px] leading-[1.5] text-[var(--muted)]">
            {!statesAvailable
              ? SCHEMA_PENDING_MESSAGE
              : !licensed
                ? role === "setter"
                  ? "A setter books only and is never given a lead that needs a licence."
                  : "This role is not given leads to sell."
                : "Leads are only assigned in these states. Leave empty to use the agency's licences."}
          </span>
          {licensed && statesAvailable && (
            <>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <ToolbarSearch value={stateQuery} onChange={setStateQuery} placeholder="Find a state" />
                <span className="text-[12px] text-[var(--muted)] tabular-nums">{states.size} selected</span>
                {states.size > 0 && (
                  <Button type="button" variant="ghost" onClick={() => setStates(new Set())}>Clear</Button>
                )}
              </div>
              <div className="mt-2 grid max-h-56 grid-cols-2 gap-1.5 overflow-y-auto sm:grid-cols-3">
                {visibleStates.map(([code, name]) => (
                  <label key={code} className="flex min-w-0 items-center gap-2 rounded-[8px] border border-[var(--border)] px-2.5 py-1.5 text-[14px] text-[var(--body)]">
                    <input
                      type="checkbox"
                      className="size-4 shrink-0 accent-[var(--brand-500)]"
                      checked={states.has(code)}
                      onChange={(event) =>
                        setStates((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(code);
                          else next.delete(code);
                          return next;
                        })
                      }
                    />
                    <span className="truncate" title={name}>{name}</span>
                  </label>
                ))}
              </div>
              {states.size > 0 && (
                <div className="mt-3">
                  <span className="block text-[14px] leading-[1.5] font-semibold tracking-[-0.02em] text-[var(--body)]">Licence valid through</span>
                  <span className="block text-[12px] leading-[1.5] text-[var(--muted)]">
                    Optional. After this date they get no leads in that state.
                  </span>
                  <div className="mt-2 grid max-h-44 grid-cols-1 gap-1.5 overflow-y-auto sm:grid-cols-2">
                    {[...states].sort().map((code) => (
                      <label key={code} htmlFor={`manage-expiry-${code}`} className="flex min-w-0 items-center justify-between gap-2 rounded-[8px] border border-[var(--border)] px-2.5 py-1.5 text-[14px] text-[var(--body)]">
                        <span className="truncate" title={stateNames.get(code) ?? code}>{code}</span>
                        <input
                          id={`manage-expiry-${code}`}
                          type="date"
                          className="h-8 rounded-[6px] border border-[var(--border-strong)] bg-[var(--surface)] px-2 text-[14px] text-[var(--body)]"
                          value={expiries[code] ?? ""}
                          aria-label={`${stateNames.get(code) ?? code} licence valid through`}
                          onChange={(event) => setExpiries((current) => ({ ...current, [code]: event.target.value || null }))}
                        />
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </fieldset>
        {invited && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-[var(--border)] px-4 py-3">
            <span className="min-w-0 text-[14px] leading-[1.5] text-[var(--body)]">
              <span className="block font-semibold text-[var(--ink)]">Revoke the invitation</span>
              Frees the seat immediately.
            </span>
            <Button type="button" variant="outline" className="text-[var(--error-ink)]" disabled={revoking} onClick={onRevoke}>
              {revoking ? "Revoking…" : "Revoke invite"}
            </Button>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            type="button"
            onClick={() => {
              const kept = licensed && statesAvailable ? [...states] : initialStates;
              onApply({ role, states: kept, expiries: licensed && statesAvailable ? Object.fromEntries(kept.map((state) => [state, expiries[state] ?? null])) : initialExpiries });
            }}
          >
            Apply
          </Button>
        </div>
      </div>
    </TeamDialog>
  );
}
