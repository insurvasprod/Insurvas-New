// LA-4.7 · reading a whole table past PostgREST's 1,000-row cap.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { readPaged, PAGE_SIZE } = await import("./readPaged.ts");

/** A table of `count` rows that answers ranges the way PostgREST does: at most `cap` rows a request. */
function fakeTable(count, cap = 1000) {
  const rows = Array.from({ length: count }, (_, index) => ({ id: `p${String(index).padStart(5, "0")}` }));
  const calls = [];
  const fetchPage = async (from, to) => {
    calls.push([from, to]);
    return { data: rows.slice(from, Math.min(to + 1, from + cap)), error: null };
  };
  return { rows, calls, fetchPage };
}

test("a 2,500-policy book is read in full, in three pages", async () => {
  const table = fakeTable(2_500);
  const { rows, error } = await readPaged(table.fetchPage);
  assert.equal(error, null);
  assert.equal(rows.length, 2_500, "every policy, not the first 1,000");
  assert.deepEqual(rows.map((row) => row.id), table.rows.map((row) => row.id), "in order, none repeated or skipped");
  assert.deepEqual(table.calls, [[0, 999], [1000, 1999], [2000, 2999]]);
  assert.equal(PAGE_SIZE, 1000, "the page is PostgREST's own cap, so a full page always means 'ask again'");
});

test("an exact multiple of the page size asks once more and stops on the empty page", async () => {
  const table = fakeTable(2_000);
  const { rows } = await readPaged(table.fetchPage);
  assert.equal(rows.length, 2_000);
  assert.equal(table.calls.length, 3, "1,000 + 1,000 + an empty page that proves the end");
});

test("an empty or small table is one request", async () => {
  for (const count of [0, 1, 999]) {
    const table = fakeTable(count);
    const { rows } = await readPaged(table.fetchPage);
    assert.equal(rows.length, count);
    assert.equal(table.calls.length, 1, `${count} rows`);
  }
});

test("an error stops the read and is returned with what was read, never as a short book", async () => {
  let call = 0;
  const failing = async (from, to) => (++call === 2 ? { data: null, error: { message: "statement timeout", code: "57014" } } : { data: Array.from({ length: to - from + 1 }, (_, i) => ({ i: from + i })), error: null });
  const { rows, error } = await readPaged(failing);
  assert.equal(error?.code, "57014");
  assert.equal(rows.length, 1000, "the caller sees the error and decides; it is not silently a 1,000-policy book");
});

test("the ledger's book reader pages through readPaged, ordered to end on a unique column", () => {
  const service = readFileSync(new URL("../ledger/service.ts", import.meta.url), "utf8");
  const reader = service.slice(service.indexOf("export async function readBook"), service.indexOf("export function statusChangedAt"));
  assert.match(reader, /readPaged<BookPolicyRow>\(\(from, to\) =>/);
  assert.match(reader, /\.eq\("tenant_id", tenantId\)\.order\("effective_date", \{ ascending: false \}\)\.order\("id"\)\.range\(from, to\)/, "one tenant's rows, a stable order ending in id");
  assert.match(reader, /if \(result\.error\) throw new Error/, "a failed read is an error, never a short book");
  // Persistency and the policy page read the same book and the same lapse date.
  assert.match(readFileSync(new URL("../persistency/service.ts", import.meta.url), "utf8"), /readBook\(input\.tenantId\)/);
  assert.match(service, /export function statusChangedAt[\s\S]*?return row\.status_changed_at \?\? row\.updated_at;/);
});
