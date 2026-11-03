"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { AdminPageHeader } from "@/components/admin/page-header";
import { Button } from "@/components/ui/button";
import { DataToolbar, toolbarControl } from "@/components/ui/data-toolbar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pager, paginate } from "@/components/ui/pager";
import { StatusChip } from "@/components/ui/status-chip";
import { TableCard } from "@/components/ui/table-card";
import { useFittingPageSize } from "@/components/ui/use-fitting-page-size";
import { CARRIER_FILE_ACCEPT, FILE_TYPE_LABELS, FILE_TYPES, type CarrierFileType } from "@/lib/ingestion/constants";
import { TARGET_FIELDS } from "@/lib/ingestion/layout";
import type { LayoutMapView } from "@/lib/ingestion/layoutAdmin";
import type { SampleRead } from "@/lib/ingestion/layoutSample";
import { notify } from "@/lib/notify";

import { call, layoutHref, readSample, sampleView } from "./shared";

const keyFrom = (text: string, fileType: string) => `${text}_${fileType}`.toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/_+/g, "_").replace(/^[^a-z]+/, "").replace(/_$/, "").slice(0, 60);

/**
 * A new layout on its own page (redesign 2026-10-14, owner request): 1 the carrier's sample file,
 * 2 every column found in it, 3 a name. "From a sample file" lists every column: the ones the
 * software uses are matched to its fields, the rest kept as information. The file is read in
 * memory and dropped; the draft is saved only on Create.
 */
