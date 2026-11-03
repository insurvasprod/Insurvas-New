// Reading past PostgREST's 1,000-row page: every row up to the cap, and a flag when the cap was hit.
import test from "node:test";
import assert from "node:assert/strict";

import { allRows, chunks, PAGE } from "./pages.ts";

const table = (n) => {
  const data = Array.from({ length: n }, (_, i) => ({ id: i }));
  const calls = [];
  return { calls, build: () => ({ range: async (from, to) => { calls.push([from, to]); return { data: data.slice(from, Math.min(to + 1, from + PAGE)), error: null }; } }) };
};

test("reads every page until a short one", async () => {
  const t = table(2500);
  const read = await allRows(t.build);
  assert.equal(read.rows.length, 2500);
  assert.equal(read.truncated, false);
  assert.deepEqual(t.calls, [[0, 999], [1000, 1999], [2000, 2999]]);
});

test("exactly a page: one more read finds nothing, not truncated", async () => {
  const read = await allRows(table(1000).build);
  assert.deepEqual([read.rows.length, read.truncated], [1000, false]);
});

test("the cap is reached: what was read, and truncated", async () => {
  const read = await allRows(table(5000).build, 3000);
  assert.deepEqual([read.rows.length, read.truncated], [3000, true]);
});

test("an error stops the read and is returned", async () => {
  const read = await allRows(() => ({ range: async () => ({ data: null, error: { message: "boom" } }) }));
  assert.equal(read.error.message, "boom");
  assert.equal(read.rows.length, 0);
});

test("chunks", () => {
  assert.deepEqual(chunks([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunks([], 2), []);
});
