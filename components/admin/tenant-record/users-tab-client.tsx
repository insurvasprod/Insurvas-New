"use client";

import { useId, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { Callout, Pill, SearchBox, SettingsCard, SettingsTableCard, TableToolbar, btn, st, type PillTone } from "@/components/app/settings/primitives";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TENANT_ROLES, TENANT_ROLE_LABELS, type TenantRole } from "@/lib/tenantAuth/roles";
import { lastSeenLabel, memberState, seatCallout } from "@/lib/adminTenantUsers/present";
import type { AdminTenantMember, AdminTenantUsers } from "@/lib/adminTenantUsers/types";

export type TenantUsersCan = {
  /** super_admin: revoke one invite, revoke the expired ones. */
  revoke: boolean;
  /** super_admin: download the people CSV. */
  export: boolean;
  /** super_admin, billing_admin: the plan change lives on Subscription & billing. */
  changePlan: boolean;
  /** Roles that can open /admin/users/[id]. */
  openUser: boolean;
};

type StateFilter = "all" | "active" | "invited" | "suspended" | "none";
const STATE_FILTERS: { value: StateFilter; label: string }[] = [
  { value: "all", label: "Every state" },
  { value: "active", label: "Active" },
  { value: "invited", label: "Invited" },
  { value: "suspended", label: "Suspended" },
  { value: "none", label: "Holds no seat (deactivated, deleted)" },
];

const ROLE_TONE = (role: TenantRole): PillTone => (role === "owner" ? "brand" : "neutral");

