import test from "node:test";
import assert from "node:assert/strict";
import {
  activeSnoozes, bellEmptyTitle, bellFilterChips, bellGroupKey, bellGroupSummary, chunkIds, filterBellItems,
  groupBellItems, idsReadByOpening, nextSnoozeExpiry, parseSnoozeMap, snoozeIds, snoozeUntil, unsnoozeIds,
} from "./bell.ts";

const LEAD_A = "/app/leads/11111111-1111-1111-1111-111111111111";
const LEAD_B = "/app/leads/22222222-2222-2222-2222-222222222222";

function item(id, event_type, link, minute, read = false) {
  return { id, title: `t-${id}`, body: `b-${id}`, link, event_type, created_at: `2026-10-09T10:${String(minute).padStart(2, "0")}:00.000Z`, read };
}

// ---------------------------------------------------------------- grouping

test("partner messages to the same chat collapse into one row, newest line first", () => {
  const groups = groupBellItems([
    item("p1", "partner_message", "/app/partner-chat", 1),
    item("p2", "partner_message", "/app/partner-chat", 5),
    item("p3", "partner_message", "/app/partner-chat", 3),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].count, 3);
  assert.equal(groups[0].newest.id, "p2");
  assert.deepEqual(groups[0].members.map((m) => m.id), ["p2", "p3", "p1"]);
  assert.equal(bellGroupSummary(groups[0]), "3 partner messages");
});

test("every callback due is one row, whatever lead it is for", () => {
  const groups = groupBellItems([item("c1", "callback_due", LEAD_A, 1), item("c2", "callback_due", LEAD_B, 2)]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].kind, "callback");
  assert.equal(groups[0].link, LEAD_B, "the row opens the newest callback");
  assert.equal(bellGroupSummary(groups[0]), "2 callbacks due");
});

test("mentions and transfers group per link, and kinds never mix", () => {
  const groups = groupBellItems([
    item("m1", "mentioned", `${LEAD_A}?tab=notes`, 1),
    item("m2", "mentioned", `${LEAD_A}?tab=notes`, 2),
    item("m3", "mentioned", `${LEAD_B}?tab=notes`, 3),
    item("h1", "handoff_offered", LEAD_A, 4),
  ]);
  assert.equal(groups.length, 3);
  assert.deepEqual(groups.map((g) => g.key), ["handoff:" + LEAD_A, `mention:${LEAD_B}?tab=notes`, `mention:${LEAD_A}?tab=notes`], "newest group first");
  assert.notEqual(bellGroupKey(item("x", "mentioned", LEAD_A, 1)), bellGroupKey(item("y", "handoff_offered", LEAD_A, 1)));
});

test("a group counts its unread members", () => {
  const [group] = groupBellItems([item("p1", "partner_message", "/app/partner-chat", 1, true), item("p2", "partner_message", "/app/partner-chat", 2)]);
  assert.equal(group.unreadCount, 1);
});

test("opening a group reads the members that link opens, and only the unread ones", () => {
  const [chat] = groupBellItems([item("p1", "partner_message", "/app/partner-chat", 1), item("p2", "partner_message", "/app/partner-chat", 2), item("p0", "partner_message", "/app/partner-chat", 0, true)]);
  assert.deepEqual(idsReadByOpening(chat, chat.link).sort(), ["p1", "p2"]);
  const [callbacks] = groupBellItems([item("c1", "callback_due", LEAD_A, 1), item("c2", "callback_due", LEAD_B, 2)]);
  assert.deepEqual(idsReadByOpening(callbacks, callbacks.link), ["c2"], "the other callback stays waiting");
});

// ---------------------------------------------------------------- filters

const FEED = [
  item("h1", "handoff_offered", LEAD_A, 1),
  item("m1", "mentioned", LEAD_A, 2, true),
  item("p1", "partner_message", "/app/partner-chat", 3),
  item("c1", "callback_due", LEAD_B, 4),
];

test("All shows read and unread; Unread only unread; a kind only its own", () => {
  const none = new Set();
  assert.equal(filterBellItems(FEED, "all", none).length, 4);
  assert.deepEqual(filterBellItems(FEED, "unread", none).map((i) => i.id), ["h1", "p1", "c1"]);
  assert.deepEqual(filterBellItems(FEED, "mention", none).map((i) => i.id), ["m1"]);
  assert.deepEqual(filterBellItems(FEED, "handoff", none).map((i) => i.id), ["h1"]);
});

