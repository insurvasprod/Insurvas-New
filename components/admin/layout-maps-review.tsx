"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FileUp, Plus, X } from "lucide-react";

import { AdminPageHeader } from "@/components/admin/page-header";
import { Button } from "@/components/ui/button";
import { toolbarControl } from "@/components/ui/data-toolbar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/ui/page-states";
import { Pager, paginate } from "@/components/ui/pager";
import { StatStrip, StatTile } from "@/components/ui/stat";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { CARRIER_FILE_ACCEPT, FILE_TYPE_LABELS, FILE_TYPES, type CarrierFileType } from "@/lib/ingestion/constants";
import { guessTargetField, isKeptEntry, mapProblems, TARGET_FIELDS, TRANSFORMS_FOR, type LayoutEntry, type Transform } from "@/lib/ingestion/layout";
import { keptEntry, nextKeptField } from "@/lib/ingestion/layoutDraft";
import type { SampleRead } from "@/lib/ingestion/layoutSample";
import { pdfLayoutProblems } from "@/lib/ingestion/pdfLayout";
import type { AssignmentView, CarrierOption, LayoutMapView, LayoutStatus, WaitingFile } from "@/lib/ingestion/layoutAdmin";
import { notify } from "@/lib/notify";

const STATUS: Record<LayoutStatus, { label: string; tone: StatusTone }> = {
  draft: { label: "Draft", tone: "action" },
  in_review: { label: "In review", tone: "info" },
  published: { label: "Published", tone: "good" },
  retired: { label: "Retired", tone: "neutral" },
};

const TRANSFORM_LABEL: Record<Transform, string> = {
  none: "As written",
  strip_currency: "Remove $ and commas",
  mmddyyyy: "MM/DD/YYYY",
  mmddyy: "MM/DD/YY (or MMDDYY)",
  yyyymmdd: "YYYYMMDD",
  digits_only: "Digits only",
  negate: "Flip the sign",
  pct_to_bp: "Percent to basis points",
  fraction_to_bp: "Fraction (0.825) to basis points",
};

const select = `${toolbarControl} w-full`;

async function call<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init.headers ?? {}) } });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string; problems?: string[] };
  if (!response.ok) {
    const error = new Error(data.error ?? "That did not work; try again.") as Error & { problems?: string[] };
    error.problems = data.problems;
    throw error;
  }
  return data;
}

/** "ADV=advance; CB=chargeback" ↔ { ADV: "advance", CB: "chargeback" } — the carrier's word, then ours. */
function enumText(values: Record<string, string> | null): string {
  return Object.entries(values ?? {}).map(([raw, value]) => `${raw}=${value}`).join("; ");
}
function enumValues(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of text.split(";")) {
    const at = part.indexOf("=");
    if (at > 0) out[part.slice(0, at).trim()] = part.slice(at + 1).trim();
  }
  return out;
}

type Draft = {
  name: string;
  headerRowIndex: string;
  sheetName: string;
  rowCountSwingPct: string;
  totalRowColumn: string;
  totalRowValue: string;
  /** LA-4.4: the PDF extraction profile as JSON text; empty for a spreadsheet layout. */
  pdfText: string;
  entries: Array<LayoutEntry & { enumText: string }>;
};

/** The PDF profile typed so far: its value to save and what is wrong with it. */
function readPdfText(text: string): { value: Record<string, unknown> | null; problems: string[] } {
  if (!text.trim()) return { value: null, problems: [] };
  let value: unknown;
  try { value = JSON.parse(text); } catch { return { value: null, problems: ["The PDF layout is not valid JSON."] }; }
  if (!value || typeof value !== "object" || Array.isArray(value)) return { value: null, problems: ["The PDF layout is an object with columns and a row start."] };
  return { value: value as Record<string, unknown>, problems: pdfLayoutProblems(value).map((problem) => `PDF layout: ${problem}`) };
}

function draftOf(map: LayoutMapView): Draft {
  return {
    name: map.name,
    headerRowIndex: map.headerRowIndex ? String(map.headerRowIndex) : "",
    sheetName: map.sheetName ?? "",
    rowCountSwingPct: String(map.rowCountSwingPct),
    totalRowColumn: map.totalRowColumn ?? "",
    totalRowValue: map.totalRowValue ?? "",
    pdfText: map.pdfLayout ? JSON.stringify(map.pdfLayout, null, 2) : "",
    entries: map.entries.map((entry) => ({ ...entry, enumText: enumText(entry.enumValues) })),
  };
}

/** "Kept as sent" in the Becomes list: the column is listed in the layout, read into no field, its value kept with the row. */
const KEPT = "__kept";

/** Reads a sample file on the server: every column, what each would become, and a few rows. Nothing is stored. */
async function readSample(file: File, fileType: CarrierFileType, sheet: string | null = null): Promise<SampleRead> {
  const form = new FormData();
  form.set("file", file);
  form.set("file_type", fileType);
  if (sheet) form.set("sheet", sheet);
  const response = await fetch("/api/admin/layout-maps/sample", { method: "POST", body: form });
  const data = (await response.json().catch(() => ({}))) as SampleRead & { error?: string };
  if (!response.ok) throw new Error(data.error ?? "The file could not be read.");
  return data;
}

