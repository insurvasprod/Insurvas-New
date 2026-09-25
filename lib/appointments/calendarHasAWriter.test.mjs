// Run with: npm test
//
// LA-2.11 / LA-2.12 audit, 2026-09-22. Two defects, both of which passed every existing test.
//
// ── 1. Three tables with readers and no writer ─────────────────────────────────────────────────
//
// `tenant_agent_availability`, `tenant_agent_blocks` and `tenant_agent_booking_policy` shipped with
// the calendar migration, were read by `bookableContext` and by `book_appointment`, and were
// written by NOTHING. Measured on the live project: 0 rows in all three.
//
// That is not cosmetic, because every rule reading them is written to skip itself when its row is
// missing. `book_appointment` takes the agent's zone from availability and, finding none, skips the
// working-hours check and the blocked-time check entirely; the daily cap is guarded by
// `if v_policy.max_per_day is not null`; `tenant_member_roster` INNER JOINs availability; the
// reminder job falls back to "UTC" for the agent's zone; and `bookableContext` derives its agent
// list from availability rows, so the dialer's booking card never rendered.
//
// So the absence of an editor quietly unmet LA-2.11 criteria 2 and 3, weakened criterion 6, and
// emptied LA-2.12 criterion 6 — while the SQL enforcing all of them was correct and reviewable.
// A table nothing writes is the shape this audit keeps finding, and it is invisible to a test that
// only reads the SQL.
//
// ── 2. The role that could not reach its own surface ───────────────────────────────────────────
//
// `permissions.ts` granted a setter `dialer.use` from the day the role was added. Every route under
// `app/api/app/dialer/` admitted owners and producers only. The booking panel lives inside that
// dialer, so LA-2.12's whole flow — "setter dials → qualifies → books a slot on Ray's calendar" —
// had no door, even though the booking route itself deliberately admitted setters.
//
// Both halves are pinned below, in both directions.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";

import { rolesWith } from "../tenantAuth/permissions.ts";

const ROOT = process.cwd();
const CALENDAR_TABLES = [
  "tenant_agent_availability",
  "tenant_agent_blocks",
  "tenant_agent_booking_policy",
];
/** The calls that put a row somewhere. A table only these never reach is a table nobody can fill. */
const WRITES = ["insert", "upsert", "update", "delete"];

function sources(dir) {
  const absolute = join(ROOT, dir);
  const found = [];
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    if (["node_modules", ".next"].includes(entry.name)) continue;
    const child = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...sources(child));
    else if ([".ts", ".tsx"].includes(extname(entry.name))) found.push(child);
  }
  return found;
}

const appSources = ["lib", "app", "components"]
  .flatMap(sources)
  .filter((path) => !path.endsWith("database.types.ts"))
  .map((path) => [path.split("\\").join("/"), readFileSync(join(ROOT, path), "utf8")]);

test("every calendar table the booking rules read can also be written", () => {
  const orphans = [];
  for (const table of CALENDAR_TABLES) {
    const writers = appSources.filter(([, source]) =>
      WRITES.some((verb) =>
        // `.from("table")` followed by a write verb, within one statement's worth of characters.
        new RegExp(`from\\(\\s*["'\`]${table}["'\`]\\s*\\)[\\s\\S]{0,200}?\\.${verb}\\(`).test(source),
      ),
    );
    if (writers.length === 0) orphans.push(table);
  }

  assert.deepEqual(
    orphans,
    [],
    `read by the booking rules and written by nothing, so every rule depending on them silently ` +
      `skips itself: ${orphans.join(", ")}`,
  );
});

