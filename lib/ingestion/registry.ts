import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { readXlsxAsCsv } from "@/lib/agentTemplates/xlsx";
import { getEntitlement } from "@/lib/entitlements/get";
import { canWrite, hasFeature } from "@/lib/entitlements/types";
import { getSupabaseServiceClient } from "@/lib/supabase/service";
import { isSchemaGap } from "@/lib/supabase/schemaGap";

import type { CarrierFileKind, CarrierFileSource, CarrierFileStatus, CarrierFileType } from "./constants";
import { attributeAttachment, readPostmarkInbound, type KnownSender, type PostmarkInbound } from "./inboundEmail";
import { parseDropPath, type Attribution, type CarrierChoice } from "./path";
import { ingestCarrierFile, type IngestDeps, type IngestResult, type RegisterArgs, type RegisterOutcome } from "./pipeline";
import { carrierFileStorage } from "./supabaseStorage";

/**
 * LA-4.1 (Notion sprint) · the file registry, server side: the three doors, the list the agency sees,
 * the download link, the agency's inbound address and its known carrier senders.
 *
 * Every read filters tenant_id (the service role has no RLS predicate). Before migration
 * 20261008100000 every read answers `available: false` and every write refuses with a 503.
 */

// The registry tables are newer than the generated database types.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = any;
const db = (): Loose => getSupabaseServiceClient();

/** The feature the pipeline is sold under: the Ledger plan's statement ingestion. */
export const CARRIER_FILE_FEATURE = "statement_ingestion";
export const CARRIER_FILE_ROLES = ["owner", "bookkeeper"] as const;

export const CARRIER_FILES_PENDING_MESSAGE = "Carrier files need a database update (20261008100000). Until it is applied, statements are imported on the Statements page.";

export class CarrierFileError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message);
    this.name = "CarrierFileError";
  }
}

function pending(error: { message: string; code?: string } | null): boolean {
  return Boolean(error && isSchemaGap(error));
}

// ─── the pipeline's dependencies ───────────────────────────────────────────────────────────────

let carrierCache: { at: number; carriers: CarrierChoice[] } | null = null;

/** The carrier library (platform data), cached for a minute. */
export async function libraryCarriers(): Promise<CarrierChoice[]> {
  if (carrierCache && Date.now() - carrierCache.at < 60_000) return carrierCache.carriers;
  const { data, error } = await db().from("carriers").select("id, code, name").eq("is_active", true).order("sort_order").order("name");
  if (error) throw new Error(`Could not load the carrier library: ${error.message}`);
  carrierCache = { at: Date.now(), carriers: (data ?? []) as CarrierChoice[] };
  return carrierCache.carriers;
}

async function containerProblem(kind: CarrierFileKind, bytes: Uint8Array): Promise<string | null> {
  if (kind === "xlsx") {
    try {
      const copy = bytes.slice().buffer as ArrayBuffer;
      await readXlsxAsCsv(copy);
      return null;
    } catch {
      return "The Excel workbook could not be opened. It may be damaged or password-protected.";
    }
  }
  if (kind === "pdf") {
    const tail = new TextDecoder("latin1").decode(bytes.subarray(Math.max(0, bytes.length - 2048)));
    return tail.includes("%%EOF") ? null : "The PDF looks cut off: it has no end-of-file marker.";
  }
  return null;
}

async function register(args: RegisterArgs): Promise<RegisterOutcome> {
  const { data, error } = await db().rpc("register_carrier_file", {
    p_tenant_id: args.tenantId,
    p_carrier_id: args.carrierId,
    p_file_type: args.fileType,
    p_file_date: args.fileDate,
    p_path_agency: args.pathAgency,
    p_original_filename: args.originalFilename,
    p_storage_path: args.storagePath,
    p_content_hash: args.contentHash,
    p_file_bytes: args.fileBytes,
    p_content_type: args.contentType,
    p_file_kind: args.fileKind,
    p_source: args.source,
    p_uploaded_by: args.uploadedBy,
    p_status: args.status,
    p_error_detail: args.errorDetail,
    p_email_from: args.emailFrom,
    p_email_message_id: args.emailMessageId,
  });
  if (error) {
    if (pending(error)) throw new CarrierFileError(CARRIER_FILES_PENDING_MESSAGE, 503, "schema_pending");
    throw new Error(`The file could not be registered: ${error.message}`);
  }
  const result = data as { outcome: "registered" | "skipped"; file_id: string; superseded_file_id?: string | null };
  return result.outcome === "skipped"
    ? { outcome: "skipped", fileId: result.file_id }
    : { outcome: "registered", fileId: result.file_id, supersededFileId: result.superseded_file_id ?? null };
}

