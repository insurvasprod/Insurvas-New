"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { CarrierSetupDot } from "@/components/admin/catalog/carrier-setup-dot";
import { Button } from "@/components/ui/button";
import { DataToolbar, ToolbarCheckbox, ToolbarSearch, toolbarControl } from "@/components/ui/data-toolbar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setParamsInPlace } from "@/components/ui/nav-pending";
import { EmptyState, NoMatches } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { Sheet } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { notify } from "@/lib/notify";
import { CARRIER_METHOD_LABELS, CARRIER_METHODS, REQUEST_LABELS, REQUEST_TYPES, type RequestType } from "@/lib/retention/servicing";
import type { Guide } from "@/lib/retention/servicingStore";

export type ServicingRow = { carrierId: string; carrierName: string; guides: Partial<Record<RequestType, Guide>> };
const blank: Guide = { method: null, whereToDoIt: "", whatTheyNeed: "", clientMustAuthorise: null, formRef: "", notes: "" };
const written = (row: ServicingRow) => REQUEST_TYPES.filter((type) => row.guides[type]).length;

/**
 * LA-5.4 (Notion sprint) · staff write, in plain words, how each carrier takes each servicing change.
 * Agents see it the moment they open a request — "an agent who does not know a carrier needs a signed
 * form will try the portal, fail, and give up". Nothing is pre-filled: a wrong instruction is worse than none.
 *
 * Admin round 1 (catalog.html screen 13): a coverage grid, carriers × the four request types, with search and
 * "missing only", instead of one carrier at a time from a dropdown. A carrier opens the same four-request editor
 * (how, where, they ask for, client authorises, form, notes, Save) in a right sheet (`?carrier=<id>` in the URL).
 */
