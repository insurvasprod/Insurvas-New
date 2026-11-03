"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { notify } from "@/lib/notify";

import { PageHeader } from "@/components/ui/page-header";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { EmptyState, ErrorState, NoMatches, SectionLoading } from "@/components/ui/page-states";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { Pager, paginate } from "@/components/ui/pager";
import { Button } from "@/components/ui/button";
import { PRODUCER_STATUS_LABELS, type ProducerStatus } from "@/lib/agency/constants";
import { MEMBER_ROLE_LABELS, type MemberRole } from "@/lib/tenantAuth/roles";
import { BasisChip, Money } from "./money";
import { InviteProducerDialog } from "./invite-producer-dialog";
import { sendJson, useAgencyData } from "./use-agency-data";

type RosterRow = {
  id: string; userId: string; displayName: string; email: string | null; status: ProducerStatus; role: string | null;
  hiredOn: string | null; canSubmit: boolean; canSubmitReason: string | null; inviteExpiresAt: string | null;
};
type DashRow = { producerUserId: string; submitted: number; issued: number; balanceCents: number | null };
type Dash = { producers: DashRow[]; alerts: Array<{ producerUserId: string; daysLeft: number }>; seats: { used: number; max: number | null }; ledgerReady: boolean };

export const STATUS_TONE: Record<ProducerStatus, StatusTone> = { invited: "neutral", onboarding: "info", active: "good", suspended: "warning", offboarded: "neutral" };

/**
 * AG-1.1 · the roster: one row per producer — status, role, hire date, this month's submitted and issued, his
 * payable balance (reported) and a licence-health dot. Pending invites are rows already (status invited).
 * Offboarded producers stay behind the filter: they own policies, they cannot disappear.
 */
