/**
 * LA-4.1 (Notion sprint) · one way into the registry, whatever the door.
 *
 * The upload route, the email webhook and the bucket poller each turn what they received into a
 * DoorInput and call ingestCarrierFile. Nothing after this point knows which door was used: the row
 * it writes differs only in `source`, `uploaded_by` and (for email) who sent it.
 *
 *   1. hash the bytes;
 *   2. the same bytes already held → record the skip (nothing stored again);
 *   3. check the file is the kind its name claims and that it opens, without reading its rows;
 *      together with what the door could not attribute, that decides received or failed;
 *   4. store it (the bucket door's file is already stored, at its drop path);
 *   5. register it — the database dedups again under a lock and supersedes a reissue atomically.
 *      Losing that race, or failing to register, removes the object just stored.
 *
 * Dependencies are passed in, so the whole flow runs in tests with fakes (ingestion.test.mjs) and
 * stays free of any provider or database type. Relative imports only.
 */
import { carrierFileBytesMatch, carrierFileKind, isBinaryXls, FILE_KIND_CONTENT_TYPE, type CarrierFileKind, type CarrierFileSource, type CarrierFileType } from "./constants.ts";
import { syntheticStoragePath, type Attribution } from "./path.ts";
import type { StorageAdapter } from "./storage.ts";

export type RegisterArgs = {
  tenantId: string;
  carrierId: string | null;
  fileType: CarrierFileType | null;
  fileDate: string | null;
  pathAgency: string | null;
  originalFilename: string;
  storagePath: string;
  contentHash: string;
  fileBytes: number;
  contentType: string | null;
  fileKind: CarrierFileKind | null;
  source: CarrierFileSource;
  uploadedBy: string | null;
  status: "received" | "failed";
  errorDetail: string | null;
  emailFrom: string | null;
  emailMessageId: string | null;
};

export type RegisterOutcome =
  /** `attributed`: a file that failed only for want of its carrier was told it by these bytes (20261009210000). */
  | { outcome: "registered"; fileId: string; supersededFileId: string | null; attributed?: boolean; storagePath?: string }
  | { outcome: "skipped"; fileId: string }
  /** The same bytes, removed from the bucket earlier, dropped again: the same file, back (20261009100000). */
  | { outcome: "restored"; fileId: string };

export type IngestDeps = {
  storage: StorageAdapter;
  sha256(bytes: Uint8Array): string;
  /**
   * The file already held with these bytes, if any. A fast pre-check; register() is the authority.
   * `awaitingCarrier`: it failed only because no one knew its carrier, and was never read.
   */
  findByHash(tenantId: string, contentHash: string): Promise<{ id: string; awaitingCarrier?: boolean } | null>;
  /** The carrier a code names in the library, or null. */
  carrierByCode(code: string): Promise<{ id: string } | null>;
  /** The carrier a Drive-layout folder names (its name, code or a folder alias; the agency's alias first), or null. */
  carrierByFolder(tenantId: string, folder: string): Promise<{ id: string } | null>;
  /** Why a file of this kind does not open (a corrupt workbook), or null. Never reads its rows. */
  containerProblem(kind: CarrierFileKind, bytes: Uint8Array): Promise<string | null>;
  register(args: RegisterArgs): Promise<RegisterOutcome>;
};

export type DoorInput = {
  tenantId: string;
  source: CarrierFileSource;
  uploadedBy: string | null;
  filename: string;
  contentType: string | null;
  bytes: Uint8Array;
  /**
   * What the door knows. A door that chose the carrier by id passes both carrierId and that
   * carrier's code (the code names the folder); the bucket door passes only the code from its path.
   */
  carrierId?: string | null;
  attribution: Attribution;
  /** What the door could not attribute, already in words. */
  problems: string[];
  /** The bucket door only: where the script dropped it. Other doors get a synthetic path. */
  storagePath?: string;
  emailFrom?: string | null;
  emailMessageId?: string | null;
};

export type IngestResult =
  | { outcome: "registered"; fileId: string; status: "received" | "failed"; errorDetail: string | null; supersededFileId: string | null; storagePath: string }
  | { outcome: "skipped"; fileId: string }
  | { outcome: "restored"; fileId: string };

