"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, MoreHorizontal, TriangleAlert, X } from "lucide-react";

import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { Pill, btn, st } from "@/components/app/settings/primitives";
import { BoardStatGrid, BoardStatTile } from "@/components/admin/board-stat-tile";
import { BoardTableFooter } from "@/components/admin/board-table-footer";
import { DashboardUtcTime } from "@/components/admin/dashboard-utc-time";
import { Button } from "@/components/ui/button";
import { DataToolbar, FilterButton, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { TableCard } from "@/components/ui/table-card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState, ErrorState, NoMatches, SectionLoading } from "@/components/ui/page-states";
import { TENANT_ROLES, TENANT_ROLE_LABELS, type TenantRole } from "@/lib/tenantAuth/roles";
import { USERS_PAGE_SIZE, userStatusLabel, type UserSortColumn } from "@/lib/users/constants";
import type { UserListRow } from "@/lib/users/list";
import { LIFECYCLE_TONES, USER_LIFECYCLES, USER_LIFECYCLE_LABELS } from "@/lib/adminUsersList/lifecycle";
import { EMPTY_FACETS, activeFilterCount, usersListSearchParams, type UsersListFacets } from "@/lib/adminUsersList/query";
import { SORT_OPTIONS, dayCell, loginCell, orderLabel, tileText } from "@/lib/adminUsersList/present";
import type { UsersListRow, UsersListStats } from "@/lib/adminUsersList/types";
import { InviteLinkPanel } from "./invite-link-panel";
import { EditUserDialog } from "./edit-user-dialog";
import { SuspendUserDialog } from "./suspend-user-dialog";
import { DeleteUserDialog } from "./delete-user-dialog";
import { credentialAction } from "@/lib/adminUsers/credential";
import { USERS_LIST_CHANGED_EVENT } from "./users-list-create-user";

/** More than this many distinct IPs in 24h suggests a shared account. */
const SHARED_ACCOUNT_IP_THRESHOLD = 3;

/**
 * The dialogs were written against lib/users/list's row, whose status and role are narrower unions.
 * Same database row, same fields; only the TypeScript spelling differs.
 */
const legacyRow = (row: UsersListRow | null) => row as unknown as (UserListRow & { phone: string | null }) | null;

type Column = { key: UserSortColumn; label: string; width?: string };
const COLUMNS: Column[] = [
  { key: "name", label: "User" },
  { key: "tenant_name", label: "Tenant", width: "w-[200px]" },
  { key: "tenant_role", label: "Role", width: "w-[120px]" },
  { key: "status", label: "Status", width: "w-[150px]" },
  { key: "last_login_at", label: "Last login", width: "w-[150px]" },
];

type Tenant = { id: string; name: string };

export function UsersListTable({
  initialUsers,
  initialTotal,
  initialStats,
  planCodes,
  tenants,
  canManage,
  readAt,
}: {
  initialUsers: UsersListRow[];
  initialTotal: number;
  initialStats: UsersListStats;
  planCodes: string[];
  tenants: Tenant[];
  /** super_admin: the row actions (edit, reset / resend, status changes, delete). */
  canManage: boolean;
  /** Milliseconds since epoch the server read the page at, so both renders print the same dates. */
  readAt: number;
}) {
  const [users, setUsers] = useState(initialUsers);
  const [total, setTotal] = useState(initialTotal);
  const [stats, setStats] = useState(initialStats);
  const [searchInput, setSearchInput] = useState("");
  const [q, setQ] = useState("");
  const [facets, setFacets] = useState<UsersListFacets>(EMPTY_FACETS);
  const [sort, setSort] = useState<UserSortColumn>("created_at");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [issuedLink, setIssuedLink] = useState<{ url: string; expiresAt: string; email: string } | null>(null);
  // Each dialog keeps its row after closing so it can animate out; `…Open` drives visibility.
  const [editing, setEditing] = useState<UsersListRow | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [suspending, setSuspending] = useState<UsersListRow | null>(null);
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [deleting, setDeleting] = useState<UsersListRow | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const isFirstRun = useRef(true);
  const ids = useId();

  // Debounce the search box so typing does not fire a request per keystroke.
  useEffect(() => {
    const next = searchInput.trim();
    if (next === q) return;
    const timer = setTimeout(() => {
      setQ(next);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput, q]);

  // The header's Create user lives in the server page; it tells this island to reload.
  useEffect(() => {
    const reload = () => setRefreshKey((k) => k + 1);
    window.addEventListener(USERS_LIST_CHANGED_EVENT, reload);
    return () => window.removeEventListener(USERS_LIST_CHANGED_EVENT, reload);
  }, []);

  useEffect(() => {
    // The server already rendered page 1 with no filters.
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    // Tiles are platform-wide, so they are re-read only after a write (refreshKey), not per filter.
    const params = usersListSearchParams({ q, facets, sort, dir, page, stats: refreshKey > 0 });
    fetch(`/api/admin/users?${params.toString()}`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((body) => {
        // A slow earlier request must not overwrite a newer one.
        if (cancelled) return;
        setUsers(body.users);
        setTotal(body.total);
        if (body.stats) setStats(body.stats);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [q, facets, sort, dir, page, refreshKey]);

  function setFacet<K extends keyof UsersListFacets>(key: K, value: UsersListFacets[K]) {
    setFacets((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  }

  function clearAll() {
    setSearchInput("");
    setQ("");
    setFacets(EMPTY_FACETS);
    setPage(1);
  }

  function toggleSort(column: UserSortColumn) {
    if (sort === column) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSort(column);
      setDir(column === "last_login_at" || column === "created_at" ? "desc" : "asc");
    }
    setPage(1);
  }

  async function post(user: UsersListRow, path: string) {
    setBusyId(user.id);
    const res = await fetch(`/api/admin/users/${user.id}/${path}`, { method: "POST" });
    const body = await res.json().catch(() => null);
    setBusyId(null);
    return { res, body };
  }

  async function resendInvite(user: UsersListRow) {
    const { res, body } = await post(user, "resend-invite");
    if (!res.ok) return notify.block(body?.error ?? "Could not resend invitation");
    notify.done(`New invitation issued for ${user.email}`);
    setIssuedLink({ url: body.invite.url, expiresAt: body.invite.expiresAt, email: user.email });
  }

  async function sendReset(user: UsersListRow) {
    const { res, body } = await post(user, "send-reset");
    if (!res.ok) return notify.block(body?.error ?? "Could not send reset link");
    notify.done(`Password reset link issued for ${user.email}`);
    setIssuedLink({ url: body.reset.url, expiresAt: body.reset.expiresAt, email: user.email });
  }

  /** activate / deactivate / unsuspend: the transitions that need no extra input. */
  async function changeState(user: UsersListRow, path: "activate" | "deactivate" | "unsuspend", verb: string) {
    const { res, body } = await post(user, path);
    if (!res.ok) return notify.block(body?.error ?? `Could not ${verb} this user`);
    notify.done(`${user.email} ${verb}d`);
    setRefreshKey((k) => k + 1);
  }

  const tiles = tileText(stats);
  const filterCount = activeFilterCount(facets);
  const anythingSet = filterCount > 0 || Boolean(facets.tenant) || searchInput.trim() !== "";
  const colSpan = COLUMNS.length + 1;

  // The filters behind the Filters button show as removable chips once set, so they stay visible
  // with the panel closed. Tenant and status have their own controls in the toolbar.
  const panelCount = filterCount - (facets.state ? 1 : 0);
  const chips: Array<{ key: string; label: string; clear: () => void }> = [];
  if (facets.plan) chips.push({ key: "plan", label: `Plan: ${facets.plan}`, clear: () => setFacet("plan", "") });
  if (facets.role) {
    chips.push({ key: "role", label: `Role: ${TENANT_ROLE_LABELS[facets.role as TenantRole] ?? facets.role}`, clear: () => setFacet("role", "") });
  }
  if (facets.signupFrom || facets.signupTo) {
    chips.push({
      key: "signup",
      label: `Joined: ${facets.signupFrom || "any"} to ${facets.signupTo || "any"}`,
      clear: () => setFacets((prev) => ({ ...prev, signupFrom: "", signupTo: "" })),
    });
  }
  if (facets.lastLoginFrom || facets.lastLoginTo) {
    chips.push({
      key: "login",
      label: `Last login: ${facets.lastLoginFrom || "any"} to ${facets.lastLoginTo || "any"}`,
      clear: () => setFacets((prev) => ({ ...prev, lastLoginFrom: "", lastLoginTo: "" })),
    });
  }

  return (
    <div className="flex w-full min-w-0 flex-col gap-6">
      <BoardStatGrid>
        <BoardStatTile label="Users" value={tiles.users.value} footnote={tiles.users.footnote} title={tiles.users.title} />
        <BoardStatTile
          label="Active"
          value={tiles.active.value}
          footnote={tiles.active.footnote}
          title={tiles.active.title}
          tone={stats.active > 0 ? "success" : "default"}
        />
        <BoardStatTile
          label="Invited"
          value={tiles.invited.value}
          footnote={tiles.invited.footnote}
          title={tiles.invited.title}
          tone={stats.invitedStale > 0 ? "warning" : "default"}
        />
        <BoardStatTile
          label="Suspended"
          value={tiles.suspended.value}
          footnote={tiles.suspended.footnote}
          title={tiles.suspended.title}
          tone={stats.suspended > 0 ? "error" : "default"}
        />
      </BoardStatGrid>

      <TableCard
        toolbar={
          <>
            <DataToolbar
              actions={
                <>
                  {anythingSet && (
                    <Button type="button" variant="ghost" onClick={clearAll}>
                      Clear all
                    </Button>
                  )}
                  <RefreshButton onClick={() => setRefreshKey((k) => k + 1)} refreshing={loading} />
                </>
              }
            >
              <ToolbarSearch value={searchInput} onChange={setSearchInput} placeholder="Search name, email" />
              <select
                aria-label="Tenant"
                value={facets.tenant}
                onChange={(event) => setFacet("tenant", event.target.value)}
                className={cn(toolbarControl, "max-w-[260px] truncate")}
              >
                <option value="">All tenants</option>
                <option value="none">No agency</option>
                {tenants.map((tenant) => (
                  <option key={tenant.id} value={tenant.id}>
                    {tenant.name}
                  </option>
                ))}
              </select>
              <select aria-label="Status" value={facets.state} onChange={(event) => setFacet("state", event.target.value)} className={toolbarControl}>
                <option value="">Any status</option>
                {USER_LIFECYCLES.map((state) => (
                  <option key={state} value={state}>
                    {USER_LIFECYCLE_LABELS[state]}
                  </option>
                ))}
              </select>
              <FilterButton open={filtersOpen} onClick={() => setFiltersOpen((open) => !open)} count={panelCount} />
              {chips.map((chip) => (
                <span
                  key={chip.key}
                  className="inline-flex h-7 items-center gap-2 rounded-full border border-border bg-background pr-1.5 pl-3 text-xs font-semibold text-foreground"
                >
                  {chip.label}
                  <button
                    type="button"
                    aria-label={`Remove ${chip.label}`}
                    onClick={chip.clear}
                    className="inline-flex size-4 cursor-pointer items-center justify-center rounded-full bg-muted text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-2.5" aria-hidden="true" />
                  </button>
                </span>
              ))}
              <span className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
                {total.toLocaleString("en-US")} of {stats.rows.toLocaleString("en-US")} users
              </span>
            </DataToolbar>
            {filtersOpen && (
              <div id={`${ids}-filters`} className="flex w-full flex-wrap items-center gap-2 border-t border-border pt-3">
                <select aria-label="Plan" value={facets.plan} onChange={(event) => setFacet("plan", event.target.value)} className={toolbarControl}>
                  <option value="">Any plan</option>
                  {planCodes.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
                <select aria-label="Role" value={facets.role} onChange={(event) => setFacet("role", event.target.value)} className={toolbarControl}>
                  <option value="">Any role</option>
                  {TENANT_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {TENANT_ROLE_LABELS[role]}
                    </option>
                  ))}
                </select>
                <DateRange
                  id={`${ids}-joined`}
                  label="Joined"
                  from={facets.signupFrom}
                  to={facets.signupTo}
                  onFrom={(v) => setFacet("signupFrom", v)}
                  onTo={(v) => setFacet("signupTo", v)}
                />
                <DateRange
                  id={`${ids}-login`}
                  label="Last login"
                  from={facets.lastLoginFrom}
                  to={facets.lastLoginTo}
                  onFrom={(v) => setFacet("lastLoginFrom", v)}
                  onTo={(v) => setFacet("lastLoginTo", v)}
                />
                <select
                  aria-label="Sort by"
                  value={sort}
                  onChange={(event) => {
                    setSort(event.target.value as UserSortColumn);
                    setPage(1);
                  }}
                  className={toolbarControl}
                >
                  {SORT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      Sort: {option.label}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Direction"
                  value={dir}
                  onChange={(event) => {
                    setDir(event.target.value as "asc" | "desc");
                    setPage(1);
                  }}
                  className={toolbarControl}
                >
                  <option value="desc">Descending</option>
                  <option value="asc">Ascending</option>
                </select>
              </div>
            )}
          </>
        }
      >
        <div className="min-w-0 overflow-x-auto">
          <table className={cn(st.table, "min-w-[860px]")}>
            <thead>
              <tr className={st.headRow}>
                {COLUMNS.map((column) => {
                  const sorted = sort === column.key;
                  return (
                    <th
                      key={column.key}
                      scope="col"
                      aria-sort={sorted ? (dir === "asc" ? "ascending" : "descending") : undefined}
                      className={cn(st.th, column.width)}
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort(column.key)}
                        className="inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 [font:inherit] uppercase text-inherit hover:text-[var(--ink)]"
                        title={`Sort by ${column.label.toLowerCase()}`}
                      >
                        {column.label}
                        {sorted && (dir === "asc" ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden />)}
                      </button>
                    </th>
                  );
                })}
                <th scope="col" className={cn(st.th, "text-right", canManage ? "w-[140px]" : "w-[100px]")}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="m-seq">
              {users.length === 0 && (
                <tr>
                  <td colSpan={colSpan} className="p-0">
                    {/* Loading, a failed read, nothing on the platform and nothing matching are four
                        different facts; each gets its own sentence. */}
                    {loading ? (
                      <SectionLoading rows={5} columns={COLUMNS.length} label="Loading users" />
                    ) : failed ? (
                      <ErrorState
                        detail="The user list could not be read. Nothing was changed."
                        action={
                          <Button type="button" variant="outline" onClick={() => setRefreshKey((k) => k + 1)}>
                            Try again
                          </Button>
                        }
                      />
                    ) : anythingSet ? (
                      <NoMatches noun="users" onClear={clearAll} />
                    ) : (
                      <EmptyState title="No users yet" hint="People appear here when you create one, or when a tenant owner invites someone." />
                    )}
                  </td>
                </tr>
              )}
              {users.map((user) => (
                <tr
                  key={`${user.id}|${user.tenant_id ?? ""}`}
                  className={cn("m-row hover:bg-[var(--brand-50)]", loading && "opacity-60")}
                >
                  <td className={st.td}>
                    <span className="inline-flex items-center gap-2" title={`Joined ${dayCell(user.created_at)}`}>
                      {user.name}
                      {(user.distinct_ips_24h ?? 0) > SHARED_ACCOUNT_IP_THRESHOLD && (
                        <span
                          role="img"
                          aria-label={`Signed in from ${user.distinct_ips_24h} addresses in 24 hours, possibly a shared account`}
                          title={`Successful sign-ins from ${user.distinct_ips_24h} distinct IPs in 24h — possible shared account`}
                          className="text-[var(--warning-ink)]"
                        >
                          <TriangleAlert className="size-4" aria-hidden />
                        </span>
                      )}
                    </span>
                    <span className={st.sub}>{user.email}</span>
                  </td>
                  <td className={st.td}>
                    {user.tenant_name ?? <span className="text-[var(--muted)]">No tenant</span>}
                    {user.tenant_id && <span className={st.sub}>{user.plan_code ?? "No plan yet"}</span>}
                  </td>
                  <td className={st.td}>
                    {user.tenant_role ? TENANT_ROLE_LABELS[user.tenant_role as TenantRole] ?? user.tenant_role : <span className="text-[var(--muted)]">—</span>}
                  </td>
                  <td className={st.td}>
                    <span title={user.lifecycle === "suspended" && user.suspension_reason ? `Reason: ${user.suspension_reason}` : undefined} className="inline-flex">
                      {user.lifecycle ? (
                        <Pill tone={LIFECYCLE_TONES[user.lifecycle]} dot>
                          {USER_LIFECYCLE_LABELS[user.lifecycle]}
                        </Pill>
                      ) : (
                        <Pill tone="neutral" dot>
                          {userStatusLabel(user.status)}
                        </Pill>
                      )}
                    </span>
                  </td>
                  <td className={cn(st.td, "whitespace-nowrap")}>
                    {user.last_login_at ? <DashboardUtcTime iso={user.last_login_at} text={loginCell(user.last_login_at, readAt)} /> : "—"}
                  </td>
                  <td className={cn(st.td, "text-right")}>
                    <span className="inline-flex items-center justify-end gap-2">
                      <Link href={`/admin/users/${user.id}`} className={btn("secondary")}>
                        View
                      </Link>
                      {canManage && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon-sm" disabled={busyId === user.id} aria-label={`Actions for ${user.name}`}>
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onSelect={() => {
                                setEditing(user);
                                setEditOpen(true);
                              }}
                            >
                              Edit user
                            </DropdownMenuItem>
                            {/* Exactly one applies: no password yet, or one to reset. A reset issues a
                                link; nobody here ever sees a password. */}
                            {(() => {
                              // lib/adminUsers/credential.ts: joined → reset, still onboarding → invite,
                              // suspended/deactivated → neither (a consumed reset reactivates the account).
                              const credential = credentialAction({ status: user.status, hasPassword: user.has_password, acceptedMembership: Boolean(user.accepted_at) });
                              if (credential === "reset") return <DropdownMenuItem onSelect={() => sendReset(user)}>Send password reset</DropdownMenuItem>;
                              if (credential === "invite") return <DropdownMenuItem onSelect={() => resendInvite(user)}>Resend invitation</DropdownMenuItem>;
                              return null;
                            })()}
                            <DropdownMenuSeparator />
                            {/* Only the transitions the database allows from the current status, so the
                                menu cannot produce a no-op or a 409. */}
                            {user.status === "active" && (
                              <DropdownMenuItem onSelect={() => changeState(user, "deactivate", "deactivate")}>
                                {/* users.status is account-wide: this signs them out of every agency. */}
                                Deactivate in every agency
                              </DropdownMenuItem>
                            )}
                            {user.status === "inactive" && (
                              <DropdownMenuItem onSelect={() => changeState(user, "activate", "activate")}>Reactivate</DropdownMenuItem>
                            )}
                            {user.status === "suspended" && (
                              <DropdownMenuItem onSelect={() => changeState(user, "unsuspend", "unsuspend")}>Lift suspension</DropdownMenuItem>
                            )}
                            {user.status === "active" && (
                              <DropdownMenuItem
                                variant="destructive"
                                onSelect={() => {
                                  setSuspending(user);
                                  setSuspendOpen(true);
                                }}
                              >
                                Suspend…
                              </DropdownMenuItem>
                            )}
                            {/* Every state, including a pending invitation typed to the wrong address. */}
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={() => {
                                setDeleting(user);
                                setDeleteOpen(true);
                              }}
                            >
                              Delete…
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <BoardTableFooter
          page={page}
          pageSize={USERS_PAGE_SIZE}
          total={total}
          itemLabel="users"
          order={`${orderLabel(sort, dir)} · server-side paging`}
          onPageChange={setPage}
          busy={loading}
        />
      </TableCard>

      {canManage && (
        <>
          {/* Keyed by row id so each dialog remounts with fresh state for a different user. */}
          <EditUserDialog
            key={`edit-${editing?.id ?? "none"}`}
            user={legacyRow(editing)}
            open={editOpen}
            onClose={() => setEditOpen(false)}
            onSaved={() => setRefreshKey((k) => k + 1)}
          />
          <SuspendUserDialog
            key={`suspend-${suspending?.id ?? "none"}`}
            user={legacyRow(suspending)}
            open={suspendOpen}
            onClose={() => setSuspendOpen(false)}
            onSuspended={() => setRefreshKey((k) => k + 1)}
          />
          <DeleteUserDialog
            key={`delete-${deleting?.id ?? "none"}`}
            user={legacyRow(deleting)}
            open={deleteOpen}
            onClose={() => setDeleteOpen(false)}
            onDeleted={() => setRefreshKey((k) => k + 1)}
          />
          <Dialog open={issuedLink !== null} onOpenChange={(open) => !open && setIssuedLink(null)}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>New link issued</DialogTitle>
                <DialogDescription>Any earlier link for {issuedLink?.email} has been revoked and no longer works.</DialogDescription>
              </DialogHeader>
              {issuedLink && <InviteLinkPanel url={issuedLink.url} expiresAt={issuedLink.expiresAt} />}
              <DialogFooter>
                <Button type="button" onClick={() => setIssuedLink(null)}>
                  Done
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}

function DateRange({
  id,
  label,
  from,
  to,
  onFrom,
  onTo,
}: {
  id: string;
  label: string;
  from: string;
  to: string;
  onFrom: (value: string) => void;
  onTo: (value: string) => void;
}) {
  return (
    <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
      <legend className="sr-only">{label} (UTC)</legend>
      <span className="flex items-center gap-2 text-xs text-muted-foreground">
        {label}
        <label htmlFor={`${id}-from`} className="sr-only">
          {label} from
        </label>
        <input id={`${id}-from`} type="date" value={from} onChange={(event) => onFrom(event.target.value)} className={toolbarControl} />
        <span>to</span>
        <label htmlFor={`${id}-to`} className="sr-only">
          {label} to
        </label>
        <input id={`${id}-to`} type="date" value={to} onChange={(event) => onTo(event.target.value)} className={toolbarControl} />
      </span>
    </fieldset>
  );
}
