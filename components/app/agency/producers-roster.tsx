"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { notify } from "@/lib/notify";

import { StatStrip, StatTile } from "@/components/ui/stat";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { EmptyState, ErrorState, NoMatches, SectionLoading } from "@/components/ui/page-states";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { Pager, paginate } from "@/components/ui/pager";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { refreshStepCounts } from "@/components/app/step-frame/step-rail";
import { PRODUCER_STATUS_LABELS, type ProducerStatus } from "@/lib/agency/constants";
import type { RosterFilter } from "@/lib/agency/rosterFilter";
import { MEMBER_ROLE_LABELS, type MemberRole } from "@/lib/tenantAuth/roles";
import { InfoTip } from "@/components/ui/info-tip";
import { Money } from "./money";
import { sendJson, useAgencyData } from "./use-agency-data";

type RosterRow = {
  id: string; userId: string; displayName: string; email: string | null; status: ProducerStatus; role: string | null;
  hiredOn: string | null; canSubmit: boolean; canSubmitReason: string | null; inviteExpiresAt: string | null;
};
type DashRow = { producerUserId: string; submitted: number; issued: number; balanceCents: number | null };
type Dash = { producers: DashRow[]; alerts: Array<{ producerUserId: string; daysLeft: number }>; seats: { used: number; max: number | null }; ledgerReady: boolean };

export const STATUS_TONE: Record<ProducerStatus, StatusTone> = { invited: "neutral", onboarding: "info", active: "good", suspended: "warning", offboarded: "neutral" };

type SortKey = "name" | "status" | "hired" | "month" | "balance" | "licence" | "submit";

/**
 * AG-1.1 · the roster, Home › Agency › Producers (2026-11-03): one row per producer — status, role,
 * hire date, this month's submitted and issued, his payable balance (reported), licence health and whether the
 * AG-1.10 gate lets him submit. Pending invites are rows already (status invited). Offboarded producers stay behind
 * the filter: they own policies, they cannot disappear. Every column sorts (the spec); each figure in the strip
 * opens the rows it counts (`?status=`). Invite producer and Finish agency setup sit on the title line.
 */
