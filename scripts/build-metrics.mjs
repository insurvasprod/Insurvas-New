// SA-3.9 · Builds the metrics_daily snapshot.
//
// Re-runnable for any date: the function upserts, so a corrected calculation can be backfilled
// across the whole history without duplicating rows. Meant to run nightly.
//
// Usage: npm run metrics:build          (last 90 days)
//        npm run metrics:build -- 365   (last year)
import { createClient } from "@supabase/supabase-js";

const days = Number(process.argv[2] ?? 90);
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

console.log(`Building ${days} day(s) of metrics…`);

let built = 0;
for (let i = days; i >= 0; i--) {
  const date = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
  const { error } = await supabase.rpc("compute_metrics_for_date", { p_date: date });
  if (error) {
    console.error(`  ${date}: ${error.message}`);
    process.exit(1);
  }
  built++;
}

console.log(`Built ${built} day(s).`);

const { data: latest } = await supabase
  .from("metrics_daily").select("*").order("date", { ascending: false }).limit(1).maybeSingle();

if (latest) {
  console.log(`\nLatest (${latest.date}):`);
  console.log(`  MRR (contracted) $${(latest.mrr_cents / 100).toFixed(2)}  ARR $${(latest.arr_cents / 100).toFixed(2)}`);
  console.log(`  Collected that day $${(latest.collected_cents / 100).toFixed(2)}`);
  console.log(`  Active customers ${latest.active_customers}  new ${latest.new_customers}  churned ${latest.churned_customers}`);
  console.log(`  By plan: ${JSON.stringify(latest.plan_breakdown)}`);
}
