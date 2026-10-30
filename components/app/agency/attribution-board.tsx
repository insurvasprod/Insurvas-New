"use client";

import { useMemo, useState } from "react";
import { notify } from "@/lib/notify";

import { PageHeader } from "@/components/ui/page-header";
import { ViewTabs } from "@/components/ui/view-tabs";
import { TableCard } from "@/components/ui/table-card";
import { Pager, paginate } from "@/components/ui/pager";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DataToolbar, RefreshButton, toolbarControl } from "@/components/ui/data-toolbar";
import { DetailPanel } from "@/components/ui/detail-panel";
import { EmptyState, ErrorState, SectionLoading } from "@/components/ui/page-states";
import { Button } from "@/components/ui/button";
import { BasisChip, Money } from "./money";
import { sendJson, useAgencyData } from "./use-agency-data";

type Item = {
  id: string; kind: "disagreement" | "unattributed"; status: "open" | "resolved"; writingNumberUserId: string | null; applicationUserId: string | null;
  carrierName: string | null; policyNumber: string | null; agentIdentifier: string | null; amountCents: number; fileName: string | null; rowNumber: number | null;
  resolvedUserId: string | null; resolvedAt: string | null; reason: string | null;
};
type Producer = { id: string; userId: string; displayName: string };

/**
 * AG-1.4 · statement rows we could not safely give to one producer. The writing number decides; without one, our
 * application record; when both exist and disagree — or neither does — a person decides here, with a reason, and
 * the audit keeps who and why. Until then the row is in nobody's totals, and it is never given to the owner by
 * default. The carrier file itself is never edited.
 */
