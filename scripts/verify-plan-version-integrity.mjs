// M2-1 / M2-7 · Plan creation and versioning must retain the full commercial configuration.
import { createClient } from "@supabase/supabase-js";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const stamp = Date.now();
const code = `qa_plan_${stamp}`;
let failures = 0;
const check = (label, condition, detail = "") => {
  console.log(condition ? `  ok   ${label}` : `  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  if (!condition) failures++;
};

const { data: feature } = await db.from("features").select("feature_key").eq("is_archived", false).limit(1).single();
const { data: plan, error: planError } = await db
  .from("plans")
  .insert({ code, version: 1, name: "QA plan", plan_type: "individual", is_public: false, is_archived: false, sort_order: 9999 })
  .select("id")
  .single();
if (planError) throw planError;

let version;
let addon;
try {
  check("a new individual plan receives the mandatory one-seat limit", (await db.from("plan_limits").select("max_seats").eq("plan_id", plan.id).single()).data?.max_seats === 1);

  await db.from("plan_features").insert({ plan_id: plan.id, feature_key: feature.feature_key });
  await db.from("plan_prices").insert({ plan_id: plan.id, price_monthly_cents: 9900, price_quarterly_cents: 27000, price_yearly_cents: 99000, setup_fee_cents: 500, trial_days: 14, currency: "USD" });
  await db.from("plan_limits").update({ max_seats: 1, max_carriers: 7, max_publishers: 3, max_marketing_partners: 4, max_affiliates: 5, max_buffer_seats: 6, max_partner_users: 7 }).eq("plan_id", plan.id);
  await db.from("plan_meters").insert({ plan_id: plan.id, meter_key: "dialer_minutes", included_qty: 123, hard_cap: true });
  ({ data: addon } = await db.from("addons").insert({ code: `qa_addon_${stamp}`, name: "QA add-on", price_cents: 100, billing_cycle: "monthly", is_active: true }).select("id").single());
  await db.from("plan_available_addons").insert({ plan_id: plan.id, addon_id: addon.id });

  const result = await db.rpc("admin_create_plan_version", { p_plan_id: plan.id });
  version = result.data;
  if (result.error) throw result.error;

  const [limits, meters, addons, prices] = await Promise.all([
    db.from("plan_limits").select("max_seats, max_carriers, max_publishers, max_marketing_partners, max_affiliates, max_buffer_seats, max_partner_users").eq("plan_id", version).single(),
    db.from("plan_meters").select("meter_key, included_qty, hard_cap").eq("plan_id", version).single(),
    db.from("plan_available_addons").select("addon_id").eq("plan_id", version).single(),
    db.from("plan_prices").select("price_monthly_cents, price_quarterly_cents, price_yearly_cents, setup_fee_cents, trial_days").eq("plan_id", version).single(),
  ]);
  check("a new version copies limits", limits.data?.max_carriers === 7 && limits.data?.max_partner_users === 7, JSON.stringify(limits.data));
  check("a new version copies meters", meters.data?.meter_key === "dialer_minutes" && meters.data?.included_qty === 123);
  check("a new version copies available add-ons", addons.data?.addon_id === addon.id);
  check("a new version copies all prices", prices.data?.price_quarterly_cents === 27000 && prices.data?.setup_fee_cents === 500);
} finally {
  if (version) {
    await db.from("plan_available_addons").delete().eq("plan_id", version);
    await db.from("plan_meters").delete().eq("plan_id", version);
    await db.from("plan_limits").delete().eq("plan_id", version);
    await db.from("plan_prices").delete().eq("plan_id", version);
    await db.from("plan_features").delete().eq("plan_id", version);
    await db.from("plans").delete().eq("id", version);
  }
  await db.from("plan_available_addons").delete().eq("plan_id", plan.id);
  await db.from("plan_meters").delete().eq("plan_id", plan.id);
  await db.from("plan_limits").delete().eq("plan_id", plan.id);
  await db.from("plan_prices").delete().eq("plan_id", plan.id);
  await db.from("plan_features").delete().eq("plan_id", plan.id);
  await db.from("plans").delete().eq("id", plan.id);
  if (addon) await db.from("addons").delete().eq("id", addon.id);
}

console.log(failures === 0 ? "\nPlan version integrity checks passed." : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
