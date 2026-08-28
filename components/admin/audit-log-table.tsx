"use client";

import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { AUDIT_ACTIONS, AUDIT_ACTION_LABELS, type AuditAction } from "@/lib/audit/actions";
import { PaginationBar } from "./pagination-bar";
import { tableHeaderRow, tableHeadCell, tableShell } from "./table-styles";

type Actor = { id: string; name: string; email: string };

type AuditEntry = {
  id: string;
  ts: string;
  actor_type: "admin" | "system";
  actor_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  reason: string | null;
  ip: string | null;
  user_agent: string | null;
  metadata: unknown;
  actor: Actor | null;
};

export function AuditLogTable({
  initialEntries,
  initialTotal,
  pageSize,
  isSuperAdmin,
  allAdmins,
}: {
  initialEntries: AuditEntry[];
  initialTotal: number;
  pageSize: number;
  isSuperAdmin: boolean;
  allAdmins: Actor[];
}) {
  const [entries, setEntries] = useState(initialEntries);
  const [total, setTotal] = useState(initialTotal);
  const [action, setAction] = useState<"all" | AuditAction>("all");
  const [actorId, setActorId] = useState<string>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<AuditEntry | null>(null);
  const isFirstRun = useRef(true);

  useEffect(() => {
    // Skip the very first run — initialEntries (server-rendered) already reflects "no filters".
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }

    const params = new URLSearchParams();
    if (action !== "all") params.set("action", action);
    if (isSuperAdmin && actorId !== "all") params.set("actorId", actorId);
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    params.set("page", String(page));

    fetch(`/api/admin/audit-log?${params.toString()}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!body) return;
        setEntries(body.entries);
        setTotal(body.total);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [action, actorId, from, to, page]);

  function resetToFirstPage<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value);
      setPage(1);
    };
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={action} onValueChange={resetToFirstPage((v: string) => setAction(v as "all" | AuditAction))}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Action" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All actions</SelectItem>
            {AUDIT_ACTIONS.map((a) => (
              <SelectItem key={a} value={a}>
                {AUDIT_ACTION_LABELS[a]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {isSuperAdmin && (
          <Select value={actorId} onValueChange={resetToFirstPage(setActorId)}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Actor" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All admins</SelectItem>
              {allAdmins.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        <input
          type="date"
          value={from}
          onChange={(e) => resetToFirstPage(setFrom)(e.target.value)}
          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
          aria-label="From date"
        />
        <span className="text-sm text-muted-foreground">to</span>
        <input
          type="date"
          value={to}
          onChange={(e) => resetToFirstPage(setTo)(e.target.value)}
          className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs"
          aria-label="To date"
        />
      </div>

      <div className={tableShell}>
        <Table>
          <TableHeader>
            <TableRow className={tableHeaderRow}>
              <TableHead className={tableHeadCell}>When</TableHead>
              <TableHead className={tableHeadCell}>Actor</TableHead>
              <TableHead className={tableHeadCell}>Action</TableHead>
              <TableHead className={tableHeadCell}>Target</TableHead>
              <TableHead className={tableHeadCell}>Reason</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                  No matching audit entries.
                </TableCell>
              </TableRow>
            )}
            {entries.map((entry) => (
              <TableRow key={entry.id} className="cursor-pointer" onClick={() => setSelected(entry)}>
                <TableCell className="text-muted-foreground">{new Date(entry.ts).toLocaleString()}</TableCell>
                <TableCell className="font-medium">{entry.actor?.name ?? entry.actor_type}</TableCell>
                <TableCell>
                  <Badge variant="outline">
                    {AUDIT_ACTION_LABELS[entry.action as AuditAction] ?? entry.action}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {entry.target_type ? `${entry.target_type}:${entry.target_id}` : "—"}
                </TableCell>
                <TableCell className="max-w-[200px] truncate text-muted-foreground">
                  {entry.reason ?? "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <PaginationBar page={page} totalItems={total} itemsPerPage={pageSize} itemLabel="entries" onPageChange={setPage} />
      </div>

      <Dialog open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{selected && (AUDIT_ACTION_LABELS[selected.action as AuditAction] ?? selected.action)}</DialogTitle>
            <DialogDescription>{selected && new Date(selected.ts).toLocaleString()}</DialogDescription>
          </DialogHeader>
          {selected && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-muted-foreground">Actor</p>
                  <p className="font-medium">{selected.actor ? `${selected.actor.name} (${selected.actor.email})` : selected.actor_type}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Target</p>
                  <p className="font-medium">
                    {selected.target_type ? `${selected.target_type}:${selected.target_id}` : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">IP</p>
                  <p className="font-medium">{selected.ip ?? "—"}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">User agent</p>
                  <p className="truncate font-medium" title={selected.user_agent ?? undefined}>
                    {selected.user_agent ?? "—"}
                  </p>
                </div>
              </div>
              {selected.reason && (
                <div>
                  <p className="text-muted-foreground">Reason</p>
                  <p className="font-medium">{selected.reason}</p>
                </div>
              )}
              <div>
                <p className="mb-1 text-muted-foreground">Metadata</p>
                <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
                  {JSON.stringify(selected.metadata, null, 2)}
                </pre>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
