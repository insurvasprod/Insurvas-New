import assert from "node:assert/strict";
import test from "node:test";

import { claimTotpStep, isMissingTotpStepColumn } from "./totpReplay.ts";

const ADMIN = "00000000-0000-4000-8000-000000000001";

/**
 * A stand-in for PostgREST's `update ... where ... returning` on admin_users. The WHERE clause is
 * evaluated when the statement runs (at `select`), against the row as it is at that moment, and
 * the write is applied in the same tick — the way Postgres re-checks a conditional update against
 * the committed row when two updates race. Only the filters claimTotpStep uses are understood.
 */
function fakeAdminUsers(rows, { missingColumn = false, failWith = null } = {}) {
  const statements = [];
  const client = {
    from(table) {
      assert.equal(table, "admin_users");
      return {
        update(values) {
          const filters = { eq: [], or: null };
          const builder = {
            eq(column, value) {
              filters.eq.push([column, value]);
              return builder;
            },
            or(expression) {
              filters.or = expression;
              return builder;
            },
            async select(columns) {
              assert.equal(columns, "id");
              await Promise.resolve(); // let a concurrent claim start before this one runs
              statements.push({ values, filters });
              if (failWith) return { data: null, error: failWith };
              if (missingColumn) {
                return { data: null, error: { code: "42703", message: 'column admin_users.last_totp_step does not exist' } };
              }
              const alternatives = filters.or.split(",").map((part) => {
                const [column, op, operand] = part.split(".");
                assert.equal(column, "last_totp_step");
                if (op === "is" && operand === "null") return (row) => row.last_totp_step === null;
                if (op === "lt") return (row) => row.last_totp_step !== null && row.last_totp_step < Number(operand);
                throw new Error(`unsupported filter ${part}`);
              });
              const matched = rows.filter(
                (row) => filters.eq.every(([c, v]) => row[c] === v) && alternatives.some((matches) => matches(row)),
              );
              for (const row of matched) Object.assign(row, values);
              return { data: matched.map((row) => ({ id: row.id })), error: null };
            },
          };
          return builder;
        },
      };
    },
  };
  return { client, statements };
}

test("the first code an admin ever uses is accepted and becomes the last accepted step", async () => {
  const rows = [{ id: ADMIN, last_totp_step: null }];
  const { client } = fakeAdminUsers(rows);
  assert.equal(await claimTotpStep(client, ADMIN, 59_000_000), "claimed");
  assert.equal(rows[0].last_totp_step, 59_000_000);
});

test("the same code again is refused as a replay", async () => {
  const rows = [{ id: ADMIN, last_totp_step: null }];
  const { client } = fakeAdminUsers(rows);
  assert.equal(await claimTotpStep(client, ADMIN, 59_000_000), "claimed");
  assert.equal(await claimTotpStep(client, ADMIN, 59_000_000), "replayed");
  assert.equal(rows[0].last_totp_step, 59_000_000);
});

test("a code from an earlier step than the last accepted one is refused (the drift window)", async () => {
  const rows = [{ id: ADMIN, last_totp_step: 59_000_001 }];
  const { client } = fakeAdminUsers(rows);
  assert.equal(await claimTotpStep(client, ADMIN, 59_000_000), "replayed");
  assert.equal(rows[0].last_totp_step, 59_000_001, "a refused claim does not move the step");
});

test("a newer step is accepted", async () => {
  const rows = [{ id: ADMIN, last_totp_step: 59_000_000 }];
  const { client } = fakeAdminUsers(rows);
  assert.equal(await claimTotpStep(client, ADMIN, 59_000_001), "claimed");
  assert.equal(rows[0].last_totp_step, 59_000_001);
});

test("two concurrent verifies with the same code: exactly one passes", async () => {
  const rows = [{ id: ADMIN, last_totp_step: null }];
  const { client } = fakeAdminUsers(rows);
  const results = await Promise.all([
    claimTotpStep(client, ADMIN, 59_000_000),
    claimTotpStep(client, ADMIN, 59_000_000),
  ]);
  assert.deepEqual([...results].sort(), ["claimed", "replayed"]);
});

test("the compare and the set are one conditional update, scoped to the admin", async () => {
  const rows = [
    { id: ADMIN, last_totp_step: null },
    { id: "00000000-0000-4000-8000-000000000002", last_totp_step: null },
  ];
  const { client, statements } = fakeAdminUsers(rows);
  await claimTotpStep(client, ADMIN, 59_000_000);
  assert.equal(statements.length, 1, "no separate read before the write");
  assert.deepEqual(statements[0].values, { last_totp_step: 59_000_000 });
  assert.deepEqual(statements[0].filters.eq, [["id", ADMIN]]);
  assert.equal(statements[0].filters.or, "last_totp_step.is.null,last_totp_step.lt.59000000");
  assert.equal(rows[1].last_totp_step, null, "another admin's step is untouched");
});

test("before 20260924364000 is applied the check is skipped, not failed", async () => {
  const { client } = fakeAdminUsers([{ id: ADMIN }], { missingColumn: true });
  assert.equal(await claimTotpStep(client, ADMIN, 59_000_000), "unavailable");
  assert.equal(isMissingTotpStepColumn({ code: "PGRST204", message: "Could not find the 'last_totp_step' column" }), true);
  assert.equal(isMissingTotpStepColumn({ code: "42703", message: "column does not exist" }), true);
  assert.equal(isMissingTotpStepColumn({ code: "57014", message: "canceling statement" }), false);
  assert.equal(isMissingTotpStepColumn(null), false);
});

test("any other database error is reported as an error, so the route fails closed", async () => {
  const { client } = fakeAdminUsers([{ id: ADMIN, last_totp_step: null }], {
    failWith: { code: "57014", message: "canceling statement due to statement timeout" },
  });
  assert.equal(await claimTotpStep(client, ADMIN, 59_000_000), "error");
});

test("a step that is not a safe non-negative integer is never put in the filter", async () => {
  const { client, statements } = fakeAdminUsers([{ id: ADMIN, last_totp_step: null }]);
  assert.equal(await claimTotpStep(client, ADMIN, 1.5), "error");
  assert.equal(await claimTotpStep(client, ADMIN, -1), "error");
  assert.equal(await claimTotpStep(client, ADMIN, Number.NaN), "error");
  assert.equal(statements.length, 0);
});
