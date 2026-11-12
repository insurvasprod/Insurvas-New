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

// Round 7, owner pick 2·A, 2026-11-10 (docs/la4/mockups-r7/retention.html, boards 2·A–2·4): the six cards went for
// tabs on the title line; no buttons or menus in a row (each row opens its request); Mark sent and Check it are md
// dialogs on the request page, whose title line holds ‹ ›, the primary by state and ⋯. These replace the SvA
// (2026-11-05) pins on the cards, the row's buttons and the step form beside the timeline.

test("the list has no side panel, no pop-up and nothing to decide in a row", () => {
  const board = read(BOARD);
  assert.doesNotMatch(board, /DetailPanel/);
  assert.doesNotMatch(board, /StepDialog/);
  assert.doesNotMatch(board, /StartDialog/);
  assert.doesNotMatch(board, /ServicingRequestDialog/);
  assert.doesNotMatch(board, /from "@\/components\/ui\/dialog"/);
  assert.doesNotMatch(board, /CancelRequestDialog|MoreMenu|<Button asChild variant=/, "Mark sent, Try again and ⋯ Cancel left the row (2·A)");
  assert.doesNotMatch(board, /<RiskCards /, "the six cards went (2·A)");
});

test("each row opens its request; the policy and the case stay links; the next step is words", () => {
  const board = read(BOARD);
  assert.match(board, /<LinkRow href=\{href\}/);
  assert.match(board, /const href = requestHref\(r\.id, view\)/);
  assert.match(board, /href=\{policyHref\(r\)\}/);
  // One-line rows (owner 2026-11-11): the "From a Retention case" sub-line left the row; the request page's From tile links the case.
  assert.doesNotMatch(board, />From a Retention case</);
  assert.match(read("app/app/(shell)/servicing/[id]/page.tsx"), /href=\{r\.caseId \? `\/app\/retention\/\$\{r\.caseId\}` : undefined\}/);
  assert.match(board, /\{next\} ›/);
  const shared = read(SHARED);
  assert.match(shared, /NEXT_WORDS[^\n]*check: "Check it", send: "Send it", failed: "Try again"/);
  assert.match(shared, /\/app\/servicing\/new\?carrier=\$\{r\.carrierId\}&policy=\$\{encodeURIComponent\(r\.policyNumber\)\}&type=\$\{r\.type\}/);
});

test("the list's tabs are on the title line, the ?status= address, with counts red where a person is needed", () => {
  const board = read(BOARD);
  assert.match(board, /useSearchParams\(\)/);
  assert.match(board, /asServicingView\(params\.get\("status"\)\)/);
  const page = read("app/app/(shell)/servicing/page.tsx");
  assert.match(page, /<ViewTabs/);
  assert.match(page, /tabs=\{tabs\}/);
  assert.match(page, /tone: b\.key === "check" \|\| b\.key === "send" \? \("danger" as const\)/);
  assert.match(page, /href="\/app\/servicing\/new">New request</);
  assert.match(page, /Paused while the account is read-only\./, "read-only: New request stays, paused (2·4)");
  assert.doesNotMatch(page, /facts=|chip=/, "the title stands alone");
  for (const label of ["Check it", "Send it", "Waiting", "Not in the file", "Proven", "Cancelled"]) assert.match(read(SHARED), new RegExp(`label: "${label}"`));
  assert.match(read(SHARED), /title: "Nothing to check", hint: "A request lands here when the carrier's file doesn't show the change by its date\."/);
});

test("cancelling is the shared confirm, in board 2·2's words, and steps to cancelled", () => {
  const view = read(VIEW);
  assert.match(view, /<ConfirmDialog/);
  assert.match(view, /title="Cancel the request\?"/);
  assert.match(view, /cancelLabel="Keep the request"/);
  assert.match(view, /confirmLabel=\{busy \? "Cancelling…" : "Cancel the request"\}/);
  assert.match(view, /stops being tracked\. Nothing is sent to the carrier\./);
  assert.match(view, /to: "cancelled"/);
  assert.match(view, /notify\.done\("Cancelled\."\)/);
});

