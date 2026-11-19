"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { carrierHref } from "@/components/admin/layout-maps/shared";
import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { patchQuery } from "@/components/admin/catalog/layout-url";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { DoneStamp } from "@/components/ui/done-stamp";
import { useDoneStamps } from "@/components/ui/use-done-stamps";
import { useDepartures } from "@/components/ui/use-row-exit";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { fileDay, FILE_TYPE_LABELS, type CarrierFileType } from "@/lib/ingestion/constants";
import type { MappingRow, QueueEntry } from "@/lib/ingestion/statusAdmin";
import { shownWord, STATUS_LABELS, STATUS_VOCABULARY, type NormalizedStatus } from "@/lib/ingestion/statuses";
import { notify } from "@/lib/notify";

async function call(url: string, init: RequestInit) {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
  const data = (await response.json().catch(() => ({}))) as { error?: string; heldFiles?: number };
  if (!response.ok) throw new Error(data.error ?? "That did not work; try again.");
  return data;
}

const matches = (needle: string, ...values: string[]) => !needle || values.some((value) => value.toLowerCase().includes(needle));

function CarrierName({ name, code }: { name: string; code: string }) {
  return code ? <Link href={carrierHref(code)} className="font-semibold text-foreground hover:underline">{name}</Link> : <span className="font-semibold text-foreground">{name}</span>;
}

/**
 * LA-4.5 (Notion sprint) · carrier status words nobody has mapped yet, gathered across agencies, and the status map,
 * inside the Catalog frame (admin round 1, catalog screen 11). A word is shown exactly as it arrived (a space is a ·),
 * because "ACTIVE " and "ACTIVE" are different words. Mapping one approves it: the held rows are read again from their
 * raw rows. An approved mapping never changes. Both tables search (`q`, `mq`) and share one carrier filter
 * (`?carrier=<code>`), all in the URL.
 */
