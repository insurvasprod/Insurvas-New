// Security review 2026-11, M-2: staff sessions that the server can end.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

process.env.ADMIN_SESSION_SECRET ??= "test-only-admin-session-secret-at-least-32-bytes";

const {
  adminSessionIsCurrent,
  currentAdminSessionVersion,
  endAdminSessions,
  readAdminWithSessionVersion,
  tokenSessionVersion,
} = await import("./sessionVersion.ts");
const { signAdminSessionToken, verifyAdminSessionToken } = await import("./session.ts");

const ADMIN = "00000000-0000-4000-8000-000000000001";
const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");
const MISSING = { code: "42703", message: "column admin_users.session_version does not exist" };

/**
 * A stand-in for PostgREST on admin_users. A conditional update is evaluated when it runs, against
 * the row as it is then, the way Postgres re-checks the WHERE clause of two racing updates.
 */
function fakeAdminUsers(rows, { missingColumn = false, failSelect = null, beforeUpdate = null } = {}) {
  const calls = [];
  const matches = (row, filters) => filters.every(([column, value]) => row[column] === value);
  const client = {
    from(table) {
      assert.equal(table, "admin_users");
      return {
        select(columns) {
          const filters = [];
          const run = async () => {
            calls.push({ kind: "select", columns });
            if (failSelect) return { data: null, error: failSelect };
            if (missingColumn && columns.includes("session_version")) return { data: null, error: MISSING };
            const row = rows.find((candidate) => matches(candidate, filters));
            if (!row) return { data: null, error: null };
            const picked = Object.fromEntries(columns.split(",").map((c) => c.trim()).map((c) => [c, row[c]]));
            return { data: picked, error: null };
          };
          const builder = {
            eq(column, value) {
              filters.push([column, value]);
              return builder;
            },
            maybeSingle: run,
          };
          return builder;
        },
        update(values) {
          const filters = [];
          const builder = {
            eq(column, value) {
              filters.push([column, value]);
              return builder;
            },
            async select() {
              calls.push({ kind: "update", values, filters: [...filters] });
              if (missingColumn) return { data: null, error: { code: "PGRST204", message: "no session_version column" } };
              if (beforeUpdate) beforeUpdate(rows);
              const hit = rows.filter((row) => matches(row, filters));
              for (const row of hit) Object.assign(row, values);
              return { data: hit.map((row) => ({ id: row.id })), error: null };
            },
          };
          return builder;
        },
      };
    },
  };
  return { client, calls };
}

test("a token carries the version it was issued at; one without a version counts as 0", async () => {
  const token = await signAdminSessionToken(ADMIN, "super_admin", 4);
  const payload = await verifyAdminSessionToken(token);
  assert.equal(payload?.ver, 4);
  assert.equal(tokenSessionVersion(payload), 4);
  assert.equal(tokenSessionVersion({}), 0, "a token from before the claim");
  assert.equal(tokenSessionVersion({ ver: -1 }), 0);
  assert.equal(tokenSessionVersion({ ver: "4" }), 0);
  assert.equal(tokenSessionVersion({ ver: 1.5 }), 0);
});

test("a session is current only at the row's version; with no column yet every token passes", () => {
  assert.equal(adminSessionIsCurrent(0, 0), true);
  assert.equal(adminSessionIsCurrent(3, 3), true);
  assert.equal(adminSessionIsCurrent(0, 1), false, "signed out after this token was issued");
  assert.equal(adminSessionIsCurrent(2, 1), false);
  assert.equal(adminSessionIsCurrent(0, null), true, "migration not applied: as before");
});

test("ending sessions raises the version by one, conditional on the version read", async () => {
  const rows = [{ id: ADMIN, session_version: 2 }];
  const { client, calls } = fakeAdminUsers(rows);
  assert.equal(await endAdminSessions(client, ADMIN), "ended");
  assert.equal(rows[0].session_version, 3);
  const update = calls.find((call) => call.kind === "update");
  assert.deepEqual(update.values, { session_version: 3 });
  assert.deepEqual(update.filters, [["id", ADMIN], ["session_version", 2]]);
});

