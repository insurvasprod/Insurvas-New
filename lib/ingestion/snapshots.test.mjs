// LA-4.6 (Notion sprint) · policy snapshots and the change-detection engine.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { changeWindow, historyOf, snapshotContent, snapshotsForFile, TRACKED_FIELDS } from "./snapshots.ts";

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const blank = Object.fromEntries(TRACKED_FIELDS.map((field) => [field, null]));
const snap = (policy, date, file, received, values) => ({ policyNumber: policy, snapshotDate: date, fileId: file, fileReceivedAt: received, values: { ...blank, ...values } });
const active = { status_normalized: "active", carrier_status_raw: "INFORCE", paid_to_date: "2026-09-01", premium_cents: 4210 };

test("a policy seen for the first time is a first-seen event and no change rows", () => {
  const { changes, events } = historyOf([snap("P1", "2026-09-05", "f1", "2026-09-05T10:00:00Z", active)]);
  assert.deepEqual(changes, []);
  assert.deepEqual(events, [{ policy_number: "P1", event_type: "first_seen", snapshot_date: "2026-09-05", file_id: "f1" }]);
});

test("active → lapsed is exactly one status change, dated by the two files", () => {
  const { changes } = historyOf([
    snap("P1", "2026-09-05", "f1", "2026-09-05T10:00:00Z", active),
    snap("P1", "2026-10-05", "f2", "2026-10-05T10:00:00Z", { ...active, status_normalized: "lapsed", carrier_status_raw: "Lapse-NonPay" }),
  ]);
  const status = changes.filter((change) => change.field_name === "status_normalized");
  assert.equal(status.length, 1);
  assert.deepEqual(status[0], { policy_number: "P1", field_name: "status_normalized", old_value: "active", new_value: "lapsed", from_snapshot_date: "2026-09-05", to_snapshot_date: "2026-10-05", from_file_id: "f1", to_file_id: "f2" });
  assert.equal(changes.length, 2, "and the carrier's own word moved too");
});

