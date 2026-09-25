// Run with: npm test
//
// A callback scheduled from the dialer was never scheduled.
//
// The agent pressed one of seven plain buttons, which posted `{ disposition: "callback_scheduled" }`
// with no time. The lead went to `lead_state = 'working'`, the work item to `completed`, and NO
// `tenant_callbacks` row was written — the endpoint had no time to write one with. The lead then
// matched none of `serve_next_lead`'s six tiers and had no row on the Callbacks screen, so nothing
// would ever surface it again. Meanwhile the call history displayed "Callback scheduled".
//
// Measured on the live project 2026-09-23: 0 callbacks on the tenant immediately after doing it.
//
// The fix reuses the disposition wizard's validation and callback write, wrapped around the
// dialer's own function so the call is still recorded. Three things have to stay true, and the
// third is the one that would rot quietly.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (...parts) => readFileSync(join(root, ...parts), "utf8");
const migrations = join(root, "supabase", "migrations");

function latestDefinitionOf(name) {
  const files = readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort();
  const needle = `create or replace function public.${name}(`;
  for (let i = files.length - 1; i >= 0; i -= 1) {
    const text = readFileSync(join(migrations, files[i]), "utf8");
    const start = text.indexOf(needle);
    if (start === -1) continue;
    return { file: files[i], body: text.slice(start, text.indexOf("$function$;", start)) };
  }
  return null;
}

test("the dialer's callback path actually writes a callback", () => {
  const fn = latestDefinitionOf("complete_dial_disposition_with_callback");
  assert.ok(fn, "complete_dial_disposition_with_callback is gone; the dialer would book nothing again");
  assert.match(fn.body, /insert into public\.tenant_callbacks/, "it no longer creates a callback row");
  assert.match(fn.body, /insert into public\.callback_history/, "the callback history entry is gone");
});

test("it still records the call", () => {
  // Booking a callback must not cost the lead nothing. The dialer's own function is what stamps the
  // attempt's disposition and increments attempts_made; routing around it would schedule the
  // callback and leave the call itself unrecorded.
  const fn = latestDefinitionOf("complete_dial_disposition_with_callback");
  assert.match(
    fn.body,
    /complete_existing_dial_disposition/,
    "the call attempt is no longer dispositioned, so a booked callback would cost no attempt",
  );
});

test("it validates exactly as strictly as the wizard", () => {
  // The wizard refuses a past time, an unreal timezone and a non-member assignee. A second path
  // that accepts what the first refuses is how two callers end up with two different rules, and the
  // looser one wins by being easier to reach.
  const fn = latestDefinitionOf("complete_dial_disposition_with_callback");
  for (const code of ["CALLBACK_DATE_REQUIRED", "CALLBACK_DATE_PAST", "CALLBACK_TIMEZONE_INVALID", "CALLBACK_ASSIGNEE_INVALID"]) {
    assert.match(fn.body, new RegExp(code), `${code} is no longer enforced on the dialer path`);
  }
});

test("the route refuses callback_scheduled with no time", () => {
  // This is the assertion that matters most. Without it the old behaviour returns exactly as it
  // was — accepted, no callback, lead stranded — and nothing fails anywhere.
  const route = read("app", "api", "app", "dialer", "attempt", "[id]", "disposition", "route.ts");
  assert.match(route, /callback_time_required/, "a callback with no time is accepted again");
  assert.match(route, /recordCallbackDisposition/, "the route no longer routes callbacks to the booking path");
});

test("the dialer offers a time before it submits", () => {
  const ui = read("components", "app", "dialer-workspace.tsx");
  assert.match(ui, /pendingCallback/, "the callback button submits immediately again, with no time");
  assert.match(ui, /datetime-local/, "there is no time picker");
  // The customer's timezone, not the agent's. The panel already derives it from the lead's state,
  // and reading the agent's clock instead would book "2pm" in the wrong hour.
  assert.match(
    ui,
    /customer_timezone: eligibility\?\.timezone/,
    "the callback is booked against something other than the customer's own timezone",
  );
});