test("the request page: the Retention frame, the list's gates, the title alone, tabs, ‹ › and notFound", () => {
  const page = read(REQUEST_PAGE);
  assert.match(page, /<RetentionPage step="servicing" title=\{name\}/);
  assert.doesNotMatch(page, /facts=|chip=/, "the title stands alone");
  assert.match(page, /guardPage\("payment_repair"\)/);
  assert.match(page, /actAsPage\(guard, \["owner", "producer", "retention"\]\)/);
  assert.match(page, /scope: await scopeFor\(guard\.context\)/);
  assert.match(page, /loadRequest\(viewer, id\)/);
  assert.match(page, /loadServicing\(viewer, \{ verify: false \}\)/);
  assert.match(page, /if \(!r\) notFound\(\)/);
  assert.match(page, /retentionTrail\("servicing", name\)/);
  for (const label of ["Request", "Policy", "History"]) assert.match(page, new RegExp(`label: "${label}"`));
  assert.match(page, /<ChevronLeft aria-hidden="true" \/>\{neighbour\(previous\)\}/);
  assert.match(page, /\{neighbour\(next\)\}<ChevronRight aria-hidden="true" \/>/);
  assert.match(page, /<StatStrip /);
  assert.match(page, /Where it stands/);
  assert.match(page, /No notes yet/);
  assert.match(page, /params: Promise<\{ id: string \}>/, "Next 16: params is a Promise");
});

test("the title line by state, and ⋯ (2·1); read-only keeps only ⋯ › Open the policy (2·4)", () => {
  const view = read(VIEW);
  assert.match(view, /primary === "send" && <StepButton step="send" label="Mark sent" \/>/);
  assert.match(view, /primary === "check" && <StepButton step="check" label="Check it" \/>/);
  assert.match(view, /primary === "failed" && <Button asChild><Link href=\{tryAgainHref\}>Try again<\/Link><\/Button>/);
  assert.match(view, /!readOnly && cancellable && \{ label: "Cancel the request"/);
  assert.match(view, /\{ label: "Open the policy", href: policyHref \}/);
  assert.match(view, /!readOnly && caseHref && \{ label: "Open the case"/);
});

test("the store reads one request with the list's visibility", () => {
  const store = read("lib/retention/servicingStore.ts");
  assert.match(store, /export async function loadRequest\(viewer: Viewer, id: string\): Promise<ServicingRequest \| null>/);
  assert.match(store, /if \(!\(await policyVisibleTo\(viewer, r\.carrier_id, r\.policy_number\)\)\) return null;/);
  assert.match(store, /export async function searchPolicies\(viewer: Viewer, raw: string\): Promise<PolicyMatch\[\]>/);
  assert.match(store, /\.slice\(0, 20\)/);
});

test("Mark sent and Check it are md dialogs with the request's fields, an error line and 2·2's toasts", () => {
  const view = read(VIEW);
  assert.match(view, /<DialogContent size="md">/);
  for (const label of ["How you asked", "Their reference", "Form used", "Takes effect by", "They said it was done on"]) assert.match(view, new RegExp(`label="${label}"`));
  assert.match(view, /\{`Mark \$\{facts\.name\}'s request sent`\}/);
  assert.match(view, /\{`What did \$\{facts\.carrierName\} say\?`\}/);
  for (const chip of ["It's done", "Not done yet", "They refused it"]) assert.match(view, new RegExp(`label: "${chip}"`));
  assert.match(view, /This is what you were told\. The request closes only when a carrier file shows the change\./);
  assert.match(view, /<ErrorLine error=\{error\} \/>/);
  assert.doesNotMatch(view, /notify\.(error|fail)/, "an error the person can fix stays on the dialog");
  assert.match(view, /notify\.done\("Sent\. It stays open until a carrier file shows the change\."\)/);
  assert.match(view, /notify\.done\("Noted\. It stays open until a carrier file shows the change\."\)/);
  assert.match(view, /useState\(\(\) => localDay\(\)\)/);
  assert.doesNotMatch(view, /toISOString/);
  const shared = read(SHARED);
  assert.match(shared, /getFullYear\(\)/);
  assert.match(shared, /getMonth\(\) \+ 1/);
  assert.match(shared, /getDate\(\)/);
  assert.match(view, /router\.replace\(back, \{ scroll: false \}\)/);
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
  // Round 7, owner pick 2·3, 2026-11-10: the saves are on the title line; leaving with changes asks first.
  assert.match(page, /actions=\{<StepSlotTarget id=\{NEW_REQUEST_SLOT\} \/>\}/);
  assert.match(flow, /slot=\{NEW_REQUEST_SLOT\}/);
  const form = read("components/app/retention/servicing-request-form.tsx");
  assert.match(form, /<StepSlot id=\{slot\}>/);
  assert.match(form, /Save, send later/);
  assert.match(form, /Record as sent/);
  assert.match(form, /<LeaveGuard /);
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
