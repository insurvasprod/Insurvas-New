"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { DataToolbar, ToolbarCheckbox, ToolbarSearch } from "@/components/ui/data-toolbar";
import { Input } from "@/components/ui/input";
import { NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { TableCard } from "@/components/ui/table-card";
import type { Guidance } from "@/lib/ingestion/bookImport";
import { notify } from "@/lib/notify";

type Row = { carrierId: string; carrierName: string; guidance: Guidance | null; updatedAt: string | null };
const blank: Guidance = { whereInPortal: "", reportName: "", formatHint: "", notes: "" };

/**
 * LA-4.10 (Notion sprint) · staff write, in plain words, where each carrier keeps its policy file —
 * which menu, what the report is called, which format to choose. Agencies see it on the import
 * screen the moment it is saved.
 */
export function CarrierGuidanceEditor({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [missingOnly, setMissingOnly] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Guidance>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const visible = rows.filter((r) => (!query.trim() || r.carrierName.toLowerCase().includes(query.trim().toLowerCase())) && (!missingOnly || !r.guidance));
  const shown = paginate(visible, page, 10);
  // A new search or filter starts from the first page.
  const search = (value: string) => { setQuery(value); setPage(1); };
  const filterMissing = (value: boolean) => { setMissingOnly(value); setPage(1); };
  const draft = (r: Row) => drafts[r.carrierId] ?? { ...blank, ...(r.guidance ?? {}) };
  const set = (r: Row, patch: Partial<Guidance>) => setDrafts((all) => ({ ...all, [r.carrierId]: { ...draft(r), ...patch } }));

  async function save(r: Row) {
    const d = draft(r);
    setBusy(r.carrierId);
    try {
      const response = await fetch("/api/admin/carrier-guidance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ carrier_id: r.carrierId, where_in_portal: d.whereInPortal || null, report_name: d.reportName || null, format_hint: d.formatHint || null, notes: d.notes || null }) });
      const data = (await response.json().catch(() => ({}))) as { error?: string; result?: string };
      if (!response.ok) throw new Error(data.error ?? "That did not save.");
      notify.done(data.result === "cleared" ? "Guidance cleared." : "Guidance saved.");
      router.refresh();
    } catch (error) {
      notify.block(error instanceof Error ? error.message : "That did not save.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <TableCard
      toolbar={<DataToolbar><ToolbarSearch value={query} onChange={search} placeholder="Search carriers" /><ToolbarCheckbox checked={missingOnly} onChange={filterMissing} label="Only carriers with no guidance" /></DataToolbar>}
      footer={visible.length > 0 ? <Pager page={shown.current} pageSize={10} total={visible.length} noun="carriers" onPage={setPage} /> : undefined}
    >
      {visible.length === 0 ? <NoMatches noun="carriers" onClear={() => { setQuery(""); setMissingOnly(false); setPage(1); }} /> : (
        <table className="portal-lead-table w-full min-w-[1100px] text-left text-sm">
          <thead><tr><th className="w-[170px]">Carrier</th><th>Where in the portal</th><th className="w-[200px]">Report is called</th><th className="w-[170px]">Format to choose</th><th className="w-[220px]">Notes</th><th className="w-[90px] text-right"><span className="sr-only">Save</span></th></tr></thead>
          <tbody>
            {shown.rows.map((r) => {
              const d = draft(r);
              return (
                <tr key={r.carrierId}>
                  <td className="font-semibold text-foreground">{r.carrierName}<span className="block text-xs font-normal text-muted-foreground">{r.guidance ? `saved ${r.updatedAt?.slice(0, 10) ?? ""}` : "no guidance yet"}</span></td>
                  <td><Input aria-label={`Where in the portal for ${r.carrierName}`} className="h-9" maxLength={1000} value={d.whereInPortal ?? ""} onChange={(e) => set(r, { whereInPortal: e.target.value })} /></td>
                  <td><Input aria-label="Report name" className="h-9" maxLength={200} value={d.reportName ?? ""} onChange={(e) => set(r, { reportName: e.target.value })} /></td>
                  <td><Input aria-label="Format" className="h-9" maxLength={200} value={d.formatHint ?? ""} onChange={(e) => set(r, { formatHint: e.target.value })} /></td>
                  <td><Input aria-label="Notes" className="h-9" maxLength={2000} value={d.notes ?? ""} onChange={(e) => set(r, { notes: e.target.value })} /></td>
                  <td className="text-right"><Button type="button" size="sm" disabled={busy !== null} onClick={() => void save(r)}>Save</Button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </TableCard>
  );
}
