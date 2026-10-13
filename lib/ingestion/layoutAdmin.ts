import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";

import type { CarrierFileType } from "./constants";
import { mapProblems, type DataType, type LayoutEntry, type Transform } from "./layout";
import { pdfLayoutProblems } from "./pdfLayout";

/**
 * LA-4.3 (Notion sprint) · the platform's layout maps, for staff (the admin plane).
 *
 * The LA-3.13 field-map lifecycle: a draft is edited, published by a member of staff (which retires
 * the version before it), and frozen from then on — a change is version N+1. A layout is shared by
 * every carrier ASSIGNED to it, per file type. Only platform rows (tenant_id null) are read or
 * written here; an agency's own overrides are its own.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();

export class LayoutMapError extends Error {
  constructor(message: string, readonly status: number, readonly problems: string[] = []) {
    super(message);
    this.name = "LayoutMapError";
  }
}

export const LAYOUT_MAPS_PENDING_MESSAGE = "Layout maps need a database update (20261008120000).";

export type LayoutStatus = "draft" | "in_review" | "published" | "retired";

export type LayoutEntryView = LayoutEntry & { sortOrder: number };

export type LayoutMapView = {
  id: string;
  layoutKey: string;
  name: string;
  fileType: CarrierFileType;
  version: number;
  status: LayoutStatus;
  headerRowIndex: number | null;
  sheetName: string | null;
  rowCountSwingPct: number;
  totalRowColumn: string | null;
  totalRowValue: string | null;
  /** How a PDF statement is cut into columns (pdfLayout.ts); null for a spreadsheet layout. */
  pdfLayout: unknown | null;
  approvedAt: string | null;
  updatedAt: string;
  entries: LayoutEntryView[];
};

export type AssignmentView = { id: string; carrierId: string; carrierName: string; fileType: CarrierFileType; layoutKey: string };
export type CarrierOption = { id: string; code: string; name: string };

function fail(error: { message: string; code?: string }, fallback: string): never {
  if (isSchemaGap(error)) throw new LayoutMapError(LAYOUT_MAPS_PENDING_MESSAGE, 503);
  // The database's own guard sentences (frozen once published, one file type per layout) are meant for people.
  if (error.code === "P0001") throw new LayoutMapError(error.message, 409);
  if (error.code === "23505") throw new LayoutMapError("That version or assignment already exists.", 409);
  throw new Error(`${fallback}: ${error.message}`);
}

const MAP_COLUMNS = "id, layout_key, name, file_type, version, status, header_row_index, sheet_name, row_count_swing_pct, total_row_column, total_row_value, pdf_layout, approved_at, updated_at, carrier_layout_map_entry(source_column, target_field, data_type, transform, required, sort_order, enum_values)";

function view(row: Loose): LayoutMapView {
  return {
    id: row.id,
    layoutKey: row.layout_key,
    name: row.name,
    fileType: row.file_type,
    version: row.version,
    status: row.status,
    headerRowIndex: row.header_row_index,
    sheetName: row.sheet_name,
    rowCountSwingPct: row.row_count_swing_pct,
    totalRowColumn: row.total_row_column,
    totalRowValue: row.total_row_value,
    pdfLayout: row.pdf_layout ?? null,
    approvedAt: row.approved_at,
    updatedAt: row.updated_at,
    entries: [...(row.carrier_layout_map_entry ?? [])]
      .sort((a: Loose, b: Loose) => a.sort_order - b.sort_order)
      .map((entry: Loose) => ({ sourceColumn: entry.source_column, targetField: entry.target_field, dataType: entry.data_type as DataType, transform: entry.transform as Transform, required: entry.required, enumValues: entry.enum_values, sortOrder: entry.sort_order })),
  };
}

