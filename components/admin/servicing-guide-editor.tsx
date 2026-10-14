"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { DataToolbar, toolbarControl } from "@/components/ui/data-toolbar";
import { Input } from "@/components/ui/input";
import { TableCard } from "@/components/ui/table-card";
import { CARRIER_METHOD_LABELS, CARRIER_METHODS, REQUEST_LABELS, REQUEST_TYPES, type RequestType } from "@/lib/retention/servicing";
import type { Guide } from "@/lib/retention/servicingStore";
import { notify } from "@/lib/notify";

type Row = { carrierId: string; carrierName: string; guides: Partial<Record<RequestType, Guide>> };
const blank: Guide = { method: null, whereToDoIt: "", whatTheyNeed: "", clientMustAuthorise: null, formRef: "", notes: "" };

/**
 * LA-5.4 (Notion sprint) · staff write, in plain words, how each carrier takes each servicing change.
 * Agents see it the moment they open a request — "an agent who does not know a carrier needs a signed
 * form will try the portal, fail, and give up". Nothing is pre-filled: a wrong instruction is worse than none.
 */
export function ServicingGuideEditor({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const [carrierId, setCarrierId] = useState(rows[0]?.carrierId ?? "");
  const [drafts, setDrafts] = useState<Record<string, Guide>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const row = rows.find((r) => r.carrierId === carrierId) ?? null;
  const key = (t: RequestType) => `${carrierId}|${t}`;
  const draft = (t: RequestType) => drafts[key(t)] ?? { ...blank, ...(row?.guides[t] ?? {}) };
  const set = (t: RequestType, patch: Partial<Guide>) => setDrafts((all) => ({ ...all, [key(t)]: { ...draft(t), ...patch } }));

  async function save(t: RequestType) {
    const d = draft(t);
    setBusy(t);
    try {
      const response = await fetch("/api/admin/servicing-guides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ carrier_id: carrierId, request_type: t, method: d.method, where_to_do_it: d.whereToDoIt || null, what_they_need: d.whatTheyNeed || null, client_must_authorise: d.clientMustAuthorise, form_ref: d.formRef || null, notes: d.notes || null }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string; result?: string };
      if (!response.ok) throw new Error(data.error ?? "That did not save.");
      notify.done(data.result === "cleared" ? "Instructions cleared." : "Instructions saved.");
      router.refresh();
    } catch (error) {
      notify.block(error instanceof Error ? error.message : "That did not save.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <TableCard
      toolbar={
        <DataToolbar>
          <select aria-label="Carrier" className={toolbarControl} value={carrierId} onChange={(e) => setCarrierId(e.target.value)}>
            {rows.map((r) => <option key={r.carrierId} value={r.carrierId}>{r.carrierName}{Object.keys(r.guides).length ? ` (${Object.keys(r.guides).length} of 4)` : " (none)"}</option>)}
          </select>
        </DataToolbar>
      }
    >
      {row && (
        <table className="portal-lead-table w-full min-w-[1150px] text-left text-sm">
          <thead><tr><th className="w-[160px]">Change</th><th className="w-[150px]">How</th><th>Where</th><th className="w-[200px]">They ask for</th><th className="w-[140px]">Client authorises</th><th className="w-[140px]">Form</th><th className="w-[180px]">Notes</th><th className="w-[80px] text-right"><span className="sr-only">Save</span></th></tr></thead>
          <tbody>
            {REQUEST_TYPES.map((t) => {
              const d = draft(t);
              return (
                <tr key={t}>
                  <td className="font-semibold text-foreground">{REQUEST_LABELS[t]}<span className="block text-xs font-normal text-muted-foreground">{row.guides[t] ? "written" : "not written yet"}</span></td>
                  <td>
                    <select aria-label={`How ${row.carrierName} takes it`} className={`${toolbarControl} w-full`} value={d.method ?? ""} onChange={(e) => set(t, { method: (e.target.value || null) as Guide["method"] })}>
                      <option value="">Not known</option>
                      {CARRIER_METHODS.map((m) => <option key={m} value={m}>{CARRIER_METHOD_LABELS[m]}</option>)}
                    </select>
                  </td>
                  <td><Input aria-label="Where" className="h-9" maxLength={1000} value={d.whereToDoIt ?? ""} onChange={(e) => set(t, { whereToDoIt: e.target.value })} /></td>
                  <td><Input aria-label="They ask for" className="h-9" maxLength={1000} value={d.whatTheyNeed ?? ""} onChange={(e) => set(t, { whatTheyNeed: e.target.value })} /></td>
                  <td>
                    <select aria-label="Client authorises" className={`${toolbarControl} w-full`} value={d.clientMustAuthorise === null ? "" : d.clientMustAuthorise ? "yes" : "no"} onChange={(e) => set(t, { clientMustAuthorise: e.target.value === "" ? null : e.target.value === "yes" })}>
                      <option value="">Not known</option>
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </select>
                  </td>
                  <td><Input aria-label="Form" className="h-9" maxLength={200} value={d.formRef ?? ""} onChange={(e) => set(t, { formRef: e.target.value })} /></td>
                  <td><Input aria-label="Notes" className="h-9" maxLength={2000} value={d.notes ?? ""} onChange={(e) => set(t, { notes: e.target.value })} /></td>
                  <td className="text-right"><Button type="button" disabled={busy !== null} onClick={() => void save(t)}>Save</Button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </TableCard>
  );
}
