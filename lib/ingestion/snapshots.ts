/**
 * LA-4.6 (Notion sprint) · Layer 2 in pure code: a typed policy row as a snapshot, and a policy's
 * history (its changes and its first-seen event) from its snapshots.
 *
 * The lapse is in the difference between two files. Each policy's snapshots are put in order — by
 * file date, then by the order the files arrived (so a reissue for the same day comes after what it
 * corrects) — and each consecutive pair is compared, field by field, whatever the gap between them.
 * Nothing here knows what "yesterday" is. The first snapshot is a first-seen event and no changes.
 *
 * Deterministic and pure: the store writes exactly what this returns, and a test can rebuild it.
 */

/** The fields whose movement is a change (Notion LA-4.6). */
export const TRACKED_FIELDS = [
  "status_normalized",
  "carrier_status_raw",
  "paid_to_date",
  "premium_cents",
  "premium_mode",
  "payment_method",
  "face_amount_cents",
  "product_code",
  "product_tier",
  "termination_date",
  "agent_identifier",
] as const;
export type TrackedField = (typeof TRACKED_FIELDS)[number];

export const TRACKED_FIELD_LABELS: Record<TrackedField, string> = {
  status_normalized: "Status",
  carrier_status_raw: "Carrier's status",
  paid_to_date: "Paid-to date",
  premium_cents: "Premium",
  premium_mode: "Premium mode",
  payment_method: "Payment method",
  face_amount_cents: "Face amount",
  product_code: "Product",
  product_tier: "Product tier",
  termination_date: "Termination date",
  agent_identifier: "Writing agent",
};

/** The snapshot's own columns, beyond the tracked ones. Everything else the map read goes in `extra`. */
const CORE_FIELDS = ["policy_number", ...TRACKED_FIELDS, "effective_date", "issue_date", "application_date"] as const;

export type SnapshotRow = {
  policy_number: string;
  raw_row_id: string;
  carrier_status_raw: string | null;
  status_normalized: string | null;
  paid_to_date: string | null;
  effective_date: string | null;
  issue_date: string | null;
  application_date: string | null;
  termination_date: string | null;
  premium_cents: number | null;
  premium_mode: string | null;
  payment_method: string | null;
  face_amount_cents: number | null;
  product_code: string | null;
  product_tier: string | null;
  agent_identifier: string | null;
  /** Never drop a field: what the map read that has no column, and the columns it did not read. */
  extra: { fields: Record<string, string | number | null>; columns: Record<string, string> };
};

type Values = Record<string, string | number | null>;
const text = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));
const integer = (value: unknown): number | null => (typeof value === "number" ? value : null);

/** One typed row (LA-4.3, gated by LA-4.5) as the snapshot it becomes. */
export function snapshotFromRow(input: { values: Values; rawRowId: string; unreadColumns: Record<string, string> }): SnapshotRow {
  const v = input.values;
  const fields: Values = {};
  for (const [key, value] of Object.entries(v)) if (!(CORE_FIELDS as readonly string[]).includes(key)) fields[key] = value;
  return {
    policy_number: String(v.policy_number),
    raw_row_id: input.rawRowId,
    carrier_status_raw: text(v.carrier_status_raw),
    status_normalized: text(v.status_normalized),
    paid_to_date: text(v.paid_to_date),
    effective_date: text(v.effective_date),
    issue_date: text(v.issue_date),
    application_date: text(v.application_date),
    termination_date: text(v.termination_date),
    premium_cents: integer(v.premium_cents),
    premium_mode: text(v.premium_mode),
    payment_method: text(v.payment_method),
    face_amount_cents: integer(v.face_amount_cents),
    product_code: text(v.product_code),
    product_tier: text(v.product_tier),
    agent_identifier: text(v.agent_identifier),
    extra: { fields, columns: input.unreadColumns },
  };
}

/** A stable text of a snapshot's content (not its raw row), for "did it change?" across rebuilds. */
export function snapshotContent(row: SnapshotRow): string {
  const { raw_row_id: _ignored, extra, ...rest } = row;
  void _ignored;
  const sorted = (object: Record<string, unknown>) => Object.fromEntries(Object.keys(object).sort().map((key) => [key, object[key]]));
  return JSON.stringify({ ...sorted(rest), extra: { fields: sorted(extra.fields), columns: sorted(extra.columns) } });
}