export async function listLayoutMaps(): Promise<{ maps: LayoutMapView[]; assignments: AssignmentView[]; carriers: CarrierOption[] }> {
  const [maps, assignments, carriers] = await Promise.all([
    db().from("carrier_layout_map").select(MAP_COLUMNS).is("tenant_id", null).order("layout_key").order("version", { ascending: false }),
    db().from("carrier_layout_assignment").select("id, carrier_id, file_type, layout_key, carriers(name)").is("tenant_id", null),
    db().from("carriers").select("id, code, name").eq("is_active", true).order("name"),
  ]);
  if (maps.error) fail(maps.error, "Could not load layout maps");
  if (assignments.error) fail(assignments.error, "Could not load layout assignments");
  if (carriers.error) fail(carriers.error, "Could not load carriers");
  return {
    maps: (maps.data ?? []).map(view),
    assignments: (assignments.data ?? []).map((row: Loose) => ({ id: row.id, carrierId: row.carrier_id, carrierName: row.carriers?.name ?? "", fileType: row.file_type, layoutKey: row.layout_key })),
    carriers: carriers.data ?? [],
  };
}

async function getMap(id: string): Promise<LayoutMapView> {
  const { data, error } = await db().from("carrier_layout_map").select(MAP_COLUMNS).is("tenant_id", null).eq("id", id).maybeSingle();
  if (error) fail(error, "Could not load the layout map");
  if (!data) throw new LayoutMapError("That layout map does not exist.", 404);
  return view(data);
}

export async function createLayoutMap(adminId: string, input: { layoutKey: string; name: string; fileType: CarrierFileType }): Promise<LayoutMapView> {
  const { data: latest, error } = await db().from("carrier_layout_map").select("version").is("tenant_id", null).eq("layout_key", input.layoutKey).order("version", { ascending: false }).limit(1);
  if (error) fail(error, "Could not read the layout's versions");
  if (latest?.length) throw new LayoutMapError(`Layout "${input.layoutKey}" already exists; open it and start a new version.`, 409);
  const { data, error: insertError } = await db().from("carrier_layout_map").insert({ layout_key: input.layoutKey, name: input.name, file_type: input.fileType, version: 1, created_by_admin: adminId }).select("id").single();
  if (insertError) fail(insertError, "Could not create the layout map");
  return getMap(data.id);
}

export type LayoutSave = {
  name: string;
  headerRowIndex: number | null;
  sheetName: string | null;
  rowCountSwingPct: number;
  totalRowColumn: string | null;
  totalRowValue: string | null;
  entries: LayoutEntry[];
  /** LA-4.4: the PDF extraction profile; undefined leaves it as it is, null clears it. */
  pdfLayout?: unknown | null;
};

/** Saves a draft: its settings and its whole column list. A published version is refused by the database. */
export async function saveLayoutMap(id: string, input: LayoutSave): Promise<LayoutMapView> {
  const current = await getMap(id);
  if (current.status !== "draft" && current.status !== "in_review") throw new LayoutMapError(`Version ${current.version} is ${current.status}; start version ${current.version + 1} to change it.`, 409);
  const { error } = await db().from("carrier_layout_map").update({
    name: input.name,
    header_row_index: input.headerRowIndex,
    sheet_name: input.sheetName,
    row_count_swing_pct: input.rowCountSwingPct,
    total_row_column: input.totalRowColumn,
    total_row_value: input.totalRowValue,
    ...(input.pdfLayout !== undefined ? { pdf_layout: input.pdfLayout } : {}),
  }).eq("id", id).is("tenant_id", null);
  if (error) fail(error, "Could not save the layout map");
  const removed = await db().from("carrier_layout_map_entry").delete().eq("map_id", id);
  if (removed.error) fail(removed.error, "Could not replace the map's columns");
  if (input.entries.length) {
    const inserted = await db().from("carrier_layout_map_entry").insert(input.entries.map((entry, index) => ({
      map_id: id,
      source_column: entry.sourceColumn,
      target_field: entry.targetField,
      data_type: entry.dataType,
      transform: entry.transform,
      required: entry.required,
      sort_order: index,
      enum_values: entry.dataType === "enum" ? entry.enumValues ?? {} : null,
    })));
    if (inserted.error) fail(inserted.error, "Could not save the map's columns");
  }
  return getMap(id);
}

