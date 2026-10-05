// Imported first by every scripts/verify-*.mjs. Verify scripts create (and often leave behind)
// whole tenants — each one seeded with pipelines, stages and disposition flows — and some load
// 10,000+ leads. On 2026-09-30, 605 of production's 615 tenants and 96% of its leads were such
// leftovers, which pushed the nano instance into swap and took the API down. So they refuse to run
// against the production project unless someone means it.
//
//   Point them at a dev project or a Supabase branch (NEXT_PUBLIC_SUPABASE_URL / TENANT_DB_URL),
//   or, deliberately and once: VERIFY_ALLOW_PRODUCTION=1 node --env-file=.env.local scripts/verify-….mjs

const PRODUCTION_REFS = (process.env.PRODUCTION_SUPABASE_REFS ?? "iiimdgizjwnihpyrukbu")
  .split(",").map((s) => s.trim()).filter(Boolean);

const targets = [process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_URL, process.env.TENANT_DB_URL, process.env.DATABASE_URL]
  .filter(Boolean).map(String);
const hit = PRODUCTION_REFS.find((ref) => targets.some((t) => t.includes(ref)));

if (hit && process.env.VERIFY_ALLOW_PRODUCTION !== "1") {
  console.error(
    `Refusing to run: this verify script would write test tenants into the PRODUCTION project (${hit}).\n` +
    "Point NEXT_PUBLIC_SUPABASE_URL / TENANT_DB_URL at a dev project or branch, or set VERIFY_ALLOW_PRODUCTION=1 if you really mean it.",
  );
  process.exit(2);
}
