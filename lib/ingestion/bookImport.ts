import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";

import { persistencyStatus } from "./policyCurrent";
import { uploadCarrierFile, type UploadInput } from "./registry";
import type { IngestResult } from "./pipeline";

/**
 * LA-4.10 (Notion sprint) · importing an existing book: the agency's most recent policy file from
 * each carrier portal, through the ordinary pipeline. This file is the screen's server side — which
 * carriers to ask for, where each portal keeps its file, what each upload produced, the running
 * total, and skipping (reversible).
 *
 * The upload IS the LA-4.1 upload door; the one difference is the file is marked is_initial_import,
 * which makes LA-4.8 match it in bulk (one summary item, not one per client).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();

export class BookImportError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "BookImportError";
  }
}

export const BOOK_IMPORT_PENDING_MESSAGE = "Importing a book needs a database update (20261008190000).";

export type Guidance = { whereInPortal: string | null; reportName: string | null; formatHint: string | null; notes: string | null };
export type CarrierImport = {
  carrierId: string;
  carrierName: string;
  writes: boolean;
  status: "pending" | "imported" | "skipped";
  guidance: Guidance | null;
  file: { id: string; name: string; status: string; fileDate: string | null; rows: number | null; held: number | null; error: string | null; block: string | null } | null;
  result: { policies: number; monthlyPremiumCents: number; atRisk: number } | null;
  summary: { provisional: number; existing: number; linkedByNumber: number; blocked: number } | null;
};

const FILE_COLUMNS = "id, carrier_id, original_filename, status, file_date, row_count, held_row_count, error_detail, parse_block, received_at, is_initial_import, derived_at";

export async function loadBookImport(tenantId: string) {
  const [writes, rows, guidance, files, current, summaries, library, monthsRead] = await Promise.all([
    db().from("tenant_carriers").select("carrier_id").eq("tenant_id", tenantId).eq("is_active", true),
    db().from("book_import_carrier").select("carrier_id, status, file_id, updated_at").eq("tenant_id", tenantId),
    db().from("carrier_portal_guidance").select("carrier_id, where_in_portal, report_name, format_hint, notes"),
    db().from("file_registry").select(FILE_COLUMNS).eq("tenant_id", tenantId).eq("file_type", "policies").eq("is_initial_import", true).order("received_at", { ascending: false }).limit(200),
    db().from("policy_current").select("carrier_id, annualised_premium_cents, risk_band").eq("tenant_id", tenantId).limit(50000),
    db().from("queue_item").select("carrier_id, subject_id, payload").eq("tenant_id", tenantId).eq("queue_type", "initial_import"),
    db().from("carriers").select("id, name").eq("is_active", true).order("name"),
    db().from("file_registry").select("file_date").eq("tenant_id", tenantId).eq("file_type", "policies").eq("status", "parsed").limit(5000),
  ]);
  for (const read of [rows, guidance, files]) {
    if (read.error) {
      if (isSchemaGap(read.error)) return { available: false as const };
      throw new Error(`Could not load the import: ${read.error.message}`);
    }
  }
  const writing = new Set<string>((writes.data ?? []).map((row: Loose) => row.carrier_id));
  const progress = new Map<string, Loose>((rows.data ?? []).map((row: Loose) => [row.carrier_id, row]));
  const guide = new Map<string, Guidance>((guidance.data ?? []).map((row: Loose) => [row.carrier_id, { whereInPortal: row.where_in_portal, reportName: row.report_name, formatHint: row.format_hint, notes: row.notes }]));
  const latestFile = new Map<string, Loose>();
  for (const file of files.data ?? []) if (!latestFile.has(file.carrier_id)) latestFile.set(file.carrier_id, file);
  const byCarrier = new Map<string, { policies: number; annual: number; atRisk: number }>();
  for (const row of current.data ?? []) {
    const entry = byCarrier.get(row.carrier_id) ?? { policies: 0, annual: 0, atRisk: 0 };
    entry.policies++;
    entry.annual += Number(row.annualised_premium_cents ?? 0);
    if (row.risk_band === "at_risk" || row.risk_band === "critical") entry.atRisk++;
    byCarrier.set(row.carrier_id, entry);
  }
  const summaryOf = new Map<string, Loose>();
  for (const item of summaries.data ?? []) if (item.subject_id) summaryOf.set(item.subject_id, item.payload);

  // The carriers to ask about: the ones the agency told us it writes (LA-0.4), and any it has
  // already imported or skipped.
  const ids = [...new Set([...writing, ...progress.keys(), ...latestFile.keys()])];
  const name = new Map<string, string>((library.data ?? []).map((row: Loose) => [row.id, row.name]));
  const carriers: CarrierImport[] = ids.filter((id) => name.has(id)).map((id): CarrierImport => {
    const file = latestFile.get(id) ?? null;
    const row = progress.get(id);
    const totals = byCarrier.get(id);
    const summary = file ? summaryOf.get(file.id) : null;
    return {
      carrierId: id,
      carrierName: name.get(id)!,
      writes: writing.has(id),
      // Imported means a file is on the row: a progress row alone (a duplicate upload, before 2026-10-07) shows nothing.
      status: (row?.status === "skipped" && !file ? "skipped" : file ? "imported" : "pending") as CarrierImport["status"],
      guidance: guide.get(id) ?? null,
      // "parsed" comes before the snapshots and matching are written; until derived_at, it is still being read.
      file: file ? { id: file.id, name: file.original_filename, status: file.status === "parsed" && !file.derived_at && !file.parse_block && Number(file.row_count ?? 0) > Number(file.held_row_count ?? 0) ? "parsing" : file.status, fileDate: file.file_date, rows: file.row_count, held: file.held_row_count, error: file.error_detail, block: file.parse_block } : null,
      result: totals ? { policies: totals.policies, monthlyPremiumCents: Math.round(totals.annual / 12), atRisk: totals.atRisk } : null,
      summary: summary ? { provisional: Number(summary.provisional ?? 0), existing: Number(summary.existing ?? 0), linkedByNumber: Number(summary.linkedByNumber ?? 0), blocked: Number(summary.blocked ?? 0) } : null,
    };
  }).sort((a, b) => Number(b.writes) - Number(a.writes) || a.carrierName.localeCompare(b.carrierName));

  const months = new Set((monthsRead.data ?? []).map((row: Loose) => String(row.file_date ?? "").slice(0, 7)).filter(Boolean));
  const totals = carriers.reduce((sum, c) => ({ policies: sum.policies + (c.result?.policies ?? 0), monthlyPremiumCents: sum.monthlyPremiumCents + (c.result?.monthlyPremiumCents ?? 0), atRisk: sum.atRisk + (c.result?.atRisk ?? 0) }), { policies: 0, monthlyPremiumCents: 0, atRisk: 0 });
  return {
    available: true as const,
    carriers,
    others: (library.data ?? []).filter((row: Loose) => !ids.includes(row.id)).map((row: Loose) => ({ id: row.id as string, name: row.name as string })),
    totals,
    done: carriers.filter((c) => c.status !== "pending").length,
    persistency: persistencyStatus(months.size),
    processing: carriers.some((c) => c.file && (c.file.status === "received" || c.file.status === "parsing")),
  };
}

/**
 * The import's upload: the ordinary upload door, then the file is marked an initial import (before
 * its processing starts, which the caller runs after responding) and the carrier marked imported.
 */