test("the diff works across a 1-day gap and a 31-day gap alike — nothing assumes yesterday", () => {
  for (const [from, to] of [["2026-10-05", "2026-10-06"], ["2026-09-04", "2026-10-05"]]) {
    const { changes } = historyOf([
      snap("P1", from, "a", `${from}T09:00:00Z`, active),
      snap("P1", to, "b", `${to}T09:00:00Z`, { ...active, paid_to_date: "2026-10-01" }),
    ]);
    assert.deepEqual(changes.map((c) => [c.field_name, c.old_value, c.new_value, c.from_snapshot_date, c.to_snapshot_date]), [["paid_to_date", "2026-09-01", "2026-10-01", from, to]]);
  }
  assert.doesNotMatch(read("lib/ingestion/snapshots.ts"), /Date\.now|new Date\(\)|yesterday\s*[=(]/, "no clock and no 'yesterday' in the engine");
});

test("a back-dated file recomputes the changes around it, and only for its own policies", () => {
  const sep = snap("P1", "2026-09-05", "sep", "2026-09-06T00:00:00Z", active);
  const nov = snap("P1", "2026-11-05", "nov", "2026-11-06T00:00:00Z", { ...active, status_normalized: "lapsed" });
  const before = historyOf([sep, nov]).changes.filter((c) => c.field_name === "status_normalized");
  assert.deepEqual(before.map((c) => [c.from_snapshot_date, c.to_snapshot_date]), [["2026-09-05", "2026-11-05"]]);
  // October's file arrives late — after November's — and it already says lapsed.
  const oct = snap("P1", "2026-10-05", "oct", "2026-11-20T00:00:00Z", { ...active, status_normalized: "lapsed" });
  const after = historyOf([sep, nov, oct]).changes.filter((c) => c.field_name === "status_normalized");
  assert.deepEqual(after.map((c) => [c.old_value, c.new_value, c.from_snapshot_date, c.to_snapshot_date]), [["active", "lapsed", "2026-09-05", "2026-10-05"]], "the lapse moves to the window the late file reveals");
  const store = read("lib/ingestion/snapshotStore.ts");
  assert.match(store, /const chunk = result\.policies\.slice/, "only the policies the file touched are recomputed");
  assert.match(read("supabase/migrations/20261008140000_la_4_6_policy_snapshots.sql"), /delete from public\.policy_change where tenant_id = p_tenant_id and carrier_id = p_carrier_id and policy_number = any\(p_policies\)/);
});

test("change dates are file dates, never processing time; a reissue is a correction on that day", () => {
  const { changes } = historyOf([
    snap("P1", "2026-10-05", "first", "2026-10-05T08:00:00Z", { ...active, premium_cents: 4210 }),
    snap("P1", "2026-10-05", "reissue", "2026-10-05T15:00:00Z", { ...active, premium_cents: 4120 }),
  ]);
  assert.deepEqual(changes.map((c) => [c.field_name, c.old_value, c.new_value, c.from_snapshot_date, c.to_snapshot_date]), [["premium_cents", "4210", "4120", "2026-10-05", "2026-10-05"]]);
  assert.equal(changeWindow("2026-10-05", "2026-10-05", (d) => d), "corrected in a reissued file of 2026-10-05");
  assert.equal(changeWindow("2026-09-05", "2026-10-05", (d) => d), "between the files of 2026-09-05 and 2026-10-05", "a monthly change says how precise it is");
  const sql = read("supabase/migrations/20261008140000_la_4_6_policy_snapshots.sql");
  assert.match(sql, /select p_tenant_id, v_file\.agency_id, v_file\.carrier_id, r\.policy_number, v_file\.file_date,/, "the snapshot date is the file's date");
  assert.match(sql, /  from_snapshot_date date not null,\n  to_snapshot_date date not null,\n/, "the change dates have no default: they are always the files' dates");
});

test("change rows can be thrown away and rebuilt identically from the snapshots", () => {
  const history = [
    snap("P1", "2026-08-05", "a", "2026-08-05T00:00:00Z", active),
    snap("P1", "2026-09-05", "b", "2026-09-05T00:00:00Z", { ...active, paid_to_date: "2026-09-01" }),
    snap("P1", "2026-10-05", "c", "2026-10-05T00:00:00Z", { ...active, status_normalized: "lapsed", termination_date: "2026-10-01" }),
    snap("P2", "2026-10-05", "c", "2026-10-05T00:00:00Z", active),
  ];
  const first = historyOf(history);
  const rebuilt = historyOf([...history].reverse());
  assert.deepEqual(rebuilt, first, "the same snapshots, in any order, give the same history");
  assert.equal(first.events.length, 2);
});

test("one snapshot per policy per file; every snapshot carries its raw row; nothing is dropped", () => {
  const rows = [
    { rowNumber: 2, values: { policy_number: "P1", carrier_status_raw: "INFORCE", status_normalized: "active", insured_name: "Jo Smith", premium_cents: 4210 } },
    { rowNumber: 3, values: { policy_number: "P1", carrier_status_raw: "INFORCE", status_normalized: "active" } },
    { rowNumber: 4, values: { policy_number: "P2", carrier_status_raw: "INFORCE", status_normalized: "active" } },
  ];
  const ids = new Map([[2, "r2"], [3, "r3"], [4, "r4"]]);
  const { snapshots, duplicates } = snapshotsForFile(rows, ids, (n) => ({ "Reinstatement Date": n === 2 ? "2026-11-01" : "" }));
  assert.deepEqual(snapshots.map((s) => [s.policy_number, s.raw_row_id]), [["P1", "r2"], ["P2", "r4"]]);
  assert.deepEqual(duplicates, [{ policyNumber: "P1", rowNumber: 3, keptRow: 2 }]);
  assert.deepEqual(snapshots[0].extra, { fields: { insured_name: "Jo Smith" }, columns: { "Reinstatement Date": "2026-11-01" } }, "a field with no column, and a column the map does not read, both kept");
  assert.equal(snapshotContent(snapshots[0]), snapshotContent({ ...snapshots[0], raw_row_id: "elsewhere" }), "content does not depend on which raw row id it got");
  assert.throws(() => snapshotsForFile([{ rowNumber: 9, values: { policy_number: "P9" } }], new Map(), () => ({})), /no raw row/);
});

test("the migration: one per day, immutable but rebuildable, written only through its functions", () => {
  const sql = read("supabase/migrations/20261008140000_la_4_6_policy_snapshots.sql");
  assert.match(sql, /create unique index if not exists policy_snapshot_one_per_day\s+on public\.policy_snapshot \(tenant_id, carrier_id, policy_number, snapshot_date\)\s+where not superseded/);
  assert.match(sql, /foreign key \(file_id, raw_row_id\) references public\.raw_rows\(file_id, id\)/, "every snapshot points at its raw row");
  assert.match(sql, /A policy snapshot is never edited; it is rebuilt from its file''s raw rows\./);
  assert.match(sql, /revoke insert, update, delete, truncate on public\.policy_snapshot, public\.policy_change, public\.policy_event from service_role, tenant_app/);
  assert.match(sql, /constraint policy_event_once unique \(tenant_id, carrier_id, policy_number, event_type\)/);
  // The snapshot stage is registered, and the door and the sweep run it after a parse.
  assert.match(read("lib/ingestion/stages.ts"), /export const REPROCESS_STAGES: ReprocessStage\[\] = \[policySnapshots, expectedCommission, commissionEntries, orphanCommission\];/);
  const parser = read("lib/ingestion/parser.ts");
  assert.match(parser, /if \(outcome\.outcome === "parsed"\) await deriveFile\(tenantId, fileId, outcome\);/);
  assert.match(parser, /\.is\("derived_at", null\)/, "a file parsed but not derived is retried");
});
