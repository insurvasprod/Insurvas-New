/**
 * Builds one SQL script from a list of pending migrations, for the Supabase SQL editor.
 *
 * This environment has no DDL rights (see docs/backlog.md #190), so the deliverable is a file a
 * database owner can paste and run. Unlike scripts/build-la2-deployment.mjs, which wraps seven
 * files in ONE transaction, this wraps EACH file in its own begin/commit: the list here spans
 * several sessions' work, and one file failing (a timeout on a large backfill, say) should roll
 * back that file alone, with the error naming it, rather than everything queued in front of it.
 * Each file also records itself in supabase_migrations.schema_migrations inside its own transaction,
 * so history moves with the schema; on-conflict-do-nothing keeps a re-run harmless.
 *
 * Which files are pending is decided by scripts/verify-applied-migrations.mjs, which reads the live
 * catalog — not by migration history, which the SQL editor does not write.
 *
 *   node scripts/build-pending-bundle.mjs <out.sql> <migration file>...
 */
import fs from "node:fs";
import path from "node:path";

const [out, ...names] = process.argv.slice(2);
if (!out || names.length === 0) {
  console.error("usage: node scripts/build-pending-bundle.mjs <out.sql> <migration file>...");
  process.exit(1);
}

const DIR = "supabase/migrations";
const files = names.map((name) => path.basename(name)).sort();
for (const file of files) {
  const text = fs.readFileSync(path.join(DIR, file), "utf8");
  // Nothing that cannot run inside a transaction, and no transaction control of its own.
  // Judged on top-level SQL only: a comment, or a function body that refreshes a view concurrently
  // when it is later called, controls nothing while the file runs.
  const topLevel = text.replace(/--[^\n]*/g, "").replace(/\$([A-Za-z_]*)\$[\s\S]*?\$\1\$/g, "''");
  if (/^\s*(begin|commit|rollback)\s*;/im.test(topLevel) || /\bconcurrently\b/i.test(topLevel) || /^\s*vacuum\b/im.test(topLevel)) {
    console.error(`${file} controls its own transaction or cannot run inside one; bundle it by hand.`);
    process.exit(1);
  }
  // Postgres refuses a subquery in a table CHECK (0A000). scripts/check-migrations.mjs cannot see it
  // when the ALTER that adds the column is refused for privilege first, so it is caught here. A
  // policy's `with check (…)` may hold one, and is skipped.
  const sql = text.replace(/--[^\n]*/g, "");
  for (const match of sql.matchAll(/(\bwith\s+)?\bcheck\s*\(/gi)) {
    if (match[1]) continue;
    let depth = 0; let end = match.index + match[0].length - 1;
    for (; end < sql.length; end += 1) { if (sql[end] === "(") depth += 1; else if (sql[end] === ")" && --depth === 0) break; }
    // Quoted text is not SQL: a jsonpath predicate such as '$[*] ? (!exists(@.field))' is a string.
    if (/\b(select|exists)\b/i.test(sql.slice(match.index, end).replace(/'(?:[^']|'')*'/g, "''"))) {
      console.error(`${file} has a subquery inside a CHECK constraint, which Postgres refuses (0A000). Fix the file first.`);
      process.exit(1);
    }
  }
}

const header = [
  "-- ============================================================================",
  `-- Pending migrations — ${files.length} files, each in its own transaction`,
  `-- Generated ${new Date().toISOString().slice(0, 10)} by scripts/build-pending-bundle.mjs. Do not hand-edit; regenerate.`,
  "--",
  "-- HOW TO RUN: Supabase dashboard → SQL editor → paste this whole file → Run.",
  "-- Each file is begin … commit on its own. The SQL editor STOPS at the first error: that file is",
  "-- rolled back, the files before it stay applied, and nothing after it runs. Fix the named file,",
  "-- regenerate, and run the whole script again — re-running is safe: the files use",
  "-- create-or-replace / if-not-exists, and history rows use on-conflict-do-nothing.",
  "--",
  "-- AFTERWARDS: node --env-file=.env.local scripts/verify-applied-migrations.mjs",
  "--",
  "-- Files, in order:",
  ...files.map((file, index) => `--   ${String(index + 1).padStart(2)}. ${file}`),
  "-- ============================================================================",
  "",
].join("\n");

const body = files.map((file, index) => {
  const text = fs.readFileSync(path.join(DIR, file), "utf8").replace(/\s+$/, "");
  const [version, ...rest] = file.replace(/\.sql$/, "").split("_");
  const name = rest.join("_");
  return [
    `-- ─── [${index + 1}/${files.length}] ${file} ${"─".repeat(Math.max(3, 70 - file.length))}`,
    "begin;",
    "",
    text,
    "",
    "do $bundle$ begin",
    "  if to_regclass('supabase_migrations.schema_migrations') is not null then",
    `    insert into supabase_migrations.schema_migrations (version, name) values ('${version}', '${name}') on conflict do nothing;`,
    "  end if;",
    "end $bundle$;",
    "commit;",
    "",
  ].join("\n");
}).join("\n");

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, `${header}\n${body}`);
console.log(`wrote ${out}: ${files.length} files, ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
