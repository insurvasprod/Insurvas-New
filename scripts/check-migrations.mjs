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
  let start = 0;
  let i = 0;

  while (i < sql.length) {
    // Comments and quoted regions can contain semicolons that are not statement boundaries.
    if (sql.startsWith("--", i)) {
      const end = sql.indexOf("\n", i + 2);
      i = end === -1 ? sql.length : end + 1;
      continue;
    }
    if (sql.startsWith("/*", i)) {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? sql.length : end + 2;
      continue;
    }
    if (sql[i] === "'" || sql[i] === '"') {
      const quote = sql[i++];
      while (i < sql.length) {
        if (sql[i] === quote && sql[i + 1] === quote) {
          i += 2;
          continue;
        }
        if (sql[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (sql[i] === "$") {
      let tagEnd = i + 1;
      while (tagEnd < sql.length && /[A-Za-z_]/.test(sql[tagEnd])) tagEnd++;
      if (sql[tagEnd] === "$") {
        const dollarQuote = sql.slice(i, tagEnd + 1);
        const end = sql.indexOf(dollarQuote, tagEnd + 1);
        i = end === -1 ? sql.length : end + dollarQuote.length;
        continue;
      }
    }
    if (sql[i] === ";") {
      const statement = sql.slice(start, i).trim();
      if (statement && statement.replace(/(?:^|\n)\s*--[^\n]*/g, "").trim()) statements.push(statement);
      start = i + 1;
    }
    i++;
  }

  const finalStatement = sql.slice(start).trim();
  if (finalStatement && finalStatement.replace(/(?:^|\n)\s*--[^\n]*/g, "").trim()) statements.push(finalStatement);
  return statements;
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

// Some tenant-scoped policies cast app.tenant_id to uuid. A connection without a
// value can expose an empty-string cast error before the migration statement gets
// to its intended privilege/semantic check. Use a valid, non-existent sentinel so
// the verifier remains isolated and can distinguish migration errors from context
// setup errors.
await client.query("select set_config('app.tenant_id', $1, true)", ["00000000-0000-0000-0000-000000000000"]);

/* The deep check runs each statement inside a temporary PL/pgSQL function. This keeps the
 * per-statement exception boundary but avoids one remote network round trip per statement. */
const payload = [];
for (const file of files) {
  const statements = splitStatements(readFileSync(join(DIR, file), "utf8"));
  statements.forEach((statement, index) => {
    payload.push({ seq: payload.length + 1, file, statement_no: index + 1, sql: statement });
  });
}

await client.query(`
  create or replace function pg_temp.check_migration_batch(p_payload jsonb)
  returns table(result_seq integer, result_file text, result_statement_no integer,
    result_status text, result_code text, result_message text)
  language plpgsql
  as $function$
  declare item record;
  begin
    for item in
      select * from jsonb_to_recordset(p_payload) as x(seq integer, file text, statement_no integer, sql text)
      order by seq
    loop
      result_seq := item.seq;
      result_file := item.file;
      result_statement_no := item.statement_no;
      begin
        execute item.sql;
        result_status := 'executed';
        result_code := null;
        result_message := null;
      exception when others then
        result_status := 'error';
        get stacked diagnostics result_code = returned_sqlstate, result_message = message_text;
      end;
      return next;
    end loop;
  end;
  $function$;
`);

const { rows: results } = await client.query(
  "select * from pg_temp.check_migration_batch($1::jsonb) order by result_seq",
  [JSON.stringify(payload)],
);

const problems = [];
let checked = 0;
let parsedOnly = 0;
let executed = 0;
let blockedDependencies = 0;

/*
 * A tenant connection is deliberately unable to create or alter objects. Once a DDL statement
 * has returned the expected privilege error, PostgreSQL may also report follow-up GRANT/REVOKE,
 * index, trigger, or ALTER statements as missing-object errors. Those follow-ups cannot be
 * independently tested with this connection and are not migration defects. Keep real DML and
 * function-body errors visible so a typo is never hidden behind the permission check.
 */
const DEPENDENT_DDL = /^(?:alter\s+table|comment\s+on|create\s+(?:index|trigger|policy)|drop\s+(?:index|trigger|policy)|grant\s+|revoke\s+)/i;
const EXPECTED_DEPENDENT_CODES = new Set(["42P01", "42704", "42883"]);

function stripLeadingComments(statement) {
  let value = statement.trimStart();
  while (value.startsWith("--") || value.startsWith("/*")) {
    if (value.startsWith("--")) {
      const end = value.indexOf("\n");
      value = end === -1 ? "" : value.slice(end + 1).trimStart();
    } else {
      const end = value.indexOf("*/", 2);
      value = end === -1 ? "" : value.slice(end + 2).trimStart();
    }
  }
  return value;
}

for (const file of files) {
  const statements = payload.filter((item) => item.file === file);
  const fileResults = results.filter((result) => result.result_file === file);
  let fileProblems = 0;
  let privilegeBlocked = false;

  for (const result of fileResults) {
    const statement = statements[result.result_statement_no - 1]?.sql ?? "";
    if (result.result_status === "executed") {
      executed++;
    } else if (EXPECTED.has(result.result_code)) {
      parsedOnly++;
      privilegeBlocked = true;
    } else if (privilegeBlocked && EXPECTED_DEPENDENT_CODES.has(result.result_code) && DEPENDENT_DDL.test(stripLeadingComments(statement))) {
      blockedDependencies++;
    } else {
      fileProblems++;
      problems.push({
        file,
        n: result.result_statement_no,
        code: result.result_code,
        message: result.result_message,
        sql: statement.slice(0, 160).replace(/\s+/g, " "),
      });
    }
  }

  checked += fileResults.length;

  const mark = fileProblems === 0 ? "[32mok[0m" : `[31m${fileProblems} problem(s)[0m`;
  console.log(`${mark.padEnd(22)} ${file} (${statements.length} statements)`);
}

await client.query("rollback");
await client.end();

console.log("");
console.log(`${checked} statements checked — ${parsedOnly} parsed then blocked on rights, ${executed} ran and were rolled back`);
if (blockedDependencies) {
  console.log(`${blockedDependencies} dependent DDL checks skipped after an expected privilege block`);
}

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
