/**
 * One-off codemod: move a verify suite off raw `public.users` inserts and onto createFixtureUser.
 *
 * Why. `public.users.id` is foreign keyed to `auth.users`, because Supabase Auth is the credential
 * authority for the tenant plane. A suite that invents its own `randomUUID()` and inserts it fails
 * with `users_id_fkey`, and every authenticated assertion after that returns 401. Twenty eight
 * suites were written before that change. Five were fixed by hand during the LA-0 audit; this does
 * the rest mechanically so the edit is identical everywhere.
 *
 * What it rewrites, and nothing else:
 *   1. adds the createFixtureUser / deleteFixtureUser import
 *   2. turns `const ownerId = randomUUID();` into `let ownerId = null;` for ids used as users
 *   3. replaces the `db.from("users").insert([...])` block with one createFixtureUser call per row
 *   4. replaces the `from("users").delete().in("id", [...])` cleanup with deleteFixtureUser calls
 *
 * Tenant, partner and other ids keep their randomUUID(), because only `users.id` is constrained.
 *
 *   node scripts/lib/migrateFixtures.mjs scripts/verify-partner-users.mjs [--write]
 */
import { readFileSync, writeFileSync } from "node:fs";

const file = process.argv[2];
const write = process.argv.includes("--write");
if (!file) {
  console.error("usage: node scripts/lib/migrateFixtures.mjs <suite.mjs> [--write]");
  process.exit(1);
}

let src = readFileSync(file, "utf8");
const before = src;
const notes = [];

if (src.includes("createFixtureUser")) {
  console.log(`${file}: already migrated`);
  process.exit(0);
}

/** Finds the `db.from("users").insert([ ... ])` call and returns its bounds and array body. */
function findUsersInsert(text) {
  const start = text.search(/(?:await\s+)?\w+\s*\.from\(\s*["']users["']\s*\)\s*\.insert\(\s*\[/);
  if (start === -1) return null;
  const open = text.indexOf("[", start);
  let depth = 0;
  let i = open;
  for (; i < text.length; i++) {
    if (text[i] === "[") depth++;
    else if (text[i] === "]") { depth--; if (depth === 0) break; }
  }
  if (depth !== 0) return null;
  // Walk forward to the closing paren and optional semicolon of the .insert( call.
  let j = i + 1;
  while (j < text.length && text[j] !== ")") j++;
  return { start, arrayStart: open, arrayEnd: i, end: j + 1, body: text.slice(open + 1, i) };
}

/** Extends a match back over an assignment like `const users = ` so it is replaced too. */
function withAssignmentPrefix(text, start) {
  const line = text.lastIndexOf("\n", start) + 1;
  const head = text.slice(line, start);
  return /^\s*(?:const|let|var)\s+\w+\s*=\s*$/.test(head) ? line + head.match(/^\s*/)[0].length : start;
}

const hit = findUsersInsert(src);
if (!hit) {
  console.log(`${file}: no raw users insert found, skipping`);
  process.exit(0);
}

/** Splits the array body into its top level object literals. */
function splitObjects(body) {
  const out = [];
  let depth = 0, start = -1;
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "{") { if (depth === 0) start = i; depth++; }
    else if (body[i] === "}") { depth--; if (depth === 0) out.push(body.slice(start, i + 1)); }
  }
  return out;
}

const rows = splitObjects(hit.body);
if (rows.length === 0) {
  console.log(`${file}: users insert had no rows, skipping`);
  process.exit(0);
}

const calls = [];
const idVars = [];
for (const row of rows) {
  const id = row.match(/\bid\s*:\s*([A-Za-z_$][\w$]*)/);
  const email = row.match(/\bemail\s*:\s*(`[^`]*`|"[^"]*"|'[^']*')/);
  const name = row.match(/\bname\s*:\s*(`[^`]*`|"[^"]*"|'[^']*')/);
  const status = row.match(/\bstatus\s*:\s*(`[^`]*`|"[^"]*"|'[^']*')/);
  if (!id || !email) {
    console.error(`${file}: a users row has no id or email binding, refusing to guess`);
    process.exit(2);
  }
  idVars.push(id[1]);
  const args = [`email: ${email[1]}`, `name: ${name ? name[1] : `"fixture"`}`];
  if (status && !/["'`]active["'`]/.test(status[1])) args.push(`status: ${status[1]}`);
  calls.push(`  ({ userId: ${id[1]} } = await createFixtureUser(db, { ${args.join(", ")} }));`);
}

// 3. swap the insert for the calls, and drop the error check that followed it.
const replaceFrom = withAssignmentPrefix(src, hit.start);
src = src.slice(0, replaceFrom) + calls.join("\n").trimStart() + src.slice(hit.end);
src = src.replace(/\n\s*if \(\s*users\.error\s*\)[^\n]*\n/, "\n");
src = src.replace(/;;+/g, ";");
notes.push(`${calls.length} fixture user(s)`);

// 2. the ids must be assignable now.
for (const v of idVars) {
  const re = new RegExp(`const\\s+${v}\\s*=\\s*randomUUID\\(\\)\\s*;`, "g");
  if (re.test(src)) src = src.replace(re, `let ${v} = null;`);
}

// 4. cleanup through the helper, so the auth half goes too.
// Two shapes appear: an inline array literal, and a variable holding one. Both have to go through
// the helper, otherwise the auth.users row survives and the next run cannot reuse the email.
src = src.replace(
  /await\s+(\w+)\.from\(\s*["']users["']\s*\)\.delete\(\)\.in\(\s*["']id["']\s*,\s*(\[[^\]]*\]|\w+)\s*\)\s*;/g,
  (_m, client, list) => `for (const id of ${list.trim()}) await deleteFixtureUser(${client}, id);`,
);
// Some suites delete a single fixture instead of a list.
src = src.replace(
  /await\s+(\w+)\.from\(\s*["']users["']\s*\)\.delete\(\)\.eq\(\s*["']id["']\s*,\s*(\w+)\s*\)\s*;/g,
  (_m, client, id) => `await deleteFixtureUser(${client}, ${id});`,
);

// 1. import last, so the earlier offsets stayed valid.
src = src.replace(
  /(import \{ createClient \} from "@supabase\/supabase-js";)/,
  `$1\nimport { createFixtureUser, deleteFixtureUser } from "./lib/fixtureUser.mjs";`,
);
if (!src.includes("fixtureUser.mjs")) {
  console.error(`${file}: could not place the import, leaving the file alone`);
  process.exit(2);
}

if (src === before) {
  console.log(`${file}: nothing changed`);
  process.exit(0);
}

if (write) {
  writeFileSync(file, src, "utf8");
  console.log(`${file}: migrated ${notes.join(", ")}`);
} else {
  console.log(`${file}: would migrate ${notes.join(", ")} (dry run)`);
}