export function AttributionBoard({ canResolve }: { canResolve: boolean }) {
  const items = useAgencyData<{ items: Item[] }>("/api/app/agency/attribution");
  const roster = useAgencyData<{ rows: Producer[] }>("/api/app/agency/producers");
  const [tab, setTab] = useState<"disagreement" | "unattributed" | "resolved">("disagreement");
  const [open, setOpen] = useState<Item | null>(null);
  const [choice, setChoice] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = useFittingPageSize(420, 45);
  const name = useMemo(() => new Map((roster.data?.rows ?? []).map((p) => [p.userId, p.displayName])), [roster.data]);
  const all = items.data?.items ?? [];
  const rows = all.filter((i) => (tab === "resolved" ? i.status === "resolved" : i.status === "open" && i.kind === tab));
  const shown = paginate(rows, page, pageSize);
  const count = (k: "disagreement" | "unattributed") => all.filter((i) => i.status === "open" && i.kind === k).length;

  function pick(i: (typeof all)[number]) {
    setOpen(i);
    setChoice(i.writingNumberUserId ?? i.applicationUserId ?? "");
    setReason("");
  }

  async function resolve() {
    if (!open) return;
    setBusy(true);
    const { error } = await sendJson("/api/app/agency/attribution", "POST", { itemId: open.id, producerUserId: choice, reason });
    setBusy(false);
    if (error) { notify.fail(error); return; }
    notify.done(`Row ${open.rowNumber ?? ""} is ${name.get(choice) ?? "the producer"}'s. It now counts in their totals.`);
    setOpen(null);
    items.reload();
  }

  return (
    <div className="m-stagger flex min-h-0 flex-grow flex-col gap-6">
      <PageHeader title="Attribution queue" description="Statement rows we could not safely give to one producer." />
      <ViewTabs label="Attribution" value={tab} onChange={(next) => { setTab(next); setPage(1); }} idPrefix="attr-tab" tabs={[
        { key: "disagreement", label: "Disagreements", count: count("disagreement"), tone: count("disagreement") ? "danger" : undefined },
        { key: "unattributed", label: "Unattributed", count: count("unattributed") },
        { key: "resolved", label: "Resolved" },
      ]} />
      <div className="flex min-h-0 flex-col gap-4 lg:flex-row lg:items-stretch">
        <TableCard className="min-w-0 flex-1" toolbar={<DataToolbar actions={<RefreshButton onClick={items.reload} refreshing={items.refreshing} />} />} footer={rows.length ? <Pager page={shown.current} total={rows.length} noun="rows" pageSize={pageSize} onPage={setPage} /> : undefined}>
          {items.error ? <ErrorState detail={items.error} /> : items.loading ? <SectionLoading rows={4} columns={5} label="Loading the queue" /> : rows.length === 0 ? (
            <EmptyState title={tab === "resolved" ? "Nothing resolved yet" : "Nothing waiting"} hint={tab === "resolved" ? "Rows you decide appear here with who decided and why." : tab === "disagreement" ? "No row has a writing number and an application naming different producers." : "Every statement row matched one producer by its writing number or its application."} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>File · row</TableHead><TableHead>Carrier</TableHead><TableHead>Writing no. says</TableHead><TableHead>Application says</TableHead>
                  <TableHead className="text-right">Amount <BasisChip basis="reported" /></TableHead>{tab === "resolved" && <TableHead>Given to</TableHead>}{tab !== "resolved" && canResolve && <TableHead className="text-right"><span className="sr-only">Open</span></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.rows.map((i) => (
                  <TableRow key={i.id} className={open?.id === i.id ? "bg-[var(--primary-soft)]" : canResolve && i.status === "open" ? "cursor-pointer" : undefined} onClick={() => { if (canResolve && i.status === "open") pick(i); }}>
                    <TableCell className="max-w-[16rem] truncate font-medium" title={i.fileName ?? undefined}>{i.fileName ?? "File"} · {i.rowNumber ?? "—"}</TableCell>
                    <TableCell>{i.carrierName ?? "—"}</TableCell>
                    <TableCell>{i.writingNumberUserId ? name.get(i.writingNumberUserId) ?? "A producer" : <span className="text-[var(--muted)]">{i.agentIdentifier ? `${i.agentIdentifier} — not mapped` : "No number"}</span>}</TableCell>
                    <TableCell>{i.applicationUserId ? name.get(i.applicationUserId) ?? "A producer" : <span className="text-[var(--muted)]">No application</span>}</TableCell>
                    <TableCell className="text-right"><Money cents={i.amountCents} /></TableCell>
                    {tab === "resolved" && <TableCell>{i.resolvedUserId ? name.get(i.resolvedUserId) ?? "A producer" : "—"}<div className="text-xs text-[var(--muted)]">{i.reason}</div></TableCell>}
                    {tab !== "resolved" && canResolve && <TableCell className="text-right"><Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); pick(i); }}>Open</Button></TableCell>}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TableCard>
        {open && (
          <DetailPanel mode="split" title={`Row ${open.rowNumber ?? ""} · ${open.policyNumber ?? "policy"}`} subtitle={open.carrierName ?? undefined} onClose={() => setOpen(null)}
            footer={<div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setOpen(null)}>Cancel</Button><Button onClick={resolve} disabled={busy || !choice || !reason.trim()}>{busy ? "Saving…" : "Resolve"}</Button></div>}>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-[var(--muted)]">Writing number</dt><dd>{open.agentIdentifier ?? "—"}{open.writingNumberUserId ? ` → ${name.get(open.writingNumberUserId) ?? "a producer"}` : ""}</dd>
              <dt className="text-[var(--muted)]">Submitted by</dt><dd>{open.applicationUserId ? name.get(open.applicationUserId) ?? "a producer" : "—"}</dd>
              <dt className="text-[var(--muted)]">Amount</dt><dd><Money cents={open.amountCents} /></dd>
            </dl>
            <p className="my-3 rounded-md border-l-[3px] border-l-[var(--info)] bg-[var(--info-surface)] p-2 text-sm text-[var(--info-ink)]">Nothing is paid on this row until it is resolved.</p>
            <div className="grid gap-3 text-sm">
              <label className="grid gap-1 font-medium">Give this row to<select className={toolbarControl} value={choice} onChange={(e) => setChoice(e.target.value)}><option value="">Choose a producer</option>{(roster.data?.rows ?? []).map((p) => <option key={p.userId} value={p.userId}>{p.displayName}</option>)}</select></label>
              <label className="grid gap-1 font-medium">Reason (kept in the audit)<input className={toolbarControl} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} /></label>
            </div>
          </DetailPanel>
        )}
      </div>
    </div>
  );
}