/** Publishes a draft once its columns make sense for its file type; the version before it retires. */
export async function publishLayoutMap(adminId: string, id: string): Promise<LayoutMapView> {
  const current = await getMap(id);
  // LA-4.4: a PDF extraction profile is checked before a person approves it, not when a file fails.
  const problems = [...mapProblems({ fileType: current.fileType }, current.entries), ...(current.pdfLayout ? pdfLayoutProblems(current.pdfLayout).map((problem) => `PDF layout: ${problem}`) : [])];
  if (problems.length) throw new LayoutMapError("This map cannot be published yet.", 400, problems);
  const { error } = await db().rpc("publish_layout_map", { p_map_id: id, p_admin_id: adminId, p_user_id: null });
  if (error) fail(error, "Could not publish the layout map");
  return getMap(id);
}

/** Copies a published (or retired) version into a new draft, version N+1. */
export async function newLayoutVersion(adminId: string, id: string): Promise<LayoutMapView> {
  const source = await getMap(id);
  const { data: open } = await db().from("carrier_layout_map").select("version").is("tenant_id", null).eq("layout_key", source.layoutKey).in("status", ["draft", "in_review"]).limit(1);
  if (open?.length) throw new LayoutMapError(`Version ${open[0].version} of this layout is already open as a draft.`, 409);
  const { data: latest } = await db().from("carrier_layout_map").select("version").is("tenant_id", null).eq("layout_key", source.layoutKey).order("version", { ascending: false }).limit(1);
  const version = (latest?.[0]?.version ?? source.version) + 1;
  const { data, error } = await db().from("carrier_layout_map").insert({
    layout_key: source.layoutKey,
    name: source.name,
    file_type: source.fileType,
    version,
    header_row_index: source.headerRowIndex,
    sheet_name: source.sheetName,
    row_count_swing_pct: source.rowCountSwingPct,
    total_row_column: source.totalRowColumn,
    total_row_value: source.totalRowValue,
    // A PDF layout carries over to the next version, like the sheet and header row.
    pdf_layout: source.pdfLayout,
    created_by_admin: adminId,
  }).select("id").single();
  if (error) fail(error, "Could not start the new version");
  return saveLayoutMap(data.id, { ...source, entries: source.entries });
}

export async function retireLayoutMap(id: string): Promise<LayoutMapView> {
  const current = await getMap(id);
  if (current.status !== "published") throw new LayoutMapError("Only the published version can be retired.", 409);
  const { error } = await db().from("carrier_layout_map").update({ status: "retired" }).eq("id", id).is("tenant_id", null);
  if (error) fail(error, "Could not retire the layout map");
  return getMap(id);
}

/**
 * Deletes a draft (or in-review) version and its columns. A published or retired version is never
 * deleted (LA-4.3: published maps are immutable and files record the version that read them); the
 * database refuses it too. Deleting the only version of a layout also removes its carrier assignments,
 * which would otherwise point at nothing.
 */
export async function deleteLayoutDraft(id: string): Promise<LayoutMapView> {
  const current = await getMap(id);
  if (current.status !== "draft" && current.status !== "in_review") throw new LayoutMapError(`Version ${current.version} is ${current.status}; only a draft can be deleted. Retire a published version instead.`, 409);
  const { data, error } = await db().from("carrier_layout_map").delete().eq("id", id).is("tenant_id", null).in("status", ["draft", "in_review"]).select("id");
  if (error) fail(error, "Could not delete the draft");
  if (!data?.length) throw new LayoutMapError("That draft no longer exists.", 404);
  const { data: others, error: othersError } = await db().from("carrier_layout_map").select("id").is("tenant_id", null).eq("layout_key", current.layoutKey).limit(1);
  if (othersError) fail(othersError, "Could not read the layout's other versions");
  if (!others?.length) {
    const removed = await db().from("carrier_layout_assignment").delete().is("tenant_id", null).eq("layout_key", current.layoutKey);
    if (removed.error) fail(removed.error, "Could not remove the layout's assignments");
  }
  return current;
}

