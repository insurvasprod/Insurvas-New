"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, ChevronsUpDown, MoreHorizontal, Search, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TENANT_ROLE_LABELS, type TenantRole } from "@/lib/tenantAuth/roles";
import {
  USERS_PAGE_SIZE,
  USER_STATUSES,
  USER_STATUS_LABELS,
  type UserSortColumn,
} from "@/lib/users/constants";
import type { UserListRow, UserStats } from "@/lib/users/list";
import { relativeTime } from "@/lib/relativeTime";
import { PaginationBar } from "./pagination-bar";
import { UserStatStrip } from "./user-stat-strip";
import { tableHeaderRow, tableHeadCell, tableShell } from "./table-styles";
import { CreateUserDialog, type TenantOption } from "./create-user-dialog";
import { InviteLinkPanel } from "./invite-link-panel";
import { EditUserDialog } from "./edit-user-dialog";
import { SuspendUserDialog } from "./suspend-user-dialog";
import { StatusChip, accountTone } from "@/components/admin/status-chip";

const COLUMNS: { key: UserSortColumn; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "email", label: "Email" },
  { key: "tenant_name", label: "Tenant" },
  { key: "tenant_role", label: "Role" },
  { key: "plan_code", label: "Plan" },
  { key: "status", label: "Status" },
  { key: "last_login_at", label: "Last login" },
  { key: "created_at", label: "Created" },
];

/** More than this many distinct IPs in 24h suggests a shared account (SA-1.5). */
const SHARED_ACCOUNT_IP_THRESHOLD = 3;

type Filters = {
  status: string;
  plan: string;
  signupFrom: string;
  signupTo: string;
  lastLoginFrom: string;
  lastLoginTo: string;
};

const EMPTY_FILTERS: Filters = {
  status: "all",
  plan: "all",
  signupFrom: "",
  signupTo: "",
  lastLoginFrom: "",
  lastLoginTo: "",
};

