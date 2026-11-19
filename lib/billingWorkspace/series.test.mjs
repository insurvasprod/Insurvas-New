import test from "node:test";
import assert from "node:assert/strict";

import { bucketCounts, bucketSums, monthBuckets, overdueAt, weekBuckets } from "./series.ts";

const NOW = Date.parse("2026-11-17T12:00:00Z");

test("six months end with the current one", () => {
  const months = monthBuckets(NOW, 6);
  assert.deepEqual(months.map((m) => m.key), ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"]);
  assert.equal(months[5].end, "2026-12-01T00:00:00.000Z");
});

test("weeks are seven-day windows ending now", () => {
  const weeks = weekBuckets(NOW, 2);
  assert.equal(weeks[1].end, new Date(NOW).toISOString());
  assert.equal(Date.parse(weeks[1].start) - Date.parse(weeks[0].start), 7 * 86_400_000);
});

test("counts and sums land in their bucket", () => {
  const months = monthBuckets(NOW, 2);
  assert.deepEqual(bucketCounts(["2026-10-03T00:00:00Z", "2026-11-01T00:00:00Z", "2026-11-02T00:00:00Z"], months), [1, 2]);
  assert.deepEqual(bucketSums([{ at: "2026-10-31T23:59:59Z", value: 500 }, { at: "2026-11-01T00:00:00Z", value: 100 }], months), [500, 100]);
});

test("an invoice is overdue between its due date and its payment or void", () => {
  const rows = [
    { status: "paid", due_at: "2026-10-01T00:00:00Z", paid_at: "2026-10-10T00:00:00Z", voided_at: null },
    { status: "overdue", due_at: "2026-10-05T00:00:00Z", paid_at: null, voided_at: null },
    { status: "void", due_at: "2026-10-01T00:00:00Z", paid_at: null, voided_at: "2026-10-03T00:00:00Z" },
    { status: "draft", due_at: "2026-10-01T00:00:00Z", paid_at: null, voided_at: null },
  ];
  assert.equal(overdueAt(rows, "2026-10-02T00:00:00Z"), 2);
  assert.equal(overdueAt(rows, "2026-10-08T00:00:00Z"), 2);
  assert.equal(overdueAt(rows, "2026-10-12T00:00:00Z"), 1);
});