test("the calendar editor is reachable from the product", () => {
  const byPath = new Map(appSources);
  const route = byPath.get("app/api/app/availability/route.ts");
  assert.ok(route, "the availability route is gone; the three calendar tables have no writer again");

  // A route nothing renders is the same defect one layer up — that is how `book_appointment` sat
  // live and correct with no caller for a whole module.
  const settings = byPath.get("components/app/agent-settings-tabs.tsx");
  assert.ok(settings, "the settings tabs component is gone");
  // The switch arm, not the import. Matching the import passes on a file that imports the editor
  // and renders nothing — which is the unreachable-component defect this test exists to catch.
  assert.match(
    settings,
    /case "calendar": return <CalendarAvailabilitySettings \/>/,
    "no settings tab renders the calendar editor",
  );

  const page = byPath.get("app/app/(shell)/settings/page.tsx");
  assert.ok(page, "the settings page is gone");
  assert.match(page, /tabs=\{SETTINGS_SECTIONS\}/, "the settings page no longer draws its rail from the shared section list");
  assert.match(byPath.get("lib/settings/sections.ts") ?? "", /id: "calendar"/, "the settings page offers no Calendar tab, so the editor has no route to it");

  const editor = byPath.get("components/app/calendar-availability-settings.tsx");
  assert.ok(editor, "the calendar editor component is gone");
  assert.match(editor, /fetch\("\/api\/app\/availability"/, "the editor no longer reads the calendar");
  assert.match(editor, /method: "PUT"/, "the editor no longer saves the calendar");
});

test("a member with no hours is told what that means, not shown an empty week", () => {
  const editor = new Map(appSources).get("components/app/calendar-availability-settings.tsx");
  // The whole defect was invisible because nothing said so. An empty week that looks configured is
  // the same failure in a smaller costume, and this audit has removed several of them already.
  // Asserted against the rendered sentence, not the phrase: the file's own doc comment quotes
  // "No hours set", so a bare match on it is satisfied by the documentation of the thing rather
  // than the thing.
  // Since the settings redesign it is a warning callout: "No hours set" is its title and the
  // consequence is its body, so both halves are asserted as rendered JSX, not as prose.
  assert.match(editor, /title="No hours set">\s+Until they are, an/);
  assert.match(
    editor,
    /booked at any time of day that is legal for the\s+customer/,
    "the empty state no longer says what an unset week actually does",
  );
});

test("the buffer is not claimed to do something it does not do", () => {
  const editor = new Map(appSources).get("components/app/calendar-availability-settings.tsx");
  // Until 20260924120000 `buffer_minutes` was stored and enforced by nothing, and the editor said
  // so. It is now held by the double-booking exclusion constraint itself — each appointment
  // carries the buffer it was booked with and the constraint excludes [start, end + buffer) — so
  // the editor may say "added after each one", and this pins that the database really does it.
  const migration = readFileSync(
    join(ROOT, "supabase", "migrations", "20260924120000_settings_calendar_buffer_same_day_recurring_blocks.sql"),
    "utf8",
  );
  assert.match(migration, /tstzrange\(starts_at_utc, occupied_until_utc, '\[\)'\) with &&/);
  assert.match(migration, /new\.occupied_until_utc := new\.ends_at_utc \+ make_interval\(mins => coalesce\(new\.buffer_minutes, 0\)\)/);
  assert.match(migration, /customer_timezone, notes, buffer_minutes\)/, "book_appointment no longer records the buffer");
  assert.match(editor, /Added after each one, so a/);
});

test("every dialer route admits exactly the roles that hold dialer.use", () => {
  const expected = [...rolesWith("dialer.use")].sort();
  // Identity search is the deliberate exception: LA-2.12's role table forbids a setter from seeing
  // "other setters' leads", and searching the book by name is exactly that. Named here so the
  // exception stays a decision rather than an oversight.
  const EXCEPT = ["app/api/app/dialer/search/route.ts"];

  const routes = appSources.filter(
    ([path]) => path.startsWith("app/api/app/dialer/") && path.endsWith("/route.ts") && !EXCEPT.includes(path),
  );
  assert.ok(routes.length >= 8, `expected the dialer's routes, found ${routes.length} — this guard needs rewriting`);

  const wrong = [];
  for (const [path, source] of routes) {
    const declared = source.match(/const DIALER_ROLES = \[([^\]]*)\]/);
    if (!declared) {
      wrong.push(`${path}: does not use DIALER_ROLES, so its gate is a second copy of the permission map`);
      continue;
    }
    const roles = [...declared[1].matchAll(/"([a-z]+)"/g)].map((match) => match[1]).sort();
    if (roles.join(",") !== expected.join(",")) wrong.push(`${path}: admits ${roles.join("/")}, map says ${expected.join("/")}`);
    if (!/requireFeatureRole\(\s*"outbound_dialing",\s*DIALER_ROLES/.test(source))
      wrong.push(`${path}: declares DIALER_ROLES but does not gate on it`);
  }

  assert.deepEqual(wrong, [], `dialer routes disagree with permissions.ts:\n  ${wrong.join("\n  ")}`);
});

test("the dialer page and its nav entry agree with the same permission", () => {
  const byPath = new Map(appSources);
  const page = byPath.get("app/app/(shell)/dialer/page.tsx");
  assert.ok(page, "the dialer page is gone");
  // Derived, not re-listed. The re-listed version is what kept the setter out for a whole module.
  assert.match(page, /hasTenantPermission\(guard\.role, "dialer\.use"\)/);

  const menu = byPath.get("lib/menu/definition.ts");
  assert.ok(menu, "the menu definition is gone");
  const entry = menu.match(/key: "leads\.dialer"[^}]*required_roles: \[([^\]]*)\]/);
  assert.ok(entry, "the Dialer nav item has no declared roles");
  const navRoles = [...entry[1].matchAll(/"([a-z]+)"/g)].map((match) => match[1]).sort();
  assert.deepEqual(
    navRoles,
    [...rolesWith("dialer.use")].sort(),
    "the Dialer nav entry and permissions.ts disagree, so somebody can reach a page they cannot see",
  );
});

test("a setter is not offered the two dialer controls that would refuse them", () => {
  const workspace = new Map(appSources).get("components/app/dialer-workspace.tsx");
  assert.ok(workspace, "the dialer workspace is gone");
  // Admitting the setter to the dialer would otherwise hand them two controls whose routes answer
  // 403 — `/api/app/outbound/application` and `/api/app/dialer/search` — which is the dead-end
  // pattern this audit has been removing, newly introduced by the fix rather than found.
  assert.match(workspace, /const isSetter = role === "setter"/);
  assert.match(workspace, /\{!isSetter && <form onSubmit=\{\(event\) => void searchLeads\(event\)\}/);
  assert.match(workspace, /\{panel && !readOnly && !isSetter && <Card className="portal-dialer-interested">/);
});
