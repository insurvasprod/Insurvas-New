"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Unlock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, ToolbarSearch } from "@/components/ui/data-toolbar";
import { setParamsInPlace } from "@/components/ui/nav-pending";
import { EmptyState, ErrorState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { formatUtcDateTime } from "@/lib/adminDashboard/figures";
import { LOCKOUT_PLANE_LABEL, type LockoutEntry } from "@/lib/loginEvents/lockouts";
import { notify } from "@/lib/notify";

const pad = (value: number) => String(value).padStart(2, "0");
/** "14:20", or "Nov 18 14:20" when it is not today (UTC). */
function when(iso: string, nowIso: string): string {
  const date = new Date(iso);
  const time = `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
  if (iso.slice(0, 10) === nowIso.slice(0, 10)) return time;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[date.getUTCMonth()]} ${date.getUTCDate()} ${time}`;
}

/**
 * Monitoring › Lockouts list (admin round 1, monitoring.html screen 3), moved from the Login protection panel under
 * Platform › Advanced. Every sign-in lockout key in the rate-limit store: the account or address, who it is
 * (customer, staff, staff two-step code), the failures counted, since when, and when it unlocks. "Locked now"
 * (default) or every recorded key (`?show=all`), and a search, live in the address. Unlock clears one key through
 * the same super-admin route as before (POST /api/admin/security/rate-limits), which writes the audit row.
 */
export function LockTable({ entries, nowIso, failed }: { entries: LockoutEntry[]; nowIso: string; failed: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const [refreshing, startRefresh] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const pageSize = useFittingPageSize(420, 45);

  const showAll = params.get("show") === "all";
  const search = params.get("q") ?? "";
  const page = Math.max(1, Number(params.get("page")) || 1);
  const needle = search.trim().toLowerCase();
  const filtered = entries.filter((entry) => (showAll || entry.unlocksAt) && (!needle || entry.email.toLowerCase().includes(needle) || entry.ip.toLowerCase().includes(needle)));
  const { current, rows } = paginate(filtered, page, pageSize);
  const locked = entries.filter((entry) => entry.unlocksAt).length;

  async function unlock(entry: LockoutEntry) {
    setBusy(entry.scopeKey);
    const response = await fetch("/api/admin/security/rate-limits", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scopeKey: entry.scopeKey }),
    }).catch(() => null);
    const body = response ? await response.json().catch(() => null) : null;
    setBusy(null);
    if (!response || !response.ok) {
      notify.block(body?.error ?? "Could not clear login lockout");
      return;
    }
    notify.done(`${entry.email} can try again now. Recorded in the audit log.`);
    startRefresh(() => router.refresh());
  }

  const clear = () => setParamsInPlace({ q: null, page: null });

  return (
    <TableCard
      className="min-w-0"
      footer={<Pager page={current} pageSize={pageSize} total={filtered.length} noun={filtered.length === 1 ? "lockout" : "lockouts"} suffix={showAll ? "locked first" : "soonest to unlock first"} onPage={(next) => setParamsInPlace({ page: next > 1 ? String(next) : null })} />}
      toolbar={
        <DataToolbar actions={<RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />}>
          <ToolbarSearch value={search} onChange={(value) => setParamsInPlace({ q: value || null, page: null })} placeholder="Search email or IP" label="Search lockouts by email address or IP" />
          <span className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
            {failed ? "Count unavailable" : `${locked.toLocaleString("en-US")} locked · ${entries.length.toLocaleString("en-US")} recorded`}
          </span>
        </DataToolbar>
      }
    >
      {failed ? (
        <ErrorState title="Couldn't read the lockouts" detail="Nothing is shown rather than an empty list. Try again." action={<Button type="button" variant="outline" onClick={() => startRefresh(() => router.refresh())}>Try again</Button>} />
      ) : filtered.length === 0 ? (
        needle ? (
          <NoMatches noun="lockouts" onClear={clear} />
        ) : showAll ? (
          <EmptyState title="No recorded login lockouts" hint="Failed sign-ins are counted here per account and address; nothing is being counted right now." />
        ) : (
          <EmptyState title="Nobody is locked out" hint="Accounts locked after repeated failed sign-ins appear here." />
        )
      ) : (
        <Table className="min-w-[860px]">
          <TableHeader>
            <TableRow>
              <TableHead>Account or address</TableHead>
              <TableHead>Who</TableHead>
              <TableHead>IP</TableHead>
              <TableHead className="text-right">Failures</TableHead>
              <TableHead>Counting since</TableHead>
              <TableHead>Unlocks</TableHead>
              <TableHead><span className="sr-only">Action</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((entry) => (
              <TableRow key={entry.scopeKey}>
                <TableCell className="max-w-[18rem] truncate font-medium text-foreground" title={entry.email}>{entry.email}</TableCell>
                <TableCell className="whitespace-nowrap">{LOCKOUT_PLANE_LABEL[entry.plane]}</TableCell>
                <TableCell className="font-mono text-xs">{entry.ip}</TableCell>
                <TableCell className="text-right tabular-nums">{entry.failures.toLocaleString("en-US")}</TableCell>
                <TableCell className="whitespace-nowrap tabular-nums" title={formatUtcDateTime(entry.since) ?? undefined}>{when(entry.since, nowIso)}</TableCell>
                <TableCell className="whitespace-nowrap tabular-nums">
                  {entry.unlocksAt ? (
                    <StatusChip tone="warning" dot>
                      <span title={formatUtcDateTime(entry.unlocksAt) ?? undefined}>Locked until {when(entry.unlocksAt, nowIso)}</span>
                    </StatusChip>
                  ) : (
                    <StatusChip tone="neutral">Not locked</StatusChip>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <Button type="button" variant="ghost" size="sm" onClick={() => void unlock(entry)} disabled={busy === entry.scopeKey}>
                    <Unlock className="size-3.5" aria-hidden="true" />
                    {busy === entry.scopeKey ? "Unlocking…" : entry.unlocksAt ? "Unlock" : "Clear failures"}
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </TableCard>
  );
}