export function ServicingGuideEditor({ rows, initialMissingOnly = false }: { rows: ServicingRow[]; initialMissingOnly?: boolean }) {
  const params = useSearchParams();
  const [query, setQuery] = useState("");
  const [missingOnly, setMissingOnly] = useState(initialMissingOnly);
  const [page, setPage] = useState(1);
  const openId = params.get("carrier");
  const open = openId ? rows.find((row) => row.carrierId === openId) ?? null : null;

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => (!needle || row.carrierName.toLowerCase().includes(needle)) && (!missingOnly || written(row) < REQUEST_TYPES.length));
  }, [rows, query, missingOnly]);
  const pageSize = useFittingPageSize(420, 45);
  const shown = paginate(visible, page, pageSize);
  const clear = () => { setQuery(""); setMissingOnly(false); setPage(1); };
  const openRow = (row: ServicingRow) => setParamsInPlace({ carrier: row.carrierId });

  return (
    <>
      <TableCard
        toolbar={
          <DataToolbar>
            <ToolbarSearch value={query} onChange={(value) => { setQuery(value); setPage(1); }} placeholder="Search carriers" />
            <ToolbarCheckbox checked={missingOnly} onChange={(value) => { setMissingOnly(value); setPage(1); }} label="Missing only" />
          </DataToolbar>
        }
        footer={visible.length > 0 ? <Pager page={shown.current} pageSize={pageSize} total={visible.length} noun="carriers" onPage={setPage} /> : undefined}
      >
        {rows.length === 0 ? (
          <EmptyState title="No active carriers" hint="Servicing instructions are written per carrier in the platform library." />
        ) : visible.length === 0 ? (
          <NoMatches noun="carriers" onClear={clear} />
        ) : (
          <Table className="min-w-[860px]">
            <TableHeader>
              <TableRow>
                <TableHead>Carrier</TableHead>
                {REQUEST_TYPES.map((type) => <TableHead key={type} className="w-[150px] text-center">{REQUEST_LABELS[type]}</TableHead>)}
                <TableHead className="w-[90px] text-right">Written</TableHead>
                <TableHead className="w-8"><span className="sr-only">Open</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.rows.map((row) => (
                <TableRow key={row.carrierId} className="cursor-pointer" onClick={() => openRow(row)} aria-selected={openId === row.carrierId}>
                  <TableCell className="font-semibold text-foreground">
                    <button type="button" className="max-w-[16rem] truncate text-left hover:underline" onClick={(event) => { event.stopPropagation(); openRow(row); }} aria-label={`Open ${row.carrierName}'s servicing instructions`}>{row.carrierName}</button>
                  </TableCell>
                  {REQUEST_TYPES.map((type) => (
                    <TableCell key={type} className="text-center">
                      <CarrierSetupDot cell={row.guides[type] ? { state: "set", detail: "Written" } : { state: "missing", detail: "Not written yet" }} label={`${row.carrierName} · ${REQUEST_LABELS[type]}`} />
                    </TableCell>
                  ))}
                  <TableCell className="text-right tabular-nums">{written(row)} of {REQUEST_TYPES.length}</TableCell>
                  <TableCell className="text-right text-muted-foreground" aria-hidden="true">›</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </TableCard>

      {open && (
        <Sheet
          key={open.carrierId}
          title={open.carrierName}
          subtitle={`Servicing instructions · ${written(open)} of ${REQUEST_TYPES.length} written`}
          onClose={() => setParamsInPlace({ carrier: null })}
          className="lg:w-[640px]"
          footer={<><span className="flex-1" /><Button type="button" variant="ghost" onClick={() => setParamsInPlace({ carrier: null })}>Close</Button></>}
        >
          <ServicingFourRows row={open} />
        </Sheet>
      )}
    </>
  );
}

/**
 * One carrier's four requests, each with how, where, what they ask for, whether the client authorises, the form and
 * notes, and its own Save. Used in the Servicing sheet and on the carrier's record.
 */
export function ServicingFourRows({ row }: { row: ServicingRow }) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Partial<Record<RequestType, Guide>>>({});
  const [busy, setBusy] = useState<RequestType | null>(null);
  const draft = (t: RequestType) => drafts[t] ?? { ...blank, ...(row.guides[t] ?? {}) };
  const set = (t: RequestType, patch: Partial<Guide>) => setDrafts((all) => ({ ...all, [t]: { ...draft(t), ...patch } }));

  async function save(t: RequestType) {
    const d = draft(t);
    setBusy(t);
    try {
      const response = await fetch("/api/admin/servicing-guides", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ carrier_id: row.carrierId, request_type: t, method: d.method, where_to_do_it: d.whereToDoIt || null, what_they_need: d.whatTheyNeed || null, client_must_authorise: d.clientMustAuthorise, form_ref: d.formRef || null, notes: d.notes || null }),
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
    <div className="flex flex-col gap-4">
      {REQUEST_TYPES.map((t) => {
        const d = draft(t);
        const id = `${row.carrierId}-${t}`;
        return (
          <section key={t} className="grid gap-3 border-t border-border pt-4 first:border-t-0 first:pt-0" aria-label={REQUEST_LABELS[t]}>
            <div className="flex items-center justify-between gap-2">
              <h3 className="m-0 text-sm font-semibold text-foreground">{REQUEST_LABELS[t]}</h3>
              <span className="text-xs text-muted-foreground">{row.guides[t] ? "written" : "not written yet"}</span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1">
                <Label htmlFor={`${id}-how`}>How</Label>
                <select id={`${id}-how`} aria-label={`How ${row.carrierName} takes it`} className={`${toolbarControl} w-full`} value={d.method ?? ""} onChange={(e) => set(t, { method: (e.target.value || null) as Guide["method"] })}>
                  <option value="">Not known</option>
                  {CARRIER_METHODS.map((m) => <option key={m} value={m}>{CARRIER_METHOD_LABELS[m]}</option>)}
                </select>
              </div>
              <div className="grid gap-1">
                <Label htmlFor={`${id}-auth`}>Client authorises</Label>
                <select id={`${id}-auth`} className={`${toolbarControl} w-full`} value={d.clientMustAuthorise === null ? "" : d.clientMustAuthorise ? "yes" : "no"} onChange={(e) => set(t, { clientMustAuthorise: e.target.value === "" ? null : e.target.value === "yes" })}>
                  <option value="">Not known</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </div>
              <div className="grid gap-1 sm:col-span-2"><Label htmlFor={`${id}-where`}>Where</Label><Input id={`${id}-where`} className="h-9" maxLength={1000} value={d.whereToDoIt ?? ""} onChange={(e) => set(t, { whereToDoIt: e.target.value })} /></div>
              <div className="grid gap-1 sm:col-span-2"><Label htmlFor={`${id}-need`}>They ask for</Label><Input id={`${id}-need`} className="h-9" maxLength={1000} value={d.whatTheyNeed ?? ""} onChange={(e) => set(t, { whatTheyNeed: e.target.value })} /></div>
              <div className="grid gap-1"><Label htmlFor={`${id}-form`}>Form</Label><Input id={`${id}-form`} className="h-9" maxLength={200} value={d.formRef ?? ""} onChange={(e) => set(t, { formRef: e.target.value })} /></div>
              <div className="grid gap-1"><Label htmlFor={`${id}-notes`}>Notes</Label><Input id={`${id}-notes`} className="h-9" maxLength={2000} value={d.notes ?? ""} onChange={(e) => set(t, { notes: e.target.value })} /></div>
            </div>
            <div><Button type="button" size="sm" disabled={busy !== null} onClick={() => void save(t)}>{busy === t ? "Saving…" : "Save"}</Button></div>
          </section>
        );
      })}
    </div>
  );
}
