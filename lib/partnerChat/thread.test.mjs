import test from "node:test";
import assert from "node:assert/strict";

import { buildThread, dayLabel, GROUP_WINDOW_MS } from "./thread.ts";

/**
 * The thread's shape (owner, 30 Oct: the Messages page should read like a conversation). What a
 * reader sees is decided here — which messages share a name and a time, where a day begins, and
 * what its heading says — so it is tested here rather than inferred from the rendered page.
 */

const NOW = Date.parse("2026-10-30T12:00:00Z");
const ME = "u-me";

let counter = 0;
const text = (at, by, message = "hi") => ({
  id: `m${++counter}`, channelId: "c1", partnerId: null, workItemId: null,
  message, messageKind: "text", cardType: null, cardPayload: {},
  createdBy: by, createdAt: at, attachments: [],
});
const card = (at) => ({ ...text(at, null), messageKind: "system_card", cardType: "new_lead" });

const kinds = (items) => items.map((item) => item.kind);
const groups = (items) => items.filter((item) => item.kind === "group");

/* ── Days ────────────────────────────────────────────────────────────────────────────────────── */

test("a day heading says Today, Yesterday, the date, or the date with its year", () => {
  assert.equal(dayLabel("2026-10-30T09:00:00Z", NOW, "UTC"), "Today");
  assert.equal(dayLabel("2026-10-29T23:59:00Z", NOW, "UTC"), "Yesterday");
  assert.equal(dayLabel("2026-10-28T10:00:00Z", NOW, "UTC"), "28 Oct");
  assert.equal(dayLabel("2024-02-05T10:00:00Z", NOW, "UTC"), "5 Feb 2024");
});

test("Today is the viewer's midnight, not the server's", () => {
  // 30 Oct 01:00 UTC is still 29 Oct in Denver. The same moment is Today in one zone and
  // Yesterday in the other, and each reader should see their own.
  const moment = "2026-10-30T01:00:00Z";
  assert.equal(dayLabel(moment, NOW, "UTC"), "Today");
  assert.equal(dayLabel(moment, NOW, "America/Denver"), "Yesterday");
});

test("a day heading opens each day, once", () => {
  const items = buildThread([
    text("2026-10-28T10:00:00Z", ME),
    text("2026-10-28T10:01:00Z", ME),
    text("2026-10-30T10:00:00Z", ME),
  ], { viewerId: ME, now: NOW });
  assert.deepEqual(kinds(items), ["day", "group", "day", "group"]);
  assert.deepEqual(items.filter((item) => item.kind === "day").map((item) => item.label), ["28 Oct", "Today"]);
});

test("a run never spans a day, however close the two messages are", () => {
  // A minute apart, from one sender, but either side of midnight: two groups, two headings.
  const items = buildThread([
    text("2026-10-29T23:59:30Z", ME),
    text("2026-10-30T00:00:10Z", ME),
  ], { viewerId: ME, now: NOW });
  assert.deepEqual(kinds(items), ["day", "group", "day", "group"]);
});

/* ── Grouping ────────────────────────────────────────────────────────────────────────────────── */

test("consecutive messages from one sender share a group", () => {
  const items = buildThread([
    text("2026-10-30T10:00:00Z", ME),
    text("2026-10-30T10:01:00Z", ME),
    text("2026-10-30T10:02:00Z", ME),
  ], { viewerId: ME, now: NOW });
  assert.equal(groups(items).length, 1);
  assert.equal(groups(items)[0].messages.length, 3);
});

test("a different sender starts a new group", () => {
  const items = buildThread([
    text("2026-10-30T10:00:00Z", ME),
    text("2026-10-30T10:01:00Z", "u-them"),
    text("2026-10-30T10:02:00Z", ME),
  ], { viewerId: ME, now: NOW });
  assert.deepEqual(groups(items).map((group) => group.side), ["mine", "theirs", "mine"]);
});

test("a long gap starts a new group, so one time never speaks for two", () => {
  const start = Date.parse("2026-10-30T10:00:00Z");
  const within = buildThread([
    text(new Date(start).toISOString(), ME),
    text(new Date(start + GROUP_WINDOW_MS).toISOString(), ME),
  ], { viewerId: ME, now: NOW });
  assert.equal(groups(within).length, 1, "exactly the window still groups");

  const beyond = buildThread([
    text(new Date(start).toISOString(), ME),
    text(new Date(start + GROUP_WINDOW_MS + 1000).toISOString(), ME),
  ], { viewerId: ME, now: NOW });
  assert.equal(groups(beyond).length, 2);
});

/* ── Sides ───────────────────────────────────────────────────────────────────────────────────── */

test("only the viewer's own messages take the sent side", () => {
  const items = buildThread([
    text("2026-10-30T10:00:00Z", ME),
    text("2026-10-30T10:06:00Z", "u-colleague"),
    text("2026-10-30T10:12:00Z", null),
  ], { viewerId: ME, now: NOW });
  assert.deepEqual(groups(items).map((group) => group.side), ["mine", "theirs", "theirs"]);
});

test("with no viewer known, nothing is drawn as the viewer's own", () => {
  // The id arrives with the channels; until it does, a wrong side is worse than one column.
  const items = buildThread([text("2026-10-30T10:00:00Z", ME)], { viewerId: null, now: NOW });
  assert.deepEqual(groups(items).map((group) => group.side), ["theirs"]);
});

/* ── Automatic updates ───────────────────────────────────────────────────────────────────────── */

test("an automatic update stands alone and interrupts the run around it", () => {
  const items = buildThread([
    text("2026-10-30T10:00:00Z", ME),
    card("2026-10-30T10:01:00Z"),
    text("2026-10-30T10:02:00Z", ME),
  ], { viewerId: ME, now: NOW });
  assert.deepEqual(kinds(items), ["day", "group", "notice", "group"]);
});

/* ── Edges ───────────────────────────────────────────────────────────────────────────────────── */

test("an empty thread is empty, not a bare day heading", () => {
  assert.deepEqual(buildThread([], { viewerId: ME, now: NOW }), []);
});

test("every item carries a key, and no two are the same", () => {
  const items = buildThread([
    text("2026-10-28T10:00:00Z", ME),
    card("2026-10-28T10:01:00Z"),
    text("2026-10-30T10:00:00Z", "u-them"),
  ], { viewerId: ME, now: NOW });
  const keys = items.map((item) => item.key);
  assert.ok(keys.every(Boolean), "a missing key makes React reuse the wrong row");
  assert.equal(new Set(keys).size, keys.length);
});

test("an unreadable timestamp still draws, under the day around it", () => {
  // A blank separator is worse than no separator, and one bad row should not split a thread in two.
  assert.deepEqual(kinds(buildThread([text("not a date", ME)], { viewerId: ME, now: NOW })), ["group"]);

  const mixed = buildThread([
    text("2026-10-30T10:00:00Z", ME),
    text("not a date", ME),
    text("2026-10-30T10:02:00Z", ME),
  ], { viewerId: ME, now: NOW });
  assert.deepEqual(mixed.filter((item) => item.kind === "day").map((item) => item.label), ["Today"]);
});