export function ProducersRoster({ isAccountOwner, canManage, needsUpgrade }: { isAccountOwner: boolean; canManage: boolean; needsUpgrade: boolean }) {
  const params = useSearchParams();
  const router = useRouter();
  const roster = useAgencyData<{ rows: RosterRow[]; schemaPending: boolean }>("/api/app/agency/producers");
  const dash = useAgencyData<Dash>("/api/app/agency/dashboard");
  const [inviteOpen, setInviteOpen] = useState(params.get("invite") === "1" && canManage);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"current" | "all" | ProducerStatus>("current");
  const [page, setPage] = useState(1);
  const [upgrading, setUpgrading] = useState(false);

  useEffect(() => { if (params.get("invite") === "1") router.replace("/app/producers"); }, [params, router]);

  const byUser = useMemo(() => new Map((dash.data?.producers ?? []).map((p) => [p.producerUserId, p])), [dash.data]);
  const soonest = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of dash.data?.alerts ?? []) m.set(a.producerUserId, Math.min(m.get(a.producerUserId) ?? 999, a.daysLeft));
    return m;
  }, [dash.data]);
  const rows = roster.data?.rows ?? [];
  const filtered = rows.filter((r) =>
    (status === "all" || (status === "current" ? r.status !== "offboarded" : r.status === status)) &&
    (!search.trim() || `${r.displayName} ${r.email ?? ""}`.toLowerCase().includes(search.trim().toLowerCase())));
  const pageSize = useFittingPageSize(480, 45);
  const { rows: pageRows, current } = paginate(filtered, page, pageSize);
  const active = rows.filter((r) => r.status === "active").length;
  const invited = rows.filter((r) => r.status === "invited").length;
  const blocked = rows.filter((r) => (r.status === "active" || r.status === "onboarding") && !r.canSubmit).length;

  async function finishUpgrade() {
    setUpgrading(true);
    const { error } = await sendJson("/api/app/agency/upgrade", "POST", {});
    setUpgrading(false);
    if (error) { notify.fail(error); return; }
    notify.done("Your agency is set up. Your existing book is now yours as producer #1.");
    roster.reload();
    dash.reload();
  }

  return (
    <div className="m-stagger flex min-h-0 flex-grow flex-col gap-6">
      <PageHeader title="Producers" description="Everyone who writes business under your agency's contracts." actions={canManage ? <Button onClick={() => setInviteOpen(true)}>Invite producer</Button> : undefined} />
      {needsUpgrade && isAccountOwner && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border-l-[3px] border-l-[var(--primary)] bg-[var(--primary-soft)] p-3 text-sm">
          <span>Finish setting up your agency: your existing book becomes yours as producer #1.</span>
          <Button onClick={finishUpgrade} disabled={upgrading}>{upgrading ? "Setting up…" : "Finish setup"}</Button>
        </div>
      )}
      {roster.data && (
        <StatStrip label="Producers">
          <StatTile label="Active" value={String(active)} />
          <StatTile label="Seats used" value={dash.data ? (dash.data.seats.max === null ? String(dash.data.seats.used) : `${dash.data.seats.used} of ${dash.data.seats.max}`) : "—"} />
          <StatTile label="Pending invites" value={String(invited)} />
          <StatTile label="Cannot submit yet" value={String(blocked)} valueTone={blocked ? "warning" : undefined} />
        </StatStrip>
      )}
      <TableCard
        toolbar={
          <DataToolbar actions={<RefreshButton onClick={() => { roster.reload(); dash.reload(); }} refreshing={roster.refreshing} />}>
            <ToolbarSearch value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search producers" label="Search producers" />
            <select aria-label="Status" className={toolbarControl} value={status} onChange={(e) => { setStatus(e.target.value as typeof status); setPage(1); }}>
              <option value="current">Not offboarded</option>
              <option value="all">All</option>
              {(["active", "onboarding", "invited", "suspended", "offboarded"] as ProducerStatus[]).map((s) => <option key={s} value={s}>{PRODUCER_STATUS_LABELS[s]}</option>)}
            </select>
          </DataToolbar>
        }
        footer={filtered.length ? <Pager page={current} total={filtered.length} noun="producers" onPage={setPage} pageSize={pageSize} /> : undefined}
      >
        {roster.error ? <ErrorState detail={roster.error} /> : roster.loading ? <SectionLoading rows={5} columns={8} label="Loading producers" /> : roster.data?.schemaPending ? (
          <EmptyState title="Not switched on yet" hint="Producers appear once the agency database update is applied." />
        ) : rows.length === 0 ? (
          <EmptyState title="No producers yet" hint="Invite your first producer. Their row appears here at once, as invited." action={canManage ? <Button onClick={() => setInviteOpen(true)}>Invite producer</Button> : undefined} />
        ) : filtered.length === 0 ? (
          <NoMatches noun="producers" onClear={() => { setSearch(""); setStatus("current"); }} />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Producer</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Hired</TableHead>
                <TableHead className="text-right">Submitted</TableHead>
                <TableHead className="text-right">Issued</TableHead>
                <TableHead className="text-right">Balance <BasisChip basis="reported" /></TableHead>
                <TableHead>Licence</TableHead>
                <TableHead>Submit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageRows.map((r) => {
                const d = byUser.get(r.userId);
                const days = soonest.get(r.userId);
                return (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium"><Link className="hover:underline" href={`/app/producers/${r.id}`}>{r.displayName}</Link>{r.email && <div className="text-xs text-[var(--muted)]">{r.email}</div>}</TableCell>
                    <TableCell><StatusChip tone={STATUS_TONE[r.status]}>{PRODUCER_STATUS_LABELS[r.status]}</StatusChip></TableCell>
                    <TableCell>{r.role ? MEMBER_ROLE_LABELS[r.role as MemberRole] ?? r.role : "—"}</TableCell>
                    <TableCell className="tabular-nums">{r.status === "invited" ? (r.inviteExpiresAt ? `invite expires ${r.inviteExpiresAt.slice(0, 10)}` : "invited") : r.hiredOn ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{d ? d.submitted : "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{d ? d.issued : "—"}</TableCell>
                    <TableCell className="text-right">{dash.data?.ledgerReady && d ? <Money cents={d.balanceCents} /> : <span className="text-[var(--muted)]">—</span>}</TableCell>
                    <TableCell>{r.status === "invited" ? "—" : days === undefined ? <StatusChip tone="good">OK</StatusChip> : <StatusChip tone={days <= 14 ? "danger" : "warning"}>{days} days</StatusChip>}</TableCell>
                    <TableCell>{r.canSubmit ? <StatusChip tone="good">Can submit</StatusChip> : r.status === "invited" ? <span className="text-[var(--muted)]">Not yet accepted</span> : <StatusChip tone="warning" title={r.canSubmitReason ?? undefined}>{r.canSubmitReason ?? "Cannot submit"}</StatusChip>}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </TableCard>
      {canManage && <InviteProducerDialog open={inviteOpen} onOpenChange={setInviteOpen} isAccountOwner={isAccountOwner} onInvited={() => roster.reload()} />}
    </div>
  );
}
