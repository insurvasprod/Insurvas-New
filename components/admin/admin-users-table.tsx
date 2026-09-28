"use client";

import { useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";

import { notify } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { ADMIN_ROLES, ADMIN_ROLE_LABELS, type AdminRole } from "@/lib/adminAuth/roles";
import {
  SELF_REFUSAL,
  STAFF_ORDER,
  roleInSentence,
  roleWithArticle,
  staffChangeRefusal,
  staffDate,
  staffDateTime,
  type StaffChange,
  type StaffRow,
} from "@/lib/adminStaff/present";
import { Pill, st } from "@/components/app/settings/primitives";
import { BoardTableFooter } from "@/components/admin/board-table-footer";
import { NoMatches } from "@/components/admin/empty-state";
import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { TableCard } from "@/components/ui/table-card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const PAGE_SIZE = 10;

type RoleFilter = "all" | AdminRole;
type StateFilter = "all" | "active" | "inactive";

const STATE_FILTERS: { value: StateFilter; label: string }[] = [
  { value: "all", label: "Every state" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Deactivated" },
];

type Pending = { admin: StaffRow; change: StaffChange };

const subscribeNothing = () => () => {};

/** False during the server render and hydration, true after: local time must never reach the server HTML. */
function useIsClient() {
  return useSyncExternalStore(subscribeNothing, () => true, () => false);
}

/**
 * The staff table (board p-adm-admins): search and filters, the six board columns, a row menu for
 * role changes and deactivation, and the confirmation each of them goes through. Rows arrive sorted
 * from the server (sortStaff); after a change the page re-renders on the server with router.refresh.
 */
export function AdminUsersTable({
  admins,
  currentAdminId,
  activeSuperAdmins,
}: {
  admins: StaffRow[];
  currentAdminId: string;
  activeSuperAdmins: number;
}) {
  const router = useRouter();
  const isClient = useIsClient();
  const [refreshing, startRefresh] = useTransition();

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [stateFilter, setStateFilter] = useState<StateFilter>("all");
  const [page, setPage] = useState(1);
  const [pending, setPending] = useState<Pending | null>(null);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return admins.filter((admin) => {
      if (roleFilter !== "all" && admin.role !== roleFilter) return false;
      if (stateFilter === "active" && !admin.is_active) return false;
      if (stateFilter === "inactive" && admin.is_active) return false;
      if (query && !admin.name.toLowerCase().includes(query) && !admin.email.toLowerCase().includes(query)) return false;
      return true;
    });
  }, [admins, search, roleFilter, stateFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const paged = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  function clearFilters() {
    setSearch("");
    setRoleFilter("all");
    setStateFilter("all");
    setPage(1);
  }

  const localTitle = (iso: string | null) => (isClient && iso ? `Your time: ${new Date(iso).toLocaleString()}` : undefined);

  return (
    <>
      <TableCard
        toolbar={
          <DataToolbar actions={<RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />}>
            <ToolbarSearch
              value={search}
              onChange={(value) => {
                setSearch(value);
                setPage(1);
              }}
              placeholder="Search admins"
              label="Search admins by name or email"
            />
            <select
              aria-label="Role"
              className={toolbarControl}
              value={roleFilter}
              onChange={(event) => {
                setRoleFilter(event.target.value as RoleFilter);
                setPage(1);
              }}
            >
              <option value="all">Every role</option>
              {ADMIN_ROLES.map((role) => (
                <option key={role} value={role}>
                  {ADMIN_ROLE_LABELS[role]}
                </option>
              ))}
            </select>
            <select
              aria-label="State"
              className={toolbarControl}
              value={stateFilter}
              onChange={(event) => {
                setStateFilter(event.target.value as StateFilter);
                setPage(1);
              }}
            >
              {STATE_FILTERS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </DataToolbar>
        }
      >
        <div className="min-w-0 overflow-x-auto">
          <table className={cn(st.table, "min-w-[960px]")}>
            <thead>
              <tr className={st.headRow}>
                <th scope="col" className={st.th}>Email</th>
                <th scope="col" className={cn(st.th, "w-[180px]")}>Name</th>
                <th scope="col" className={cn(st.th, "w-[150px]")}>Role</th>
                <th scope="col" className={cn(st.th, "w-[130px]")}>State</th>
                <th scope="col" className={cn(st.th, "w-[210px]")}>Last login</th>
                <th scope="col" className={cn(st.th, "w-[120px]")}>Created</th>
                <th scope="col" className={cn(st.th, "w-[64px]")}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="m-seq">
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className={cn(st.td, "p-0")}>
                    <NoMatches noun="admins" onClear={clearFilters} />
                  </td>
                </tr>
              )}
              {paged.map((admin) => {
                const isSelf = admin.id === currentAdminId;
                return (
                  <tr key={admin.id} className={cn("m-row", isSelf && "bg-[var(--brand-50)]")}>
                    <td className={cn(st.td, "break-words")}>
                      {admin.email}
                      {isSelf && (
                        <Pill tone="brand" className="ml-2 align-middle">
                          You
                        </Pill>
                      )}
                    </td>
                    <td className={st.td}>{admin.name}</td>
                    <td className={st.td}>
                      <Pill tone={admin.role === "super_admin" ? "info" : "neutral"} dot>
                        {ADMIN_ROLE_LABELS[admin.role]}
                      </Pill>
                    </td>
                    <td className={st.td}>
                      <Pill tone={admin.is_active ? "success" : "neutral"} dot>
                        {admin.is_active ? "Active" : "Deactivated"}
                      </Pill>
                    </td>
                    <td className={cn(st.td, "whitespace-nowrap tabular-nums")} title={localTitle(admin.last_login_at)}>
                      {staffDateTime(admin.last_login_at) ?? "Never"}
                    </td>
                    <td className={cn(st.td, "whitespace-nowrap tabular-nums")} title={localTitle(admin.created_at)}>
                      {staffDate(admin.created_at) ?? "—"}
                    </td>
                    <td className={cn(st.td, "text-right")}>
                      <RowMenu
                        admin={admin}
                        currentAdminId={currentAdminId}
                        activeSuperAdmins={activeSuperAdmins}
                        onChoose={(change) => setPending({ admin, change })}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <BoardTableFooter
          page={safePage}
          pageSize={PAGE_SIZE}
          total={filtered.length}
          itemLabel="admins"
          order={STAFF_ORDER}
          onPageChange={setPage}
        />
      </TableCard>

      <ConfirmChangeDialog pending={pending} onClose={() => setPending(null)} onDone={() => router.refresh()} />
    </>
  );
}

function RowMenu({
  admin,
  currentAdminId,
  activeSuperAdmins,
  onChoose,
}: {
  admin: StaffRow;
  currentAdminId: string;
  activeSuperAdmins: number;
  onChoose: (change: StaffChange) => void;
}) {
  const isSelf = admin.id === currentAdminId;
  const refusalFor = (change: StaffChange) => staffChangeRefusal({ actorId: currentAdminId, target: admin, change, activeSuperAdmins });
  const toggle: StaffChange = { is_active: !admin.is_active };
  const toggleRefusal = refusalFor(toggle);
  const otherRoles = ADMIN_ROLES.filter((role) => role !== admin.role);
  // One reason line for the menu: the self rule covers every item; the last-super-admin rule covers
  // deactivating and every demotion at once.
  const reason = isSelf ? SELF_REFUSAL : toggleRefusal ?? otherRoles.map((role) => refusalFor({ role })).find(Boolean) ?? null;

  return (
    // Not modal: a modal menu that opens a dialog from onSelect leaves pointer-events off on <body>.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Actions for ${admin.name}`}
          className="inline-flex size-8 cursor-pointer items-center justify-center rounded-[8px] text-[var(--muted)] hover:bg-[var(--surface-alt)] hover:text-[var(--ink)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]"
        >
          <MoreHorizontal className="size-4" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {reason && (
          <p role="note" className="m-0 px-2 py-1.5 text-[12px] leading-[1.5] tracking-[-0.01em] text-[var(--muted)]">
            {reason}
          </p>
        )}
        <DropdownMenuLabel>Change role</DropdownMenuLabel>
        {otherRoles.map((role) => (
          <DropdownMenuItem key={role} disabled={refusalFor({ role }) !== null} onSelect={() => onChoose({ role })}>
            Make {roleInSentence(role)}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant={admin.is_active ? "destructive" : "default"}
          disabled={toggleRefusal !== null}
          onSelect={() => onChoose(toggle)}
        >
          {admin.is_active ? "Deactivate" : "Reactivate"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function describe(pending: Pending): { title: string; body: string; confirm: string; busy: string; destructive: boolean; done: string } {
  const { admin, change } = pending;
  if (change.is_active === false) {
    return {
      title: `Deactivate ${admin.name}?`,
      body: `${admin.email} is signed out on their next request and can no longer sign in. Everything they did stays in the audit log, attributed to them, and they can be reactivated later. Recorded in the audit log.`,
      confirm: "Deactivate",
      busy: "Deactivating…",
      destructive: true,
      done: `${admin.email} deactivated`,
    };
  }
  if (change.is_active === true) {
    return {
      title: `Reactivate ${admin.name}?`,
      body: `${admin.email} can sign in again as ${roleWithArticle(admin.role)}, with their existing password and authenticator app. Recorded in the audit log.`,
      confirm: "Reactivate",
      busy: "Reactivating…",
      destructive: false,
      done: `${admin.email} reactivated`,
    };
  }
  const role = change.role as AdminRole;
  const promotes = role === "super_admin";
  return {
    title: `Make ${admin.name} ${roleWithArticle(role)}?`,
    body:
      `${admin.email} moves from ${roleInSentence(admin.role)} to ${roleInSentence(role)}. What they can see and do in this console changes on their next request.` +
      (promotes ? " A super admin can manage every staff account, including yours." : "") +
      " Recorded in the audit log.",
    confirm: "Change role",
    busy: "Changing role…",
    destructive: admin.role === "super_admin",
    done: `${admin.email} is now ${roleWithArticle(role)}`,
  };
}

function ConfirmChangeDialog({ pending, onClose, onDone }: { pending: Pending | null; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copy = pending ? describe(pending) : null;

  function close() {
    if (busy) return;
    setError(null);
    onClose();
  }

  async function confirm() {
    if (!pending || !copy) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/admin/admins/${pending.admin.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(pending.change),
    });
    const body = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok) {
      // Shown here, in the dialog, rather than as a toast: a 409 (the last active super admin) is an
      // answer to this exact question, and the reader should see it where they asked.
      setError(body?.error ?? "Could not update this admin.");
      if (res.status === 409) onDone();
      return;
    }
    notify.done(copy.done);
    onClose();
    onDone();
  }

  return (
    <Dialog open={pending !== null} onOpenChange={(next) => !next && close()}>
      <DialogContent>
        {copy && (
          <>
            <DialogHeader>
              <DialogTitle>{copy.title}</DialogTitle>
              <DialogDescription className="text-[14px] leading-[1.5]">{copy.body}</DialogDescription>
            </DialogHeader>
            {error && (
              <p role="alert" className="m-0 text-[14px] leading-[1.5] tracking-[-0.02em] text-[var(--error-ink)]">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={close} disabled={busy}>
                Cancel
              </Button>
              <Button type="button" variant={copy.destructive ? "destructive" : "default"} onClick={confirm} disabled={busy}>
                {busy ? copy.busy : copy.confirm}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
