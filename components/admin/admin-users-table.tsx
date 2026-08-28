"use client";

import { useCallback, useMemo, useState } from "react";
import { MoreHorizontal, Search } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
import { ADMIN_ROLES, ADMIN_ROLE_LABELS, type AdminRole } from "@/lib/adminAuth/roles";
import { CreateAdminDialog } from "./create-admin-dialog";
import { PaginationBar } from "./pagination-bar";
import { tableHeaderRow, tableHeadCell, tableShell } from "./table-styles";

const PAGE_SIZE = 10;

type AdminRow = {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
};

type RoleFilter = "all" | AdminRole;
type StatusFilter = "all" | "active" | "inactive";

export function AdminUsersTable({
  initialAdmins,
  currentAdminId,
}: {
  initialAdmins: AdminRow[];
  currentAdminId: string;
}) {
  const [admins, setAdmins] = useState(initialAdmins);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/admin/admins");
    if (res.ok) {
      const body = await res.json();
      setAdmins(body.admins);
    }
  }, []);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return admins.filter((admin) => {
      if (roleFilter !== "all" && admin.role !== roleFilter) return false;
      if (statusFilter === "active" && !admin.is_active) return false;
      if (statusFilter === "inactive" && admin.is_active) return false;
      if (query && !admin.name.toLowerCase().includes(query) && !admin.email.toLowerCase().includes(query)) {
        return false;
      }
      return true;
    });
  }, [admins, search, roleFilter, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const paged = useMemo(
    () => filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filtered, safePage],
  );

  async function toggleActive(admin: AdminRow) {
    setPendingId(admin.id);
    const res = await fetch(`/api/admin/admins/${admin.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: !admin.is_active }),
    });
    setPendingId(null);

    if (!res.ok) {
      const body = await res.json().catch(() => null);
      toast.error(body?.error ?? "Could not update admin");
      return;
    }

    toast.success(admin.is_active ? `${admin.email} deactivated` : `${admin.email} reactivated`);
    refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select value={roleFilter} onValueChange={(v) => setRoleFilter(v as RoleFilter)}>
          <SelectTrigger className="w-[170px]">
            <SelectValue placeholder="Role" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All roles</SelectItem>
            {ADMIN_ROLES.map((r) => (
              <SelectItem key={r} value={r}>
                {ADMIN_ROLE_LABELS[r]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Deactivated</SelectItem>
          </SelectContent>
        </Select>
        <div className="ml-auto">
          <CreateAdminDialog onCreated={refresh} />
        </div>
      </div>

      <div className={tableShell}>
        <Table>
          <TableHeader>
            <TableRow className={tableHeaderRow}>
              <TableHead className={tableHeadCell}>Name</TableHead>
              <TableHead className={tableHeadCell}>Email</TableHead>
              <TableHead className={tableHeadCell}>Role</TableHead>
              <TableHead className={tableHeadCell}>Status</TableHead>
              <TableHead className={tableHeadCell}>Last login</TableHead>
              <TableHead className={`${tableHeadCell} w-10`} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                  No admins match these filters.
                </TableCell>
              </TableRow>
            )}
            {paged.map((admin) => (
              <TableRow key={admin.id}>
                <TableCell className="font-medium">{admin.name}</TableCell>
                <TableCell className="text-muted-foreground">{admin.email}</TableCell>
                <TableCell>
                  <Badge variant="outline">{ADMIN_ROLE_LABELS[admin.role]}</Badge>
                </TableCell>
                <TableCell>
                  <Badge
                    variant="outline"
                    className={
                      admin.is_active
                        ? "border-transparent bg-[var(--color-success)]/10 text-[var(--color-success)]"
                        : "border-transparent bg-[var(--color-danger)]/10 text-[var(--color-danger)]"
                    }
                  >
                    {admin.is_active ? "Active" : "Deactivated"}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {admin.last_login_at ? new Date(admin.last_login_at).toLocaleString() : "Never"}
                </TableCell>
                <TableCell>
                  {admin.id === currentAdminId ? (
                    <span className="block text-center text-xs text-muted-foreground">You</span>
                  ) : (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" disabled={pendingId === admin.id}>
                          <MoreHorizontal />
                          <span className="sr-only">Actions</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          variant={admin.is_active ? "destructive" : "default"}
                          onSelect={() => toggleActive(admin)}
                        >
                          {admin.is_active ? "Deactivate" : "Reactivate"}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <PaginationBar
          page={safePage}
          totalItems={filtered.length}
          itemsPerPage={PAGE_SIZE}
          itemLabel="admins"
          onPageChange={setPage}
        />
      </div>
    </div>
  );
}