test("snoozed items leave every filter but Snoozed", () => {
  const snoozed = new Set(["p1"]);
  for (const filter of ["all", "unread", "partner_message"]) {
    assert.ok(!filterBellItems(FEED, filter, snoozed).some((i) => i.id === "p1"), filter);
  }
  assert.deepEqual(filterBellItems(FEED, "snoozed", snoozed).map((i) => i.id), ["p1"]);
});

test("chips: All, Unread, one per kind present, Snoozed only when something is", () => {
  const chips = bellFilterChips(FEED, new Set(), "all");
  assert.deepEqual(chips.map((c) => c.key), ["all", "unread", "handoff", "mention", "partner_message", "callback"]);
  assert.equal(chips.find((c) => c.key === "unread").count, 3);
  assert.equal(chips.find((c) => c.key === "mention").count, 0, "a kind chip counts unread");
  const snoozedChips = bellFilterChips(FEED, new Set(["p1"]), "all");
  assert.ok(!snoozedChips.some((c) => c.key === "partner_message"), "a kind with only snoozed items has no chip");
  assert.equal(snoozedChips.at(-1).key, "snoozed");
  assert.equal(snoozedChips.at(-1).count, 1);
});

test("the active chip stays even when its kind has emptied", () => {
  const chips = bellFilterChips([], new Set(), "callback");
  assert.ok(chips.some((c) => c.key === "callback"));
  assert.equal(bellEmptyTitle("unread"), "No unread notifications");
  assert.equal(bellEmptyTitle("callback"), "No callbacks");
});

// ---------------------------------------------------------------- snooze

test("snooze times: 1 hour, 3 hours, tomorrow at 9 local", () => {
  const now = new Date(2026, 9, 9, 22, 30);
  assert.equal(snoozeUntil("1h", now).getTime() - now.getTime(), 3_600_000);
  assert.equal(snoozeUntil("3h", now).getTime() - now.getTime(), 3 * 3_600_000);
  const tomorrow = snoozeUntil("tomorrow9", now);
  assert.deepEqual([tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), tomorrow.getHours(), tomorrow.getMinutes()], [2026, 9, 10, 9, 0]);
  const monthEnd = snoozeUntil("tomorrow9", new Date(2026, 9, 31, 8, 0));
  assert.deepEqual([monthEnd.getMonth(), monthEnd.getDate()], [10, 1], "rolls over the month");
});

test("a snooze expires: the item comes back once its time has passed", () => {
  const now = Date.parse("2026-10-09T10:00:00.000Z");
  const map = snoozeIds({}, ["a", "b"], new Date(now + 60_000));
  map.c = new Date(now - 1).toISOString();
  map.d = "not a time";
  assert.deepEqual(Object.keys(activeSnoozes(map, now)).sort(), ["a", "b"]);
  assert.deepEqual(Object.keys(activeSnoozes(map, now + 60_000)), [], "at its time it is no longer snoozed");
  assert.equal(nextSnoozeExpiry(map, now), now + 60_000);
  assert.equal(nextSnoozeExpiry({}, now), null);
  assert.deepEqual(Object.keys(unsnoozeIds(map, ["a"])).sort(), ["b", "c", "d"]);
});

test("stored snoozes that cannot be read mean nothing is snoozed", () => {
  assert.deepEqual(parseSnoozeMap(null), {});
  assert.deepEqual(parseSnoozeMap("{oops"), {});
  assert.deepEqual(parseSnoozeMap("[1,2]"), {});
  assert.deepEqual(parseSnoozeMap('{"a":"2026-10-09T10:00:00.000Z","b":5}'), { a: "2026-10-09T10:00:00.000Z" });
});

test("mark-all-read ids are sent in chunks the route accepts", () => {
  const ids = Array.from({ length: 205 }, (_, i) => String(i));
  assert.deepEqual(chunkIds(ids).map((c) => c.length), [100, 100, 5]);
  assert.deepEqual(chunkIds([]), []);
});
