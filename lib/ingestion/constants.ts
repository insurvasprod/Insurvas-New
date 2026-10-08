/**
 * LA-4.1 (Notion sprint) · the shared vocabulary of the carrier-file pipeline.
 *
 * A carrier sends two kinds of file and they are never confused (Module 4 doc §3.3): a POLICY file
 * (what the agent owns and whether it is alive) and a COMMISSION file (what was paid and what was
 * taken back). Some carriers also send a NEW BUSINESS file (applications not issued yet), read like
 * a policy file but kept apart, so it never replaces the day's policy file. Every file comes through one of three doors and ends as one file_registry row.
 *
 * Pure and client-safe; relative imports only, so the tests load it directly.
 */

export const CARRIER_FILE_BUCKET = "carrier-files";

export const FILE_TYPES = ["policies", "commissions", "new_business"] as const;
export type CarrierFileType = (typeof FILE_TYPES)[number];

export const FILE_TYPE_LABELS: Record<CarrierFileType, string> = {
  policies: "Policies",
  commissions: "Commissions",
  new_business: "New business",
};

/** The word a path uses for each type: <date>/<agency>/<carrier>/<Policies|Commissions|New Business>/<file>. */
export const FILE_TYPE_PATH_SEGMENT: Record<CarrierFileType, string> = {
  policies: "Policies",
  commissions: "Commissions",
  new_business: "New Business",
};

/** A type whose rows are policies (a policy file or a new-business file): read into snapshots. */
export const isPolicyFeed = (type: string | null | undefined): boolean => type === "policies" || type === "new_business";

export const FILE_SOURCES = ["upload", "email", "bucket"] as const;
export type CarrierFileSource = (typeof FILE_SOURCES)[number];

export const FILE_SOURCE_LABELS: Record<CarrierFileSource, string> = {
  upload: "Uploaded",
  email: "Emailed in",
  bucket: "Dropped by a script",
};

export const FILE_STATUSES = ["received", "parsing", "parsed", "failed", "superseded"] as const;
export type CarrierFileStatus = (typeof FILE_STATUSES)[number];

export const FILE_STATUS_LABELS: Record<CarrierFileStatus, string> = {
  received: "Received",
  parsing: "Reading",
  parsed: "Read",
  failed: "Failed",
  superseded: "Replaced",
};

export const FILE_KINDS = ["csv", "xlsx", "xls", "pdf"] as const;
export type CarrierFileKind = (typeof FILE_KINDS)[number];

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export const FILE_KIND_CONTENT_TYPE: Record<CarrierFileKind, string> = {
  csv: "text/csv",
  xlsx: XLSX_MIME,
  xls: "application/vnd.ms-excel",
  pdf: "application/pdf",
};

/** What the upload picker offers. */
export const CARRIER_FILE_ACCEPT = `.csv,text/csv,.xlsx,${XLSX_MIME},.xls,application/vnd.ms-excel,.pdf,application/pdf`;

/**
 * The largest file the upload door takes: it travels in one request body, which a serverless host
 * caps near 4.5 MB. The bucket door has no such limit (the bucket allows 25 MB).
 */
export const MAX_UPLOAD_BYTES = 4_000_000;

/** "Oct 5, 2026" for a file's date (YYYY-MM-DD, a calendar day: no time zone moves it). */
export function fileDay(value: string | null): string {
  if (!value) return "—";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** "1.2 MB", "840 KB". */
export function fileSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} KB`;
  return `${bytes} B`;
}

/** The kind a file's name (or, failing that, its type) says it is; null for anything else. */
export function carrierFileKind(file: { name: string; type?: string | null }): CarrierFileKind | null {
  const name = file.name.trim().toLowerCase();
  if (name.endsWith(".csv")) return "csv";
  if (name.endsWith(".xlsx")) return "xlsx";
  if (name.endsWith(".xls")) return "xls";
  if (name.endsWith(".pdf")) return "pdf";
  const type = (file.type ?? "").toLowerCase().split(";")[0].trim();
  if (type === "text/csv" || type === "application/csv") return "csv";
  if (type === XLSX_MIME) return "xlsx";
  if (type === "application/vnd.ms-excel") return "xls";
  if (type === "application/pdf") return "pdf";
  return null;
}

/**
 * Whether the first bytes are what the kind claims: an .xlsx is a zip ("PK\x03\x04"), a PDF starts
 * "%PDF", an .xls is an Excel 2003 XML workbook (the binary 97-2003 format is not read), and a CSV
 * is text with no NUL byte in its first kilobyte.
 */
export function carrierFileBytesMatch(kind: CarrierFileKind, head: Uint8Array): boolean {
  if (kind === "xls") return isSpreadsheetMl(head);
  if (kind === "pdf") return head.length >= 4 && head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46;
  if (kind === "xlsx") return head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
  if (head.length === 0) return false;
  for (let index = 0; index < Math.min(head.length, 1024); index++) if (head[index] === 0) return false;
  return true;
}

/** An Excel 2003 XML workbook (SpreadsheetML): XML text naming the spreadsheet namespace early on. */
export function isSpreadsheetMl(head: Uint8Array): boolean {
  if (head.length === 0) return false;
  let text = "";
  for (let index = 0; index < Math.min(head.length, 2048); index++) text += String.fromCharCode(head[index]);
  return /^\s*(\xef\xbb\xbf)?\s*<\?xml/.test(text) && /urn:schemas-microsoft-com:office:spreadsheet|<Workbook[\s>]/.test(text);
}

/** The binary Excel 97-2003 format (an OLE compound file), which is not read: it has to be saved as .xlsx. */
export function isBinaryXls(head: Uint8Array): boolean {
  return head.length >= 4 && head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0;
}
