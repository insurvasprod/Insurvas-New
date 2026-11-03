// Run with: npm test
//
// LA-1.2 "Partner users & portal access", agency side. The routes under
// app/api/app/partners/[id]/users existed with no UI calling them, so a partner created in the
// agent app had no way to get its first partner admin. This pins the wiring in
// components/app/partner-users-panel.tsx: it calls the invite, resend and status routes, and every
// refusal the reader sees is the route's own `body.error` (seat limit, agency account, duplicate
// email, a partner that is gone).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const panel = read("components/app/partner-users-panel.tsx");
const workspace = read("components/app/partners-workspace.tsx");
const inviteRoute = read("app/api/app/partners/[id]/users/route.ts");
const statusRoute = read("app/api/app/partners/[id]/users/[userId]/route.ts");
const resendRoute = read("app/api/app/partners/[id]/users/[userId]/resend-invite/route.ts");

/** The source of one `async function name(` in the panel, up to the next top-level function in it. */
function fn(name) {
  const start = panel.indexOf(`async function ${name}(`);
  assert.ok(start >= 0, `${name}() exists`);
  const next = panel.slice(start + 1).search(/\n  (?:async )?function \w+\(/);
  return next < 0 ? panel.slice(start) : panel.slice(start, start + 1 + next);
}

test("the agency panel invites through POST /api/app/partners/[id]/users and shows the route's error", () => {
  const invite = fn("submitInvite");
  assert.match(invite, /fetch\(`\/api\/app\/partners\/\$\{partnerId\}\/users`,\s*\{\s*method: "POST"/);
  assert.match(invite, /JSON\.stringify\(\{ name: trimmedName, email: trimmedEmail, role \}\)/);
  assert.match(invite, /setInviteError\(body\?\.error \?\? "Could not send invitation"\)/);
  // The copyable link, because email delivery may be disabled.
  assert.match(invite, /setInvite\(\{\s*url: body\.invite\.url/);
  assert.match(panel, /<PartnerInviteResultPanel result=\{invite\} \/>/);
  // The error is drawn in the dialog, one line, as an alert.
  assert.match(panel, /\{inviteError \? \(\s*<p role="alert"/);
  // The agency can issue either role — the first partner admin comes from here.
  assert.match(panel, /<option value="partner_admin">Partner admin<\/option>/);
  assert.match(panel, /<option value="partner_user">Partner user<\/option>/);
});

test("a chosen reporting line is set through the owner-only admin-assignment route after the invite", () => {
  const invite = fn("submitInvite");
  assert.match(invite, /role === "partner_user" && reportsTo && canAssignAdmin/);
  assert.match(invite, /\/users\/\$\{body\.user\.id\}\/admin-assignment`/);
  assert.match(invite, /assignedBody\?\.error/);
  // The invite route does not accept a reporting line; if it ever does, the panel should send it there.
  assert.doesNotMatch(inviteRoute, /partnerAdminUserId|partner_admin_user_id/);
  assert.match(workspace, /canAssignAdmin=\{canManageProductConfig\}/);
});

test("resend and deactivate/reactivate call their routes and surface body.error", () => {
  const resend = fn("resend");
  assert.match(resend, /\/users\/\$\{member\.user_id\}\/resend-invite`/);
  assert.match(resend, /method: "POST"/);
  assert.match(resend, /notify\.block\(body\?\.error \?\? "Could not resend invitation"\)/);
  assert.match(resend, /setInvite\(/);

  const status = fn("changeStatus");
  assert.match(status, /fetch\(`\/api\/app\/partners\/\$\{partnerId\}\/users\/\$\{member\.user_id\}`,\s*\{\s*method: "PATCH"/);
  assert.match(status, /JSON\.stringify\(\{ action \}\)/);
  assert.match(status, /"deactivate" : "reactivate"/);
  assert.match(status, /notify\.block\(body\?\.error \?\? "Could not change user status"\)/);
  // The PATCH body is the route's schema, not a raw status.
  assert.match(read("lib/partnerAuth/schemas.ts"), /action: z\.enum\(\["deactivate", "reactivate"\]/);
  assert.match(statusRoute, /partnerUserActionSchema/);
  assert.match(resendRoute, /export async function POST/);
});

test("the route errors the panel relays are the ones the routes return", () => {
  assert.match(inviteRoute, /This email belongs to an agency account/);
  assert.match(inviteRoute, /already has partner access or a pending invitation/);
  assert.match(inviteRoute, /partnerLimitBody\("max_partner_users"/);
  assert.match(statusRoute, /partnerLimitBody\("max_partner_users", .*"reactivate"\)/);
});

test("deactivation asks first; write actions are hidden when read-only or offboarded", () => {
  assert.match(panel, /onClick=\{\(\) => setConfirmFor\(member\)\}/);
  assert.match(panel, /<Dialog open=\{confirmFor !== null\}/);
  assert.match(panel, /const canWrite = !readOnly && !offboarded;/);
  assert.match(panel, /\{canWrite \? \(\s*<Button type="button" onClick=\{openInvite\}>/);
  assert.match(panel, /\{canWrite && pending \? \(/);
});

test("the panel follows the list standard and keeps seat usage visible without a page reload", () => {
  assert.match(panel, /<TableCard/);
  assert.match(panel, /<DataToolbar/);
  assert.match(panel, /<RefreshButton onClick=\{\(\) => void load\(\)\}/);
  assert.match(panel, /<SectionLoading/);
  assert.match(panel, /capacityLabel\(seatUsage, seatLimit,/);
  assert.match(workspace, /seatUsage=\{usage\.partnerUsers\}/);
  assert.match(workspace, /seatLimit=\{limits\.max_partner_users\}/);
  // After an action the panel re-reads itself; the page only refreshes its capacity figures.
  assert.match(workspace, /onSeatsChanged=\{\(\) => void refreshCapacity\(\)\}/);
  assert.doesNotMatch(workspace, /onSeatsChanged=\{\(\) => void load\(\)\}/);
});
