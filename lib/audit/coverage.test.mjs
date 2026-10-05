/**
 * Every write route on the admin API leaves an audit trail.
 *
 * SA-0.3's second criterion is "every write route added in SA-1, SA-2 and SA-3 produces exactly one
 * audit row". Two halves, and only one of them can be checked without a database:
 *
 *   - **Exactly one** is behavioural. Verified by probe on 2026-09-21 for create, activate,
 *     suspend, unsuspend and deactivate — each added precisely one row.
 *   - **At all** is structural, and that is what this test holds. A new admin write route that
 *     forgets to audit is the easy mistake, and it is invisible until somebody asks who changed
 *     something and the log has no answer.
 *
 * The audit log is append-only by database privilege (`UPDATE` and `DELETE` are revoked even from
 * `service_role`, verified directly), so a row that was never written can never be added later.
 * A gap here is permanent.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ADMIN_API = join(fileURLToPath(new URL("../../", import.meta.url)), "app", "api", "admin");

const WRITE_METHOD = /export\s+(?:async\s+)?function\s+(POST|PATCH|PUT|DELETE)\b/g;
const CALLS_AUDIT = /\baudit\(/;

/**
 * Routes that audit through a shared helper instead of calling `audit()` themselves.
 *
 * Each of these is one line that hands the whole operation to `setUserStatus`, which authorises,
 * applies the transition and writes the audit row in one place — deliberately, so the four
 * lifecycle routes cannot drift apart. Verified by probe: each writes exactly one row.
 */
const AUDITS_VIA_HELPER = {
  "users/[id]/activate/route.ts": "setUserStatus()",
  "users/[id]/deactivate/route.ts": "setUserStatus()",
  "users/[id]/suspend/route.ts": "setUserStatus()",
  "users/[id]/unsuspend/route.ts": "setUserStatus()",
  // LA-3.13 · platform field maps: every write goes through lib/extension/maps.ts, which audits.
  "field-maps/route.ts": "lib/extension/maps.ts auditMap()",
  "field-maps/[id]/route.ts": "lib/extension/maps.ts auditMap()",
  "field-maps/[id]/publish/route.ts": "lib/extension/maps.ts auditMap()",
  "field-maps/[id]/versions/route.ts": "lib/extension/maps.ts auditMap()",
};

/**
 * Write routes that legitimately write no audit row, with the reason.
 *
 * Deliberately narrow. "It is only a read-ish write" is not a reason; the test is here because
 * that argument is always available and usually wrong.
 */
const NO_AUDIT_EXPECTED = {
  "auth/login/route.ts": "records a login_event; the audit row is written by verify-2fa, where the login actually succeeds",
  "auth/verify-2fa/route.ts": "writes admin.login itself — listed only because the matcher sees the route, not the call order",
  "notifications/route.ts": "POST only records that this admin has seen their own bell items (admin_notification_reads, keyed by the session's admin id); no customer, billing or platform record changes, and the events themselves are already audit rows or trial state — matching the agent and partner planes, whose mark-read is not audited either",
};

function routeFiles(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) routeFiles(path, found);
    else if (entry.name === "route.ts") found.push(path);
  }
  return found;
}

const writeRoutes = routeFiles(ADMIN_API)
  .map((path) => ({
    route: path.slice(path.indexOf(`api${sep}admin`) + `api${sep}admin${sep}`.length).split(sep).join("/"),
    source: readFileSync(path, "utf8"),
  }))
  .filter(({ source }) => {
    WRITE_METHOD.lastIndex = 0;
    return WRITE_METHOD.test(source);
  })
  .sort((a, b) => a.route.localeCompare(b.route));

test("every admin write route leaves an audit trail", () => {
  const silent = writeRoutes
    .filter(({ source }) => !CALLS_AUDIT.test(source))
    .map(({ route }) => route)
    .filter((route) => !(route in AUDITS_VIA_HELPER));

  assert.deepEqual(
    silent.filter((route) => !(route in NO_AUDIT_EXPECTED)),
    [],
    "NEW admin write route(s) with no audit trail. Call audit(...) on the success path, or — if the " +
      "operation genuinely changes nothing worth recording — add it to NO_AUDIT_EXPECTED with the " +
      "reason. The audit log cannot be backfilled: UPDATE and DELETE are revoked on it, so a row " +
      "that was never written is gone for good.",
  );

  // Both allowlists must stay current, or they quietly stop being allowlists.
  for (const [name, known] of [["AUDITS_VIA_HELPER", AUDITS_VIA_HELPER], ["NO_AUDIT_EXPECTED", NO_AUDIT_EXPECTED]]) {
    assert.deepEqual(
      Object.keys(known).filter((route) => !writeRoutes.some((r) => r.route === route)),
      [],
      `${name} lists route(s) that no longer exist as write routes — delete those entries.`,
    );
  }
});

test("the scan actually found the admin write surface", () => {
  // A matcher that finds nothing passes the assertion above.
  assert.ok(writeRoutes.length > 25, `expected >25 admin write routes, found ${writeRoutes.length}`);
  assert.ok(
    writeRoutes.some(({ source }) => CALLS_AUDIT.test(source)),
    "no write route matched the audit() pattern — the helper was probably renamed, so this guard is blind",
  );
});
