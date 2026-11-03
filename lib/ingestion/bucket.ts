/**
 * Carrier files › Bucket · one day of the automated drop (LA-4.1's third door), as plain arithmetic.
 *
 * Scripts write files into the bucket under <date>/<agency>/<carrier>/<Policies|Commissions>/; the
 * poll registers them like any other door. The page lists what arrived on a day, one row per
 * agency, carrier and type: read, still reading, or unreadable. When a day has a corrected file,
 * the current one stands for the row and the files it replaced are counted on it.
 *
 * Whether a file is MISSING is not decided here: LA-4.19's file monitor judges it from each
 * carrier's expected cadence (LA-4.17 Carrier rules) and raises a finding the next morning.
 *
 * Pure and client-safe; relative imports only.
 */

export type BucketFile = {
  id: string;
  agency: string | null;
  carrierId: string | null;
  carrierName: string | null;
  fileType: string | null;
  fileDate: string | null;
  filename: string;
  bytes: number;
  receivedAt: string;
  status: string;
  problem: string | null;
  replaced: boolean;
  rows: number | null;
  path: string;
};

export type BucketState = "received" | "reading" | "failed";

export type BucketRow = {
  key: string;
  agency: string;
  carrierId: string | null;
  carrierName: string;
  fileType: string | null;
  state: BucketState;
  /** The file standing for the row (the current one). */
  file: BucketFile;
  /** Earlier files of the same day it replaced. */
  replaced: number;
};

/** A file monitor finding (LA-4.19): a carrier on a cadence that sent nothing by its due day. */
export type MissingFile = { id: string; carrierId: string; carrierName: string; cadence: string; due: string; lastReceivedAt: string | null; reasoning: string };

export const BUCKET_STATE_LABELS: Record<BucketState, string> = {
  received: "Received",
  reading: "Reading",
  failed: "Can't be read",
};

export const agencyKey = (agency: string | null) => (agency ?? "").trim().toLowerCase().replace(/\s+/g, " ");

export function stateOf(file: Pick<BucketFile, "status">): BucketState {
  if (file.status === "failed") return "failed";
  if (file.status === "parsed") return "received";
  return "reading";
}

/** The day's files: one row per agency, carrier and type, the current file standing for it. */
export function bucketRows(files: BucketFile[]): BucketRow[] {
  const groups = new Map<string, BucketFile[]>();
  for (const file of files) {
    const key = `${agencyKey(file.agency)}|${file.carrierId ?? ""}|${file.fileType ?? ""}`;
    groups.set(key, [...(groups.get(key) ?? []), file]);
  }
  const rows: BucketRow[] = [];
  for (const [key, group] of groups) {
    const file = group.find((candidate) => !candidate.replaced) ?? group[0];
    rows.push({ key, agency: file.agency ?? "No agency folder", carrierId: file.carrierId, carrierName: file.carrierName ?? "Carrier not known", fileType: file.fileType, state: stateOf(file), file, replaced: group.length - 1 });
  }
  return rows.sort((a, b) => a.agency.localeCompare(b.agency) || a.carrierName.localeCompare(b.carrierName) || String(a.fileType).localeCompare(String(b.fileType)));
}
