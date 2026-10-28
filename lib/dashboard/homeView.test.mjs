// Run with: node --experimental-strip-types --test lib/dashboard/homeView.test.mjs
//
// Home redesign (2026-10-28): what each role sees first, and that a figure nobody read is left out
// rather than drawn as zero.
import { test } from "node:test";
import assert from "node:assert/strict";

import { activityView, attentionItems, homeRole, kpiCards, KPI_ORDER, MAX_KPIS, niceMax, percentChange, scheduleItems, weekTotals } from "./homeView.ts";
import { sampleCallbacks, sampleToday } from "./homeSample.ts";

const ALL_FIGURES = ["dials", "reached", "rate", "appointments", "dials7", "premium", "queue", "booked", "shown", "showRate", "closeOut"].map((key) => ({ key, href: `/app/${key}` }));
const LINKS = { transfers: "/app/inbound", callbacks: "/app/callbacks", lapse: "/app/lapse-risk", licences: "/app/appointments" };

test("homeRole: an agency admin reads as the owner, a manager keeps its own home", () => {
  assert.equal(homeRole("producer", "admin"), "owner");
  assert.equal(homeRole("producer", "manager"), "manager");
  assert.equal(homeRole("owner", null), "owner");
  assert.equal(homeRole("setter", undefined), "setter");
});

test("percentChange needs a baseline above zero", () => {
  assert.equal(percentChange(110, 100), 10);
  assert.equal(percentChange(5, 0), null);
  assert.equal(percentChange(5, null), null);
  assert.equal(percentChange(90, 120), -25);
});

test("attention lists only counts above zero, most urgent first", () => {
  const items = attentionItems(sampleToday(), LINKS);
  assert.deepEqual(items.map((item) => item.key), ["transfers", "callbacks", "licences", "lapse"]);
  assert.equal(items[0].tone, "danger", "a transfer past SLA is red");
  assert.equal(items[0].detail, "1 past SLA");
  const quiet = sampleToday();
  quiet.needs = { ...quiet.needs, transfersWaiting: 0, slaBreaching: 0, callbacksOverdue: 0, lapsing: 0, licences: { expired: 0, expiring: 0, states: [] } };
  assert.deepEqual(attentionItems(quiet, LINKS), []);
});

test("attention never shows an item the reader cannot open", () => {
  const items = attentionItems(sampleToday(), { callbacks: "/app/callbacks" });
  assert.deepEqual(items.map((item) => item.key), ["callbacks"]);
  assert.deepEqual(attentionItems(null, LINKS), []);
});

test("an unread need (null) is not an alert", () => {
  const today = sampleToday();
  today.needs = { ...today.needs, transfersWaiting: null, lapsing: null, licences: null, callbacksOverdue: null };
  assert.deepEqual(attentionItems(today, LINKS), []);
});

test("each role gets at most four cards, in its order", () => {
  for (const role of Object.keys(KPI_ORDER)) {
    const cards = kpiCards(sampleToday(), ALL_FIGURES, role);
    assert.ok(cards.length <= MAX_KPIS, `${role}: ${cards.length} cards`);
    const order = KPI_ORDER[role];
    assert.deepEqual(cards.map((card) => card.key), order.filter((key) => cards.some((card) => card.key === key)));
  }
  assert.deepEqual(kpiCards(sampleToday(), ALL_FIGURES, "owner").map((card) => card.key), ["premium", "appointments", "rate", "dials"]);
  assert.deepEqual(kpiCards(sampleToday(), ALL_FIGURES, "setter").map((card) => card.key), ["booked", "showRate", "appointments", "queue"]);
});

test("a manager never sees premium", () => {
  assert.ok(!kpiCards(sampleToday(), ALL_FIGURES, "manager").some((card) => card.key === "premium"));
});

test("a card appears only when its figure is in the role's home", () => {
  const cards = kpiCards(sampleToday(), [{ key: "appointments", href: "/app/calendar" }], "owner");
  assert.deepEqual(cards.map((card) => card.key), ["appointments"]);
  assert.equal(cards[0].href, "/app/calendar");
});

test("a figure that was not read gives its place to the next", () => {
  const today = sampleToday();
  today.policies30 = null;
  today.appointmentsToday = null;
  const keys = kpiCards(today, ALL_FIGURES, "owner").map((card) => card.key);
  assert.ok(!keys.includes("premium") && !keys.includes("appointments"));
  assert.equal(keys.length, 4);
});

test("only one card per row is amber", () => {
  const today = sampleToday();
  // Close-out has an outcome waiting and the show rate is short of full coverage: both want amber.
  const cards = kpiCards(today, ALL_FIGURES, "setter");
  const producer = kpiCards(today, ALL_FIGURES, "producer");
  for (const row of [cards, producer]) assert.ok(row.filter((card) => card.tone === "warn").length <= 1);
});

test("contact-rate change is in points against the prior seven days", () => {
  const week = weekTotals(sampleToday().series);
  const card = kpiCards(sampleToday(), ALL_FIGURES, "owner").find((item) => item.key === "rate");
  assert.equal(card.delta.unit, " pts");
  assert.equal(card.delta.value, Math.round((week.rate - week.priorRate) * 10) / 10);
  assert.equal(card.fact.label, "Prior 7 days", "the change names its comparison");
  assert.equal(card.fact.value, `${Math.round(week.priorRate)}%`);
});

test("the activity chart is absent when dialling was not read", () => {
  const today = sampleToday();
  today.series = today.series.map((day) => ({ ...day, dials: null, contacts: null }));
  assert.equal(activityView(today), null);
  const view = activityView(sampleToday());
  assert.equal(view.bars.length, 14);
  assert.ok(view.bars.every((bar) => bar.reached <= bar.dials));
  assert.equal(view.topOutcome.label, "No answer");
  assert.equal(view.bestHour.hour, 11);
});

test("niceMax rounds up to a readable gridline", () => {
  assert.equal(niceMax(3), 5);
  assert.equal(niceMax(38), 40);
  assert.equal(niceMax(137), 150);
  assert.equal(niceMax(301), 350);
  assert.equal(niceMax(1000), 1000);
});

test("schedule puts late callbacks first, then by time, and respects links", () => {
  const today = sampleToday();
  const { items, total } = scheduleItems(today.appointmentsTodayList, sampleCallbacks(), { appointments: "/app/calendar", callbacks: "/app/callbacks" }, 6);
  assert.equal(total, 8);
  assert.equal(items.length, 6);
  assert.deepEqual(items.slice(0, 2).map((item) => item.late), [true, true]);
  for (let i = 3; i < items.length; i += 1) assert.ok(Date.parse(items[i - 1].atUtc) <= Date.parse(items[i].atUtc));
  const onlyAppointments = scheduleItems(today.appointmentsTodayList, sampleCallbacks(), { appointments: "/app/calendar" });
  assert.ok(onlyAppointments.items.every((item) => item.kind === "appointment"));
});