function ingestDeps(): IngestDeps {
  return {
    storage: carrierFileStorage(),
    sha256: (bytes) => createHash("sha256").update(bytes).digest("hex"),
    findByHash: async (tenantId, contentHash) => {
      const { data, error } = await db().from("file_registry").select("id").eq("tenant_id", tenantId).eq("content_hash", contentHash).maybeSingle();
      if (error) {
        if (pending(error)) throw new CarrierFileError(CARRIER_FILES_PENDING_MESSAGE, 503, "schema_pending");
        throw new Error(`Could not check for the same file: ${error.message}`);
      }
      return data ? { id: data.id as string } : null;
    },
    carrierByCode: async (code) => (await libraryCarriers()).find((carrier) => carrier.code === code) ?? null,
    containerProblem,
    register,
  };
}

/** May this agency take carrier files right now? (Feature on its plan, and a full account.) */
async function acceptsFiles(tenantId: string): Promise<boolean> {
  const entitlement = await getEntitlement(tenantId);
  return hasFeature(entitlement, CARRIER_FILE_FEATURE) && canWrite(entitlement);
}

// ─── door 1: upload ────────────────────────────────────────────────────────────────────────────

export type UploadInput = {
  filename: string;
  contentType: string | null;
  bytes: Uint8Array;
  carrierId: string;
  fileType: CarrierFileType;
  fileDate: string;
  agency: string | null;
};

export async function uploadCarrierFile(tenantId: string, userId: string, input: UploadInput): Promise<IngestResult> {
  const carrier = (await libraryCarriers()).find((choice) => choice.id === input.carrierId);
  if (!carrier) throw new CarrierFileError("Choose a carrier from the library.", 400, "unknown_carrier");
  const attribution: Attribution = { fileDate: input.fileDate, agency: input.agency, carrierCode: carrier.code, fileType: input.fileType };
  return ingestCarrierFile(ingestDeps(), {
    tenantId,
    source: "upload",
    uploadedBy: userId,
    filename: input.filename,
    contentType: input.contentType,
    bytes: input.bytes,
    carrierId: carrier.id,
    attribution,
    problems: [],
  });
}

// ─── door 2: email ─────────────────────────────────────────────────────────────────────────────

export type EmailOutcome =
  | { handled: false; reason: "no_agency" | "not_entitled" | "schema_pending" }
  | { handled: true; tenantId: string; results: Array<{ filename: string } & IngestResult> };

async function tenantForToken(tokens: string[]): Promise<string | null> {
  if (!tokens.length) return null;
  const { data, error } = await db().from("tenant_inbound_addresses").select("tenant_id, token").in("token", tokens);
  if (error) {
    if (pending(error)) throw new CarrierFileError(CARRIER_FILES_PENDING_MESSAGE, 503, "schema_pending");
    throw new Error(`Could not look the address up: ${error.message}`);
  }
  const rows = (data ?? []) as Array<{ tenant_id: string; token: string }>;
  // One message to two agencies' addresses is ambiguous; the first address it was sent to wins.
  for (const token of tokens) {
    const row = rows.find((candidate) => candidate.token === token);
    if (row) return row.tenant_id;
  }
  return null;
}

async function knownSenders(tenantId: string): Promise<KnownSender[]> {
  const { data, error } = await db().from("carrier_inbound_senders").select("carrier_id, sender, tenant_id").or(`tenant_id.eq.${tenantId},tenant_id.is.null`);
  if (error) throw new Error(`Could not load the known carrier senders: ${error.message}`);
  return ((data ?? []) as Array<{ carrier_id: string; sender: string; tenant_id: string | null }>).map((row) => ({ carrierId: row.carrier_id, sender: row.sender, tenantId: row.tenant_id }));
}