/** Users & seats: the seat callout and meter, the people table, and the offboarding note. */
export function TenantUsersPanel({ tenantId, data, can }: { tenantId: string; data: AdminTenantUsers; can: TenantUsersCan }) {
  const router = useRouter();
  const { seats, members, readAt } = data;
  const callout = seatCallout(seats);
  const stale = members.filter((member) => member.stale);

  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState<StateFilter>("all");
  const [roleFilter, setRoleFilter] = useState<TenantRole | "all">("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [revoking, setRevoking] = useState<AdminTenantMember | null>(null);
  const [staleOpen, setStaleOpen] = useState(false);
  const filtersId = useId();

  const activeFilters = (stateFilter === "all" ? 0 : 1) + (roleFilter === "all" ? 0 : 1);
  const rows = useMemo(() => {
    const term = query.trim().toLowerCase();
    return members.filter((member) => {
      if (term && !member.name.toLowerCase().includes(term) && !member.email.toLowerCase().includes(term)) return false;
      if (roleFilter !== "all" && member.role !== roleFilter) return false;
      if (stateFilter === "none") return member.seat === null;
      if (stateFilter !== "all") return member.seat === stateFilter;
      return true;
    });
  }, [members, query, roleFilter, stateFilter]);

  const over = seats.max !== null && seats.held > seats.max;
  const full = seats.max !== null && seats.held >= seats.max;
  const fill = over ? "bg-[var(--error)]" : full ? "bg-[var(--warning)]" : "bg-[var(--primary)]";
  const pct = seats.max ? Math.min(100, (seats.held / seats.max) * 100) : 0;
  const breakdown = [`${seats.active} active`, seats.suspended ? `${seats.suspended} suspended` : null, `${seats.invited} invited`].filter(Boolean).join(" · ");

  return (
    <div className="m-stagger flex w-full min-w-0 flex-col gap-6" data-tenant-tab="users">
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Callout tone={callout.tone} title={callout.title}>
          <p className="m-0">{callout.body}</p>
        </Callout>

        <SettingsCard pad={20}>
          <div className="flex flex-col gap-2.5">
            <div className="flex justify-between gap-3 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--body)]">
              <span>Seats used</span>
              <span className="font-semibold tabular-nums">{seats.max === null ? `${seats.held} · no limit` : `${seats.held} of ${seats.max}`}</span>
            </div>
            <span className="block w-full">
              {seats.max !== null && (
                <span
                  role="meter"
                  aria-label="Seats used"
                  aria-valuenow={seats.held}
                  aria-valuemin={0}
                  aria-valuemax={seats.max}
                  className="m-meter block h-1.5 overflow-hidden rounded-full bg-[var(--surface-sunken)]"
                >
                  <span className={cn("block h-1.5 rounded-full", fill)} style={{ width: `${pct}%` }} />
                </span>
              )}
              <span className="mt-1 block text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)] tabular-nums">{breakdown}</span>
            </span>
            {(can.changePlan || can.revoke) && (
              <div className="flex flex-wrap items-center gap-2.5">
                {can.changePlan && (
                  // No per-seat selling: seats come with the plan, so this is the plan change.
                  <Link href={`/admin/tenants/${tenantId}?tab=subscription`} className={btn("primary", "h-[38px]")}>
                    Add seats
                  </Link>
                )}
                {can.revoke && (
                  <>
                    <button
                      type="button"
                      className={btn("secondary", "h-[38px]")}
                      disabled={stale.length === 0}
                      aria-describedby={stale.length === 0 ? `${filtersId}-stale-none` : undefined}
                      onClick={() => setStaleOpen(true)}
                    >
                      Revoke stale invites
                    </button>
                    {stale.length === 0 && (
                      <span id={`${filtersId}-stale-none`} className="text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">
                        No invitation has expired.
                      </span>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </SettingsCard>
      </div>

      <SettingsTableCard
        title="People"
        actions={
          <TableToolbar>
            <SearchBox value={query} onChange={setQuery} placeholder="Search this tenant" label="Search this tenant's people" />
            <button
              type="button"
              aria-expanded={filtersOpen}
              aria-controls={filtersId}
              onClick={() => setFiltersOpen((open) => !open)}
              className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface)] px-3.5 text-[14px] leading-[1.43] font-semibold tracking-[-0.01em] text-[var(--ink)] hover:bg-[var(--surface-alt)]"
            >
              <svg aria-hidden width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                <path d="M4 6h16M7 12h10M10 18h4" />
              </svg>
              Filters
              {activeFilters > 0 && (
                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--surface-alt)] px-1.5 text-[12px] leading-[1.5] font-semibold tracking-[-0.01em] text-[var(--ink)]">
                  {activeFilters}
                </span>
              )}
            </button>
            <span className="grow" />
            {can.export && (
              <a href={`/api/admin/tenants/${tenantId}/users/export`} download className={btn("secondary", "h-10")}>
                Export
              </a>
            )}
          </TableToolbar>
        }
      >
        {filtersOpen && (
          <div id={filtersId} className="flex flex-wrap items-end gap-4 border-b border-[var(--border)] px-4 py-3">
            <FilterSelect id={`${filtersId}-state`} label="State" value={stateFilter} onChange={(v) => setStateFilter(v as StateFilter)} options={STATE_FILTERS} />
            <FilterSelect
              id={`${filtersId}-role`}
              label="Role"
              value={roleFilter}
              onChange={(v) => setRoleFilter(v as TenantRole | "all")}
              options={[{ value: "all", label: "Every role" }, ...TENANT_ROLES.map((role) => ({ value: role, label: TENANT_ROLE_LABELS[role] }))]}
            />
            {activeFilters > 0 && (
              <button type="button" className={btn("row")} onClick={() => { setStateFilter("all"); setRoleFilter("all"); }}>
                Clear filters
              </button>
            )}
          </div>
        )}
        <table className={st.table}>
          <thead>
            <tr className={st.headRow}>
              <th scope="col" className={st.th}>Person</th>
              <th scope="col" className={cn(st.th, "w-[150px]")}>Role</th>
              <th scope="col" className={cn(st.th, "w-[150px]")}>State</th>
              <th scope="col" className={cn(st.th, "w-[160px]")}>Last seen</th>
              <th scope="col" className={cn(st.th, "w-[150px]")}>Sign-ins (30d)</th>
              <th scope="col" className={cn(st.th, "w-[120px]")}><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="m-seq">
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className={cn(st.td, "py-6 text-center text-[var(--muted)]")}>
                  {members.length === 0 ? "Nobody belongs to this tenant yet." : "Nobody here matches this search and these filters."}
                </td>
              </tr>
            )}
            {rows.map((member) => {
              const state = memberState(member);
              return (
                <tr key={member.id} className="m-row">
                  <td className={st.td}>
                    {can.openUser ? (
                      <Link href={`/admin/users/${member.id}`} className="text-inherit hover:underline">{member.name}</Link>
                    ) : (
                      member.name
                    )}
                    <br />
                    <span className="text-[12px] text-[var(--muted)]">{member.email}</span>
                  </td>
                  <td className={st.td}>
                    <Pill tone={ROLE_TONE(member.role)}>{TENANT_ROLE_LABELS[member.role] ?? member.role}</Pill>
                  </td>
                  <td className={st.td}>
                    <Pill tone={state.tone}>{state.label}</Pill>
                    {state.note && <span className={st.sub}>{state.note}</span>}
                  </td>
                  <td className={cn(st.td, "tabular-nums")}>{lastSeenLabel(member, readAt)}</td>
                  <td className={cn(st.td, "tabular-nums")}>
                    {member.signIns30d === null ? <span title="Needs a database update that has not been applied yet">—</span> : member.signIns30d}
                  </td>
                  <td className={st.td}>
                    {member.revocable && can.revoke ? (
                      <button type="button" className={btn("row", "px-4")} onClick={() => setRevoking(member)}>
                        Revoke
                      </button>
                    ) : can.openUser ? (
                      <Link href={`/admin/users/${member.id}`} className={btn("row", "px-4")}>
                        Open
                      </Link>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </SettingsTableCard>

      <Callout tone="error" title="Offboarding never deletes">
        <p className="m-0">
          Deactivating a person removes their access and frees the seat. Their calls, notes, dispositions and policies stay
          exactly where they are, attributed to them, because a book of business with a missing agent is not an audit trail.
          Deactivation is account-wide: it signs the person out of every agency they belong to, not only this one. Revoking an
          invite that was never accepted is not offboarding: it removes the invite, and the unused account it created, because
          there is no work to keep.
        </p>
      </Callout>

      {can.revoke && (
        <>
          <RevokeInviteDialog tenantId={tenantId} member={revoking} onClose={() => setRevoking(null)} onDone={() => router.refresh()} />
          <RevokeStaleDialog tenantId={tenantId} stale={stale} open={staleOpen} onClose={() => setStaleOpen(false)} onDone={() => router.refresh()} />
        </>
      )}
    </div>
  );
}

function FilterSelect({ id, label, value, onChange, options }: { id: string; label: string; value: string; onChange: (value: string) => void; options: { value: string; label: string }[] }) {
  return (
    <span className="flex min-w-[200px] flex-col gap-1">
      <label htmlFor={id} className="text-[12px] leading-[1.33] font-semibold tracking-[0.02em] uppercase text-[var(--muted)]">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 rounded-[8px] border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-[14px] tracking-[-0.02em] text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </span>
  );
}

function RevokeInviteDialog({ tenantId, member, onClose, onDone }: { tenantId: string; member: AdminTenantMember | null; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);

  async function revoke() {
    if (!member) return;
    setBusy(true);
    const res = await fetch(`/api/admin/tenants/${tenantId}/invites/${member.id}`, { method: "DELETE" });
    const body = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) {
      notify.block(body?.error ?? "Could not revoke this invitation");
      return;
    }
    notify.done(`Invitation to ${member.email} revoked`);
    onClose();
    onDone();
  }

  return (
    <Dialog open={member !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Revoke {member?.name}&apos;s invitation</DialogTitle>
          <DialogDescription>
            The invitation to {member?.email} stops working and the seat it holds is freed. If the account it created belongs to no
            other agency, it is removed too. Recorded in the audit log.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Keep it
          </Button>
          <Button type="button" variant="destructive" onClick={revoke} disabled={busy}>
            {busy ? "Revoking…" : "Revoke invitation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RevokeStaleDialog({ tenantId, stale, open, onClose, onDone }: { tenantId: string; stale: AdminTenantMember[]; open: boolean; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const count = stale.length;
  const shown = stale.slice(0, 5);

  async function revokeAll() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/admin/tenants/${tenantId}/stale-invites`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expected: count }),
    });
    const body = await res.json().catch(() => null);
    setBusy(false);
    if (res.status === 409) {
      // The set changed since this page was read: show the new count, refresh, and let them confirm again.
      setError(body?.error ?? "The expired invitations changed. Look again and confirm.");
      onDone();
      return;
    }
    if (!res.ok || body?.ok === false) {
      setError(body?.error ?? "Could not revoke the expired invitations");
      onDone();
      return;
    }
    notify.done(`${body.revoked} expired invitation${body.revoked === 1 ? "" : "s"} revoked`);
    onClose();
    onDone();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) return;
        setError(null);
        onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Revoke {count} expired invitation{count === 1 ? "" : "s"}
          </DialogTitle>
          <DialogDescription>
            {count === 1 ? "This invitation has" : `These ${count} invitations have`} expired without being accepted. Revoking frees the
            seat{count === 1 ? "" : "s"} they hold and removes any account that belongs to no other agency. Each one is recorded in the
            audit log.
          </DialogDescription>
        </DialogHeader>
        <ul className="m-0 list-none space-y-1 p-0 text-[14px] leading-[1.5] text-[var(--body)]">
          {shown.map((member) => (
            <li key={member.id}>
              {member.name} <span className="text-[12px] text-[var(--muted)]">{member.email}</span>
            </li>
          ))}
          {count > shown.length && <li className="text-[12px] text-[var(--muted)]">and {count - shown.length} more</li>}
        </ul>
        {error && (
          <p role="alert" className="m-0 text-[14px] leading-[1.5] text-[var(--error-ink)]">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={revokeAll} disabled={busy || count === 0}>
            {busy ? "Revoking…" : `Revoke ${count}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
