import "./lib/refuseProduction.mjs";
/**
 * Does every RPC the application calls actually exist in the database?
 *
 * Run with: npm run verify:rpc-contract
 *
 * Why this exists. The LA-0 audit chased six tasks' worth of "unproven" acceptance criteria and
 * found the cause was not the application code: it was that the configured database is missing
 * most of the functions the code calls. A `supabase.rpc("x")` against a function that does not
 * exist is not a compile error, not a type error, and not a lint error — `database.types.ts` is a
 * hand-maintained file, so it can happily declare a function nobody ever created. It is a 404
 * from PostgREST at runtime, surfaced to the customer as a 500.
 *
 * Nothing in this repository noticed. 104 of 131 called RPCs were absent and every gate was green.
 *
 * This check closes that. It reads every `.rpc("name")` call in the tree, asks the database which
 * functions exist, and fails with the difference. It needs only catalog read access, so the
 * deliberately unprivileged TENANT_DB_URL role is enough.
 *
 * It reports two categories, because they need different responses:
 *   MISSING  — the app calls it and the database does not have it. A runtime 500 waiting to happen.
 *   UNUSED   — the database has it and no code path calls it. Usually dead, occasionally a sign
 *              that a caller was deleted without its migration, so it is listed but never fatal.
 */
import { Client } from "pg";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, extname, relative } from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const SEARCH_ROOTS = ["app", "lib", "scripts", "components"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mjs", ".js"]);
const RPC_PATTERN = /\.rpc\(\s*["'`]([a-z0-9_]+)["'`]/g;

/**
 * Functions the application deliberately does not call: triggers, internal helpers, and anything
 * invoked only from inside other SQL. Listing them keeps the UNUSED report honest instead of noisy.
 */
const NOT_CALLED_FROM_CODE = new Set([
  "handle_new_auth_user",
  "set_updated_at",
  "trigger_set_timestamp",
]);

function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", ".next", ".git", "dist", "build"].includes(entry.name)) continue;
      walk(path, out);
    } else if (SOURCE_EXTENSIONS.has(extname(entry.name))) {
      out.push(path);
    }
  }
}

function calledRpcs() {
  const files = [];
  for (const root of SEARCH_ROOTS) {
    try {
      statSync(join(ROOT, root));
      walk(join(ROOT, root), files);
    } catch {
      // Root not present in this checkout — fine.
    }
  }

  const called = new Map(); // name -> [files]
  const self = join(ROOT, "scripts", "verify-rpc-contract.mjs");
  for (const file of files) {
    if (file === self) continue; // this file documents the pattern it searches for
    const source = readFileSync(file, "utf8");
    for (const [, name] of source.matchAll(RPC_PATTERN)) {
      const rel = relative(ROOT, file).replace(/\\/g, "/");
      if (!called.has(name)) called.set(name, []);
      if (!called.get(name).includes(rel)) called.get(name).push(rel);
    }
  }
  return called;
}

async function existingFunctions() {
  const connectionString = process.env.TENANT_DB_URL;
  if (!connectionString) {
    throw new Error("Missing TENANT_DB_URL in .env.local — this check needs catalog read access.");
  }
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    // Exclude functions installed by an extension. pg_trgm and btree_gist alone contribute ~200
    // entries (gbt_*, gtrgm_*, similarity, word_similarity …) which would bury the real report.
    const { rows } = await client.query(
      `select distinct p.proname
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and not exists (
            select 1 from pg_depend d
             where d.objid = p.oid and d.classid = 'pg_proc'::regclass and d.deptype = 'e'
          )`,
    );
    return new Set(rows.map((row) => row.proname));
  } finally {
    await client.end();
  }
}

const called = calledRpcs();
const existing = await existingFunctions();

const missing = [...called.entries()]
  .filter(([name]) => !existing.has(name))
  .sort(([a], [b]) => a.localeCompare(b));

const unused = [...existing]
  .filter((name) => !called.has(name) && !NOT_CALLED_FROM_CODE.has(name))
  .sort();

console.log(`RPCs called by the application : ${called.size}`);
console.log(`Present in the database        : ${called.size - missing.length}`);
console.log(`Missing from the database      : ${missing.length}`);
console.log(`In the database, never called  : ${unused.length}\n`);

if (missing.length > 0) {
  console.log("MISSING — each of these is a runtime 500 on the code path that calls it:\n");
  // Group by the module that calls it, so the output maps onto whoever owns the fix.
  const byArea = new Map();
  for (const [name, files] of missing) {
    const area = files[0].split("/").slice(0, 2).join("/");
    if (!byArea.has(area)) byArea.set(area, []);
    byArea.get(area).push([name, files]);
  }
  for (const area of [...byArea.keys()].sort()) {
    console.log(`  ${area}`);
    for (const [name, files] of byArea.get(area)) {
      console.log(`    ${name}`);
      for (const file of files.slice(0, 3)) console.log(`      ${file}`);
      if (files.length > 3) console.log(`      … and ${files.length - 3} more`);
    }
    console.log("");
  }
}

if (unused.length > 0) {
  console.log(`Never called from code (not fatal): ${unused.join(", ")}\n`);
}

if (missing.length === 0) {
  console.log("Every RPC the application calls exists in this database.");
  process.exitCode = 0;
} else {
  console.log(
    `${missing.length} RPC(s) the application calls do not exist in this database.\n` +
      "The application will return 500 on every path that reaches one. Apply the migrations that\n" +
      "create them, or point .env.local at a project that has them.",
  );
  // Deliberately process.exitCode rather than process.exit(): an early exit while the pg client
  // still holds a handle aborts on Windows/Node 24 with UV_HANDLE_CLOSING instead of reporting.
  process.exitCode = 1;
}
