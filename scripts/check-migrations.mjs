/**
 * Parse-checks every migration against a real PostgreSQL server without changing anything.
 *
 * The trick: this repository's only credential is TENANT_DB_URL, whose role has no DDL rights. That
 * looks like a dead end for validating a migration, but Postgres parses a statement BEFORE it
 * checks permissions. So a syntax error and a permission error are different SQLSTATEs, and the
 * second one is proof the first did not happen:
 *
 *   42601 syntax_error            the SQL is wrong        <- a real failure
 *   42P01 undefined_table         wrong order, or a typo  <- a real failure
 *   42704 undefined_object        missing type or role    <- a real failure
 *   42501 insufficient_privilege  parsed fine, no rights  <- expected, and what we want
 *
 * Every statement runs inside a savepoint that is rolled back immediately, and the whole run is
 * wrapped in one transaction that is rolled back at the end. Nothing is committed, ever.
 *
 * What this does NOT prove: that the migrations produce the right schema when actually applied.
 * Only running them against a scratch database with an owner connection proves that. This catches
 * the class of mistake that would otherwise be found by a failing production deploy.
 *
 *   node --env-file=.env.local scripts/check-migrations.mjs
 *   node --env-file=.env.local scripts/check-migrations.mjs 0000_baseline.sql
 */
import pg from "pg";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

const DIR = "supabase/migrations";

/** Errors that mean the statement parsed and only rights stopped it. */
const EXPECTED = new Set([
  "42501", // insufficient_privilege
  "0LP01", // invalid_grant_operation
]);

/**
 * Splits SQL into statements, respecting dollar quoting and string literals.
 *
 * A naive split on ";" tears every function body in half — pg_get_functiondef emits bodies wrapped
 * in $function$ ... $function$ and they are full of semicolons.
 */
function splitStatements(sql) {
  const statements = [];
  let buf = "";
  let i = 0;
  let dollarTag = null;

  while (i < sql.length) {
    const rest = sql.slice(i);

    if (dollarTag) {
      if (rest.startsWith(dollarTag)) {
        buf += dollarTag;
        i += dollarTag.length;
        dollarTag = null;
        continue;
      }
      buf += sql[i++];
      continue;
    }

    // line comment
    if (rest.startsWith("--")) {
      const end = sql.indexOf("\n", i);
      const stop = end === -1 ? sql.length : end;
      buf += sql.slice(i, stop);
      i = stop;
      continue;
    }

    // single-quoted string
    if (sql[i] === "'") {
      buf += sql[i++];
      while (i < sql.length) {
        buf += sql[i];
        if (sql[i] === "'" && sql[i + 1] === "'") {
          buf += sql[++i];
          i++;
          continue;
        }
        if (sql[i] === "'") { i++; break; }
        i++;
      }
      continue;
    }

    // dollar-quote opening: $$ or $tag$
    const dq = rest.match(/^\$[A-Za-z_]*\$/);
    if (dq) {
      dollarTag = dq[0];
      buf += dollarTag;
      i += dollarTag.length;
      continue;
    }

    if (sql[i] === ";") {
      statements.push(buf.trim());
      buf = "";
      i++;
      continue;
    }

    buf += sql[i++];
  }

  if (buf.trim()) statements.push(buf.trim());
  return statements.filter((s) => s && !/^(--[^\n]*\n?)*$/.test(s));
}

if (!process.env.TENANT_DB_URL) {
  console.error("TENANT_DB_URL is not set. Run with --env-file=.env.local");
  process.exit(1);
}

const only = process.argv.slice(2).find((a) => !a.startsWith("--"));
const files = readdirSync(DIR)
  .filter((f) => f.endsWith(".sql"))
  .filter((f) => !only || f === only)
  .sort();

if (!files.length) {
  console.error(only ? `no migration named ${only}` : `no .sql files in ${DIR}`);
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.TENANT_DB_URL, ssl: { rejectUnauthorized: false } });
await client.connect();

/**
 * Fast path — syntax only, one round trip per file.
 *
 * PostgreSQL's simple query protocol parses an ENTIRE multi-statement string before executing any
 * of it. So sending a whole migration as one query either fails with 42601 and a character offset
 * (a real syntax error, and nothing ran), or gets as far as the first permission check (everything
 * parsed). The slow per-statement path below adds semantic checks — undefined tables, missing
 * types — at the cost of a round trip each, which over a remote pooler is minutes rather than
 * seconds.
 */
if (process.argv.includes("--fast")) {
  let bad = 0;
  for (const file of files) {
    const sql = readFileSync(join(DIR, file), "utf8");
    await client.query("begin");
    try {
      await client.query(sql);
      console.log(`[32mparsed and ran[0m        ${file}`);
    } catch (e) {
      if (EXPECTED.has(e.code)) {
        console.log(`[32mparsed[0m                ${file}`);
      } else if (e.code === "42601") {
        const upto = sql.slice(0, Number(e.position || 0));
        const line = upto.split("\n").length;
        console.log(`[31msyntax error[0m          ${file}:${line}`);
        console.log(`  ${e.message}`);
        console.log(`  ${sql.split("\n")[line - 1]?.trim().slice(0, 120)}`);
        bad++;
      } else {
        // Parsed, then something else stopped it. Not a syntax problem, but worth seeing.
        console.log(`[33mparsed, then ${e.code}[0m   ${file}`);
        console.log(`  ${e.message}`);
      }
    }
    await client.query("rollback");
  }
  await client.end();
  console.log("");
  console.log(bad ? `[31m${bad} file(s) contain a syntax error.[0m` : "[32mEvery file parses.[0m");
  console.log("Nothing was committed. Run without --fast for per-statement semantic checks.");
  process.exit(bad ? 1 : 0);
}

await client.query("begin");

const problems = [];
let checked = 0;
let parsedOnly = 0;
let executed = 0;

for (const file of files) {
  const statements = splitStatements(readFileSync(join(DIR, file), "utf8"));
  let fileProblems = 0;

  for (const [n, statement] of statements.entries()) {
    checked++;
    await client.query("savepoint s");
    try {
      await client.query(statement);
      executed++;
      await client.query("rollback to savepoint s");
    } catch (e) {
      await client.query("rollback to savepoint s");
      if (EXPECTED.has(e.code)) {
        parsedOnly++;
        continue;
      }
      fileProblems++;
      problems.push({
        file,
        n: n + 1,
        code: e.code,
        message: e.message,
        sql: statement.slice(0, 160).replace(/\s+/g, " "),
      });
    }
  }

  const mark = fileProblems === 0 ? "[32mok[0m" : `[31m${fileProblems} problem(s)[0m`;
  console.log(`${mark.padEnd(22)} ${file} (${statements.length} statements)`);
}

await client.query("rollback");
await client.end();

console.log("");
console.log(`${checked} statements checked — ${parsedOnly} parsed then blocked on rights, ${executed} ran and were rolled back`);

if (!problems.length) {
  console.log("[32mNo syntax, ordering or missing-object errors.[0m");
  console.log("Nothing was committed. This does not replace applying the migrations to a scratch database.");
  process.exit(0);
}

console.log("");
for (const p of problems) {
  console.log(`[31m${p.file} statement ${p.n} [${p.code}][0m`);
  console.log(`  ${p.message}`);
  console.log(`  ${p.sql}…`);
}
process.exit(1);