export function UsersTable({
  initialUsers,
  initialTotal,
  initialStats,
  planCodes,
  tenants,
  canCreate,
}: {
  initialUsers: UserListRow[];
  initialTotal: number;
  initialStats: UserStats;
  planCodes: string[];
  tenants: TenantOption[];
  canCreate: boolean;
}) {
  const [users, setUsers] = useState(initialUsers);
  const [total, setTotal] = useState(initialTotal);
  const [stats, setStats] = useState(initialStats);
  const [searchInput, setSearchInput] = useState("");
  const [q, setQ] = useState("");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<UserSortColumn>("created_at");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [resentInvite, setResentInvite] = useState<{ url: string; expiresAt: string; email: string } | null>(null);
  // `editing` holds the row and outlives the close, so the dialog still has content to render
  // while it animates out; `editOpen` drives visibility. Keeping the row (and therefore the
  // dialog's key) stable during close is what preserves the exit animation.
  const [editing, setEditing] = useState<UserListRow | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [suspending, setSuspending] = useState<UserListRow | null>(null);
  const [suspendOpen, setSuspendOpen] = useState(false);
  const isFirstRun = useRef(true);
  const isFirstStatsRun = useRef(true);

  // Debounce the search box so typing doesn't fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    // The server already rendered page 1 with no filters — don't immediately refetch it.
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }

    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (filters.status !== "all") params.set("status", filters.status);
    if (filters.plan !== "all") params.set("plan", filters.plan);
    if (filters.signupFrom) params.set("signupFrom", filters.signupFrom);
    if (filters.signupTo) params.set("signupTo", filters.signupTo);
    if (filters.lastLoginFrom) params.set("lastLoginFrom", filters.lastLoginFrom);
    if (filters.lastLoginTo) params.set("lastLoginTo", filters.lastLoginTo);
    params.set("sort", sort);
    params.set("dir", dir);
    params.set("page", String(page));

    let cancelled = false;
    setLoading(true);

    fetch(`/api/admin/users?${params.toString()}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        // A slow earlier request must not overwrite a newer one's results.
        if (cancelled || !body) return;
        setUsers(body.users);
        setTotal(body.total);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [q, filters, sort, dir, page, refreshKey]);

  // The counter strip reflects the whole platform, so it only changes when the underlying data
  // does — refresh it alongside filtering rather than recomputing it from the loaded page.
  useEffect(() => {
    // Needs its own guard: the list effect above has already flipped its ref by the time this runs.
    if (isFirstStatsRun.current) {
      isFirstStatsRun.current = false;
      return;
    }
    fetch("/api/admin/users/stats")
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => body && setStats(body.stats));
  }, [q, filters, refreshKey]);

  async function resendInvite(user: UserListRow) {
    setResendingId(user.id);
    const res = await fetch(`/api/admin/users/${user.id}/resend-invite`, { method: "POST" });
    const body = await res.json().catch(() => null);
    setResendingId(null);

    if (!res.ok) {
      toast.error(body?.error ?? "Could not resend invitation");
      return;
    }

    toast.success(`New invitation issued for ${user.email}`);
    setResentInvite({ url: body.invite.url, expiresAt: body.invite.expiresAt, email: user.email });
  }

  /** activate / deactivate / unsuspend — the transitions that need no extra input. */
  async function changeState(user: UserListRow, path: "activate" | "deactivate" | "unsuspend", label: string) {
    setResendingId(user.id);
    const res = await fetch(`/api/admin/users/${user.id}/${path}`, { method: "POST" });
    const body = await res.json().catch(() => null);
    setResendingId(null);

    if (!res.ok) {
      toast.error(body?.error ?? `Could not ${label} this user`);
      return;
    }

    toast.success(`${user.email} ${label}d`);
    setRefreshKey((k) => k + 1);
  }

  async function sendReset(user: UserListRow) {
    setResendingId(user.id);
    const res = await fetch(`/api/admin/users/${user.id}/send-reset`, { method: "POST" });
    const body = await res.json().catch(() => null);
    setResendingId(null);

    if (!res.ok) {
      toast.error(body?.error ?? "Could not send reset link");
      return;
    }

    toast.success(`Password reset link issued for ${user.email}`);
    setResentInvite({ url: body.reset.url, expiresAt: body.reset.expiresAt, email: user.email });
  }

  function updateFilter<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(1);
  }

  function toggleSort(column: UserSortColumn) {
    if (sort === column) {
      setDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSort(column);
      setDir("asc");
    }
    setPage(1);
  }

  return (
    <div className="space-y-6">
      <UserStatStrip stats={stats} />

      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[240px] flex-1">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search name or email…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="pl-8"
            />
          </div>

          <Select value={filters.status} onValueChange={(v) => updateFilter("status", v)}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {USER_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {USER_STATUS_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filters.plan} onValueChange={(v) => updateFilter("plan", v)}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Plan" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All plans</SelectItem>
              {planCodes.map((code) => (
                <SelectItem key={code} value={code}>
                  {code}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {canCreate && (
            <div className="ml-auto">
              <CreateUserDialog tenants={tenants} onCreated={() => setRefreshKey((k) => k + 1)} />
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
          <span className="font-medium text-muted-foreground">Signed up</span>
          <DateInput
            value={filters.signupFrom}
            onChange={(v) => updateFilter("signupFrom", v)}
            label="Signed up from"
          />
          <span className="text-muted-foreground">to</span>
          <DateInput value={filters.signupTo} onChange={(v) => updateFilter("signupTo", v)} label="Signed up to" />

          <span className="ml-4 font-medium text-muted-foreground">Last login</span>
          <DateInput
            value={filters.lastLoginFrom}
            onChange={(v) => updateFilter("lastLoginFrom", v)}
            label="Last login from"
          />
          <span className="text-muted-foreground">to</span>
          <DateInput
            value={filters.lastLoginTo}
            onChange={(v) => updateFilter("lastLoginTo", v)}
            label="Last login to"
          />
        </div>

        <div className={tableShell}>
          <Table>
            <TableHeader>
              <TableRow className={tableHeaderRow}>
                {COLUMNS.map((col) => (
                  <TableHead key={col.key} className={tableHeadCell}>
                    <button
                      type="button"
                      onClick={() => toggleSort(col.key)}
                      className="flex items-center gap-1 uppercase transition-opacity hover:opacity-80"
                    >
                      {col.label}
                      {sort === col.key ? (
                        dir === "asc" ? (
                          <ArrowUp className="size-3" />
                        ) : (
                          <ArrowDown className="size-3" />
                        )
                      ) : (
                        <ChevronsUpDown className="size-3 opacity-40" />
                      )}
                    </button>
                  </TableHead>
                ))}
                {canCreate && <TableHead className={`${tableHeadCell} w-10`} />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.length === 0 && (
                <TableRow>
                  <TableCell colSpan={COLUMNS.length + (canCreate ? 1 : 0)} className="h-24 text-center text-muted-foreground">
                    {loading ? "Loading…" : "No users match these filters."}
                  </TableCell>
                </TableRow>
              )}
              {users.map((user) => (
                <TableRow key={user.id} className={loading ? "opacity-60" : undefined}>
                  <TableCell className="font-medium">
                    <span className="flex items-center gap-2">
                      <Link href={`/admin/users/${user.id}`} className="hover:underline">
                        {user.name}
                      </Link>
                      {(user.distinct_ips_24h ?? 0) > SHARED_ACCOUNT_IP_THRESHOLD && (
                        <span
                          title={`Successful logins from ${user.distinct_ips_24h} distinct IPs in 24h — possible shared account`}
                          className="text-[var(--color-warning)]"
                        >
                          <TriangleAlert className="size-4" />
                        </span>
                      )}
                      {!user.has_password && (
                        <Badge
                          variant="outline"
                          className="border-transparent bg-[var(--color-warning)]/10 text-[var(--color-warning)]"
                        >
                          Invite pending
                        </Badge>
                      )}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{user.email}</TableCell>
                  <TableCell>{user.tenant_name ?? <span className="text-muted-foreground">—</span>}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {user.tenant_role ? TENANT_ROLE_LABELS[user.tenant_role as TenantRole] : "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{user.plan_code ?? "No plan yet"}</TableCell>
                  <TableCell>
                    <StatusChip
                      tone={accountTone(user.status)}
                      dot
                      // Hovering a suspended user shows why, without a trip to the audit log.
                      title={user.suspension_reason ?? undefined}
                    >
                      {USER_STATUS_LABELS[user.status]}
                    </StatusChip>
                  </TableCell>
                  <TableCell
                    className="text-muted-foreground"
                    title={user.last_login_at ? new Date(user.last_login_at).toLocaleString() : undefined}
                  >
                    {relativeTime(user.last_login_at)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(user.created_at).toLocaleDateString()}
                  </TableCell>
                  {canCreate && (
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" disabled={resendingId === user.id}>
                            <MoreHorizontal />
                            <span className="sr-only">Actions</span>
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
                          {/* Exactly one of these applies: you either haven't set a password yet,
                              or you have one to reset. */}
                          {user.has_password ? (
                            <DropdownMenuItem onSelect={() => sendReset(user)}>
                              Send password reset
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem onSelect={() => resendInvite(user)}>
                              Resend invitation
                            </DropdownMenuItem>
                          )}

                          <DropdownMenuSeparator />

                          {/* Only the transitions that make sense from the current state are
                              offered, so the menu can't produce a no-op or a 409. */}
                          {user.status === "active" && (
                            <DropdownMenuItem onSelect={() => changeState(user, "deactivate", "deactivate")}>
                              Deactivate
                            </DropdownMenuItem>
                          )}
                          {user.status === "inactive" && (
                            <DropdownMenuItem onSelect={() => changeState(user, "activate", "activate")}>
                              Reactivate
                            </DropdownMenuItem>
                          )}
                          {user.status === "suspended" ? (
                            <DropdownMenuItem onSelect={() => changeState(user, "unsuspend", "unsuspend")}>
                              Lift suspension
                            </DropdownMenuItem>
                          ) : (
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
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <PaginationBar
            page={page}
            totalItems={total}
            itemsPerPage={USERS_PAGE_SIZE}
            itemLabel="users"
            onPageChange={setPage}
          />
        </div>
      </div>

      {/* Keyed by row id so each dialog remounts with fresh state when a *different* user is
          opened — that's what lets them seed from props instead of resetting in an effect. */}
      <EditUserDialog
        key={`edit-${editing?.id ?? "none"}`}
        user={editing}
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSaved={() => setRefreshKey((k) => k + 1)}
      />

      <SuspendUserDialog
        key={`suspend-${suspending?.id ?? "none"}`}
        user={suspending}
        open={suspendOpen}
        onClose={() => setSuspendOpen(false)}
        onSuspended={() => setRefreshKey((k) => k + 1)}
      />

      <Dialog open={resentInvite !== null} onOpenChange={(open) => !open && setResentInvite(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New link issued</DialogTitle>
            <DialogDescription>
              Any earlier link for {resentInvite?.email} has been revoked and no longer works.
            </DialogDescription>
          </DialogHeader>
          {resentInvite && <InviteLinkPanel url={resentInvite.url} expiresAt={resentInvite.expiresAt} />}
          <DialogFooter>
            <Button onClick={() => setResentInvite(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DateInput({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  return (
    <input
      type="date"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
    />
  );
}