/** One file's policy rows as snapshots: one per policy. A policy listed twice keeps its first row. */
export function snapshotsForFile(rows: Array<{ rowNumber: number; values: Values }>, rawRowIds: Map<number, string>, unreadColumnsOf: (rowNumber: number) => Record<string, string>) {
  const seen = new Map<string, number>();
  const snapshots: SnapshotRow[] = [];
  const duplicates: Array<{ policyNumber: string; rowNumber: number; keptRow: number }> = [];
  for (const row of rows) {
    const policy = row.values.policy_number;
    if (policy === null || policy === undefined || String(policy) === "") continue;
    const key = String(policy);
    const rawRowId = rawRowIds.get(row.rowNumber);
    if (!rawRowId) throw new Error(`Line ${row.rowNumber} has no raw row.`);
    if (seen.has(key)) { duplicates.push({ policyNumber: key, rowNumber: row.rowNumber, keptRow: seen.get(key)! }); continue; }
    seen.set(key, row.rowNumber);
    snapshots.push(snapshotFromRow({ values: row.values, rawRowId, unreadColumns: unreadColumnsOf(row.rowNumber) }));
  }
  return { snapshots, duplicates };
}

export type StoredSnapshot = {
  policyNumber: string;
  snapshotDate: string;
  fileId: string;
  /** When its file arrived: orders two files of the same date (a reissue after what it corrects). */
  fileReceivedAt: string;
  values: Record<TrackedField, string | number | null>;
};

export type PolicyChange = {
  policy_number: string;
  field_name: TrackedField;
  old_value: string | null;
  new_value: string | null;
  from_snapshot_date: string;
  to_snapshot_date: string;
  from_file_id: string;
  to_file_id: string;
};

export type PolicyEvent = { policy_number: string; event_type: "first_seen"; snapshot_date: string; file_id: string };

/**
 * A policy's whole history from its snapshots, in any order. Changes between each consecutive pair
 * (by file date, then arrival), and its first snapshot as a first-seen event. Re-running it on the
 * same snapshots gives the same rows, which is what makes the change log disposable.
 */
export function historyOf(snapshots: StoredSnapshot[]): { changes: PolicyChange[]; events: PolicyEvent[] } {
  const byPolicy = new Map<string, StoredSnapshot[]>();
  for (const snapshot of snapshots) byPolicy.set(snapshot.policyNumber, [...(byPolicy.get(snapshot.policyNumber) ?? []), snapshot]);
  const changes: PolicyChange[] = [];
  const events: PolicyEvent[] = [];
  // Policies in a fixed order, so the same snapshots give the same rows whatever order they were read in.
  for (const policy of [...byPolicy.keys()].sort()) {
    const list = byPolicy.get(policy)!;
    const ordered = [...list].sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate) || a.fileReceivedAt.localeCompare(b.fileReceivedAt) || a.fileId.localeCompare(b.fileId));
    events.push({ policy_number: policy, event_type: "first_seen", snapshot_date: ordered[0].snapshotDate, file_id: ordered[0].fileId });
    for (let index = 1; index < ordered.length; index++) {
      const before = ordered[index - 1];
      const after = ordered[index];
      for (const field of TRACKED_FIELDS) {
        const oldValue = text(before.values[field]);
        const newValue = text(after.values[field]);
        if (oldValue !== newValue) {
          changes.push({ policy_number: policy, field_name: field, old_value: oldValue, new_value: newValue, from_snapshot_date: before.snapshotDate, to_snapshot_date: after.snapshotDate, from_file_id: before.fileId, to_file_id: after.fileId });
        }
      }
    }
  }
  return { changes, events };
}

/** "between the files of Sep 5 and Oct 5": a change is only as precise as the files' cadence. */
export function changeWindow(from: string, to: string, day: (iso: string) => string): string {
  return from === to ? `corrected in a reissued file of ${day(to)}` : `between the files of ${day(from)} and ${day(to)}`;
}
