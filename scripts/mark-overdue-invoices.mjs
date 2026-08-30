// SA-3.7 · Moves issued invoices past their due date to overdue.
//
// This is what gives manual-billing tenants an overdue signal at all: their invoices have no
// provider charge behind them, so Whop's own dunning never fires for them. Deliberately NOT a
// reminder ladder — SA-3.5 stays cancelled; this just makes the admin's overdue tile and filter
// tell the truth so a human can chase.
//
// Meant to run daily. Run with: npm run mark:overdue
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const { data, error } = await supabase.rpc("mark_overdue_invoices");
if (error) {
  console.error("Could not mark overdue invoices:", error.message);
  process.exit(1);
}

console.log(`${data} invoice(s) moved to overdue.`);

const { data: overdue } = await supabase
  .from("invoices")
  .select("number, total_cents, due_at, tenants(name)")
  .eq("status", "overdue")
  .order("due_at");

for (const row of overdue ?? []) {
  const days = Math.floor((Date.now() - new Date(row.due_at).getTime()) / 86_400_000);
  console.log(`  ${row.number}  ${row.tenants?.name ?? "—"}  $${(row.total_cents / 100).toFixed(2)}  ${days}d overdue`);
}
