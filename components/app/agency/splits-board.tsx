"use client";

import { useMemo, useState } from "react";
import { notify } from "@/lib/notify";

import { PageHeader } from "@/components/ui/page-header";
import { TableCard } from "@/components/ui/table-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { DetailPanel } from "@/components/ui/detail-panel";
import { EmptyState, ErrorState, NoMatches, SectionLoading } from "@/components/ui/page-states";
import { Button } from "@/components/ui/button";
import { bpsToPercent, dollars, dollarsToCents, percentToBps } from "@/lib/agency/constants";
import { computeOverride, splitPool } from "@/lib/agency/overrideCore";
import { sendJson, useAgencyData } from "./use-agency-data";

type Split = { setId: string; carrierId: string; carrierName: string | null; policyNumber: string; writerUserId: string | null; shares: Array<{ producerUserId: string; shareBps: number; isWriter: boolean }>; createdAt: string };
type OverrideRow = { producerUserId: string; producerName: string; carrierId: string; carrierName: string; agencyLevelBps: number | null; producerLevelBps: number | null };

/**
 * AG-1.6 · Commission splits — policies two producers agreed to share. Not an override: the override is computed,
 * a split is entered. Order, fixed: agency commission → the WRITER's pool → the owner's override → the split of
 * the pool. The non-writer's own level is not applied; he gets his share of the writer's pool. Shares must add up
 * to exactly 100% — anything else is refused, never normalised.
 */