export async function receiveInboundEmail(payload: PostmarkInbound): Promise<EmailOutcome> {
  const message = readPostmarkInbound(payload);
  let tenantId: string | null;
  try {
    tenantId = await tenantForToken(message.tokens);
  } catch (error) {
    if (error instanceof CarrierFileError && error.code === "schema_pending") return { handled: false, reason: "schema_pending" };
    throw error;
  }
  if (!tenantId) return { handled: false, reason: "no_agency" };
  if (!(await acceptsFiles(tenantId))) return { handled: false, reason: "not_entitled" };

  const [senders, carriers] = await Promise.all([knownSenders(tenantId), libraryCarriers()]);
  const deps = ingestDeps();
  const results: Array<{ filename: string } & IngestResult> = [];
  for (const attachment of message.attachments) {
    const sorted = attributeAttachment(message, attachment.name, senders, carriers);
    const result = await ingestCarrierFile(deps, {
      tenantId,
      source: "email",
      // An emailed file has no signed-in uploader; who sent it is kept in email_from.
      uploadedBy: null,
      filename: attachment.name,
      contentType: attachment.contentType,
      bytes: attachment.bytes,
      carrierId: sorted.carrierId,
      attribution: sorted.attribution,
      problems: sorted.problems,
      emailFrom: message.from,
      emailMessageId: message.messageId,
    });
    results.push({ filename: attachment.name, ...result });
  }
  return { handled: true, tenantId, results };
}

// ─── door 3: the bucket ────────────────────────────────────────────────────────────────────────

export type PollOutcome = {
  available: boolean;
  seen: number;
  registered: number;
  failed: number;
  skipped: number;
  /** Drops left in place for an agency that cannot take files now (no feature, or read-only). */
  waiting: number;
  errors: string[];
};

/** Registers what scripts dropped into <tenant>/inbox/… since the last poll. Safe to run twice. */
export async function pollBucketDrops(limit = 100): Promise<PollOutcome> {
  const outcome: PollOutcome = { available: true, seen: 0, registered: 0, failed: 0, skipped: 0, waiting: 0, errors: [] };
  const { data, error } = await db().rpc("list_unregistered_carrier_drops", { p_limit: limit });
  if (error) {
    if (pending(error)) return { ...outcome, available: false };
    throw new Error(`Could not list dropped files: ${error.message}`);
  }
  const drops = (data ?? []) as Array<{ storage_path: string; file_bytes: number }>;
  outcome.seen = drops.length;
  const deps = ingestDeps();
  const accepting = new Map<string, boolean>();
  for (const drop of drops) {
    const parsed = parseDropPath(drop.storage_path);
    if (!parsed.tenantId) continue;
    if (!accepting.has(parsed.tenantId)) accepting.set(parsed.tenantId, await acceptsFiles(parsed.tenantId).catch(() => false));
    if (!accepting.get(parsed.tenantId)) {
      outcome.waiting++;
      continue;
    }
    try {
      const bytes = await deps.storage.get(drop.storage_path);
      const result = await ingestCarrierFile(deps, {
        tenantId: parsed.tenantId,
        source: "bucket",
        uploadedBy: null,
        filename: parsed.filename,
        contentType: null,
        bytes,
        attribution: parsed.attribution,
        problems: parsed.problems,
        storagePath: drop.storage_path,
      });
      if (result.outcome === "skipped") outcome.skipped++;
      else if (result.status === "failed") outcome.failed++;
      else outcome.registered++;
    } catch (failure) {
      outcome.errors.push(`${drop.storage_path}: ${failure instanceof Error ? failure.message : String(failure)}`);
    }
  }
  return outcome;
}

// ─── what the agency sees ──────────────────────────────────────────────────────────────────────

export type CarrierFileRow = {
  id: string;
  carrierId: string | null;
  carrierName: string | null;
  fileType: CarrierFileType | null;
  fileDate: string | null;
  agency: string | null;
  originalFilename: string;
  fileBytes: number;
  fileKind: CarrierFileKind | null;
  status: CarrierFileStatus;
  errorDetail: string | null;
  source: CarrierFileSource;
  uploadedByName: string | null;
  emailFrom: string | null;
  receivedAt: string;
  supersededByFileId: string | null;
  contentHash: string;
  /** LA-4.2: raw rows stored for this file, once extracted; null while waiting (or before 20261008110000). */
  rowCount: number | null;
  /** LA-4.2: why its rows could not be read, when they could not. */
  rawError: string | null;
};

export type CarrierFileSkip = { id: string; originalFileId: string; originalFilename: string; source: CarrierFileSource; skippedAt: string };