export async function uploadForImport(tenantId: string, userId: string, input: Omit<UploadInput, "fileType">): Promise<IngestResult> {
  const probe = await db().from("book_import_carrier").select("carrier_id").limit(1);
  if (probe.error) {
    if (isSchemaGap(probe.error)) throw new BookImportError(BOOK_IMPORT_PENDING_MESSAGE, 503);
    throw new Error(probe.error.message);
  }
  const result = await uploadCarrierFile(tenantId, userId, { ...input, fileType: "policies" });
  if (result.outcome === "skipped") {
    // The same bytes were received before. They count for this carrier only if that is whose policy
    // file they were; otherwise the row would show another carrier's file as this one's import.
    const { data: held } = await db().from("file_registry").select("carrier_id, file_type").eq("tenant_id", tenantId).eq("id", result.fileId).maybeSingle();
    if (!held || held.carrier_id !== input.carrierId || held.file_type !== "policies") {
      const { data: owner } = held?.carrier_id ? await db().from("carriers").select("name").eq("id", held.carrier_id).maybeSingle() : { data: null };
      throw new BookImportError(`This exact file was already received${owner?.name ? ` as ${owner.name}'s` : " as another carrier's"} ${held?.file_type === "commissions" ? "commission" : "policy"} file. Choose this carrier's own file.`, 409);
    }
  }
  if (result.outcome === "registered" || result.outcome === "skipped") {
    const { error } = await db().from("file_registry").update({ is_initial_import: true }).eq("tenant_id", tenantId).eq("id", result.fileId);
    if (error) throw new Error(`The file could not be marked as an import: ${error.message}`);
  }
  await db().from("book_import_carrier").upsert({ tenant_id: tenantId, carrier_id: input.carrierId, status: "imported", file_id: result.fileId, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: "tenant_id,carrier_id" });
  return result;
}

/** Skip a carrier for now, or take the skip back. Nothing else changes; it can be imported any time. */
export async function setSkipped(tenantId: string, userId: string, carrierId: string, skipped: boolean): Promise<void> {
  const { data: carrier } = await db().from("carriers").select("id").eq("id", carrierId).eq("is_active", true).maybeSingle();
  if (!carrier) throw new BookImportError("Choose a carrier from the library.", 400);
  const write = skipped
    ? await db().from("book_import_carrier").upsert({ tenant_id: tenantId, carrier_id: carrierId, status: "skipped", file_id: null, updated_by: userId, updated_at: new Date().toISOString() }, { onConflict: "tenant_id,carrier_id" })
    : await db().from("book_import_carrier").delete().eq("tenant_id", tenantId).eq("carrier_id", carrierId).eq("status", "skipped");
  if (write.error) {
    if (isSchemaGap(write.error)) throw new BookImportError(BOOK_IMPORT_PENDING_MESSAGE, 503);
    throw new Error(`Could not save: ${write.error.message}`);
  }
}

/** Staff: the platform's portal guidance for one carrier (blank fields clear it). */
export async function saveGuidance(adminId: string, carrierId: string, guidance: Guidance): Promise<"saved" | "cleared"> {
  const values = { where_in_portal: guidance.whereInPortal?.trim() || null, report_name: guidance.reportName?.trim() || null, format_hint: guidance.formatHint?.trim() || null, notes: guidance.notes?.trim() || null };
  if (!values.where_in_portal && !values.report_name && !values.format_hint && !values.notes) {
    const { error } = await db().from("carrier_portal_guidance").delete().eq("carrier_id", carrierId);
    if (error) throw new Error(error.message);
    return "cleared";
  }
  const { error } = await db().from("carrier_portal_guidance").upsert({ carrier_id: carrierId, ...values, updated_by_admin: adminId, updated_at: new Date().toISOString() }, { onConflict: "carrier_id" });
  if (error) {
    if (isSchemaGap(error)) throw new BookImportError(BOOK_IMPORT_PENDING_MESSAGE, 503);
    throw new Error(error.message);
  }
  return "saved";
}

export async function loadGuidance() {
  const [carriers, rows] = await Promise.all([
    db().from("carriers").select("id, name").eq("is_active", true).order("name"),
    db().from("carrier_portal_guidance").select("carrier_id, where_in_portal, report_name, format_hint, notes, updated_at"),
  ]);
  if (rows.error) {
    if (isSchemaGap(rows.error)) return { available: false as const, carriers: [] };
    throw new Error(rows.error.message);
  }
  const by = new Map<string, Loose>((rows.data ?? []).map((row: Loose) => [row.carrier_id, row]));
  return {
    available: true as const,
    carriers: (carriers.data ?? []).map((c: Loose) => {
      const g = by.get(c.id);
      return { carrierId: c.id as string, carrierName: c.name as string, guidance: g ? { whereInPortal: g.where_in_portal, reportName: g.report_name, formatHint: g.format_hint, notes: g.notes } as Guidance : null, updatedAt: (g?.updated_at as string | undefined) ?? null };
    }),
  };
}
