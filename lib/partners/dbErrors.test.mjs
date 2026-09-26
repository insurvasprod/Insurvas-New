import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { friendlyPartnerDbError } = await import("./dbErrors.ts");

test("W3.1: a not-null refusal names the field instead of the column", () => {
  assert.equal(
    friendlyPartnerDbError('null value in column "contact_name" of relation "partners" violates not-null constraint'),
    "Contact name is required.",
  );
  assert.equal(friendlyPartnerDbError('null value in column "notes" of relation "partners" violates not-null constraint'), "Notes is required.");
});

test("W3.1: every constraint shape answers in words", () => {
  assert.equal(friendlyPartnerDbError('new row for relation "partners" violates check constraint "partners_contact_name_length"'), "Contact name must be 200 characters or fewer.");
  assert.match(friendlyPartnerDbError('new row for relation "partners" violates check constraint "partners_something_else"'), /not valid/);
  assert.match(friendlyPartnerDbError('duplicate key value violates unique constraint "partners_organization_id_slug_key"'), /already exists/);
  assert.match(friendlyPartnerDbError('insert or update on table "partners" violates foreign key constraint "partners_created_by_fkey"'), /no longer exists/);
  assert.match(friendlyPartnerDbError("value too long for type character varying(200)"), /too long/);
  assert.match(friendlyPartnerDbError('column "x" of relation "partners" does not exist'), /could not be saved/);
  for (const raw of ['null value in column "a" of relation "partners"', 'violates check constraint "z"']) {
    assert.doesNotMatch(friendlyPartnerDbError(raw), /relation|constraint|column/);
  }
});

test("app-raised codes are left to the route", () => {
  assert.equal(friendlyPartnerDbError("partner_limit_reached:max_affiliates:3:3"), null);
  assert.equal(friendlyPartnerDbError("invalid_partner_transition:paused:draft"), null);
  assert.equal(friendlyPartnerDbError("offboard_confirmation_required"), null);
});

test("both partner write routes pass refusals through the helper", () => {
  for (const path of ["app/api/app/partners/route.ts", "app/api/app/partners/[id]/route.ts"]) {
    assert.match(readFileSync(path, "utf8"), /friendlyPartnerDbError\(message\)/, path);
  }
});