export type CarrierFileList = { available: boolean; files: CarrierFileRow[]; skips: CarrierFileSkip[] };

const FILE_COLUMNS =
  "id, carrier_id, file_type, file_date, path_agency, original_filename, file_bytes, file_kind, status, error_detail, source, email_from, received_at, superseded_by_file_id, content_hash, row_count, carriers(name), users:uploaded_by(name, email)";
const RAW_COLUMNS = ", raw_extracted_at, raw_error";

/** The agency's files, newest first (at most `limit`), and the most recent skipped duplicates. */
export async function listCarrierFiles(tenantId: string, limit = 500): Promise<CarrierFileList> {
  const read = (columns: string) => db().from("file_registry").select(columns).eq("tenant_id", tenantId).order("received_at", { ascending: false }).limit(limit);
  const [first, skips] = await Promise.all([
    read(FILE_COLUMNS + RAW_COLUMNS),
    db().from("file_registry_skips").select("id, original_file_id, original_filename, source, skipped_at").eq("tenant_id", tenantId).order("skipped_at", { ascending: false }).limit(50),
  ]);
  let files = first;
  // Before 20261008110000 the raw-layer columns do not exist; the list still shows every file.
  if (files.error && files.error.code === "42703") files = await read(FILE_COLUMNS);
  if (files.error) {
    if (pending(files.error)) return { available: false, files: [], skips: [] };
    throw new Error(`Could not load carrier files: ${files.error.message}`);
  }
  if (skips.error && !pending(skips.error)) throw new Error(`Could not load skipped files: ${skips.error.message}`);
  return {
    available: true,
    files: (files.data ?? []).map((row: Loose) => ({
      id: row.id,
      carrierId: row.carrier_id,
      carrierName: row.carriers?.name ?? null,
      fileType: row.file_type,
      fileDate: row.file_date,
      agency: row.path_agency,
      originalFilename: row.original_filename,
      fileBytes: Number(row.file_bytes),
      fileKind: row.file_kind,
      status: row.status,
      errorDetail: row.error_detail,
      source: row.source,
      uploadedByName: row.users?.name ?? row.users?.email ?? null,
      emailFrom: row.email_from,
      receivedAt: row.received_at,
      supersededByFileId: row.superseded_by_file_id,
      contentHash: row.content_hash,
      rowCount: row.raw_extracted_at ? Number(row.row_count) : null,
      rawError: row.raw_error ?? null,
    })),
    skips: (skips.data ?? []).map((row: Loose) => ({ id: row.id, originalFileId: row.original_file_id, originalFilename: row.original_filename, source: row.source, skippedAt: row.skipped_at })),
  };
}

/** A sixty-second link to one of the agency's originals, named as it was received. */
export async function carrierFileDownloadUrl(tenantId: string, fileId: string): Promise<string> {
  const { data, error } = await db().from("file_registry").select("storage_path, original_filename").eq("tenant_id", tenantId).eq("id", fileId).maybeSingle();
  if (error) {
    if (pending(error)) throw new CarrierFileError(CARRIER_FILES_PENDING_MESSAGE, 503, "schema_pending");
    throw new Error(`Could not find the file: ${error.message}`);
  }
  if (!data || !String(data.storage_path).startsWith(`${tenantId}/`)) throw new CarrierFileError("That file is not in this workspace.", 404, "not_found");
  return carrierFileStorage().signedUrl(data.storage_path, 60, data.original_filename);
}

// ─── the agency's inbound address ──────────────────────────────────────────────────────────────

/**
 * The address shape this deployment receives on: CARRIER_FILES_INBOUND_DOMAIN ("in.insurvas.com" →
 * "<token>@in.insurvas.com"), or CARRIER_FILES_INBOUND_ADDRESS (Postmark's own
 * "abc123@inbound.postmarkapp.com" → "abc123+<token>@inbound.postmarkapp.com"). Null when neither is set.
 */
export function inboundAddressFor(token: string): string | null {
  const domain = (process.env.CARRIER_FILES_INBOUND_DOMAIN ?? "").trim().toLowerCase();
  if (domain) return `${token}@${domain}`;
  const base = (process.env.CARRIER_FILES_INBOUND_ADDRESS ?? "").trim().toLowerCase();
  const at = base.lastIndexOf("@");
  if (at > 0) return `${base.slice(0, at)}+${token}${base.slice(at)}`;
  return null;
}