/** One reading of a sample: a PDF's chosen table, or the spreadsheet itself. */
function sampleView(sample: SampleRead, table: number) {
  const chosen = sample.tables[table];
  return chosen ? { draft: chosen.draft, preview: chosen.preview, pdfLayout: chosen.layout as unknown } : { draft: sample.draft, preview: sample.preview, pdfLayout: null };
}

/**
 * A file's columns added to a draft's: a header already listed is left as it is; a row waiting for a
 * field takes that field's header; a field the draft already reads keeps its column, and the new
 * one is kept as sent. Nothing a person chose is overwritten.
 */
function mergeColumns(entries: Draft["entries"], incoming: LayoutEntry[]): { entries: Draft["entries"]; added: number } {
  const out = entries.map((entry) => ({ ...entry }));
  const listed = new Set(out.map((entry) => entry.sourceColumn.trim()));
  let added = 0;
  for (const entry of incoming) {
    if (listed.has(entry.sourceColumn.trim())) continue;
    listed.add(entry.sourceColumn.trim());
    added++;
    const blank = isKeptEntry(entry) ? undefined : out.find((item) => item.targetField === entry.targetField && !item.sourceColumn.trim());
    if (blank) { Object.assign(blank, { ...entry, enumText: enumText(entry.enumValues) }); continue; }
    const next = out.some((item) => item.targetField === entry.targetField) ? { ...keptEntry(entry.sourceColumn, "x"), targetField: nextKeptField(out) } : entry;
    out.push({ ...next, enumText: enumText(next.enumValues) });
  }
  return { entries: out, added };
}

/**
 * LA-4.3 (Notion sprint) · the platform's layout maps: how each carrier's spreadsheets are read.
 * A draft is edited and published; a published version is frozen, and changing it starts the next
 * version. Each carrier is assigned a layout per file type, so one layout can serve several carriers.
 */
