"use client";

import { useState } from "react";

import { AdminPageHeader } from "@/components/admin/page-header";
import { Button } from "@/components/ui/button";
import { toolbarControl } from "@/components/ui/data-toolbar";
import { EmptyState } from "@/components/ui/page-states";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { fileDay } from "@/lib/ingestion/constants";
import type { MappingRow, QueueEntry } from "@/lib/ingestion/statusAdmin";
import { shownWord, STATUS_LABELS, STATUS_VOCABULARY, type NormalizedStatus } from "@/lib/ingestion/statuses";
import { notify } from "@/lib/notify";

async function call(url: string, init: RequestInit) {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
  const data = (await response.json().catch(() => ({}))) as { error?: string; heldFiles?: number };
  if (!response.ok) throw new Error(data.error ?? "That did not work; try again.");
  return data;
}

/**
 * LA-4.5 (Notion sprint) · carrier status words nobody has mapped yet, gathered across agencies, and
 * the status map. A word is shown exactly as it arrived (a space is a ·), because "ACTIVE " and
 * "ACTIVE" are different words. Mapping one approves it: the held rows are read again from their
 * raw rows. An approved mapping never changes.
 */
export function StatusMapsReview({ initialQueue, initialMappings, notice }: { initialQueue: QueueEntry[]; initialMappings: MappingRow[]; notice?: string }) {
  const [queue, setQueue] = useState(initialQueue);
  const [mappings, setMappings] = useState(initialMappings);
  const [choice, setChoice] = useState<Record<string, NormalizedStatus | "">>({});
  const [busy, setBusy] = useState<string | null>(null);

  const keyOf = (entry: QueueEntry) => `${entry.carrierId}|${entry.fileType}|${entry.raw}`;

  async function reload() {
    const response = await fetch("/api/admin/status-maps");
    const data = (await response.json()) as { queue: QueueEntry[]; mappings: MappingRow[] };
    if (response.ok) { setQueue(data.queue); setMappings(data.mappings); }
  }

  async function run(key: string, action: () => Promise<string>) {
    setBusy(key);
    try {
      notify.done(await action());
      await reload();
    } catch (error) {
      notify.block(error instanceof Error ? error.message : "That did not work.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader title="Status maps" subtitle="Every carrier's status words, mapped to the nine statuses the book uses. A word nobody has mapped holds its rows back." />
      {notice && <div role="status" className="rounded-lg border border-border border-l-[3px] border-l-[var(--warning)] bg-[var(--warning-surface)] px-4 py-3 text-sm text-[var(--warning-ink)]">{notice}</div>}

      <TableCard title="Waiting to be mapped" description="Gathered across agencies: a carrier's word means the same for everyone.">
        {queue.length === 0 ? (
          <EmptyState title="No status is waiting" hint="When a carrier file has a status word nobody has mapped, it appears here and its rows are held." />
        ) : (
          <table className="portal-lead-table w-full min-w-[980px] text-left text-sm">
            <thead>
              <tr>
                <th>Carrier</th>
                <th className="w-[120px]">File type</th>
                <th>The carrier&apos;s word</th>
                <th className="w-[90px] text-right">Rows held</th>
                <th className="w-[90px] text-right">Agencies</th>
                <th className="w-[120px]">First seen</th>
                <th className="w-[220px]">Maps to</th>
                <th className="w-[100px] text-right"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {queue.map((entry) => {
                const key = keyOf(entry);
                const picked = choice[key] ?? entry.proposal?.status ?? "";
                return (
                  <tr key={key}>
                    <td className="font-semibold text-foreground">{entry.carrierName}</td>
                    <td>{entry.fileType === "policies" ? "Policies" : "Commissions"}</td>
                    <td className="font-mono text-sm text-foreground" title="Exactly as the carrier sent it; a · is a space">{shownWord(entry.raw)}</td>
                    <td className="text-right tabular-nums">{entry.rows.toLocaleString("en-US")}</td>
                    <td className="text-right tabular-nums">{entry.agencies.toLocaleString("en-US")}</td>
                    <td className="tabular-nums">{fileDay(entry.firstSeenAt)}</td>
                    <td>
                      <select aria-label={`Status for ${entry.raw}`} className={`${toolbarControl} w-full`} value={picked} onChange={(event) => setChoice({ ...choice, [key]: event.target.value as NormalizedStatus })}>
                        <option value="">Choose a status</option>
                        {STATUS_VOCABULARY.map((status) => <option key={status} value={status} title={STATUS_LABELS[status].meaning}>{STATUS_LABELS[status].label}</option>)}
                      </select>
                    </td>
                    <td className="text-right">
                      <Button type="button" size="sm" disabled={!picked || busy !== null} onClick={() => void run(key, async () => {
                        const data = await call("/api/admin/status-maps", { method: "POST", body: JSON.stringify({ carrier_id: entry.carrierId, file_type: entry.fileType, carrier_status_raw: entry.raw, status_normalized: picked }) });
                        return `${shownWord(entry.raw)} is mapped to ${STATUS_LABELS[picked as NormalizedStatus].label}.${data.heldFiles ? ` ${data.heldFiles} file${data.heldFiles === 1 ? " is" : "s are"} being read again.` : ""}`;
                      })}>{busy === key ? "Mapping…" : "Map"}</Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </TableCard>

      <TableCard title="Status map" description="An approved mapping is what files were read with; it never changes.">
        {mappings.length === 0 ? (
          <EmptyState title="No status mapped yet" hint="Mappings come from the words real carrier files use; none is guessed." />
        ) : (
          <table className="portal-lead-table w-full text-left text-sm">
            <thead>
              <tr>
                <th>Carrier</th>
                <th className="w-[120px]">File type</th>
                <th>The carrier&apos;s word</th>
                <th className="w-[180px]">Status</th>
                <th className="w-[150px]">Approved</th>
                <th className="w-[190px] text-right"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {mappings.map((row) => (
                <tr key={row.id}>
                  <td className="font-semibold text-foreground">{row.carrierName}</td>
                  <td>{row.fileType === "policies" ? "Policies" : "Commissions"}</td>
                  <td className="font-mono text-sm">{shownWord(row.raw)}</td>
                  <td>{STATUS_LABELS[row.status].label}</td>
                  <td>{row.approvedAt ? <span className="tabular-nums">{fileDay(row.approvedAt)}</span> : <StatusChip tone="action">Proposed</StatusChip>}</td>
                  <td className="text-right">
                    {!row.approvedAt && (
                      <div className="inline-flex gap-2">
                        <Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={() => void run(row.id, async () => { await call(`/api/admin/status-maps/${row.id}`, { method: "DELETE" }); return "Proposal discarded."; })}>Discard</Button>
                        <Button type="button" size="sm" disabled={busy !== null} onClick={() => void run(row.id, async () => { const data = await call(`/api/admin/status-maps/${row.id}/approve`, { method: "POST" }); return `Approved.${data.heldFiles ? ` ${data.heldFiles} file${data.heldFiles === 1 ? " is" : "s are"} being read again.` : ""}`; })}>Approve</Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>
    </div>
  );
}
