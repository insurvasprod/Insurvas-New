"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { DataToolbar, RefreshButton } from "@/components/ui/data-toolbar";
import { ErrorState } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import { notify } from "@/lib/notify";

export type StaffSessionRow = {
  id: string;
  name: string;
  email: string;
  initials: string;
  roleLabel: string;
  /** "Today 09:58", "Yesterday", "Nov 12", "Never"; printed by the server with the request's clock. */
  lastSignIn: string;
  lastSignInTitle: string | null;
  ip: string | null;
  device: string | null;
  twoStep: boolean;
};

/**
 * Monitoring › Staff sessions (admin round 1, monitoring.html screen 4): each active staff member, their role, when
 * and where they last signed in, whether two-step sign-in is set up, and "Sign out everywhere…" — asked first, then
 * the existing super-admin route (POST /api/admin/admins/[id]/sessions), which writes the audit row. Your own row
 * signs you out too: it goes through Sign out (POST /api/admin/auth/logout), which ends every session of yours and
 * audits it, because the sessions route refuses your own account on purpose.
 */
export function SessTable({ rows, currentAdminId, failed }: { rows: StaffSessionRow[]; currentAdminId: string; failed: boolean }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);

  async function signOutEverywhere(row: StaffSessionRow) {
    const own = row.id === currentAdminId;
    const ok = await confirmAction({
      title: own ? "Sign yourself out everywhere?" : `Sign ${row.name} out everywhere?`,
      description: own
        ? "This signs you out too: every session you have ends, this one included. You sign in again with your password and code. Recorded in the audit log."
        : `Every session ${row.name} has ends at once, on every device. Their account stays active; they sign in again with their password and code. Recorded in the audit log.`,
      confirmLabel: own ? "Sign me out everywhere" : "Sign out everywhere",
      cancelLabel: "Keep signed in",
    });
    if (!ok) return;
    setBusy(row.id);
    const response = await fetch(own ? "/api/admin/auth/logout" : `/api/admin/admins/${encodeURIComponent(row.id)}/sessions`, { method: "POST" }).catch(() => null);
    const body = response ? await response.json().catch(() => null) : null;
    setBusy(null);
    if (!response || !response.ok) {
      notify.block(body?.error ?? "Could not end the sessions. Try again.");
      return;
    }
    if (own) {
      // A new document, as Sign out does (TopBarSignOut): nothing of this session stays in the router cache, and
      // replace() keeps the console out of Back.
      window.location.replace("/admin/login");
      return;
    }
    notify.done(`${row.name} is signed out everywhere. Recorded in the audit log.`);
    startRefresh(() => router.refresh());
  }

  return (
    <TableCard
      className="min-w-0"
      footer={
        <p className="m-0 px-4 py-3 text-xs text-muted-foreground">
          {rows.length.toLocaleString("en-US")} active {rows.length === 1 ? "staff member" : "staff members"} · newest sign-in first · manage accounts on <Link href="/admin/admins" className="underline underline-offset-2 hover:text-foreground">Admin users</Link>
        </p>
      }
      toolbar={<DataToolbar actions={<RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />} />}
    >
      {failed ? (
        <ErrorState title="Couldn't read the staff list" detail="Nothing is shown rather than an empty list. Try again." action={<Button type="button" variant="outline" onClick={() => startRefresh(() => router.refresh())}>Try again</Button>} />
      ) : (
        <Table className="min-w-[900px]">
          <TableHeader>
            <TableRow>
              <TableHead>Staff member</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Last signed in</TableHead>
              <TableHead>From</TableHead>
              <TableHead>Two-step sign-in</TableHead>
              <TableHead><span className="sr-only">Action</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const own = row.id === currentAdminId;
              return (
                <TableRow key={row.id}>
                  <TableCell>
                    <span className="flex min-w-0 items-center gap-3">
                      {/* Staff, so initials; gold marks people (BRAND.md). */}
                      <span aria-hidden="true" className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--highlight-soft)] text-xs font-semibold text-[var(--highlight-ink)]">{row.initials}</span>
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate font-medium text-foreground">{row.name}{own ? " (you)" : ""}</span>
                        <span className="truncate text-xs text-muted-foreground">{row.email}</span>
                      </span>
                    </span>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">{row.roleLabel}</TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums" title={row.lastSignInTitle ?? undefined}>{row.lastSignIn}</TableCell>
                  <TableCell className="max-w-[16rem] truncate" title={row.device ?? undefined}>
                    {row.ip ? <span className="font-mono text-xs">{row.ip}</span> : <span className="text-muted-foreground">—</span>}
                    {row.device && <span className="text-muted-foreground"> · {row.device}</span>}
                  </TableCell>
                  <TableCell>{row.twoStep ? <StatusChip tone="good" dot>On</StatusChip> : <StatusChip tone="warning" dot>Not set up</StatusChip>}</TableCell>
                  <TableCell className="text-right">
                    <Button type="button" variant="ghost" size="sm" className="text-[var(--error-ink)]" onClick={() => void signOutEverywhere(row)} disabled={busy === row.id} title={own ? "This signs you out too" : undefined}>
                      <LogOut className="size-3.5" aria-hidden="true" />
                      {busy === row.id ? "Signing out…" : "Sign out everywhere…"}
                    </Button>
                    {own && <span className="block text-xs text-muted-foreground">This signs you out too</span>}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </TableCard>
  );
}