export type InboundAddress = { available: boolean; configured: boolean; address: string | null };

export async function getInboundAddress(tenantId: string): Promise<InboundAddress> {
  const { data, error } = await db().from("tenant_inbound_addresses").select("token").eq("tenant_id", tenantId).maybeSingle();
  if (error) {
    if (pending(error)) return { available: false, configured: false, address: null };
    throw new Error(`Could not load the inbound address: ${error.message}`);
  }
  const configured = inboundAddressFor("x".repeat(24)) !== null;
  return { available: true, configured, address: data ? inboundAddressFor(data.token) : null };
}

/** Gives the agency its address (once; it never changes, so forwarding rules keep working). */
export async function createInboundAddress(tenantId: string, userId: string): Promise<InboundAddress> {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const token = Array.from(randomBytes(24), (byte) => alphabet[byte % alphabet.length]).join("");
  const { error } = await db().from("tenant_inbound_addresses").insert({ tenant_id: tenantId, token, created_by: userId });
  if (error && error.code !== "23505") {
    if (pending(error)) throw new CarrierFileError(CARRIER_FILES_PENDING_MESSAGE, 503, "schema_pending");
    throw new Error(`Could not create the inbound address: ${error.message}`);
  }
  return getInboundAddress(tenantId);
}

// ─── known carrier senders ─────────────────────────────────────────────────────────────────────

export type SenderRow = { id: string; carrierId: string; carrierName: string | null; sender: string; platform: boolean };

export async function listSenders(tenantId: string): Promise<{ available: boolean; senders: SenderRow[] }> {
  const { data, error } = await db().from("carrier_inbound_senders").select("id, carrier_id, sender, tenant_id, carriers(name)").or(`tenant_id.eq.${tenantId},tenant_id.is.null`).order("sender");
  if (error) {
    if (pending(error)) return { available: false, senders: [] };
    throw new Error(`Could not load the known carrier senders: ${error.message}`);
  }
  return {
    available: true,
    senders: (data ?? []).map((row: Loose) => ({ id: row.id, carrierId: row.carrier_id, carrierName: row.carriers?.name ?? null, sender: row.sender, platform: row.tenant_id === null })),
  };
}

/** "commissions@americo.com" or "@americo.com" (every address at that domain). Exact match only. */
export function normaliseSender(value: string): string | null {
  const sender = value.trim().toLowerCase();
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(sender) || /^@[^@\s]+\.[^@\s]+$/.test(sender)) return sender.length <= 254 ? sender : null;
  return null;
}

export async function addSender(tenantId: string, userId: string, carrierId: string, value: string): Promise<SenderRow> {
  const sender = normaliseSender(value);
  if (!sender) throw new CarrierFileError("Enter the carrier's sending address, like commissions@carrier.com, or a whole domain, like @carrier.com.", 400, "invalid_sender");
  if (!(await libraryCarriers()).some((carrier) => carrier.id === carrierId)) throw new CarrierFileError("Choose a carrier from the library.", 400, "unknown_carrier");
  const { data, error } = await db().from("carrier_inbound_senders").insert({ tenant_id: tenantId, carrier_id: carrierId, sender, created_by: userId }).select("id, carrier_id, sender, tenant_id, carriers(name)").single();
  if (error) {
    if (pending(error)) throw new CarrierFileError(CARRIER_FILES_PENDING_MESSAGE, 503, "schema_pending");
    if (error.code === "23505") throw new CarrierFileError(`${sender} is already a known sender.`, 409, "duplicate_sender");
    throw new Error(`Could not save the sender: ${error.message}`);
  }
  return { id: data.id, carrierId: data.carrier_id, carrierName: data.carriers?.name ?? null, sender: data.sender, platform: false };
}

/** Removes one of the agency's own senders; a platform sender is not the agency's to remove. */
export async function removeSender(tenantId: string, senderId: string): Promise<void> {
  const { data, error } = await db().from("carrier_inbound_senders").delete().eq("tenant_id", tenantId).eq("id", senderId).select("id");
  if (error) {
    if (pending(error)) throw new CarrierFileError(CARRIER_FILES_PENDING_MESSAGE, 503, "schema_pending");
    throw new Error(`Could not remove the sender: ${error.message}`);
  }
  if (!data?.length) throw new CarrierFileError("That sender is not one of this agency's.", 404, "not_found");
}
