import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { campaignSpeedToLead, medianOf } = await import("./campaignSpeed.ts");

test("LA-2.5-5: per-campaign speed to lead, median over dialled leads, share over posted leads", () => {
  const t0 = Date.parse("2026-09-29T10:00:00Z");
  const at = (seconds) => new Date(t0 + seconds * 1000).toISOString();
  const leads = [
    { id: "a", campaignId: "c1", postedAt: at(0) },
    { id: "b", campaignId: "c1", postedAt: at(0) },
    { id: "c", campaignId: "c1", postedAt: at(0) },
    { id: "d", campaignId: "c1", postedAt: at(0) }, // never dialled
    { id: "e", campaignId: "c2", postedAt: at(0) },
  ];
  const clicks = [
    { leadId: "a", dialClickedAt: at(30) },
    { leadId: "a", dialClickedAt: at(900) }, // a later click never replaces the first
    { leadId: "b", dialClickedAt: at(45) },
    { leadId: "c", dialClickedAt: at(600) },
    { leadId: "e", dialClickedAt: at(61) },
  ];
  const rows = campaignSpeedToLead(leads, clicks, [{ id: "c1", name: "One", vendorId: "v" }, { id: "c2", name: "Two", vendorId: "v" }]);
  const one = rows.find((row) => row.campaignId === "c1");
  assert.equal(one.postedLeads, 4);
  assert.equal(one.dialledLeads, 3);
  assert.equal(one.medianSeconds, 45); // the median of 30, 45, 600 — not the mean
  assert.equal(one.dialledWithin60s, 2);
  assert.equal(one.dialledWithin60sPct, 50); // 2 of 4 POSTED, not 2 of 3 dialled
  const two = rows.find((row) => row.campaignId === "c2");
  assert.equal(two.dialledWithin60s, 0); // 61 s is outside the minute
  assert.equal(medianOf([10, 20]), 15);
  assert.equal(medianOf([]), null);
});

test("LA-2.5-5: the view and the fallback measure to the first Dial click", () => {
  const view = readFileSync(new URL("../../supabase/migrations/20260925709720_campaign_speed_to_lead.sql", import.meta.url), "utf8");
  assert.match(view, /min\(a\.dial_clicked_at\) as first_dial_at/);
  assert.match(view, /\/ nullif\(count\(\*\), 0\)/); // share over posted leads
  const route = readFileSync(new URL("../../app/api/app/campaigns/speed-to-lead/route.ts", import.meta.url), "utf8");
  assert.match(route, /tenant_campaign_speed_to_lead/);
  assert.match(route, /campaignSpeedToLead\(/);
  assert.match(route, /dial_clicked_at/);
});
