// SA-4.4 audit (2026-10-15): a manual apply honours the offer's own active flag and cap, and
// lowering the offer's cap lowers its coupon's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { couponCapForOfferCap, offerApplyRefusal } from "./rules.ts";

test("a paused offer, or one at its own cap, is refused before the coupon is touched", () => {
  assert.equal(offerApplyRefusal({ is_active: false, max_redemptions: null, redeemed_count: 0 })?.result, "inactive");
  assert.equal(offerApplyRefusal({ is_active: true, max_redemptions: 5, redeemed_count: 5 })?.result, "exhausted");
  assert.equal(offerApplyRefusal({ is_active: true, max_redemptions: 5, redeemed_count: 4 }), null);
  assert.equal(offerApplyRefusal({ is_active: true, max_redemptions: null, redeemed_count: 900 }), null);
});

test("lowering the offer cap lowers the coupon cap; nothing ever loosens it", () => {
  assert.equal(couponCapForOfferCap(50, 100), 50);
  assert.equal(couponCapForOfferCap(50, null), 50, "an uncapped coupon takes the new campaign cap");
  assert.equal(couponCapForOfferCap(100, 100), undefined);
  assert.equal(couponCapForOfferCap(200, 100), undefined, "raising is refused earlier, never applied here");
  assert.equal(couponCapForOfferCap(null, 100), undefined);
});

test("the service checks the offer first, applies under the offer lock, and writes the coupon cap", () => {
  const service = readFileSync(new URL("./service.ts", import.meta.url), "utf8");
  const manual = service.slice(service.indexOf("export async function applyOfferManually"), service.indexOf("export async function applyAutoOffer"));
  assert.ok(manual.indexOf("offerApplyRefusal(offer)") < manual.indexOf("manualOfferWarning("), "refusal comes before the confirm-able warning");
  assert.match(manual, /rpc\("admin_apply_offer" as never/);
  assert.match(service, /couponCapForOfferCap\(input\.max_redemptions, current\.coupon\.max_redemptions\)/);
  assert.match(service, /from\("coupons"\)\.update\(\{ max_redemptions: couponCap \} as never\)\.eq\("id", current\.coupon_id\)/);
  const route = readFileSync(new URL("../../app/api/admin/offers/[id]/apply/route.ts", import.meta.url), "utf8");
  assert.match(route, /result\.message \?\? applyFailureMessage\(result\.result\)/);
});

test("admin_apply_offer locks the offer and checks flag and cap before admin_apply_coupon", () => {
  const sql = readFileSync(new URL("../../supabase/migrations/20261015610100_sa4_offer_manual_apply.sql", import.meta.url), "utf8");
  const body = sql.slice(sql.indexOf("create or replace function"), sql.indexOf("-- ─── self-check"));
  const lock = body.indexOf("from public.offers where id = p_offer_id for update");
  assert.ok(lock > 0);
  assert.ok(body.indexOf("'inactive'") > lock && body.indexOf("'exhausted'") > lock);
  assert.ok(body.indexOf("public.admin_apply_coupon(") > body.indexOf("'exhausted'"));
  assert.match(sql, /revoke all on function public\.admin_apply_offer\(uuid, uuid, uuid\) from public, anon, authenticated;/);
});
