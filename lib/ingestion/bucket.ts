/**
 * Carrier files › Bucket (2026-10-09) · one day of the bucket as plain arithmetic: which files the
 * settings expected that day, which of them arrived, which are missing, and which arrived without
 * being expected.
 *
 *   expected    an active expectation whose weekdays include the day's weekday
 *   received    an expected file with a file in the bucket for that agency, carrier, type and day —
 *               read, still reading, or unreadable (it arrived; the row says what is wrong with it)
 *   missing     an expected file with nothing in the bucket, or whose file was deleted from it
 *   unexpected  a file in the bucket that no expectation for that day names
 *
 * Agencies are matched as written in the bucket's folder, ignoring case and spacing. When a day has
 * a corrected file, the current one stands for the row; the files it replaced are counted on it.
 *
 * Pure and client-safe; relative imports only.
 */
import type { CarrierFileType } from "./constants.ts";

export type BucketExpectation = { id: string; agency: string; carrierId: string; carrierName: string; fileType: CarrierFileType; weekdays: number[]; active: boolean };

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
  removedAt: string | null;
  restoredAt: string | null;
  replaced: boolean;
  rows: number | null;
  path: string;
};

export type BucketState = "received" | "reading" | "failed" | "removed" | "missing" | "unexpected";

export type BucketRow = {
  key: string;
  agency: string;
  carrierId: string | null;
  carrierName: string;
  fileType: string | null;
  expected: boolean;
  state: BucketState;
  /** The file standing for the row (the current one), if any. */
  file: BucketFile | null;
  /** Earlier files of the same day it replaced. */
  replaced: number;
};

export type BucketDay = {
  date: string;
  weekday: number;
  rows: BucketRow[];
  counts: { expected: number; received: number; missing: number; unexpected: number };
};

export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export const BUCKET_STATE_LABELS: Record<BucketState, string> = {
  received: "Received",
  reading: "Reading",
  failed: "Can't be read",
  removed: "Removed from bucket",
  missing: "Missing",
  unexpected: "Unexpected",
};

/** 0 Sunday … 6 Saturday for a calendar day (YYYY-MM-DD): no time zone moves a calendar day. */
export function weekdayOf(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export const agencyKey = (agency: string | null) => (agency ?? "").trim().toLowerCase().replace(/\s+/g, " ");

function stateOf(file: BucketFile): BucketState {
  if (file.removedAt) return "removed";
  if (file.status === "failed") return "failed";
  if (file.status === "parsed") return "received";
  return "reading";
}

/** The day: one row per expected file (in the settings' order), then one per unexpected file. */
export function bucketDay(input: { date: string; timezone: string; expectations: BucketExpectation[]; files: BucketFile[] }): BucketDay {
  const weekday = weekdayOf(input.date);
  const keyOf = (agency: string | null, carrierId: string | null, fileType: string | null) => `${agencyKey(agency)}|${carrierId ?? ""}|${fileType ?? ""}`;
  const groups = new Map<string, BucketFile[]>();
  for (const file of input.files) {
    const key = keyOf(file.agency, file.carrierId, file.fileType);
    groups.set(key, [...(groups.get(key) ?? []), file]);
  }
  // The file standing for a group: the current one (not replaced), the newest otherwise.
  const standing = (files: BucketFile[]) => files.find((file) => !file.replaced) ?? files[0] ?? null;

  const rows: BucketRow[] = [];
  const claimed = new Set<string>();
  const due = input.expectations
    .filter((expectation) => expectation.active && expectation.weekdays.includes(weekday))
    .sort((a, b) => a.agency.localeCompare(b.agency) || a.carrierName.localeCompare(b.carrierName) || a.fileType.localeCompare(b.fileType));
  for (const expectation of due) {
    const key = keyOf(expectation.agency, expectation.carrierId, expectation.fileType);
    claimed.add(key);
    const files = groups.get(key) ?? [];
    const file = standing(files);
    const state: BucketState = !file ? "missing" : stateOf(file);
    rows.push({ key: `e:${expectation.id}`, agency: expectation.agency, carrierId: expectation.carrierId, carrierName: expectation.carrierName, fileType: expectation.fileType, expected: true, state, file, replaced: Math.max(0, files.length - 1) });
  }
  const unexpected = [...groups.entries()].filter(([key]) => !claimed.has(key));
  for (const [key, files] of unexpected.sort((a, b) => a[0].localeCompare(b[0]))) {
    const file = standing(files)!;
    rows.push({ key: `u:${key}`, agency: file.agency ?? "No agency folder", carrierId: file.carrierId, carrierName: file.carrierName ?? "Carrier not known", fileType: file.fileType, expected: false, state: "unexpected", file, replaced: Math.max(0, files.length - 1) });
  }

  const expectedRows = rows.filter((row) => row.expected);
  return {
    date: input.date,
    weekday,
    rows,
    counts: {
      expected: expectedRows.length,
      received: expectedRows.filter((row) => row.state === "received" || row.state === "reading" || row.state === "failed").length,
      missing: expectedRows.filter((row) => row.state === "missing" || row.state === "removed").length,
      unexpected: rows.length - expectedRows.length,
    },
  };
}
