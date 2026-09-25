"use client";

import { useMemo, useState, type FormEvent } from "react";
import { notify } from "@/lib/notify";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Callout,
  DraftActions,
  Field,
  Pill,
  SearchBox,
  SettingsCard,
  SettingsMeter,
  SettingsSectionHeader,
  SettingsStack,
  SettingsTableCard,
  TableToolbar,
  btn,
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

/**
 * "What each role can reach", read off the real guards rather than the board's sample copy:
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

const NUMBER_WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const inWords = (count: number) => NUMBER_WORDS[count] ?? String(count);

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
  const [roleFilter, setRoleFilter] = useState<Set<TenantRole>>(new Set());
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set());
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
      if (roleFilter.size && !roleFilter.has(pending[member.id]?.role ?? member.role)) return false;
      if (statusFilter.size) {
        const status = statusOf(member, now);
        if (!statusFilter.has(status === "expired" ? "invited" : status)) return false;
      }
      return true;
    });
  }, [snapshot.members, query, roleFilter, statusFilter, pending, now]);

  const seats = snapshot.seats;
  const pendingInvites = snapshot.members.filter((member) => !member.acceptedAt).length;
  const atSeatLimit = seats.max !== null && seats.used >= seats.max;
  const bufferAtLimit = snapshot.bufferSeats.max !== null && snapshot.bufferSeats.used >= snapshot.bufferSeats.max;
  const filterCount = roleFilter.size + statusFilter.size;
  const planName = workspace?.planName ?? "Your plan";
  const outbound = snapshot.outboundLimits?.filter((item) => ["max_setter_seats", "max_active_campaigns"].includes(item.key)) ?? [];

  return (
    <SettingsStack>
      <SettingsSectionHeader
        actions={<DraftActions dirty={dirty} saving={saving} onDiscard={() => { setPending({}); setError(""); }} onSave={() => void saveChanges()} />}
      />

      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="flex min-w-0 grow flex-col gap-6">
          {atSeatLimit ? (
            <Callout tone="warning" title="Your plan has reached its seat limit">
              {planName} includes {seats.max} seat{seats.max === 1 ? "" : "s"} and {seats.used} {seats.used === 1 ? "is" : "are"} in use
              {pendingInvites > 0 ? `, ${inWords(pendingInvites)} of them pending invite${pendingInvites === 1 ? "" : "s"}` : ""}. An invite that is
              never accepted still holds a seat &mdash; revoke it, or upgrade the plan, before inviting anyone else.
            </Callout>
          ) : (
            <p className="m-0 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--muted)]">
              Invite teammates and control what each person can see. Role changes apply on their next request. An invite that is never accepted still holds a seat until it is revoked.
            </p>
          )}
        </div>
        <div className="flex w-full shrink-0 flex-col gap-3 lg:w-[300px]">
          {seats.max !== null ? (
            <SettingsMeter
              value={seats.used}
              max={seats.max}
              tone={atSeatLimit ? "warning" : "primary"}
              ariaLabel={`${seats.used} of ${seats.max} seats used`}
              caption={`${seats.used} of ${seats.max} seats used${pendingInvites ? ` · ${pendingInvites} pending` : ""}`}
            />
          ) : (
            <p className="m-0 text-[12px] leading-[1.5] text-[var(--muted)] tabular-nums">{seats.used} seats used · unlimited seats</p>
          )}
          <dl className="m-0 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)] tabular-nums">
            <dt>Buffer seats</dt>
            <dd className={cn("m-0 text-right", bufferAtLimit && "text-[var(--warning-ink)]")}>
              {snapshot.bufferSeats.max === null ? `${snapshot.bufferSeats.used} used · unlimited` : `${snapshot.bufferSeats.used} of ${snapshot.bufferSeats.max}`}
            </dd>
            {outbound.map((item) => (
              <FragmentRow key={item.key} label={item.label} value={item.limit === null ? `${item.usage} used · unlimited` : `${item.usage} of ${item.limit}`} />
            ))}
            <dt className="col-span-2 mt-1">
              {TENANT_ROLES.map((role) => `${TENANT_ROLE_LABELS[role]} ${seats.byRole[role]}`).join(" · ")}
            </dt>
          </dl>
        </div>
      </div>

      <SettingsTableCard
        title="People"
        actions={
          <TableToolbar>
            <SearchBox value={query} onChange={setQuery} placeholder="Search people" label="Search people" />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className={cn(btn("secondary"), "h-10 px-3.5")}>
                  <svg aria-hidden width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                    <path d="M4 6h16M7 12h10M10 18h4" />
                  </svg>
                  Filters
                  {filterCount > 0 && (
                    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--surface-alt)] px-1.5 text-[12px] font-semibold tabular-nums text-[var(--ink)]">
                      {filterCount}
                    </span>
                  )}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Access</DropdownMenuLabel>
                {TENANT_ROLES.map((role) => (
                  <DropdownMenuCheckboxItem
                    key={role}
                    checked={roleFilter.has(role)}
                    onSelect={(event) => event.preventDefault()}
                    onCheckedChange={(checked) =>
                      setRoleFilter((current) => {
                        const next = new Set(current);
                        if (checked) next.add(role);
                        else next.delete(role);
                        return next;
                      })
                    }
                  >
                    {TENANT_ROLE_LABELS[role]}
                  </DropdownMenuCheckboxItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Status</DropdownMenuLabel>
                {STATUS_FILTERS.map((status) => (
                  <DropdownMenuCheckboxItem
                    key={status.key}
                    checked={statusFilter.has(status.key)}
                    onSelect={(event) => event.preventDefault()}
                    onCheckedChange={(checked) =>
                      setStatusFilter((current) => {
                        const next = new Set(current);
                        if (checked) next.add(status.key);
                        else next.delete(status.key);
                        return next;
                      })
                    }
                  >
                    {status.label}
                  </DropdownMenuCheckboxItem>
                ))}
                {filterCount > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => { setRoleFilter(new Set()); setStatusFilter(new Set()); }}>Clear filters</DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <span className="grow" />
            <button type="button" className={btn("primary")} onClick={() => setInviteOpen(true)}>
              Invite someone
            </button>
          </TableToolbar>
        }
      >
        {error && (
          <p role="alert" className="border-b border-[var(--border)] bg-[var(--error-surface)] px-4 py-2.5 text-[14px] leading-[1.5] text-[var(--error-ink)]">
            {error}
          </p>
        )}
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
                      <button type="button" className={btn("row")} disabled={rowBusy === member.id} onClick={() => void resend(member)} aria-label={`Resend invitation to ${member.name}`}>
                        {rowBusy === member.id ? "Sending…" : "Resend"}
                      </button>
                    ) : member.id === viewerId ? (
                      <span className="text-[var(--muted)]" title="This is you. Select your name to change your own licensed states.">&mdash;</span>
                    ) : (
                      <button type="button" className={btn("row")} onClick={() => setManaging(member)} aria-label={`Manage ${member.name}`}>
                        Manage
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className={cn(st.td, "text-[var(--muted)]")}>
                  {snapshot.members.length === 0 ? "No one is on this workspace yet." : "No one matches these filters."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </SettingsTableCard>

      <SettingsCard title="What each role can reach" sub="Roles are not a hierarchy. A bookkeeper sees money an agent cannot; an agent sees calls a bookkeeper cannot.">
        <div className="overflow-x-auto">
          <table className={cn(st.table, "min-w-[640px]")}>
            <thead>
              <tr className={st.headRow}>
                <th scope="col" className={cn(st.th, "w-[150px]")}>Role</th>
                <th scope="col" className={st.th}>Leads &amp; dialing</th>
                <th scope="col" className={cn(st.th, "w-[240px]")}>Book &amp; money</th>
                <th scope="col" className={cn(st.th, "w-[190px]")}>Settings</th>
              </tr>
            </thead>
            <tbody>
              {ROLE_REACH.map((row) => (
                <tr key={row.role}>
                  <th scope="row" className={cn(st.td, "text-left font-normal")}>{TENANT_ROLE_LABELS[row.role]}</th>
                  <td className={st.td}>{row.leads}</td>
                  <td className={st.td}>{row.money}</td>
                  <td className={st.td}>{row.settings}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SettingsCard>

      {inviteOpen && (
        <InviteDialog
          onClose={() => setInviteOpen(false)}
          bufferAtLimit={bufferAtLimit}
          bufferSeats={snapshot.bufferSeats}
          atSeatLimit={atSeatLimit}
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

function FragmentRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd className="m-0 text-right">{value}</dd>
    </>
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
}: {
  onClose: () => void;
  onInvited: () => Promise<void>;
  bufferAtLimit: boolean;
  bufferSeats: TeamSnapshot["bufferSeats"];
  atSeatLimit: boolean;
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
    <TeamDialog title="Invite someone" description="They get an email with a link to choose a password. The invite holds a seat until it is accepted or revoked." onClose={onClose}>
      {atSeatLimit && (
        <Callout tone="warning" title="Every seat is in use">
          This invite will be refused until a seat is freed or the plan is upgraded.
        </Callout>
      )}
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => void invite(event)}>
        <Field label="Name" htmlFor="team-name" required>
          <input id="team-name" className={control} value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required />
        </Field>
        <Field label="Email" htmlFor="team-email" required>
          <input id="team-email" type="email" className={control} value={email} onChange={(event) => setEmail(event.target.value)} maxLength={254} required />
        </Field>
        <Field label="Role" htmlFor="team-role" className="sm:col-span-2">
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
        {error && (
          <p role="alert" className="text-[14px] text-[var(--error-ink)] sm:col-span-2">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2.5 sm:col-span-2">
          <button type="button" className={btn("ghost")} onClick={onClose}>Cancel</button>
          <button type="submit" className={btn("primary")} disabled={busy || (role === "assistant" && bufferAtLimit)}>
            {busy ? "Inviting…" : "Invite teammate"}
          </button>
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
    <TeamDialog title={`Manage ${member.name}`} description="Changes are held until you press Save changes at the top of the section." onClose={onClose}>
      <div className="grid gap-4">
        <Field label="Access" htmlFor="manage-role" hint={role === "owner" ? "Owners reach everything, including settings and billing." : undefined}>
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
                : "Once any state is recorded, lead assignment only gives this person leads in those states (and only where the agency is licensed and appointed). Leave empty to judge them on the agency's licences."}
          </span>
          {licensed && statesAvailable && (
            <>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <SearchBox value={stateQuery} onChange={setStateQuery} placeholder="Find a state" label="Find a state" />
                <span className="text-[12px] text-[var(--muted)] tabular-nums">{states.size} selected</span>
                {states.size > 0 && (
                  <button type="button" className={btn("row")} onClick={() => setStates(new Set())}>Clear</button>
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
                    Optional. From the day after, this person is not handed or served leads in that state, and their open leads there go back to the pool (never mid-call or with a booked callback). Lead assignment warns 30 days ahead.
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
              The link stops working and the seat it holds is freed. This happens now, not on Save.
            </span>
            <button type="button" className={btn("danger-row")} disabled={revoking} onClick={onRevoke}>
              {revoking ? "Revoking…" : "Revoke invite"}
            </button>
          </div>
        )}
        <div className="flex justify-end gap-2.5">
          <button type="button" className={btn("ghost")} onClick={onClose}>Cancel</button>
          <button
            type="button"
            className={btn("primary")}
            onClick={() => {
              const kept = licensed && statesAvailable ? [...states] : initialStates;
              onApply({ role, states: kept, expiries: licensed && statesAvailable ? Object.fromEntries(kept.map((state) => [state, expiries[state] ?? null])) : initialExpiries });
            }}
          >
            Apply
          </button>
        </div>
      </div>
    </TeamDialog>
  );
}