export function ProducersRoster({ initialFilter = "current" }: { initialFilter?: RosterFilter }) {
  const roster = useAgencyData<{ rows: RosterRow[]; schemaPending: boolean }>("/api/app/agency/producers");
  const dash = useAgencyData<Dash>("/api/app/agency/dashboard");
  const [search, setSearch] = useState("");
  const [status, setStatusLocal] = useState<RosterFilter>(initialFilter);
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "name", dir: "asc" });
  const [page, setPage] = useState(1);

  const setStatus = (next: RosterFilter) => {
    setStatusLocal(next);
    setPage(1);
    try { const url = new URL(window.location.href); if (next === "current") url.searchParams.delete("status"); else url.searchParams.set("status", next); window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}`); } catch { /* the list still filters */ }
  };

  const byUser = useMemo(() => new Map((dash.data?.producers ?? []).map((p) => [p.producerUserId, p])), [dash.data]);
  const soonest = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of dash.data?.alerts ?? []) m.set(a.producerUserId, Math.min(m.get(a.producerUserId) ?? 999, a.daysLeft));
    return m;
  }, [dash.data]);
  const rows = useMemo(() => roster.data?.rows ?? [], [roster.data]);
  const blockedRow = (r: RosterRow) => (r.status === "active" || r.status === "onboarding") && !r.canSubmit;
  const filtered = rows.filter((r) =>
    (status === "all" || (status === "current" ? r.status !== "offboarded" : status === "blocked" ? blockedRow(r) : r.status === status)) &&
    (!search.trim() || `${r.displayName} ${r.email ?? ""}`.toLowerCase().includes(search.trim().toLowerCase())));
  const value = (r: RosterRow, key: SortKey): string | number => {
    const d = byUser.get(r.userId);
    switch (key) {
      case "name": return r.displayName.toLowerCase();
      case "status": return PRODUCER_STATUS_LABELS[r.status];
      case "hired": return r.hiredOn ?? "";
      case "month": return (d?.submitted ?? -1) * 10000 + (d?.issued ?? 0);
      case "balance": return d?.balanceCents ?? Number.MIN_SAFE_INTEGER;
      case "licence": return soonest.get(r.userId) ?? 999;
      case "submit": return r.canSubmit ? 1 : 0;
    }
  };
  const sorted = [...filtered].sort((a, b) => {
    const x = value(a, sort.key), y = value(b, sort.key);
    const order = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
    return sort.dir === "asc" ? order : -order;
  });
  const pageSize = useFittingPageSize(400, 45);
  const { rows: pageRows, current } = paginate(sorted, page, pageSize);
  const active = rows.filter((r) => r.status === "active").length;
  const invited = rows.filter((r) => r.status === "invited").length;
  const blocked = rows.filter(blockedRow).length;

  const head = (key: SortKey, label: React.ReactNode, right = false) => (
    <TableHead className={right ? "text-right" : undefined} aria-sort={sort.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" className="inline-flex items-center gap-1 [font:inherit] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring-color)]" onClick={() => setSort((s) => ({ key, dir: s.key === key && s.dir === "asc" ? "desc" : "asc" }))}>
        {label}<span aria-hidden="true" className={sort.key === key ? "" : "opacity-30"}>{sort.key === key && sort.dir === "desc" ? "↓" : "↑"}</span>
      </button>
      {key === "month" && <InfoTip label="About this month">Applications submitted / policies issued this month.</InfoTip>}
      {key === "balance" && <InfoTip label="About the balance">What each producer is owed, on the reported basis: what the carriers&apos; statements said, before the bank confirms it.</InfoTip>}
    </TableHead>
  );

  return (
    <>
      {roster.data && !roster.data.schemaPending && (
        <StatStrip label="Producers">
          <StatTile label="Active" value={String(active)} href="/app/producers?status=active" />
          <StatTile label="Seats used" value={dash.data ? (dash.data.seats.max === null ? String(dash.data.seats.used) : `${dash.data.seats.used} of ${dash.data.seats.max}`) : "—"} footnote="Active and suspended use one" />
          <StatTile label="Pending invites" value={String(invited)} href="/app/producers?status=invited" />
          <StatTile label="Cannot submit yet" value={String(blocked)} valueTone={blocked ? "warning" : undefined} href="/app/producers?status=blocked" />
        </StatStrip>
      )}
      <TableCard
        toolbar={
          <DataToolbar actions={<RefreshButton onClick={() => { roster.reload(); dash.reload(); refreshStepCounts(); }} refreshing={roster.refreshing} />}>
            <ToolbarSearch value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search producers" label="Search producers" />
            <select aria-label="Status" className={toolbarControl} value={status} onChange={(e) => setStatus(e.target.value as RosterFilter)}>
              <option value="current">Not offboarded</option>
              <option value="all">All</option>
              <option value="blocked">Cannot submit yet</option>
              {(["active", "onboarding", "invited", "suspended", "offboarded"] as ProducerStatus[]).map((s) => <option key={s} value={s}>{PRODUCER_STATUS_LABELS[s]}</option>)}
            </select>
          </DataToolbar>
        }
        footer={sorted.length ? <Pager page={current} total={sorted.length} noun="producers" onPage={setPage} pageSize={pageSize} /> : undefined}
      >
        {roster.error ? <ErrorState detail={roster.error} /> : roster.loading ? <SectionLoading rows={5} columns={9} label="Loading producers" /> : roster.data?.schemaPending ? (
          <EmptyState title="Not switched on yet" hint="Producers appear once the agency database update is applied." />
        ) : rows.length === 0 ? (
          <EmptyState title="No producers yet" hint="Invite your first producer. Their row appears here at once, as invited." action={<Button asChild><Link href="/app/producers/invite">Invite producer</Link></Button>} />
        ) : sorted.length === 0 ? (
          <NoMatches noun="producers" onClear={() => { setSearch(""); setStatus("current"); }} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                {head("name", "Producer")}
                {head("status", "Status")}
                {head("hired", "Hired")}
                {head("month", "This month", true)}
                {head("balance", "Balance", true)}
                {head("licence", "Licence")}
                {head("submit", "Submit")}
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRows.map((r) => {
                const d = byUser.get(r.userId);
                const days = soonest.get(r.userId);
                return (
                  <TableRow key={r.id}>
                    <TableCell className="max-w-[200px] font-medium"><Link className="hover:underline" href={`/app/producers/${r.id}`}>{r.displayName}</Link><div className="truncate text-xs font-normal text-[var(--muted)]" title={r.email ?? undefined}>{[r.role ? MEMBER_ROLE_LABELS[r.role as MemberRole] ?? r.role : null, r.email].filter(Boolean).join(" · ")}</div></TableCell>
                    <TableCell><StatusChip tone={STATUS_TONE[r.status]}>{PRODUCER_STATUS_LABELS[r.status]}</StatusChip></TableCell>
                    <TableCell className="tabular-nums">{r.hiredOn ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums" title={d ? `${d.submitted} submitted · ${d.issued} issued` : undefined}>{d ? `${d.submitted} / ${d.issued}` : "—"}</TableCell>
                    <TableCell className="text-right">{dash.data?.ledgerReady && d ? <Money cents={d.balanceCents} /> : <span className="text-[var(--muted)]">—</span>}</TableCell>
                    <TableCell>{r.status === "invited" ? "—" : days === undefined ? <StatusChip tone="good">OK</StatusChip> : <StatusChip tone={days <= 14 ? "danger" : "warning"}>{days} days</StatusChip>}</TableCell>
                    <TableCell>{r.canSubmit ? <StatusChip tone="good">Can submit</StatusChip> : r.status === "invited" ? <span className="text-[var(--muted)]">{r.inviteExpiresAt ? `${r.inviteExpiresAt.slice(0, 10) < new Date().toISOString().slice(0, 10) ? "Expired" : "Open to"} ${r.inviteExpiresAt.slice(5, 10)}` : "Not yet accepted"}</span> : <StatusChip tone="warning" title={r.canSubmitReason ?? undefined} className="max-w-[180px] truncate">{r.canSubmitReason ?? "Cannot submit"}</StatusChip>}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </TableCard>
    </>
  );
}

/**
 * AG-0.12 · the one-time agency upgrade, on the title line (it was a tinted banner over the roster, which the
 * no-notices rule retired): the existing book becomes the owner's as producer #1. Asks once, then refreshes.
 */
export function FinishSetupButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  async function finish() {
    setBusy(true);
    const { error } = await sendJson("/api/app/agency/upgrade", "POST", {});
    setBusy(false);
    if (error) { notify.fail(error); return; }
    setOpen(false);
    notify.done("Your agency is set up. Your existing book is now yours as producer #1.");
    router.refresh();
  }
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>Finish agency setup</Button>
      <ConfirmDialog open={open} onOpenChange={setOpen} destructive={false} busy={busy} title="Finish setting up your agency?" description="Your existing book becomes yours as producer #1, so its policies and pay follow the agency's rules. It happens once." confirmLabel={busy ? "Setting up…" : "Finish setup"} onConfirm={() => void finish()} />
    </>
  );
}