export function NewLayout() {
  const router = useRouter();
  const [start, setStart] = useState<"sample" | "empty">("sample");
  const [fileType, setFileType] = useState<CarrierFileType>("policies");
  const [sample, setSample] = useState<{ file: File; read: SampleRead; table: number } | null>(null);
  const [name, setName] = useState("");
  const [key, setKey] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = useFittingPageSize(480, 49);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(label: string, action: () => Promise<void>) {
    setBusy(label);
    setError(null);
    try { await action(); } catch (failure) { setError(failure instanceof Error ? failure.message : "That did not work."); } finally { setBusy(null); }
  }

  const read = (file: File, type: CarrierFileType, sheet: string | null = null) => run("read", async () => {
    const result = await readSample(file, type, sheet);
    setSample({ file, read: result, table: 0 });
    setPage(1);
    const base = file.name.replace(/\.[^.]+$/, "");
    setName((current) => current || base);
    setKey((current) => current || keyFrom(base, type));
  });

  const view = sample ? sampleView(sample.read, sample.table) : null;
  const fieldLabel = (field: string) => TARGET_FIELDS[fileType].find((item) => item.key === field)?.label ?? field;
  const shown = view ? paginate(view.draft.columns, page, pageSize) : null;
  const usedCount = view ? view.draft.columns.filter((column) => column.becomes).length : 0;

  const create = () => run("create", async () => {
    const { map } = await call<{ map: LayoutMapView }>("/api/admin/layout-maps", { method: "POST", body: JSON.stringify({ layout_key: key, name: name.trim(), file_type: fileType }) });
    if (start === "sample" && sample && view) {
      await call(`/api/admin/layout-maps/${map.id}`, { method: "PUT", body: JSON.stringify({
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
    }
    notify.done(start === "sample" ? `Draft v1 created with ${view?.draft.entries.length ?? 0} columns. Check it, then publish.` : "Draft v1 created.");
    router.push(layoutHref(key));
  });

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader title="New layout" subtitle="Read a carrier's file, check its columns, name it." backHref="/admin/layout-maps" backLabel="Layout maps" />

      {error && <div role="alert" className="rounded-lg border border-border border-l-[3px] border-l-[var(--error)] bg-[var(--error-surface)] px-4 py-3 text-sm text-[var(--error-ink)]">{error}</div>}

      <TableCard title="1 · The file">
        <div className="grid gap-4 px-4 py-4 text-sm">
          <div role="radiogroup" aria-label="How to start" className="grid gap-2 sm:grid-cols-2 lg:max-w-[720px]">
            {([["sample", "From a sample file", "CSV, Excel or PDF: every column read from it"], ["empty", "Empty", "Type each column yourself"]] as const).map(([value, title, hint]) => (
              <label key={value} className={`flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2.5 ${start === value ? "border-[var(--primary)] bg-[var(--surface-alt)]" : "border-border"}`}>
                <input type="radio" name="layout-start" className="mt-0.5 accent-[var(--primary)]" checked={start === value} onChange={() => setStart(value)} />
                <span><span className="block font-semibold text-foreground">{title}</span><span className="block text-xs text-muted-foreground">{hint}</span></span>
              </label>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:max-w-[720px]">
            <div className="grid gap-1.5">
              <Label htmlFor="new-layout-type">File type</Label>
              <select id="new-layout-type" className={`${toolbarControl} w-full`} value={fileType} disabled={busy !== null} onChange={(event) => { const next = event.target.value as CarrierFileType; setFileType(next); if (sample) read(sample.file, next, sample.read.sheetName); }}>
                {FILE_TYPES.map((value) => <option key={value} value={value}>{FILE_TYPE_LABELS[value]}</option>)}
              </select>
            </div>
            {start === "sample" && (
              <div className="grid gap-1.5">
                <Label htmlFor="new-layout-file">Sample file</Label>
                <input id="new-layout-file" type="file" accept={CARRIER_FILE_ACCEPT} disabled={busy !== null} className="text-sm file:mr-3 file:h-9 file:rounded-md file:border file:border-border file:bg-[var(--surface)] file:px-3 file:text-sm file:font-semibold file:text-foreground" onChange={(event) => { const file = event.target.files?.[0]; if (file) read(file, fileType); }} />
              </div>
            )}
          </div>
        </div>
      </TableCard>

      {start === "sample" && view && shown && sample && (
        <TableCard
          title="2 · Every column in the file"
          description={`${view.draft.columns.length} columns: ${usedCount} used by the software, ${view.draft.columns.length - usedCount} kept as information.${sample.read.kind !== "pdf" ? ` Header on line ${view.draft.headerRow}.` : ""}`}
          toolbar={(sample.read.sheets.length > 1 || sample.read.tables.length > 1) ? (
            <DataToolbar>
              {sample.read.sheets.length > 1 && (
                <select aria-label="Sheet" className={`${toolbarControl} max-w-[300px]`} value={sample.read.sheetName ?? ""} disabled={busy !== null} onChange={(event) => read(sample.file, fileType, event.target.value)}>
                  {sample.read.sheets.map((sheet) => <option key={sheet} value={sheet}>Sheet: {sheet}</option>)}
                </select>
              )}
              {sample.read.tables.length > 1 && (
                <select aria-label="Table" className={`${toolbarControl} max-w-[480px]`} value={sample.table} onChange={(event) => { setSample({ ...sample, table: Number(event.target.value) }); setPage(1); }}>
                  {sample.read.tables.map((table, index) => <option key={index} value={index}>Table: {table.title.slice(0, 70)} ({table.rows} {table.rows === 1 ? "row" : "rows"})</option>)}
                </select>
              )}
            </DataToolbar>
          ) : undefined}
          footer={<Pager page={shown.current} pageSize={pageSize} total={view.draft.columns.length} noun="columns" onPage={setPage} />}
        >
          <table className="portal-lead-table w-full min-w-[760px] text-left text-sm">
            <thead><tr><th className="w-[70px]">Column</th><th>Header in the file</th><th className="w-[300px]">Used for</th><th>Example values</th></tr></thead>
            <tbody>
              {shown.rows.map((column) => {
                const examples = view.preview.map((row) => row[column.index] ?? "").filter(Boolean);
                return (
                  <tr key={`${column.column}-${column.header}`}>
                    <td className="font-mono text-xs text-muted-foreground">{column.column}</td>
                    <td className="font-semibold text-foreground">{column.header}</td>
                    <td>{column.becomes ? fieldLabel(column.becomes) : <StatusChip tone="neutral" dot={false}>Kept as information</StatusChip>}</td>
                    <td className="max-w-[320px] truncate text-muted-foreground" title={examples.join(" · ")}>{examples.slice(0, 3).join(" · ") || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {(view.draft.missingRequired.length > 0 || view.draft.unmatchedWords.length > 0 || sample.read.kind === "pdf") && (
            <ul className="m-0 grid gap-1 border-t border-border px-4 py-3 text-xs text-[var(--warning-ink)]">
              {view.draft.missingRequired.length > 0 && <li>Still to choose before publishing: {view.draft.missingRequired.map(fieldLabel).join(", ")}.</li>}
              {view.draft.unmatchedWords.map((item) => <li key={item.field}>{fieldLabel(item.field)}: the carrier&apos;s words {item.words.slice(0, 8).map((word) => `"${word}"`).join(", ")}{item.words.length > 8 ? ` and ${item.words.length - 8} more` : ""} still need our value.</li>)}
              {sample.read.kind === "pdf" && <li className="text-muted-foreground">A PDF&apos;s columns are found from where its values sit: check them, and add the statement&apos;s total and balances in the draft.</li>}
            </ul>
          )}
        </TableCard>
      )}

      {(start === "empty" || view) && (
        <TableCard title={start === "sample" ? "3 · Name it" : "2 · Name it"} footer={<><span>Starts version 1 as a draft; nothing reads files with it until it is published and a carrier is added.</span><Button type="button" disabled={busy !== null || !name.trim() || key.length < 3} onClick={create}>{busy === "create" ? "Creating…" : "Create draft"}</Button></>}>
          <div className="grid gap-4 px-4 py-4 text-sm sm:grid-cols-2 lg:max-w-[720px]">
            <div className="grid gap-1.5"><Label htmlFor="new-layout-name">Name</Label><Input id="new-layout-name" className="h-9" placeholder="Aetna / Aflac / AHL 46-column" value={name} onChange={(event) => setName(event.target.value)} /></div>
            <div className="grid gap-1.5"><Label htmlFor="new-layout-key">Key</Label><Input id="new-layout-key" className="h-9 font-mono" placeholder="aetna_aflac_ahl_policies" value={key} onChange={(event) => setKey(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))} /></div>
          </div>
        </TableCard>
      )}

      {busy === "read" && <p role="status" className="m-0 text-sm text-muted-foreground">Reading the file…</p>}
    </div>
  );
}
