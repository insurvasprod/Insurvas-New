// Servicing as list → request page → tabs (SvA, 2026-11-05): no side panel, no step pop-up, pages instead.
// Run with: node --experimental-strip-types --test lib/retention/servicingPages.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (path) => readFileSync(join(process.cwd(), path), "utf8");
const BOARD = "components/app/servicing-board.tsx";
const REQUEST_PAGE = "app/app/(shell)/servicing/[id]/page.tsx";
const NEW_PAGE = "app/app/(shell)/servicing/new/page.tsx";
const VIEW = "components/app/retention/servicing-request-view.tsx";
const SHARED = "components/app/retention/servicing-shared.ts";
const SEARCH_API = "app/api/app/retention/servicing/policies/route.ts";

test("the list has no side panel, no step pop-up and no new-request pop-up", () => {
  const board = read(BOARD);
  assert.doesNotMatch(board, /DetailPanel/);
  assert.doesNotMatch(board, /StepDialog/);
  assert.doesNotMatch(board, /StartDialog/);
  assert.doesNotMatch(board, /ServicingRequestDialog/);
  assert.doesNotMatch(board, /from "@\/components\/ui\/dialog"/, "the only pop-up left is the cancel confirm");
});

test("the list links to the request, its step, Try again and New request", () => {
  const board = read(BOARD);
  assert.match(board, /href=\{`\/app\/servicing\/\$\{r\.id\}`\}/);
  assert.match(board, /href=\{`\/app\/servicing\/\$\{r\.id\}\?step=\$\{next\}`\}/);
  assert.match(board, /href=\{tryAgainHref\(r\)\}/);
  // New request moved to the title line so the toolbar fits one line (critique E2, 2026-11-05).
  assert.match(read("app/app/(shell)/servicing/page.tsx"), /href="\/app\/servicing\/new">New request</);
  assert.match(read(SHARED), /\/app\/servicing\/new\?carrier=\$\{r\.carrierId\}&policy=\$\{encodeURIComponent\(r\.policyNumber\)\}&type=\$\{r\.type\}/);
});

test("the list's view follows the address and every tile is a link", () => {
  const board = read(BOARD);
  assert.match(board, /useSearchParams\(\)/);
  assert.match(board, /asView\(params\.get\("status"\)\)/);
  assert.doesNotMatch(board, /initialStatus/);
  // Round 3 (owner 2026-11-06): the risk cards are the views, each a link (href: viewHref(…)).
  assert.match(board, /<RiskCards /);
  assert.match(board, /href: viewHref\(/);
});

test("cancelling asks why, with named buttons, and steps to cancelled", () => {
  const view = read(VIEW);
  assert.match(view, /<ConfirmDialog/);
  assert.match(view, /cancelLabel="Keep the request"/);
  assert.match(view, /confirmLabel=\{busy \? "Cancelling…" : "Cancel the request"\}/);
  assert.match(view, /confirmDisabled=\{why\.trim\(\)\.length < 3\}/);
  assert.match(view, /to: "cancelled", note: why\.trim\(\)/);
  assert.match(read(BOARD), /<CancelRequestDialog/);
});

test("the request page: the Retention frame, the list's gates, tabs and notFound", () => {
  const page = read(REQUEST_PAGE);
  assert.match(page, /<RetentionPage\s+step="servicing"/);
  assert.match(page, /guardPage\("payment_repair"\)/);
  assert.match(page, /actAsPage\(guard, \["owner", "producer", "retention"\]\)/);
  assert.match(page, /scope: await scopeFor\(guard\.context\)/);
  assert.match(page, /await loadRequest\(viewer, id\)/);
  assert.match(page, /if \(!r\) notFound\(\)/);
  assert.match(page, /retentionTrail\("servicing", name\)/);
  assert.match(page, /readOnly \? undefined :/, "read-only: no actions");
  for (const label of ["Progress", "Change", "Notes"]) assert.match(page, new RegExp(`label: "${label}"`));
  assert.match(page, /No note/);
  assert.match(page, /params: Promise<\{ id: string \}>/, "Next 16: params is a Promise");
});

test("the store reads one request with the list's visibility", () => {
  const store = read("lib/retention/servicingStore.ts");
  assert.match(store, /export async function loadRequest\(viewer: Viewer, id: string\): Promise<ServicingRequest \| null>/);
  assert.match(store, /if \(!\(await policyVisibleTo\(viewer, r\.carrier_id, r\.policy_number\)\)\) return null;/);
  assert.match(store, /export async function searchPolicies\(viewer: Viewer, raw: string\): Promise<PolicyMatch\[\]>/);
  assert.match(store, /\.slice\(0, 20\)/);
});

test("the step form: the old dialog's fields, and the confirmed-on day is the local one", () => {
  const view = read(VIEW);
  for (const label of ["How", "Their reference", "Form used", "Takes effect by", "They said it was done on"]) assert.match(view, new RegExp(`label="${label}"`));
  assert.match(view, /This is what you were told\. The request closes only when a carrier file shows the change\./);
  assert.match(view, /useState\(\(\) => localDay\(\)\)/);
  assert.doesNotMatch(view, /toISOString/);
  const shared = read(SHARED);
  assert.match(shared, /getFullYear\(\)/);
  assert.match(shared, /getMonth\(\) \+ 1/);
  assert.match(shared, /getDate\(\)/);
  assert.match(view, /router\.replace\(back\)/);
});

test("the new-request page uses the shared request form and refuses read-only", () => {
  const page = read(NEW_PAGE);
  assert.match(page, /guardPage\("payment_repair"\)/);
  assert.match(page, /access === "read_only"/);
  assert.match(page, /<RetentionPage step="servicing"/);
  const flow = read("components/app/retention/servicing-new-request.tsx");
  assert.match(flow, /<ServicingRequestForm/);
  assert.match(flow, /origin="client_request"/);
  assert.match(flow, /fromQueue=\{false\}/);
  // The search moved into the shared PolicyPicker (2026-11-05, also used by Retention › New case).
  assert.match(flow, /<PolicyPicker /);
  assert.match(read("components/app/retention/policy-picker.tsx"), /\/api\/app\/retention\/servicing\/policies\?q=/);
  assert.match(flow, /<ToggleChip/);
});

test("the policy search API refuses without the feature role and is read only", () => {
  const api = read(SEARCH_API);
  assert.match(api, /requireFeatureRole\("payment_repair", ROLES/);
  assert.match(api, /const ROLES = \["owner", "producer", "retention"\] as const;/);
  assert.match(api, /if \(auth instanceof NextResponse\) return auth;/);
  assert.match(api, /scope: await scopeFor\(auth\.context\)/);
  assert.doesNotMatch(api, /export async function (POST|PUT|PATCH|DELETE)/);
  const getAt = api.indexOf("export async function GET");
  assert.ok(getAt > 0 && api.indexOf("requireFeatureRole(", getAt) < api.indexOf("searchPolicies(", getAt), "the role is checked before any read");
});