export function SplitsBoard({ canEdit }: { canEdit: boolean }) {
  const splits = useAgencyData<{ splits: Split[] }>("/api/app/agency/splits");
  const levels = useAgencyData<{ rows: OverrideRow[] }>("/api/app/agency/overrides");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<null | { carrierId: string; policyNumber: string; writer: string; other: string; writerPercent: string; premium: string }>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const names = useMemo(() => new Map((levels.data?.rows ?? []).map((r) => [r.producerUserId, r.producerName])), [levels.data]);
  const carriers = useMemo(() => [...new Map((levels.data?.rows ?? []).map((r) => [r.carrierId, r.carrierName])).entries()], [levels.data]);
  const producers = useMemo(() => [...names.entries()].sort((a, b) => a[1].localeCompare(b[1])), [names]);
  const rows = (splits.data?.splits ?? []).filter((s) => !search.trim() || `${s.policyNumber} ${s.carrierName ?? ""} ${s.shares.map((x) => names.get(x.producerUserId) ?? "").join(" ")}`.toLowerCase().includes(search.trim().toLowerCase()));

  // the four steps for the panel, on a typed premium, with the same integer engine the database uses
  const preview = useMemo(() => {
    if (!editing) return null;
    const writerBps = percentToBps(editing.writerPercent);
    const premium = dollarsToCents(editing.premium);
    const lv = (levels.data?.rows ?? []).find((r) => r.carrierId === editing.carrierId && r.producerUserId === editing.writer);
    if (writerBps === null || writerBps <= 0 || writerBps >= 10000 || !premium || !lv) return { writerBps, result: null, parts: null };
    const result = computeOverride({ annualPremiumCents: premium, agencyLevelBps: lv.agencyLevelBps, producerLevelBps: lv.producerLevelBps });
    const parts = result.producerPoolCents === null ? null : splitPool(result.producerPoolCents, [{ producerUserId: editing.writer, shareBps: writerBps }, { producerUserId: editing.other, shareBps: 10000 - writerBps }]);
    return { writerBps, result, parts };
  }, [editing, levels.data]);

  async function save() {
    if (!editing || !preview?.writerBps) return;
    setBusy(true);
    const { error } = await sendJson("/api/app/agency/splits", "PUT", {
      carrierId: editing.carrierId,
      policyNumber: editing.policyNumber.trim(),
      writerUserId: editing.writer,
      shares: [{ producerUserId: editing.writer, shareBps: preview.writerBps }, { producerUserId: editing.other, shareBps: 10000 - preview.writerBps }],
    });
    setBusy(false);
    if (error) { setProblem(error); return; }
    notify.done(`Split saved for ${editing.policyNumber.trim()}. Statements from now on divide its pool ${bpsToPercent(preview.writerBps)} / ${bpsToPercent(10000 - preview.writerBps)}.`);
    setEditing(null);
    splits.reload();
  }

  const start = () => { setProblem(null); setEditing({ carrierId: carriers[0]?.[0] ?? "", policyNumber: "", writer: producers[0]?.[0] ?? "", other: producers[1]?.[0] ?? "", writerPercent: "60", premium: "" }); };

  return (
    <div className="m-stagger flex min-h-0 flex-grow flex-col gap-6">
      <PageHeader title="Commission splits" description="Policies two producers share, split from the writer's pool after the override." actions={canEdit ? <Button onClick={start} disabled={producers.length < 2}>New split</Button> : undefined} />
      <div className="flex min-h-0 flex-col gap-4 lg:flex-row lg:items-stretch">
        <TableCard className="min-w-0 flex-1" toolbar={
          <DataToolbar actions={<RefreshButton onClick={splits.reload} refreshing={splits.refreshing} />}>
            <ToolbarSearch value={search} onChange={setSearch} placeholder="Search policy or producer" label="Search splits" />
          </DataToolbar>
        }>
          {splits.error ? <ErrorState detail={splits.error} /> : splits.loading ? <SectionLoading rows={4} columns={4} label="Loading splits" /> : (splits.data?.splits.length ?? 0) === 0 ? (
            <EmptyState title="No shared policies" hint="When two producers agree to share a policy, record the split here so both statements show it." action={canEdit && producers.length >= 2 ? <Button onClick={start}>New split</Button> : undefined} />
          ) : rows.length === 0 ? <NoMatches noun="splits" by="search" onClear={() => setSearch("")} /> : (
            <Table>
              <TableHeader><TableRow><TableHead>Policy</TableHead><TableHead>Carrier</TableHead><TableHead>Writer</TableHead><TableHead>Shared with</TableHead><TableHead className="text-right">Split</TableHead><TableHead>Since</TableHead></TableRow></TableHeader>
              <TableBody>
                {rows.map((s) => {
                  const writer = s.shares.find((x) => x.isWriter);
                  const others = s.shares.filter((x) => !x.isWriter);
                  return (
                    <TableRow key={s.setId}>
                      <TableCell className="font-mono text-xs">{s.policyNumber}</TableCell>
                      <TableCell>{s.carrierName ?? "—"}</TableCell>
                      <TableCell>{writer ? names.get(writer.producerUserId) ?? "Producer" : "—"}</TableCell>
                      <TableCell>{others.map((o) => names.get(o.producerUserId) ?? "Producer").join(", ")}</TableCell>
                      <TableCell className="text-right tabular-nums">{s.shares.map((x) => bpsToPercent(x.shareBps).replace("%", "")).join(" / ")}</TableCell>
                      <TableCell className="tabular-nums">{s.createdAt.slice(0, 10)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </TableCard>
        {editing && (
          <DetailPanel mode="split" title="New split" subtitle="The pool uses the writer's level. The other producer's own level is not applied." onClose={() => setEditing(null)}
            footer={<div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button><Button onClick={save} disabled={busy || !editing.policyNumber.trim() || !preview?.writerBps || editing.writer === editing.other}>{busy ? "Saving…" : "Save split"}</Button></div>}>
            <div className="grid gap-3 text-sm">
              <label className="grid gap-1 font-medium">Carrier<select className={toolbarControl} value={editing.carrierId} onChange={(e) => setEditing({ ...editing, carrierId: e.target.value })}>{carriers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
              <label className="grid gap-1 font-medium">Policy number<input className={`${toolbarControl} font-mono`} value={editing.policyNumber} onChange={(e) => setEditing({ ...editing, policyNumber: e.target.value })} /></label>
              <div className="grid grid-cols-2 gap-2">
                <label className="grid gap-1 font-medium">Writer<select className={toolbarControl} value={editing.writer} onChange={(e) => setEditing({ ...editing, writer: e.target.value })}>{producers.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
                <label className="grid gap-1 font-medium">Shared with<select className={toolbarControl} value={editing.other} onChange={(e) => setEditing({ ...editing, other: e.target.value })}>{producers.filter(([id]) => id !== editing.writer).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
              </div>
              <label className="grid gap-1 font-medium">Writer&apos;s share (%)<input inputMode="decimal" className={toolbarControl} value={editing.writerPercent} onChange={(e) => setEditing({ ...editing, writerPercent: e.target.value })} /></label>
              <p className="text-[var(--muted)]">The other producer gets {preview?.writerBps && preview.writerBps < 10000 ? bpsToPercent(10000 - preview.writerBps) : "—"}. Shares always add up to exactly 100%.</p>
              <label className="grid gap-1 font-medium">Annual premium, to preview ($)<input inputMode="decimal" placeholder="e.g. 1200" className={toolbarControl} value={editing.premium} onChange={(e) => setEditing({ ...editing, premium: e.target.value })} /></label>
              {preview?.result && (
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-md border border-border p-2"><div className="font-semibold tabular-nums">{preview.result.agencyCommissionCents === null ? "—" : dollars(preview.result.agencyCommissionCents)}</div><div className="text-xs text-[var(--muted)]">1 · agency commission</div></div>
                  <div className="rounded-md border border-border p-2"><div className="font-semibold tabular-nums">{preview.result.producerPoolCents === null ? "— set level" : dollars(preview.result.producerPoolCents)}</div><div className="text-xs text-[var(--muted)]">2 · writer&apos;s pool</div></div>
                  <div className="rounded-md border border-border p-2"><div className="font-semibold tabular-nums">{preview.result.overrideCents === null ? "—" : dollars(preview.result.overrideCents)}</div><div className="text-xs text-[var(--muted)]">3 · override</div></div>
                </div>
              )}
              {preview?.parts && <p>4 · {preview.parts.map((p) => `${names.get(p.producerUserId) ?? "Producer"} ${dollars(p.amountCents)}`).join(" · ")}</p>}
              {problem && <p role="alert" className="rounded-md border-l-[3px] border-l-[var(--error)] bg-[var(--error-surface)] p-2 text-[var(--error-ink)]">{problem}</p>}
            </div>
          </DetailPanel>
        )}
      </div>
    </div>
  );
}
