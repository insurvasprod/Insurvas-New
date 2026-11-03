import type { StatusTone } from "@/components/ui/status-chip";
import type { CarrierFileType } from "@/lib/ingestion/constants";
import { isKeptEntry, type LayoutEntry, type Transform } from "@/lib/ingestion/layout";
import type { LayoutMapView, LayoutStatus } from "@/lib/ingestion/layoutAdmin";
import { keptEntry, nextKeptField } from "@/lib/ingestion/layoutDraft";
import type { SampleRead } from "@/lib/ingestion/layoutSample";
import { pdfLayoutProblems } from "@/lib/ingestion/pdfLayout";

/**
 * What the layout-map pages share (the 2026-10-14 redesign: a list, a page per layout, a page to
 * start one): the API call, the draft a person edits, the sample-file reader, and the words.
 */

export const STATUS: Record<LayoutStatus, { label: string; tone: StatusTone }> = {
  draft: { label: "Draft", tone: "action" },
  in_review: { label: "In review", tone: "info" },
  published: { label: "Live", tone: "good" },
  retired: { label: "Retired", tone: "neutral" },
};

export const TRANSFORM_LABEL: Record<Transform, string> = {
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

/** "Kept as information" in the Used-for list: listed in the layout, used by no feature, shown to the agent with the row. */
export const KEPT = "__kept";

export async function call<T>(url: string, init: RequestInit = {}): Promise<T> {
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
export function enumText(values: Record<string, string> | null): string {
  return Object.entries(values ?? {}).map(([raw, value]) => `${raw}=${value}`).join("; ");
}
export function enumValues(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of text.split(";")) {
    const at = part.indexOf("=");
    if (at > 0) out[part.slice(0, at).trim()] = part.slice(at + 1).trim();
  }
  return out;
}

export type DraftEntry = LayoutEntry & { enumText: string };
export type Draft = {
  name: string;
  headerRowIndex: string;
  sheetName: string;
  rowCountSwingPct: string;
  totalRowColumn: string;
  totalRowValue: string;
  /** LA-4.4: the PDF extraction profile as JSON text; empty for a spreadsheet layout. */
  pdfText: string;
  entries: DraftEntry[];
};

/** The PDF profile typed so far: its value to save and what is wrong with it. */
export function readPdfText(text: string): { value: Record<string, unknown> | null; problems: string[] } {
  if (!text.trim()) return { value: null, problems: [] };
  let value: unknown;
  try { value = JSON.parse(text); } catch { return { value: null, problems: ["The PDF layout is not valid JSON."] }; }
  if (!value || typeof value !== "object" || Array.isArray(value)) return { value: null, problems: ["The PDF layout is an object with columns and a row start."] };
  return { value: value as Record<string, unknown>, problems: pdfLayoutProblems(value).map((problem) => `PDF layout: ${problem}`) };
}

export function draftOf(map: LayoutMapView): Draft {
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

export function payload(current: Draft) {
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

/** Reads a sample file on the server: every column, what each would be used for, and a few rows. Nothing is stored. */
export async function readSample(file: File, fileType: CarrierFileType, sheet: string | null = null): Promise<SampleRead> {
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
export function sampleView(sample: SampleRead, table: number) {
  const chosen = sample.tables[table];
  return chosen ? { draft: chosen.draft, preview: chosen.preview, pdfLayout: chosen.layout as unknown } : { draft: sample.draft, preview: sample.preview, pdfLayout: null };
}

/**
 * A file's columns added to a draft's: a header already listed is left as it is; a row waiting for a
 * field takes that field's header; a field the draft already uses keeps its column, and the new one
 * is kept as information. Nothing a person chose is overwritten.
 */
export function mergeColumns(entries: DraftEntry[], incoming: LayoutEntry[]): { entries: DraftEntry[]; added: number } {
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

/** A layout's versions grouped under its key: the live one, the open draft, all of them newest first. */
export type LayoutGroup = { key: string; name: string; fileType: CarrierFileType; versions: LayoutMapView[]; live: LayoutMapView | null; draft: LayoutMapView | null };
export function groupLayouts(maps: LayoutMapView[]): LayoutGroup[] {
  const byKey = new Map<string, LayoutMapView[]>();
  for (const map of maps) byKey.set(map.layoutKey, [...(byKey.get(map.layoutKey) ?? []), map]);
  return [...byKey.entries()].map(([key, versions]) => {
    const sorted = [...versions].sort((a, b) => b.version - a.version);
    return { key, name: sorted[0].name, fileType: sorted[0].fileType, versions: sorted, live: sorted.find((map) => map.status === "published") ?? null, draft: sorted.find((map) => map.status === "draft" || map.status === "in_review") ?? null };
  });
}

export const layoutHref = (key: string) => `/admin/layout-maps/${encodeURIComponent(key)}`;