export function StatusMapsReview({ initialQueue, initialMappings, pending = false }: { initialQueue: QueueEntry[]; initialMappings: MappingRow[]; pending?: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const [refreshing, startRefresh] = useTransition();
  const [queue, setQueue] = useState(initialQueue);
  const [mappings, setMappings] = useState(initialMappings);
  const [choice, setChoice] = useState<Record<string, NormalizedStatus | "">>({});
  const [busy, setBusy] = useState<string | null>(null);
  const pageSize = useFittingPageSize(420, 45);

  const carrier = (params.get("carrier") ?? "").toLowerCase();
  const wordQuery = (params.get("q") ?? "").trim().toLowerCase();
  const mapQuery = (params.get("mq") ?? "").trim().toLowerCase();
  const mapState = params.get("state") === "proposed" ? "proposed" : params.get("state") === "approved" ? "approved" : "";
  const queuePage = Math.max(1, Number(params.get("page")) || 1);
  const mappingPage = Math.max(1, Number(params.get("mpage")) || 1);
  const set = (patch: Record<string, string | null>) => patchQuery(patch);

  // Every carrier either table names, by code, for the one carrier filter.
  const carrierOptions = useMemo(() => {
    const byCode = new Map<string, string>();
    for (const row of [...queue, ...mappings]) if (row.carrierCode) byCode.set(row.carrierCode.toLowerCase(), row.carrierName);
    return [...byCode.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [queue, mappings]);

  const queueRows = queue.filter((entry) => (!carrier || entry.carrierCode.toLowerCase() === carrier) && matches(wordQuery, entry.raw, shownWord(entry.raw), entry.carrierName));
  const mappingRows = mappings.filter((row) => {
    if (carrier && row.carrierCode.toLowerCase() !== carrier) return false;
    if (mapState === "proposed" && row.approvedAt) return false;
    if (mapState === "approved" && !row.approvedAt) return false;
    return matches(mapQuery, row.raw, shownWord(row.raw), row.carrierName, STATUS_LABELS[row.status].label);
  });
  const shownQueue = paginate(queueRows, queuePage, pageSize);
  // Approve stamps "Approved" on the row, then the reload lands; on Proposed only the row then plays out (Wave D,
  // 2026-11-18). A carrier, state or search change is another list.
  const stamps = useDoneStamps(mappings);
  const leftMappings = useDepartures(mappingRows, (row) => row.id, `${carrier}|${mapState}|${mapQuery}`);
  const shownMappings = paginate(leftMappings.rows, mappingPage, pageSize);

  const rowsHeld = queue.reduce((sum, entry) => sum + entry.rows, 0);
  const carriersWaiting = new Set(queue.map((entry) => entry.carrierId)).size;
  const agenciesAtLeast = queue.reduce((most, entry) => Math.max(most, entry.agencies), 0);
  const approved = mappings.filter((row) => row.approvedAt).length;
  const proposed = mappings.length - approved;

  const keyOf = (entry: QueueEntry) => `${entry.carrierId}|${entry.fileType}|${entry.raw}`;

  async function reload() {
    const response = await fetch("/api/admin/status-maps", { cache: "no-store" });
    const data = (await response.json()) as { queue: QueueEntry[]; mappings: MappingRow[] };
    if (response.ok) { setQueue(data.queue); setMappings(data.mappings); }
    // The status line above is the server's; it reads the new counts too.
    router.refresh();
  }

  async function run(key: string, action: () => Promise<string>, stamp?: string) {
    setBusy(key);
    try {
      notify.done(await action());
      if (stamp) await stamps.stamp(key, stamp, reload);
      else await reload();
    } catch (error) {
      notify.block(error instanceof Error ? error.message : "That did not work.");
    } finally {
      setBusy(null);
    }
  }

  const carrierSelect = (
    <select aria-label="Carrier" className={`${toolbarControl} max-w-[240px]`} value={carrier} onChange={(event) => set({ carrier: event.target.value || null, page: null, mpage: null })}>
      <option value="">Every carrier</option>
      {carrier && !carrierOptions.some(([code]) => code === carrier) && <option value={carrier}>{params.get("carrier")}</option>}
      {carrierOptions.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
    </select>
  );
  const refresh = <RefreshButton onClick={() => startRefresh(() => { void reload(); })} refreshing={refreshing} />;

  return (
    <>
      <StatStrip label="Status map totals">
        <StatTile label="Words waiting" value={queue.length.toLocaleString("en-US")} footnote={queue.length > 0 ? `${carriersWaiting.toLocaleString("en-US")} carrier${carriersWaiting === 1 ? "" : "s"}` : "none waiting"} />
        <StatTile label="Rows held" value={rowsHeld.toLocaleString("en-US")} footnote="until their word is mapped" />
        <StatTile label="Agencies affected" labelTitle="The most agencies behind any one waiting word. One agency can be behind several words, so this is a floor, not a total." value={agenciesAtLeast.toLocaleString("en-US")} footnote={queue.length > 0 ? "at least" : "none held"} />
        <StatTile label="Mappings approved" value={approved.toLocaleString("en-US")} footnote={proposed > 0 ? `${proposed.toLocaleString("en-US")} proposed` : "none proposed"} href={proposed > 0 ? "/admin/status-maps?state=proposed" : undefined} />
      </StatStrip>

      <TableCard
        className="min-w-0"
        title="Waiting to be mapped"
        description="Gathered across agencies: a carrier's word means the same for everyone."
        toolbar={
          <DataToolbar actions={refresh}>
            <ToolbarSearch value={params.get("q") ?? ""} onChange={(next) => set({ q: next || null, page: null })} placeholder="Search word or carrier" />
            {carrierSelect}
          </DataToolbar>
        }
        footer={queueRows.length > 0 ? <Pager page={shownQueue.current} pageSize={pageSize} total={queueRows.length} noun="words" suffix="most rows held first" onPage={(next) => set({ page: next > 1 ? String(next) : null })} /> : undefined}
      >
        {queue.length === 0 ? (
          <EmptyState title={pending ? "The status map is not set up yet" : "No words waiting"} hint={pending ? "The database update in the status line comes first." : "New status words from carrier files appear here before any row is held for long."} />
        ) : queueRows.length === 0 ? (
          <NoMatches noun="words" onClear={() => set({ q: null, carrier: null, page: null })} />
        ) : (
          <table className="portal-lead-table w-full min-w-[980px] text-left text-sm">
            <thead>
              <tr>
                <th className="min-w-[160px]">Carrier</th>
                <th className="w-[120px]">File type</th>
                <th className="min-w-[160px]">The carrier&apos;s word</th>
                <th className="w-[100px] text-right">Rows held</th>
                <th className="w-[90px] text-right">Agencies</th>
                <th className="w-[120px]">First seen</th>
                <th className="w-[220px]">Maps to</th>
                <th className="w-[100px] text-right"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {shownQueue.rows.map((entry) => {
                const key = keyOf(entry);
                const picked = choice[key] ?? entry.proposal?.status ?? "";
                return (
                  <tr key={key}>
                    <td className="max-w-[240px] truncate"><CarrierName name={entry.carrierName} code={entry.carrierCode} /></td>
                    <td>{FILE_TYPE_LABELS[entry.fileType as CarrierFileType] ?? entry.fileType}</td>
                    <td className="max-w-[260px] truncate font-mono text-sm text-foreground" title="Exactly as the carrier sent it; a · is a space">{shownWord(entry.raw)}</td>
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

      <TableCard
        className="min-w-0"
        title="Status map"
        description="An approved mapping is what files were read with; it never changes."
        toolbar={
          <DataToolbar>
            <ToolbarSearch value={params.get("mq") ?? ""} onChange={(next) => set({ mq: next || null, mpage: null })} placeholder="Search word, carrier or status" />
            {carrierSelect}
            <select aria-label="Approval" className={toolbarControl} value={mapState} onChange={(event) => set({ state: event.target.value || null, mpage: null })}>
              <option value="">Approved and proposed</option>
              <option value="proposed">Proposed only</option>
              <option value="approved">Approved only</option>
            </select>
          </DataToolbar>
        }
        footer={mappingRows.length > 0 ? <Pager page={shownMappings.current} pageSize={pageSize} total={mappingRows.length} noun="mappings" suffix="newest first" onPage={(next) => set({ mpage: next > 1 ? String(next) : null })} /> : undefined}
      >
        {mappings.length === 0 ? (
          <EmptyState title="No status mapped yet" hint="Mappings come from the words real carrier files use; none is guessed." />
        ) : leftMappings.rows.length === 0 ? (
          <NoMatches noun="mappings" onClear={() => set({ mq: null, carrier: null, state: null, mpage: null })} />
        ) : (
          <table className="portal-lead-table w-full min-w-[860px] text-left text-sm">
            <thead>
              <tr>
                <th className="min-w-[160px]">Carrier</th>
                <th className="w-[120px]">File type</th>
                <th className="min-w-[160px]">The carrier&apos;s word</th>
                <th className="w-[180px]">Status</th>
                <th className="w-[150px]">Approved</th>
                <th className="w-[190px] text-right"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {shownMappings.rows.map((row) => (
                <tr key={row.id} {...leftMappings.rowProps(row.id)}>
                  <td className="max-w-[240px] truncate"><CarrierName name={row.carrierName} code={row.carrierCode} /></td>
                  <td>{FILE_TYPE_LABELS[row.fileType as CarrierFileType] ?? row.fileType}</td>
                  <td className="max-w-[260px] truncate font-mono text-sm" title="Exactly as the carrier sent it; a · is a space">{shownWord(row.raw)}</td>
                  <td>{STATUS_LABELS[row.status].label}</td>
                  <td>{stamps.labelOf(row.id) ? <DoneStamp label={stamps.labelOf(row.id)!} /> : row.approvedAt ? <span className="tabular-nums">{fileDay(row.approvedAt)}</span> : <StatusChip tone="action">Proposed</StatusChip>}</td>
                  <td className="text-right">
                    {!row.approvedAt && !stamps.labelOf(row.id) && (
                      <div className="inline-flex gap-2">
                        <Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={() => void run(row.id, async () => { await call(`/api/admin/status-maps/${row.id}`, { method: "DELETE" }); return "Proposal discarded."; })}>Discard</Button>
                        <Button type="button" size="sm" disabled={busy !== null} onClick={() => void run(row.id, async () => { const data = await call(`/api/admin/status-maps/${row.id}/approve`, { method: "POST" }); return `Approved.${data.heldFiles ? ` ${data.heldFiles} file${data.heldFiles === 1 ? " is" : "s are"} being read again.` : ""}`; }, "Approved")}>Approve</Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>
    </>
  );
}