test("a raise that loses a race reads again rather than overwriting the other raise", async () => {
  const rows = [{ id: ADMIN, session_version: 0 }];
  let raced = false;
  const { client } = fakeAdminUsers(rows, {
    beforeUpdate(all) {
      if (raced) return;
      raced = true;
      all[0].session_version += 1; // another sign-out landed between the read and the update
    },
  });
  assert.equal(await endAdminSessions(client, ADMIN), "ended");
  assert.equal(rows[0].session_version, 2, "both raises count; neither is lost");
});

test("no column yet: nothing is ended, the read falls back, and a new token is issued at 0", async () => {
  const rows = [{ id: ADMIN, role: "super_admin", is_active: true }];
  const { client } = fakeAdminUsers(rows, { missingColumn: true });
  assert.equal(await endAdminSessions(client, ADMIN), "unavailable");
  const { row, version } = await readAdminWithSessionVersion(client, ADMIN, "id, role, is_active");
  assert.deepEqual(row, { id: ADMIN, role: "super_admin", is_active: true });
  assert.equal(version, null);
  assert.equal(await currentAdminSessionVersion(client, ADMIN), 0);
});

test("any other read error refuses the session and fails the sign-in closed", async () => {
  const { client } = fakeAdminUsers([{ id: ADMIN, session_version: 0 }], { failSelect: { code: "57014", message: "timeout" } });
  const { row } = await readAdminWithSessionVersion(client, ADMIN, "id, role, is_active");
  assert.equal(row, null);
  assert.equal(await currentAdminSessionVersion(client, ADMIN), "error");
  assert.equal(await endAdminSessions(client, ADMIN), "error");
});

test("an unknown admin is not_found", async () => {
  const { client } = fakeAdminUsers([]);
  assert.equal(await endAdminSessions(client, ADMIN), "not_found");
});

test("every staff request checks the version: the API gate, the page gate and the sign-in", async () => {
  for (const path of ["lib/adminAuth/requireAdminRole.ts", "lib/adminAuth/getCurrentAdmin.ts"]) {
    const source = await read(path);
    assert.match(source, /readAdminWithSessionVersion/, path);
    assert.match(source, /if \(!adminSessionIsCurrent\(tokenSessionVersion\(session\), version\)\) return null;/, path);
  }
  const verify = await read("app/api/admin/auth/verify-2fa/route.ts");
  assert.match(verify, /signAdminSessionToken\(admin\.id, admin\.role, sessionVersion\)/);
  assert.ok(verify.indexOf("currentAdminSessionVersion(") < verify.indexOf("signAdminSessionToken("));
});

test("signing out ends the sessions on the server, only from a live session", async () => {
  const admin = await read("app/api/admin/auth/logout/route.ts");
  assert.match(admin, /const session = await resolveAdminContext\(\);/);
  assert.match(admin, /endAdminSessions\(/);
  assert.ok(!admin.includes("getAdminSession"), "a stale cookie must not be able to sign its owner out");
  const partner = await read("app/api/partner/auth/logout/route.ts");
  assert.match(partner, /const context = await resolvePartnerContext\(\);/);
  assert.match(partner, /update\(\{ session_version: current\.data\.session_version \+ 1 \}\)/);
  assert.match(partner, /\.eq\("session_version", current\.data\.session_version\)/);
});

test("a super admin can end another admin's sessions; deactivating or reactivating ends them too", async () => {
  const route = await read("app/api/admin/admins/[id]/sessions/route.ts");
  assert.match(route, /requireAdminRole\(\["super_admin"\]\)/);
  assert.match(route, /if \(id === auth\.session\.sub\)/);
  assert.match(route, /action: "admin\.sessions_ended"/);
  const patch = await read("app/api/admin/admins/[id]/route.ts");
  assert.match(patch, /changes\.is_active === undefined\s*\? undefined\s*: \(await endAdminSessions\(/);
  const migration = await read("supabase/migrations/20261117200000_admin_session_version.sql");
  assert.match(migration, /add column if not exists session_version integer not null default 0;/);
});
