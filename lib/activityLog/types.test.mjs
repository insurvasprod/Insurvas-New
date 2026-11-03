import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  blockedForPage,
  formatFaceAmount,
  formatSpan,
  mayReviewZeroClick,
  outcomeDetails,
  parseFlagFilter,
  refusalLabel,
  zeroClickConcentration,
} from "./types.ts";

const row = (over = {}) => ({
  id: "a", work_item_id: "w", lead_id: "l", campaign_id: null, agent_user_id: "u", served_at: "2026-09-25T09:00:00+00:00",
  clicked_at: null, dispositioned_at: null, disposition: null, card_open_seconds: null, notes: null, agent_name: "Dana",
  campaign_name: null, lead_name: "Althea", integrity_flags: [], ...over,
});

test("only owners and producers review outcomes logged without a dial", () => {
  assert.equal(mayReviewZeroClick("owner"), true);
  assert.equal(mayReviewZeroClick("producer"), true);
  assert.equal(mayReviewZeroClick("setter"), false);
  assert.equal(mayReviewZeroClick(undefined), false);
});

test("the flag filter accepts the report's flags and 'any', nothing else", () => {
  assert.equal(parseFlagFilter("any"), "any");
  assert.equal(parseFlagFilter("zero_click_disposition"), "zero_click_disposition");
  assert.equal(parseFlagFilter("drop table"), null);
  assert.equal(parseFlagFilter(null), null);
});

test("spans and face amounts read the way the log writes them", () => {
  assert.equal(formatSpan(4), "4s");
  assert.equal(formatSpan(185), "3m 05s");
  assert.equal(formatSpan(7800), "2h 10m");
  assert.equal(formatSpan(null), null);
  assert.equal(formatFaceAmount(1_500_000), "$15k");
  assert.equal(formatFaceAmount(850_000), "$8,500");
  assert.equal(formatFaceAmount(150_000_000), "$1.5M");
  assert.equal(formatFaceAmount(0), null);
});

test("outcome detail comes from the records, and a card with no outcome has none", () => {
  assert.deepEqual(outcomeDetails(row({ callback_at: "2026-09-25T21:30:00Z", on_internal_dnc: true })), []);
  const lines = outcomeDetails(row({
    disposition: "callback_scheduled", callback_at: "2026-09-24T21:30:00Z", callback_timezone: "America/Los_Angeles",
    deal_face_amount_cents: 1_500_000, deal_product: "Final expense", on_internal_dnc: true, vendor_claim_status: "accepted",
  }));
  assert.match(lines[0], /^Callback Thu 2:30 PM PDT$/);
  assert.equal(lines[1], "$15k · Final expense");
  assert.equal(lines[2], "On the do-not-call list");
  assert.equal(lines[3], "On a vendor claim · credited");
});

test("refusal codes read as words; an unknown one is humanised, not dropped", () => {
  assert.equal(refusalLabel("outside_window"), "Outside calling window");
  assert.equal(refusalLabel("some_new_code"), "Some new code");
  assert.equal(refusalLabel(null), "Blocked");
});

test("the zero-click callout names the agent with the most", () => {
  const out = zeroClickConcentration([
    { agent_name: "Dana", zero_click: 22 }, { agent_name: "Ray", zero_click: 15 }, { agent_name: "Sarah", zero_click: 0 }, { agent_name: "Old" },
  ]);
  assert.deepEqual(out, { total: 37, top: { name: "Dana", count: 22 } });
  assert.deepEqual(zeroClickConcentration([{ agent_name: "Ray" }]), { total: 0, top: null });
});

test("each refused dial lands on exactly one page of the log", () => {
  const at = (h) => `2026-09-25T${String(h).padStart(2, "0")}:00:00.000Z`;
  const blocked = [23, 20, 17, 14, 11, 8, 5, 2].map((h) => ({ id: String(h), at: at(h) }));
  // Served rows at 22, 18 (page 1) · 15, 12 (page 2) · 9 (page 3, last). Window 00:00–24:00.
  const windowFrom = "2026-09-25T00:00:00Z";
  const windowTo = "2026-09-26T00:00:00Z";
  const page1 = blockedForPage(blocked, { windowFrom, windowTo, upper: windowTo, lower: at(18), lastPage: false });
  const page2 = blockedForPage(blocked, { windowFrom, windowTo, upper: at(18), lower: at(12), lastPage: false });
  const page3 = blockedForPage(blocked, { windowFrom, windowTo, upper: at(12), lower: at(9), lastPage: true });
  assert.deepEqual(page1.map((b) => b.id), ["23", "20"]);
  assert.deepEqual(page2.map((b) => b.id), ["17", "14"]);
  assert.deepEqual(page3.map((b) => b.id), ["11", "8", "5", "2"]);
  // Offsets written differently still compare as instants.
  assert.equal(blockedForPage([{ id: "x", at: "2026-09-25T18:00:00+00:00" }], { windowFrom, windowTo, upper: windowTo, lower: at(18), lastPage: false }).length, 1);
});

test("the report migration keeps setters out of the zero-click filter and restates the latest definition", () => {
  const sql = readFileSync(new URL("../../supabase/migrations/20260925705100_activity_report_row_detail_and_flag_filter.sql", import.meta.url), "utf8");
  assert.match(sql, /v_flag = 'zero_click_disposition' and p_actor_role not in \('owner', 'producer'\)/);
  assert.match(sql, /drop function if exists public\.tenant_activity_report\(uuid, uuid, text, uuid, uuid, text, timestamptz, timestamptz, integer, integer, boolean\)/);
  assert.match(sql, /'zero_click', p\.zero_click/);
  // Everything 20260915170000 returned per agent is still returned.
  for (const key of ["served", "clicked", "logged", "contact_rate_percent", "disposition_breakdown", "callbacks_booked", "callbacks_kept", "appointments_booked", "appointments_showed", "applications_started", "applications_submitted"]) {
    assert.match(sql, new RegExp(`'${key}',`));
  }
});

test("the link migration fires on the dial and the outcome, and never matches an inbound return call", () => {
  const sql = readFileSync(new URL("../../supabase/migrations/20260925705000_activity_log_learns_the_dial_and_outcome.sql", import.meta.url), "utf8");
  assert.match(sql, /after insert or update of dial_clicked_at, disposition on public\.tenant_call_attempts/);
  assert.match(sql, /if p_attempt\.work_item_id is null then return null; end if;/);
  assert.match(sql, /p_attempt\.disposition = 'inbound_return_call'/);
  assert.match(sql, /exception when others then/);
});
