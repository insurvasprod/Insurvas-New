"use client";

import { useCallback, useMemo, useState } from "react";
import { Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
import { CreateTenantDialog } from "./create-tenant-dialog";
import { PaginationBar } from "./pagination-bar";
import { tableHeaderRow, tableHeadCell, tableShell } from "./table-styles";

const PAGE_SIZE = 10;

type TenantStatus = "provisioning" | "active" | "suspended" | "cancelled";

type TenantRow = {
  id: string;
  name: string;
  status: TenantStatus;
  plan_code: string | null;
  onboarding_state: string;
  created_at: string;
  suspended_at: string | null;
  owner: { name: string; email: string } | null;
};

type StatusFilter = "all" | TenantStatus;

const STATUS_LABELS: Record<TenantStatus, string> = {
  provisioning: "Provisioning",
  active: "Active",
  suspended: "Suspended",
  cancelled: "Cancelled",
};

const STATUS_BADGE_CLASS: Record<TenantStatus, string> = {
  provisioning: "border-transparent bg-[var(--color-warning)]/10 text-[var(--color-warning)]",
  active: "border-transparent bg-[var(--color-success)]/10 text-[var(--color-success)]",
  suspended: "border-transparent bg-[var(--color-danger)]/10 text-[var(--color-danger)]",
  cancelled: "border-transparent bg-muted text-muted-foreground",
};

export function TenantsTable({ initialTenants }: { initialTenants: TenantRow[] }) {
  const [tenants, setTenants] = useState(initialTenants);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [page, setPage] = useState(1);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/admin/tenants");
    if (res.ok) {
      const body = await res.json();
      setTenants(body.tenants);
    }
  }, []);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return tenants.filter((tenant) => {
      if (statusFilter !== "all" && tenant.status !== statusFilter) return false;
      if (query) {
        const haystack = `${tenant.name} ${tenant.owner?.name ?? ""} ${tenant.owner?.email ?? ""}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [tenants, search, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const paged = useMemo(
    () => filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filtered, safePage],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search business or owner…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <SelectTrigger className="w-[170px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-auto">
          <CreateTenantDialog onCreated={refresh} />
        </div>
      </div>

      <div className={tableShell}>
        <Table>
          <TableHeader>
            <TableRow className={tableHeaderRow}>
              <TableHead className={tableHeadCell}>Business</TableHead>
              <TableHead className={tableHeadCell}>Owner</TableHead>
              <TableHead className={tableHeadCell}>Status</TableHead>
              <TableHead className={tableHeadCell}>Plan</TableHead>
              <TableHead className={tableHeadCell}>Joined</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                  No tenants match these filters.
                </TableCell>
              </TableRow>
            )}
            {paged.map((tenant) => (
              <TableRow key={tenant.id}>
                <TableCell className="font-medium">{tenant.name}</TableCell>
                <TableCell className="text-muted-foreground">
                  {tenant.owner ? (
                    <>
                      {tenant.owner.name} <span className="text-xs">· {tenant.owner.email}</span>
                    </>
                  ) : (
                    "—"
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={STATUS_BADGE_CLASS[tenant.status]}>
                    {STATUS_LABELS[tenant.status]}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">{tenant.plan_code ?? "No plan yet"}</TableCell>
                <TableCell className="text-muted-foreground">
                  {new Date(tenant.created_at).toLocaleDateString()}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <PaginationBar
          page={safePage}
          totalItems={filtered.length}
          itemsPerPage={PAGE_SIZE}
          itemLabel="tenants"
          onPageChange={setPage}
        />
      </div>
    </div>
  );
}
