import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";

import type { CarrierFileKind, CarrierFileType } from "./constants";
import { checkFile, layoutsFromRows, type CheckFile, type CheckLayout, type FileCheckResult } from "./fileCheck";
import { detectHeaderRow } from "./grid";
import { pdfLayoutProblems, type PdfLayout } from "./pdfLayout";
import { readPdfLines, type PdfLine } from "./pdfText";
import { libraryCarriers } from "./registry";
import { carrierFileStorage } from "./supabaseStorage";
import { readOriginalSheets } from "./wholeFile";

/**
 * The file checker, server side (Owner request 2026-10-14): one of the agency's files read from
 * its stored original and checked against the published layouts. Read-only: nothing is written.
 *
 * Notion LA-4.1 attributes automatic files by their path without opening them; this check opens a
 * file only to SUGGEST who sent it, on the file's page. A person CONFIRMS the carrier, type and date
 * (POST /api/app/carrier-files/[id]/attribute) before it is read.
 *
 * Every read filters tenant_id: the service role has no RLS predicate.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();

/** What the check compares: each sheet's header row (grid.ts), or a PDF's lines. */
export async function checkInputFromBytes(kind: CarrierFileKind, bytes: Uint8Array): Promise<CheckFile> {
  if (kind === "pdf") {
    const lines: PdfLine[] = await readPdfLines(bytes);
    return { kind: "pdf", lines };
  }
  const sheets = await readOriginalSheets(kind, bytes);
  return {
    kind: "sheets",
    sheets: sheets.flatMap((sheet) => {
      const header = detectHeaderRow(sheet.grid);
      return header ? [{ name: sheet.name || null, headers: sheet.grid[header - 1] }] : [];
    }),
  };
}

/** The published layouts an agency's files are read with: the platform's and the agency's own. */
export async function loadCheckLayouts(tenantId: string): Promise<CheckLayout[]> {
  const [maps, assignments] = await Promise.all([
    db().from("carrier_layout_map").select("tenant_id, layout_key, name, file_type, version, pdf_layout, carrier_layout_map_entry(source_column, required)").eq("status", "published").or(`tenant_id.eq.${tenantId},tenant_id.is.null`),
    db().from("carrier_layout_assignment").select("tenant_id, carrier_id, file_type, layout_key, carriers(name)").or(`tenant_id.eq.${tenantId},tenant_id.is.null`),
  ]);
  if (maps.error) throw new Error(`Could not load the layouts: ${maps.error.message}`);
  if (assignments.error) throw new Error(`Could not load the layout assignments: ${assignments.error.message}`);
  return layoutsFromRows(
    tenantId,
    ((maps.data ?? []) as Loose[]).map((row) => ({
      tenantId: row.tenant_id,
      layoutKey: row.layout_key,
      name: row.name,
      fileType: row.file_type as CarrierFileType,
      version: Number(row.version),
      pdfLayout: row.pdf_layout && pdfLayoutProblems(row.pdf_layout).length === 0 ? (row.pdf_layout as PdfLayout) : null,
      entries: ((row.carrier_layout_map_entry ?? []) as Loose[]).map((entry) => ({ sourceColumn: String(entry.source_column ?? ""), required: Boolean(entry.required) })),
    })),
    ((assignments.data ?? []) as Loose[]).map((row) => ({ tenantId: row.tenant_id, carrierId: row.carrier_id, carrierName: row.carriers?.name ?? "A carrier", fileType: row.file_type as CarrierFileType, layoutKey: row.layout_key })),
  );
}

export type CarrierFileCheck = FileCheckResult & {
  /** The layout the file's carrier and type are read with now, when it has a carrier. */
  currentLayoutKey: string | null;
};

/**
 * Checks one of the agency's files against the published layouts. Null when the file is not the
 * agency's, its original cannot be read, or it is not a kind that is read.
 */
export async function checkCarrierFile(tenantId: string, fileId: string): Promise<CarrierFileCheck | null> {
  const { data: file, error } = await db().from("file_registry").select("id, storage_path, original_filename, file_kind, carrier_id, file_type").eq("tenant_id", tenantId).eq("id", fileId).maybeSingle();
  if (error) throw new Error(`Could not load the file: ${error.message}`);
  if (!file || !String(file.storage_path).startsWith(`${tenantId}/`)) return null;
  const kind = file.file_kind as CarrierFileKind | null;
  if (!kind || !["csv", "xlsx", "xls", "pdf"].includes(kind)) return null;
  let input: CheckFile;
  try {
    input = await checkInputFromBytes(kind, await carrierFileStorage().get(file.storage_path));
  } catch {
    return null;
  }
  const [layouts, carriers] = await Promise.all([loadCheckLayouts(tenantId), libraryCarriers()]);
  const result = checkFile({ file: input, layouts, filename: file.original_filename, carriers });
  const currentLayoutKey = file.carrier_id && file.file_type
    ? layouts.find((layout) => layout.fileType === file.file_type && layout.carriers.some((carrier) => carrier.id === file.carrier_id))?.layoutKey ?? null
    : null;
  return { ...result, currentLayoutKey };
}