export function LayoutMapsReview({ initialMaps, initialAssignments, carriers, notice }: { initialMaps: LayoutMapView[]; initialAssignments: AssignmentView[]; carriers: CarrierOption[]; notice?: string }) {
  const [maps, setMaps] = useState(initialMaps);
  const [assignments, setAssignments] = useState(initialAssignments);
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [newLayout, setNewLayout] = useState({ layoutKey: "", name: "", fileType: "policies" as CarrierFileType });
  const [assign, setAssign] = useState({ carrierId: "", fileType: "policies" as CarrierFileType, layoutKey: "" });
  const [waiting, setWaiting] = useState<WaitingFile[]>([]);
  const [entryPage, setEntryPage] = useState(1);
  const sampleInput = useRef<HTMLInputElement>(null);
  // The new-layout dialog: start empty, or from a sample file read in full.
  const [start, setStart] = useState<"sample" | "empty">("sample");
  const [sample, setSample] = useState<{ file: File; read: SampleRead; table: number } | null>(null);
  const [samplePage, setSamplePage] = useState(1);
  const [layoutPage, setLayoutPage] = useState(1);
  const [assignmentPage, setAssignmentPage] = useState(1);

  const layouts = useMemo(() => {
    const byKey = new Map<string, LayoutMapView[]>();
    for (const map of maps) byKey.set(map.layoutKey, [...(byKey.get(map.layoutKey) ?? []), map]);
    return [...byKey.entries()].map(([key, versions]) => {
      const sorted = [...versions].sort((a, b) => b.version - a.version);
      return { key, name: sorted[0].name, fileType: sorted[0].fileType, versions: sorted, live: sorted.find((map) => map.status === "published") ?? null, draft: sorted.find((map) => map.status === "draft" || map.status === "in_review") ?? null };
    });
  }, [maps]);
  const shownLayouts = paginate(layouts, layoutPage, 10);
  const figures = useMemo(() => {
    const assigned = (type: CarrierFileType) => new Set(assignments.filter((row) => row.fileType === type).map((row) => row.carrierId));
    const policies = assigned("policies");
    const commissions = assigned("commissions");
    return {
      published: layouts.filter((layout) => layout.live).length,
      drafts: layouts.filter((layout) => layout.draft).length,
      inReview: maps.filter((map) => map.status === "in_review").length,
      noPolicies: carriers.filter((carrier) => !policies.has(carrier.id)).length,
      noCommissions: carriers.filter((carrier) => !commissions.has(carrier.id)).length,
    };
  }, [layouts, maps, assignments, carriers]);
  const shownAssignments = paginate(assignments, assignmentPage, 10);
  const open = maps.find((map) => map.id === openId) ?? null;
  const editable = open?.status === "draft" || open?.status === "in_review";

  // The files held back for want of a layout of this type: a real header row to start from.
  useEffect(() => {
    if (!open || !editable) { setWaiting([]); return; }
    let live = true;
    call<{ files: WaitingFile[] }>(`/api/admin/layout-maps/sample-headers?file_type=${open.fileType}`, { method: "GET" }).then((data) => { if (live) setWaiting(data.files); }).catch(() => { if (live) setWaiting([]); });
    return () => { live = false; };
  }, [open?.id, open?.fileType, editable]); // eslint-disable-line react-hooks/exhaustive-deps

  // Every header of a waiting file goes in: a header that names a field becomes it, every other is kept as sent.
  const fillFrom = (fileId: string) => run("fill", async () => {
    if (!open || !draft) return;
    const { headers } = await call<{ headers: string[] }>(`/api/admin/layout-maps/sample-headers?file_id=${fileId}`, { method: "GET" });
    const fields = TARGET_FIELDS[open.fileType];
    const incoming = headers.map((header, index): LayoutEntry => {
      const field = fields.find((item) => item.key === guessTargetField(open.fileType, header));
      return field ? { sourceColumn: header, targetField: field.key, dataType: field.dataType, transform: "none", required: false, enumValues: field.dataType === "enum" ? {} : null } : keptEntry(header, String(index + 1));
    });
    const { entries, added } = mergeColumns(draft.entries, incoming);
    setDraft({ ...draft, entries });
    setEntryPage(Math.max(1, Math.ceil(entries.length / 10)));
    notify.done(added ? `${added} column${added === 1 ? "" : "s"} added. Check each one before saving.` : "Every column of that file is already listed.");
  });

  // A sample file read into the open draft: its columns added (as fillFrom), and a PDF's table layout when the draft has none.
  const fillFromSample = (file: File) => run("sample", async () => {
    if (!open || !draft) return;
    const sample = await readSample(file, open.fileType, draft.sheetName.trim() || null);
    const view = sampleView(sample, 0);
    const { entries, added } = mergeColumns(draft.entries, view.draft.entries);
    setDraft({ ...draft, entries, pdfText: !draft.pdfText.trim() && view.pdfLayout ? JSON.stringify(view.pdfLayout, null, 2) : draft.pdfText });
    setEntryPage(Math.max(1, Math.ceil(entries.length / 10)));
    notify.done(added ? `${added} column${added === 1 ? "" : "s"} added from ${file.name}. Check each one before saving.` : `Every column of ${file.name} is already listed.`);
  });

  async function reload() {
    const data = await call<{ maps: LayoutMapView[]; assignments: AssignmentView[] }>("/api/admin/layout-maps", { method: "GET" });
    setMaps(data.maps);
    setAssignments(data.assignments);
  }

  function openMap(map: LayoutMapView) {
    setOpenId(map.id);
    setDraft(draftOf(map));
    setProblems([]);
    setEntryPage(1);
  }

  async function run(key: string, action: () => Promise<void>) {
    setBusy(key);
    setProblems([]);
    try {
      await action();
    } catch (error) {
      const problemList = (error as { problems?: string[] }).problems ?? [];
      setProblems(problemList);
      notify.block(error instanceof Error ? error.message : "That did not work.");
    } finally {
      setBusy(null);
    }
  }

  function payload(current: Draft) {
    return {
      name: current.name.trim(),
      header_row_index: current.headerRowIndex.trim() ? Number(current.headerRowIndex) : null,
      sheet_name: current.sheetName.trim() || null,
      row_count_swing_pct: Number(current.rowCountSwingPct) || 50,
      total_row_column: current.totalRowColumn.trim() || null,
      total_row_value: current.totalRowValue.trim() || null,
      pdf_layout: readPdfText(current.pdfText).value,
      entries: current.entries.map((entry) => ({
        source_column: entry.sourceColumn,
        target_field: entry.targetField,
        data_type: entry.dataType,
        transform: entry.transform,
        required: entry.required,
        enum_values: entry.dataType === "enum" ? enumValues(entry.enumText) : null,
      })),
    };
  }

  const save = (then?: () => Promise<void>) => run("save", async () => {
    if (!open || !draft) return;
    const { map } = await call<{ map: LayoutMapView }>(`/api/admin/layout-maps/${open.id}`, { method: "PUT", body: JSON.stringify(payload(draft)) });
    setMaps((current) => current.map((item) => (item.id === map.id ? map : item)));
    setDraft(draftOf(map));
    if (then) await then();
    else notify.done(`Draft v${map.version} saved.`);
  });

  const publish = () => save(async () => {
    if (!open) return;
    const { map } = await call<{ map: LayoutMapView }>(`/api/admin/layout-maps/${open.id}/publish`, { method: "POST" });
    await reload();
    openMap(map);
    notify.done(`Version ${map.version} is live.`);
  });

  const fields = open ? TARGET_FIELDS[open.fileType] : [];
  const pdf = draft ? readPdfText(draft.pdfText) : { value: null, problems: [] };
  const localProblems = open && draft && editable ? [...mapProblems({ fileType: open.fileType }, draft.entries.map((entry) => ({ ...entry, enumValues: entry.dataType === "enum" ? enumValues(entry.enumText) : null }))), ...pdf.problems] : [];

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader title="Layout maps" subtitle="How each carrier's spreadsheets are read: one map per layout, shared by every carrier that uses it." actions={<Button type="button" onClick={() => setCreating(true)} disabled={Boolean(notice)}>New layout</Button>} />

      <StatStrip label="Layout map totals">
        <StatTile label="Layouts" value={layouts.length.toLocaleString("en-US")} footnote={`${figures.published.toLocaleString("en-US")} published`} />
        <StatTile label="Open drafts" value={figures.drafts.toLocaleString("en-US")} valueTone={figures.drafts > 0 ? "warning" : undefined} footnote={figures.inReview > 0 ? `${figures.inReview.toLocaleString("en-US")} in review` : "none in review"} />
        <StatTile label="Carrier assignments" value={assignments.length.toLocaleString("en-US")} footnote={`${carriers.length.toLocaleString("en-US")} active carriers`} />
        <StatTile label="No policy map" labelTitle="Active carriers with no layout assigned for policy files" value={figures.noPolicies.toLocaleString("en-US")} valueTone={figures.noPolicies > 0 ? "warning" : undefined} footnote="active carriers" />
        <StatTile label="No commission map" labelTitle="Active carriers with no layout assigned for commission files" value={figures.noCommissions.toLocaleString("en-US")} valueTone={figures.noCommissions > 0 ? "warning" : undefined} footnote="active carriers" />
      </StatStrip>

      {notice && <div role="status" className="rounded-lg border border-border border-l-[3px] border-l-[var(--warning)] bg-[var(--warning-surface)] px-4 py-3 text-sm text-[var(--warning-ink)]">{notice}</div>}

      <TableCard title="Layouts" footer={layouts.length > 10 ? <Pager page={shownLayouts.current} pageSize={10} total={layouts.length} noun="layouts" onPage={setLayoutPage} /> : undefined}>
        {layouts.length === 0 ? (
          <EmptyState title="No layout maps yet" hint="Layouts are written from real carrier sample files; until one is published for a carrier, its files wait." />
        ) : (
          <table className="portal-lead-table w-full text-left text-sm">
            <thead>
              <tr>
                <th>Layout</th>
                <th className="w-[130px]">File type</th>
                <th className="w-[110px]">Live</th>
                <th className="w-[110px]">Draft</th>
                <th>Carriers</th>
                <th className="w-[110px] text-right"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {shownLayouts.rows.map((layout) => {
                const using = assignments.filter((row) => row.layoutKey === layout.key).map((row) => row.carrierName);
                return (
                  <tr key={layout.key}>
                    <td><span className="block font-semibold text-foreground">{layout.name}</span><span className="block font-mono text-xs text-muted-foreground">{layout.key}</span></td>
                    <td>{FILE_TYPE_LABELS[layout.fileType as CarrierFileType] ?? layout.fileType}</td>
                    <td className="tabular-nums">{layout.live ? `v${layout.live.version}` : "—"}</td>
                    <td className="tabular-nums">{layout.draft ? `v${layout.draft.version}` : "—"}</td>
                    <td className="max-w-[260px] truncate" title={using.join(", ")}>{using.length ? using.join(", ") : <span className="text-muted-foreground">None assigned</span>}</td>
                    <td className="text-right"><Button type="button" variant="outline" size="sm" onClick={() => openMap(layout.draft ?? layout.live ?? layout.versions[0])}>Open</Button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </TableCard>

      {open && draft && (
        <TableCard
          title={`${open.name} · v${open.version}`}
          description={`${draft.entries.length} ${draft.entries.length === 1 ? "column" : "columns"}: ${draft.entries.filter((entry) => !isKeptEntry(entry)).length} read into fields, ${draft.entries.filter(isKeptEntry).length} kept as sent. ${editable ? "Each header must be written exactly as the file has it." : "This version is frozen; start the next version to change it."}`}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <StatusChip tone={STATUS[open.status].tone}>{STATUS[open.status].label}</StatusChip>
              {editable ? (
                <>
                  <Button type="button" variant="outline" disabled={busy !== null} onClick={() => save()}>{busy === "save" ? "Saving…" : "Save draft"}</Button>
                  <Button type="button" disabled={busy !== null || localProblems.length > 0} title={localProblems[0]} onClick={publish}>Publish</Button>
                  <Button type="button" variant="outline" disabled={busy !== null} onClick={() => setDeleting(true)}>Delete draft</Button>
                </>
              ) : (
                <>
                  {open.status === "published" && <Button type="button" variant="outline" disabled={busy !== null} onClick={() => run("retire", async () => { const { map } = await call<{ map: LayoutMapView }>(`/api/admin/layout-maps/${open.id}/retire`, { method: "POST" }); await reload(); openMap(map); notify.done(`Version ${map.version} retired.`); })}>Retire</Button>}
                  <Button type="button" disabled={busy !== null} onClick={() => run("version", async () => { const { map } = await call<{ map: LayoutMapView }>(`/api/admin/layout-maps/${open.id}/versions`, { method: "POST" }); await reload(); openMap(map); notify.done(`Version ${map.version} started as a draft.`); })}>Start v{open.version + 1}</Button>
                </>
              )}
              <Button type="button" variant="ghost" size="icon" aria-label="Close the layout" onClick={() => { setOpenId(null); setDraft(null); }}><X className="size-4" /></Button>
            </div>
          }
        >
          <fieldset disabled={!editable || busy !== null} className="grid gap-4 px-4 py-4 text-sm">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="grid gap-1.5"><Label htmlFor="layout-name">Name</Label><Input id="layout-name" className="h-9" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></div>
              <div className="grid gap-1.5"><Label htmlFor="layout-header">Header row (blank: the first full-width line)</Label><Input id="layout-header" className="h-9" inputMode="numeric" value={draft.headerRowIndex} onChange={(event) => setDraft({ ...draft, headerRowIndex: event.target.value.replace(/\D/g, "") })} /></div>
              <div className="grid gap-1.5"><Label htmlFor="layout-sheet">Sheet (blank: the first visible)</Label><Input id="layout-sheet" className="h-9" value={draft.sheetName} onChange={(event) => setDraft({ ...draft, sheetName: event.target.value })} /></div>
              <div className="grid gap-1.5"><Label htmlFor="layout-swing">Row-count swing to flag (%)</Label><Input id="layout-swing" className="h-9" inputMode="numeric" value={draft.rowCountSwingPct} onChange={(event) => setDraft({ ...draft, rowCountSwingPct: event.target.value.replace(/\D/g, "") })} /></div>
              {open.fileType === "commissions" && (
                <>
                  <div className="grid gap-1.5"><Label htmlFor="layout-total-col">Total row: column</Label><Input id="layout-total-col" className="h-9" value={draft.totalRowColumn} onChange={(event) => setDraft({ ...draft, totalRowColumn: event.target.value })} /></div>
                  <div className="grid gap-1.5"><Label htmlFor="layout-total-val">Total row: value in it</Label><Input id="layout-total-val" className="h-9" value={draft.totalRowValue} onChange={(event) => setDraft({ ...draft, totalRowValue: event.target.value })} /></div>
                </>
              )}
            </div>

            {(open.fileType === "commissions" || draft.pdfText.trim() !== "") && (
              <div className="grid gap-1.5">
                <Label htmlFor="layout-pdf">PDF layout (JSON: columns and their left edges, the row start, the statement total and balances; empty for a spreadsheet)</Label>
                <textarea
                  id="layout-pdf"
                  rows={draft.pdfText.trim() ? 12 : 3}
                  spellCheck={false}
                  value={draft.pdfText}
                  onChange={(event) => setDraft({ ...draft, pdfText: event.target.value })}
                  className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 font-mono text-xs leading-relaxed text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:opacity-70"
                />
                {editable && pdf.problems.length > 0 && <p role="alert" className="m-0 text-xs text-[var(--error-ink)]">{pdf.problems[0]}</p>}
              </div>
            )}

            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="portal-lead-table w-full min-w-[980px] text-left text-sm">
                <thead>
                  <tr>
                    <th>Column header in the file</th>
                    <th className="w-[230px]">Becomes</th>
                    <th className="w-[200px]">Read as</th>
                    <th className="w-[90px]">Required</th>
                    <th>Carrier&apos;s words (enum)</th>
                    <th className="w-[50px]"><span className="sr-only">Remove</span></th>
                  </tr>
                </thead>
                <tbody>
                  {paginate(draft.entries, entryPage).rows.map((entry, offset) => {
                    // 10 columns a page; the whole draft is held here, so turning the page keeps every edit.
                    const index = (paginate(draft.entries, entryPage).current - 1) * 10 + offset;
                    const kept = isKeptEntry(entry);
                    const update = (change: Partial<Draft["entries"][number]>) => setDraft({ ...draft, entries: draft.entries.map((item, at) => (at === index ? { ...item, ...change } : item)) });
                    return (
                      <tr key={index}>
                        <td><Input aria-label="Column header" className="h-9" value={entry.sourceColumn} onChange={(event) => update({ sourceColumn: event.target.value })} /></td>
                        <td>
                          <select aria-label="Field" className={select} value={kept ? KEPT : entry.targetField} onChange={(event) => {
                            if (event.target.value === KEPT) { if (!kept) update({ targetField: nextKeptField(draft.entries), dataType: "text", transform: "none", required: false, enumText: "" }); return; }
                            const field = fields.find((item) => item.key === event.target.value);
                            if (field) update({ targetField: field.key, dataType: field.dataType, transform: "none", enumText: "" });
                          }}>
                            <option value={KEPT}>Kept as sent (not read)</option>
                            {fields.map((field) => <option key={field.key} value={field.key}>{field.label}</option>)}
                          </select>
                        </td>
                        <td>
                          {kept ? <span className="text-muted-foreground">As sent</span> : (
                            <select aria-label="Transform" className={select} value={entry.transform} onChange={(event) => update({ transform: event.target.value as Transform })}>
                              {TRANSFORMS_FOR[entry.dataType].map((transform) => <option key={transform} value={transform}>{TRANSFORM_LABEL[transform]}</option>)}
                            </select>
                          )}
                        </td>
                        <td><input aria-label="Required" type="checkbox" className="size-4 accent-[var(--primary)]" disabled={kept} checked={entry.required} onChange={(event) => update({ required: event.target.checked })} /></td>
                        <td>{entry.dataType === "enum" ? <Input aria-label="Carrier's words" className="h-9" placeholder={`e.g. M=${fields.find((field) => field.key === entry.targetField)?.enumValues?.[0] ?? "value"}; Q=…`} value={entry.enumText} onChange={(event) => update({ enumText: event.target.value })} /> : <span className="text-muted-foreground">—</span>}</td>
                        <td><Button type="button" variant="ghost" size="icon" aria-label="Remove this column" onClick={() => setDraft({ ...draft, entries: draft.entries.filter((_, at) => at !== index) })}><X className="size-4" /></Button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {draft.entries.length > 10 && (
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-[var(--canvas)] px-4 py-3 text-xs text-muted-foreground">
                  <Pager page={paginate(draft.entries, entryPage).current} total={draft.entries.length} noun="columns" onPage={setEntryPage} />
                </div>
              )}
            </div>
            {editable && (
              <div className="flex flex-wrap items-center gap-2">
                <input ref={sampleInput} type="file" accept={CARRIER_FILE_ACCEPT} className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) fillFromSample(file); }} />
                <Button type="button" variant="outline" disabled={busy !== null} onClick={() => sampleInput.current?.click()}><FileUp className="size-4" /> {busy === "sample" ? "Reading…" : "Read a sample file"}</Button>
                {waiting.length > 0 && (
                  <select aria-label="Fill the columns from a file waiting for a layout" className={`${toolbarControl} max-w-[420px]`} value="" disabled={busy !== null} onChange={(event) => { if (event.target.value) fillFrom(event.target.value); }}>
                    <option value="">Fill from a waiting file…</option>
                    {waiting.map((file) => <option key={file.id} value={file.id}>{file.label}</option>)}
                  </select>
                )}
                <Button type="button" variant="outline" onClick={() => { const field = fields.find((item) => !draft.entries.some((entry) => entry.targetField === item.key)) ?? fields[0]; const entries = [...draft.entries, { sourceColumn: "", targetField: field.key, dataType: field.dataType, transform: "none" as Transform, required: false, enumValues: null, enumText: "" }]; setDraft({ ...draft, entries }); setEntryPage(Math.ceil(entries.length / 10)); }}><Plus className="size-4" /> Add column</Button>
              </div>
            )}
            {(problems.length > 0 || (editable && localProblems.length > 0)) && (
              <ul role="alert" className="list-disc space-y-1 pl-5 text-sm text-[var(--error-ink)]">
                {(problems.length ? problems : localProblems).map((problem) => <li key={problem}>{problem}</li>)}
              </ul>
            )}
          </fieldset>
        </TableCard>
      )}

      <TableCard
        title="Carrier assignments"
        description="Which layout reads each carrier's files. A file waits until its carrier and type have a published layout."
        toolbar={
          <form className="flex flex-wrap items-center gap-2 px-4 py-3" onSubmit={(event) => { event.preventDefault(); void run("assign", async () => { await call("/api/admin/layout-maps/assignments", { method: "PUT", body: JSON.stringify({ carrier_id: assign.carrierId, file_type: assign.fileType, layout_key: assign.layoutKey }) }); await reload(); notify.done("Assignment saved."); }); }}>
            <select aria-label="Carrier" className={toolbarControl} value={assign.carrierId} onChange={(event) => setAssign({ ...assign, carrierId: event.target.value })}>
              <option value="">Carrier</option>
              {carriers.map((carrier) => <option key={carrier.id} value={carrier.id}>{carrier.name}</option>)}
            </select>
            <select aria-label="File type" className={toolbarControl} value={assign.fileType} onChange={(event) => setAssign({ ...assign, fileType: event.target.value as CarrierFileType, layoutKey: "" })}>
              {FILE_TYPES.map((key) => <option key={key} value={key}>{FILE_TYPE_LABELS[key]}</option>)}
            </select>
            <select aria-label="Layout" className={toolbarControl} value={assign.layoutKey} onChange={(event) => setAssign({ ...assign, layoutKey: event.target.value })}>
              <option value="">Layout</option>
              {layouts.filter((layout) => layout.fileType === assign.fileType).map((layout) => <option key={layout.key} value={layout.key}>{layout.name}</option>)}
            </select>
            <Button type="submit" variant="outline" disabled={busy !== null || !assign.carrierId || !assign.layoutKey}>{busy === "assign" ? "Saving…" : "Assign"}</Button>
          </form>
        }
        footer={assignments.length > 10 ? <Pager page={shownAssignments.current} pageSize={10} total={assignments.length} noun="assignments" onPage={setAssignmentPage} /> : undefined}
      >
        {assignments.length === 0 ? (
          <EmptyState title="No carrier assigned a layout" hint="Assign a layout to a carrier and file type once the layout is written." />
        ) : (
          <table className="portal-lead-table w-full text-left text-sm">
            <thead>
              <tr><th>Carrier</th><th className="w-[140px]">File type</th><th>Layout</th><th className="w-[110px] text-right"><span className="sr-only">Actions</span></th></tr>
            </thead>
            <tbody>
              {shownAssignments.rows.map((row) => (
                <tr key={row.id}>
                  <td className="font-semibold text-foreground">{row.carrierName}</td>
                  <td>{FILE_TYPE_LABELS[row.fileType as CarrierFileType] ?? row.fileType}</td>
                  <td>{layouts.find((layout) => layout.key === row.layoutKey)?.name ?? row.layoutKey}{!layouts.find((layout) => layout.key === row.layoutKey)?.live && <span className="ml-2 text-xs text-[var(--warning-ink)]">no live version</span>}</td>
                  <td className="text-right"><Button type="button" variant="outline" size="sm" disabled={busy !== null} onClick={() => void run(`remove-${row.id}`, async () => { await call(`/api/admin/layout-maps/assignments?id=${row.id}`, { method: "DELETE" }); await reload(); notify.done("Assignment removed."); })}>Remove</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </TableCard>

      <Dialog open={creating} onOpenChange={(next) => { if (!busy) { setCreating(next); if (!next) setSample(null); } }}>
        <DialogContent className={start === "sample" && sample ? "sm:max-w-4xl" : "sm:max-w-lg"}>
          <DialogHeader>
            <DialogTitle className="text-base">New layout</DialogTitle>
            <DialogDescription>Starts version 1 as a draft. From a sample file, every column of the file is listed: the ones we read become fields, the rest are kept as sent.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 text-sm">
            <div role="radiogroup" aria-label="How to start" className="grid gap-2 sm:grid-cols-2">
              {([["sample", "From a sample file", "CSV, Excel or PDF: every column read from it"], ["empty", "Empty", "Type each column yourself"]] as const).map(([key, label, hint]) => (
                <label key={key} className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2.5 ${start === key ? "border-[var(--primary)] bg-[var(--surface-alt)]" : "border-border"}`}>
                  <input type="radio" name="layout-start" className="mt-0.5 accent-[var(--primary)]" checked={start === key} onChange={() => setStart(key)} />
                  <span><span className="block font-semibold text-foreground">{label}</span><span className="block text-xs text-muted-foreground">{hint}</span></span>
                </label>
              ))}
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="grid gap-1.5">
                <Label htmlFor="new-layout-type">File type</Label>
                <select id="new-layout-type" className={select} value={newLayout.fileType} disabled={busy !== null} onChange={(event) => { const fileType = event.target.value as CarrierFileType; setNewLayout({ ...newLayout, fileType }); if (sample) void run("read", async () => { setSample({ ...sample, read: await readSample(sample.file, fileType, sample.read.sheetName), table: 0 }); setSamplePage(1); }); }}>
                  {FILE_TYPES.map((key) => <option key={key} value={key}>{FILE_TYPE_LABELS[key]}</option>)}
                </select>
              </div>
              <div className="grid gap-1.5"><Label htmlFor="new-layout-name">Name</Label><Input id="new-layout-name" className="h-9" placeholder="Aetna / Aflac / AHL 46-column" value={newLayout.name} onChange={(event) => setNewLayout({ ...newLayout, name: event.target.value })} /></div>
              <div className="grid gap-1.5"><Label htmlFor="new-layout-key">Key</Label><Input id="new-layout-key" className="h-9 font-mono" placeholder="aetna_aflac_ahl_policies" value={newLayout.layoutKey} onChange={(event) => setNewLayout({ ...newLayout, layoutKey: event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_") })} /></div>
            </div>
            {start === "sample" && (
              <div className="grid gap-1.5">
                <Label htmlFor="new-layout-file">Sample file</Label>
                <input id="new-layout-file" type="file" accept={CARRIER_FILE_ACCEPT} disabled={busy !== null} className="text-sm file:mr-3 file:h-9 file:rounded-md file:border file:border-border file:bg-[var(--surface)] file:px-3 file:text-sm file:font-semibold file:text-foreground" onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  void run("read", async () => {
                    const read = await readSample(file, newLayout.fileType);
                    setSample({ file, read, table: 0 });
                    setSamplePage(1);
                    const base = file.name.replace(/\.[^.]+$/, "");
                    setNewLayout((current) => ({ ...current, name: current.name || base, layoutKey: current.layoutKey || `${base}_${current.fileType}`.toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/_+/g, "_").replace(/^[^a-z]+/, "").slice(0, 60) }));
                  });
                }} />
                {busy === "read" && <p className="m-0 text-xs text-muted-foreground" role="status">Reading the file…</p>}
              </div>
            )}
            {start === "sample" && sample && (() => {
              const view = sampleView(sample.read, sample.table);
              const read = view.draft.columns.filter((column) => column.becomes).length;
              const shown = paginate(view.draft.columns, samplePage);
              const label = (key: string | null) => (key ? TARGET_FIELDS[newLayout.fileType].find((field) => field.key === key)?.label ?? key : null);
              return (
                <div className="grid gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {sample.read.sheets.length > 1 && (
                      <select aria-label="Sheet" className={`${toolbarControl} max-w-[260px]`} value={sample.read.sheetName ?? ""} disabled={busy !== null} onChange={(event) => { const sheet = event.target.value; void run("read", async () => { setSample({ ...sample, read: await readSample(sample.file, newLayout.fileType, sheet), table: 0 }); setSamplePage(1); }); }}>
                        {sample.read.sheets.map((sheet) => <option key={sheet} value={sheet}>Sheet: {sheet}</option>)}
                      </select>
                    )}
                    {sample.read.tables.length > 1 && (
                      <select aria-label="Table" className={`${toolbarControl} max-w-[420px]`} value={sample.table} onChange={(event) => { setSample({ ...sample, table: Number(event.target.value) }); setSamplePage(1); }}>
                        {sample.read.tables.map((table, index) => <option key={index} value={index}>Table: {table.title.slice(0, 60)} ({table.rows} {table.rows === 1 ? "row" : "rows"})</option>)}
                      </select>
                    )}
                    <span className="text-muted-foreground tabular-nums">{view.draft.columns.length} columns · {read} read into fields · {view.draft.columns.length - read} kept as sent{sample.read.kind !== "pdf" ? ` · header on line ${view.draft.headerRow}` : ""}</span>
                  </div>
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="portal-lead-table w-full min-w-[640px] text-left text-sm">
                      <thead><tr><th className="w-[70px]">Column</th><th>Header in the file</th><th>Becomes</th><th>Example values</th></tr></thead>
                      <tbody>
                        {shown.rows.map((column) => (
                          <tr key={`${column.column}-${column.header}`}>
                            <td className="font-mono text-xs text-muted-foreground">{column.column}</td>
                            <td className="font-semibold text-foreground">{column.header}</td>
                            <td>{column.becomes ? label(column.becomes) : <span className="text-muted-foreground">Kept as sent</span>}</td>
                            <td className="max-w-[280px] truncate text-muted-foreground" title={view.preview.map((row) => row[column.index] ?? "").filter(Boolean).join(" · ")}>{view.preview.map((row) => row[column.index] ?? "").filter(Boolean).slice(0, 3).join(" · ") || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {view.draft.columns.length > 10 && (
                      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-[var(--canvas)] px-4 py-3 text-xs text-muted-foreground">
                        <Pager page={shown.current} total={view.draft.columns.length} noun="columns" onPage={setSamplePage} />
                      </div>
                    )}
                  </div>
                  {view.draft.missingRequired.length > 0 && <p className="m-0 text-xs text-[var(--warning-ink)]">Still to choose before publishing: {view.draft.missingRequired.map((key) => label(key)).join(", ")}. Pick the column for each in the draft.</p>}
                  {view.draft.unmatchedWords.map((item) => <p key={item.field} className="m-0 text-xs text-[var(--warning-ink)]">{label(item.field)}: the carrier&apos;s words {item.words.slice(0, 8).map((word) => `"${word}"`).join(", ")}{item.words.length > 8 ? ` and ${item.words.length - 8} more` : ""} still need our value.</p>)}
                  {sample.read.kind === "pdf" && <p className="m-0 text-xs text-muted-foreground">A PDF&apos;s columns are found from where its values sit. Check the rows above, then add the statement&apos;s total and balances in the draft.</p>}
                </div>
              );
            })()}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy !== null} onClick={() => { setCreating(false); setSample(null); }}>Cancel</Button>
            <Button type="button" disabled={busy !== null || !newLayout.name.trim() || newLayout.layoutKey.length < 3 || (start === "sample" && !sample)} onClick={() => void run("create", async () => {
              const { map } = await call<{ map: LayoutMapView }>("/api/admin/layout-maps", { method: "POST", body: JSON.stringify({ layout_key: newLayout.layoutKey, name: newLayout.name.trim(), file_type: newLayout.fileType }) });
              let created = map;
              if (start === "sample" && sample) {
                const view = sampleView(sample.read, sample.table);
                const saved = await call<{ map: LayoutMapView }>(`/api/admin/layout-maps/${map.id}`, { method: "PUT", body: JSON.stringify({
                  name: map.name,
                  header_row_index: null,
                  // A workbook with more than one sheet names the sheet it was drafted from.
                  sheet_name: sample.read.sheets.length > 1 ? sample.read.sheetName : null,
                  row_count_swing_pct: map.rowCountSwingPct,
                  total_row_column: null,
                  total_row_value: null,
                  pdf_layout: view.pdfLayout,
                  entries: view.draft.entries.map((entry) => ({ source_column: entry.sourceColumn, target_field: entry.targetField, data_type: entry.dataType, transform: entry.transform, required: entry.required, enum_values: entry.dataType === "enum" ? entry.enumValues ?? {} : null })),
                }) });
                created = saved.map;
              }
              await reload();
              openMap(created);
              setCreating(false);
              setSample(null);
              setNewLayout({ layoutKey: "", name: "", fileType: "policies" });
              notify.done(start === "sample" ? `Draft v1 created with ${created.entries.length} columns. Check it, then publish.` : "Draft v1 created.");
            })}>{busy === "create" ? "Creating…" : "Create draft"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleting && Boolean(open)} onOpenChange={(next) => { if (!busy) setDeleting(next); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">Delete draft v{open?.version}?</DialogTitle>
            <DialogDescription>
              {open && layouts.find((layout) => layout.key === open.layoutKey)?.versions.length === 1
                ? `This is the only version of "${open.name}", so the layout and its carrier assignments go too.`
                : "The draft and its columns are deleted. Published and retired versions stay as they are."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy !== null} onClick={() => setDeleting(false)}>Cancel</Button>
            <Button type="button" variant="destructive" disabled={busy !== null} onClick={() => void run("delete", async () => {
              if (!open) return;
              await call(`/api/admin/layout-maps/${open.id}`, { method: "DELETE" });
              const version = open.version;
              setDeleting(false);
              setOpenId(null);
              setDraft(null);
              await reload();
              notify.done(`Draft v${version} deleted.`);
            })}>{busy === "delete" ? "Deleting…" : "Delete draft"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