export async function ingestCarrierFile(deps: IngestDeps, input: DoorInput): Promise<IngestResult> {
  const contentHash = deps.sha256(input.bytes);
  const problems = [...input.problems];

  // The carrier, from the door's choice or the path's code.
  let carrierId = input.carrierId ?? null;
  if (!carrierId && input.attribution.carrierCode) {
    const carrier = await deps.carrierByCode(input.attribution.carrierCode);
    if (carrier) carrierId = carrier.id;
    else problems.push(`No carrier in the library has the code "${input.attribution.carrierCode}".`);
  }
  if (!carrierId && input.attribution.carrierFolder) {
    const carrier = await deps.carrierByFolder(input.tenantId, input.attribution.carrierFolder);
    if (carrier) carrierId = carrier.id;
    else problems.push(`No carrier in the library is named "${input.attribution.carrierFolder}". Add the folder name as an alias of its carrier.`);
  }
  const fileType = input.attribution.fileType;
  const fileDate = input.attribution.fileDate;
  const pathAgency = input.attribution.agency;

  const registration = (storagePath: string, status: "received" | "failed", errorDetail: string | null, fileKind: CarrierFileKind | null): RegisterArgs => ({
    tenantId: input.tenantId,
    carrierId,
    fileType,
    fileDate,
    pathAgency,
    originalFilename: input.filename.slice(0, 255) || "file",
    storagePath,
    contentHash,
    fileBytes: input.bytes.byteLength,
    contentType: input.contentType ?? (fileKind ? FILE_KIND_CONTENT_TYPE[fileKind] : null),
    fileKind,
    source: input.source,
    uploadedBy: input.source === "bucket" ? null : input.uploadedBy,
    status,
    errorDetail,
    emailFrom: input.emailFrom ?? null,
    emailMessageId: input.emailMessageId ?? null,
  });

  const storedAt =
    input.source === "bucket"
      ? input.storagePath ?? ""
      : syntheticStoragePath(input.tenantId, input.source, carrierId ? input.attribution : { ...input.attribution, carrierCode: null }, contentHash, input.filename);
  if (input.source === "bucket" && !storedAt.startsWith(`${input.tenantId}/`)) throw new Error("A dropped file is registered only under its own workspace.");

  // 2. Already held: record the skip, store nothing. Unless the held copy is only waiting for its
  // carrier and this one names it: then this copy is checked as usual and tells the held file.
  const held = await deps.findByHash(input.tenantId, contentHash);
  if (held && !(held.awaitingCarrier && carrierId)) {
    const outcome = await deps.register(registration(storedAt, "received", null, null));
    return outcome.outcome === "restored" ? { outcome: "restored", fileId: outcome.fileId } : { outcome: "skipped", fileId: outcome.fileId };
  }

  // 3. Is it what it says it is, and does it open? Its rows are not read here (LA-4.3 does that).
  const kind = carrierFileKind({ name: input.filename, type: input.contentType });
  if (input.bytes.byteLength === 0) problems.push("The file is empty.");
  else if (!kind) problems.push("Only CSV, Excel (.xlsx or Excel 2003 XML .xls) and PDF files can be read. The file is kept: save it in one of those formats and drop it again.");
  else if (!carrierFileBytesMatch(kind, input.bytes.subarray(0, 2048))) {
    problems.push(
      kind === "csv" ? "The file is not plain text, so it cannot be read as a CSV."
        : kind === "xls" ? (isBinaryXls(input.bytes.subarray(0, 8)) ? "This .xls is the old binary Excel format, which isn't read. Open it in Excel and save it as .xlsx, then drop it again." : "The file is not the Excel workbook its name says it is.")
          : `The file is not the ${kind === "pdf" ? "PDF" : "Excel workbook"} its name says it is.`,
    );
  } else {
    const broken = await deps.containerProblem(kind, input.bytes);
    if (broken) problems.push(broken);
  }
  const status = problems.length ? "failed" : "received";
  const errorDetail = problems.length ? problems.join(" ").slice(0, 2000) : null;

  // 4. Store (the bucket door's file is already where it was dropped; a held file's bytes are stored).
  const stores = input.source !== "bucket" && !held;
  if (stores) await deps.storage.put(storedAt, input.bytes, input.contentType ?? (kind ? FILE_KIND_CONTENT_TYPE[kind] : null));

  // 5. Register; on a lost race or an error, take back what this call stored.
  let outcome: RegisterOutcome;
  try {
    outcome = await deps.register(registration(storedAt, status, errorDetail, kind));
  } catch (error) {
    if (stores) await deps.storage.remove(storedAt).catch(() => undefined);
    throw error;
  }
  if (outcome.outcome === "skipped" || outcome.outcome === "restored") {
    if (stores) await deps.storage.remove(storedAt).catch(() => undefined);
    return { outcome: outcome.outcome, fileId: outcome.fileId };
  }
  return { outcome: "registered", fileId: outcome.fileId, status, errorDetail, supersededFileId: outcome.supersededFileId, storagePath: outcome.storagePath ?? storedAt };
}
