"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { DataToolbar, RefreshButton, toolbarControl } from "@/components/ui/data-toolbar";
import { EmptyState } from "@/components/ui/page-states";
import { TableCard } from "@/components/ui/table-card";
import type { CarrierImport } from "@/lib/ingestion/bookImport";
import { notify } from "@/lib/notify";

const money = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;

/** "Americo — 112 policies, $8,420/mo. 3 at risk." — the moment each upload is worth it. */
function resultLine(c: CarrierImport): { text: string; tone: "muted" | "ok" | "warn" | "busy" } {
  if (c.status === "skipped" && !c.file) return { text: "Skipped for now — import it any time.", tone: "muted" };
  if (!c.file) return { text: "Not imported yet", tone: "muted" };
  if (c.file.status === "received" || c.file.status === "parsing") return { text: "Reading the file…", tone: "busy" };
  if (c.file.status === "failed") return { text: c.file.error ?? "The file could not be read.", tone: "warn" };
  if (c.file.block) return { text: c.file.block, tone: "warn" };
  const r = c.result;
  const held = c.file.held ? ` ${c.file.held.toLocaleString("en-US")} rows wait for a status word to be mapped.` : "";
  if (!r) return { text: `Read — no policies yet.${held}`, tone: held ? "warn" : "muted" };
  return { text: `${r.policies.toLocaleString("en-US")} ${r.policies === 1 ? "policy" : "policies"}, ${money(r.monthlyPremiumCents)}/mo. ${r.atRisk.toLocaleString("en-US")} at risk.${held}`, tone: held ? "warn" : "ok" };
}

const TONE = { muted: "text-muted-foreground", ok: "font-semibold text-foreground", warn: "text-[var(--warning-ink)]", busy: "text-muted-foreground italic" } as const;

/**
 * LA-4.10 (Notion sprint) · import the book one carrier at a time. Each upload is read straight away
 * and its result shown on its row before the next; skipping is allowed and can be taken back.
 */
export function BookImport({ carriers, others, processing, readOnly }: { carriers: CarrierImport[]; others: Array<{ id: string; name: string }>; processing: boolean; readOnly: boolean }) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [extra, setExtra] = useState<Array<{ id: string; name: string }>>([]);
  const [dates, setDates] = useState<Record<string, string>>({});
  const [over, setOver] = useState<string | null>(null);
  const inputs = useRef<Record<string, HTMLInputElement | null>>({});
  const today = new Date().toISOString().slice(0, 10);

  // While a file is being read, look again every few seconds, so its result appears on its own.
  useEffect(() => {
    if (!processing) return;
    const timer = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(timer);
  }, [processing, router]);

  const rows: CarrierImport[] = [
    ...carriers,
    ...extra.filter((e) => !carriers.some((c) => c.carrierId === e.id)).map((e): CarrierImport => ({ carrierId: e.id, carrierName: e.name, writes: false, status: "pending", guidance: null, file: null, result: null, summary: null })),
  ];

  async function upload(carrierId: string, file: File) {
    setBusy(carrierId);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("carrier_id", carrierId);
      form.set("file_date", dates[carrierId] ?? today);
      const response = await fetch("/api/app/book-import", { method: "POST", body: form });
      const data = (await response.json().catch(() => ({}))) as { error?: string; outcome?: string };
      if (!response.ok) throw new Error(data.error ?? "That file did not upload.");
      notify.done(data.outcome === "skipped" ? "That exact file was already here — using it." : "Uploaded. Reading it now…");
      router.refresh();
    } catch (error) {
      notify.block(error instanceof Error ? error.message : "That file did not upload.");
    } finally {
      setBusy(null);
    }
  }

  async function skip(carrierId: string, action: "skip" | "unskip") {
    setBusy(carrierId);
    try {
      const response = await fetch("/api/app/book-import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, carrier_id: carrierId }) });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "That did not save.");
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
        <DataToolbar actions={<RefreshButton onClick={() => startRefresh(() => router.refresh())} refreshing={refreshing} />}>
          <select aria-label="Add another carrier" className={`${toolbarControl} w-[240px]`} value="" disabled={readOnly} onChange={(e) => { const pick = others.find((o) => o.id === e.target.value); if (pick) setExtra((all) => [...all, pick]); }}>
            <option value="">Add another carrier…</option>
            {others.filter((o) => !extra.some((e) => e.id === o.id)).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </DataToolbar>
      }
    >
      {rows.length === 0 ? (
        <EmptyState title="No carriers yet" hint="Add the carriers you write, then upload each one's latest policy file." />
      ) : (
        <table className="portal-lead-table w-full min-w-[980px] text-left text-sm">
          <thead><tr><th className="w-[200px]">Carrier</th><th>Where to find the file</th><th className="w-[300px]">Result</th><th className="w-[150px]">File date</th><th className="w-[200px] text-right"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {rows.map((c) => {
              const line = resultLine(c);
              const g = c.guidance;
              return (
                <tr
                  key={c.carrierId}
                  className={over === c.carrierId ? "outline outline-2 outline-[var(--primary)]" : undefined}
                  onDragOver={(e) => { if (!readOnly) { e.preventDefault(); setOver(c.carrierId); } }}
                  onDragLeave={() => setOver((cur) => (cur === c.carrierId ? null : cur))}
                  onDrop={(e) => { e.preventDefault(); setOver(null); const file = e.dataTransfer.files?.[0]; if (file && !readOnly) void upload(c.carrierId, file); }}
                >
                  <td className="font-semibold text-foreground">{c.carrierName}{c.writes && <span className="block text-xs font-normal text-muted-foreground">you write this carrier</span>}</td>
                  <td>
                    {g ? (
                      <span className="block text-sm">
                        {g.whereInPortal}
                        {g.reportName && <span className="block text-xs text-muted-foreground">Usually called: {g.reportName}</span>}
                        {g.formatHint && <span className="block text-xs text-muted-foreground">Choose: {g.formatHint}</span>}
                        {g.notes && <span className="block text-xs text-muted-foreground">{g.notes}</span>}
                      </span>
                    ) : <span className="text-muted-foreground">Download the carrier&apos;s latest policy (in-force) report from its agent portal.</span>}
                  </td>
                  <td className={TONE[line.tone]} role="status">{line.text}</td>
                  <td><input type="date" aria-label={`File date for ${c.carrierName}`} className={`${toolbarControl} w-full`} value={dates[c.carrierId] ?? today} max={today} disabled={readOnly} onChange={(e) => setDates((all) => ({ ...all, [c.carrierId]: e.target.value }))} /></td>
                  <td className="text-right">
                    <input ref={(el) => { inputs.current[c.carrierId] = el; }} type="file" accept=".csv,.xlsx" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void upload(c.carrierId, file); }} />
                    {!readOnly && (
                      <span className="inline-flex gap-2">
                        <Button type="button" size="sm" disabled={busy !== null} onClick={() => inputs.current[c.carrierId]?.click()}>{busy === c.carrierId ? "Uploading…" : c.file ? "Replace" : "Upload"}</Button>
                        {c.status === "skipped" ? <Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={() => void skip(c.carrierId, "unskip")}>Undo skip</Button>
                          : !c.file && <Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={() => void skip(c.carrierId, "skip")}>Skip for now</Button>}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </TableCard>
  );
}
