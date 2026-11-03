// LA-7 (Notion sprint, Module 7 — Accounting) · every file the module owns, for the tests that must
// hold across all of it (no commission-ledger writes, no floats, no outbound payment API).
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

/** Every file LA-7 owns: its library, routes, screens and migrations. */
export function la7Files() {
  const out = [];
  const walk = (dir) => {
    if (!existsSync(join(root, dir))) return;
    for (const name of readdirSync(join(root, dir))) {
      const p = `${dir}/${name}`;
      if (statSync(join(root, p)).isDirectory()) walk(p);
      else if (/\.(ts|tsx|mjs|sql)$/.test(name) && !/\.test\.mjs$/.test(name)) out.push(p);
    }
  };
  for (const dir of ["lib/accounting", "app/api/app/accounting", "app/api/partner/payouts", "components/app/accounting", "app/partner/(portal)/payouts",
    "app/app/(shell)/invoices", "app/app/(shell)/expenses", "app/app/(shell)/pnl", "app/app/(shell)/payouts", "app/app/(shell)/producer-splits", "app/app/(shell)/my-balance", "app/app/(shell)/accounting-settings", "app/app/(shell)/bank", "app/app/(shell)/tax", "app/app/(shell)/accounting"]) walk(dir);
  for (const file of ["components/partner/partner-payouts.tsx"]) if (existsSync(join(root, file))) out.push(file);
  for (const f of readdirSync(join(root, "supabase/migrations"))) if (/_la_7_/.test(f)) out.push(`supabase/migrations/${f}`);
  return out;
}