/** Points a carrier's files of one type at a layout (platform-wide). */
export async function setLayoutAssignment(adminId: string, input: { carrierId: string; fileType: CarrierFileType; layoutKey: string }): Promise<void> {
  const { data: layout } = await db().from("carrier_layout_map").select("file_type").is("tenant_id", null).eq("layout_key", input.layoutKey).limit(1);
  if (!layout?.length) throw new LayoutMapError(`There is no layout "${input.layoutKey}".`, 404);
  if (layout[0].file_type !== input.fileType) throw new LayoutMapError(`Layout "${input.layoutKey}" reads ${layout[0].file_type} files.`, 400);
  const { data: existing, error } = await db().from("carrier_layout_assignment").select("id").is("tenant_id", null).eq("carrier_id", input.carrierId).eq("file_type", input.fileType).maybeSingle();
  if (error) fail(error, "Could not read the assignment");
  const write = existing
    ? db().from("carrier_layout_assignment").update({ layout_key: input.layoutKey, created_by_admin: adminId, updated_at: new Date().toISOString() }).eq("id", existing.id)
    : db().from("carrier_layout_assignment").insert({ carrier_id: input.carrierId, file_type: input.fileType, layout_key: input.layoutKey, created_by_admin: adminId });
  const { error: writeError } = await write;
  if (writeError) fail(writeError, "Could not save the assignment");
}

export async function removeLayoutAssignment(id: string): Promise<void> {
  const { data, error } = await db().from("carrier_layout_assignment").delete().eq("id", id).is("tenant_id", null).select("id");
  if (error) fail(error, "Could not remove the assignment");
  if (!data?.length) throw new LayoutMapError("That assignment does not exist.", 404);
}

export type WaitingFile = { id: string; label: string };

/**
 * Files held back for want of a layout, newest first, so staff can write one from a real file's
 * headers instead of typing them. Staff see the carrier, file name and date; never the rows.
 */
export async function listFilesWaitingForLayout(fileType: CarrierFileType): Promise<WaitingFile[]> {
  const { data, error } = await db().from("file_registry").select("id, carrier_id, original_filename, file_date").eq("parse_block", "no_layout_map").eq("file_type", fileType).order("received_at", { ascending: false }).limit(25);
  if (error) {
    if (isSchemaGap(error)) return [];
    throw new Error(`Could not list the waiting files: ${error.message}`);
  }
  const carrierIds = [...new Set((data ?? []).map((row: Loose) => row.carrier_id).filter(Boolean))];
  const { data: carriers } = carrierIds.length ? await db().from("carriers").select("id, name").in("id", carrierIds) : { data: [] };
  const name = new Map<string, string>((carriers ?? []).map((row: Loose) => [row.id, row.name]));
  return (data ?? []).map((row: Loose) => ({ id: row.id, label: `${name.get(row.carrier_id) ?? "Carrier not known"} · ${row.original_filename}${row.file_date ? ` · ${row.file_date}` : ""}` }));
}

/** The column headers of one waiting file, read from its first kept row (alphabetical: the row keeps names, not order). */
export async function waitingFileHeaders(fileId: string): Promise<string[]> {
  const { data: file, error } = await db().from("file_registry").select("id, tenant_id, raw_columns").eq("id", fileId).eq("parse_block", "no_layout_map").maybeSingle();
  if (error) throw new Error(`Could not open the file: ${error.message}`);
  if (!file) throw new LayoutMapError("That file is no longer waiting for a layout.", 404);
  // The file's own column order (LA-4.2 keeps it on the registry row): a row's payload is jsonb,
  // which does not keep key order, so the headers came back alphabetical and staff mapped them
  // out of the order they read in the carrier's file.
  const ordered = Array.isArray(file.raw_columns) ? (file.raw_columns as Array<{ header?: unknown }>).map((column) => (typeof column?.header === "string" ? column.header : "")).filter((header) => header.trim() !== "") : [];
  if (ordered.length) return ordered;
  const { data: rows, error: rowError } = await db().from("raw_rows").select("payload").eq("tenant_id", file.tenant_id).eq("file_id", file.id).order("row_number").limit(1);
  if (rowError) throw new Error(`Could not read the file's columns: ${rowError.message}`);
  const payload = rows?.[0]?.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new LayoutMapError("No rows were kept from that file, so its columns aren't known.", 422);
  return Object.keys(payload).sort((a, b) => a.localeCompare(b));
}
