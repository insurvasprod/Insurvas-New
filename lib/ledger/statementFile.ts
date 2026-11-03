/**
 * LA-4.1 · a carrier statement file as it arrives: what kind it is, whether it is what it says it
 * is, and where its original is kept.
 *
 *   csv   parsed on import
 *   xlsx  the first visible worksheet, turned into the same CSV text the browser previews
 *         (lib/agentTemplates/xlsx.ts), then parsed
 *   pdf   stored, never parsed: a person types its lines in (LA-4.2). No AI, no provider call.
 *
 * The original is content-addressed, `<tenant>/statements/<sha256>.<ext>`: the same bytes are the
 * same object, so a re-import or a re-process never stores a second copy, and the path cannot name
 * another workspace.
 *
 * Pure and client-safe; tested in statementFile.test.mjs.
 */
import { MAX_STATEMENT_FILE_BYTES, type StatementFileKind } from "./statementConstants.ts";

export const STATEMENT_BUCKET = "commission-statements";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** What the file picker offers. */
export const STATEMENT_FILE_ACCEPT = `.csv,text/csv,.xlsx,${XLSX_MIME},.pdf,application/pdf`;

export const STATEMENT_CONTENT_TYPE: Record<StatementFileKind, string> = {
  csv: "text/csv",
  xlsx: XLSX_MIME,
  pdf: "application/pdf",
};

/** The kind a file's name (or, failing that, its type) says it is; null for anything else. */
export function statementFileKind(file: { name: string; type?: string | null }): StatementFileKind | null {
  const name = file.name.trim().toLowerCase();
  if (name.endsWith(".csv")) return "csv";
  if (name.endsWith(".xlsx")) return "xlsx";
  if (name.endsWith(".pdf")) return "pdf";
  const type = (file.type ?? "").toLowerCase();
  if (type === "text/csv" || type === "application/csv") return "csv";
  if (type === XLSX_MIME) return "xlsx";
  if (type === "application/pdf") return "pdf";
  return null;
}

/**
 * Whether the first bytes are what the kind claims. An .xlsx is a zip ("PK\x03\x04"), a PDF starts
 * "%PDF", and a CSV is text: no NUL byte in its first kilobyte.
 */
export function statementBytesMatch(kind: StatementFileKind, head: Uint8Array): boolean {
  if (kind === "pdf") return head.length >= 4 && head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46;
  if (kind === "xlsx") return head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
  for (let index = 0; index < Math.min(head.length, 1024); index++) if (head[index] === 0) return false;
  return true;
}

/** The first thing wrong with a file, in a sentence the person can act on; null when it can be imported. */
export function statementFileProblem(file: { name: string; type?: string | null; size: number }, head?: Uint8Array): string | null {
  const kind = statementFileKind(file);
  if (!kind) return "Choose the carrier's statement as a CSV, an Excel (.xlsx) or a PDF file.";
  if (file.size <= 0) return "That file is empty.";
  if (file.size > MAX_STATEMENT_FILE_BYTES) return `That file is larger than ${(MAX_STATEMENT_FILE_BYTES / 1_000_000).toFixed(0)} MB. Split it by period and import each part.`;
  if (head && !statementBytesMatch(kind, head)) {
    return kind === "csv" ? "That file is not plain text, so it cannot be read as a CSV." : `That file is not the ${kind === "pdf" ? "PDF" : "Excel workbook"} its name says it is.`;
  }
  return null;
}

/** Where an original is kept: under its own workspace, named by its content. */
export function statementStoragePath(tenantId: string, sha256: string, kind: StatementFileKind): string {
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error("A statement file is stored by its SHA-256.");
  return `${tenantId}/statements/${sha256}.${kind}`;
}
