import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { PARTNER_PAGE_PATHS, asPartnerType, partnerMenu, partnerPageAllowed } from "./portalAccess.ts";

/**
 * Roles board P1–P3 (owner 2026-11-18): the portal by partner type. The menu is drawn from the same
 * rule the pages and routes enforce, so these tests pin the rule, then that each page and route asks it.
 */

const viewer = (type, role = "partner_admin", hasTeam = false) => ({ type, role, hasTeam });
const labels = (menu) => [...menu.workspace, ...menu.organization].map((item) => item.label);

test("each type's menu is the board's, in order", () => {
  assert.deepEqual(labels(partnerMenu(viewer("publisher"))), ["Overview", "Submit transfer", "Lead pipeline", "Daily deal flow", "Messages", "Statements", "Team performance", "Team access"]);
  assert.deepEqual(labels(partnerMenu(viewer("marketing"))), ["Overview", "Submit lead", "Lead pipeline", "Campaigns", "Messages", "Statements", "Team access"]);
  assert.deepEqual(labels(partnerMenu(viewer("affiliate"))), ["Overview", "My links", "Referrals", "Refer someone", "Messages", "Statements"]);
});

test("a one-person affiliate gets no deal flow and no team pages; one with a team gets them back", () => {
  for (const page of ["deal-flow", "team-review", "team"]) {
    assert.equal(partnerPageAllowed(page, viewer("affiliate")), false, page);
    assert.equal(partnerPageAllowed(page, viewer("affiliate", "partner_admin", true)), true, page);
  }
  assert.deepEqual(labels(partnerMenu(viewer("affiliate", "partner_admin", true))), ["Overview", "My links", "Referrals", "Refer someone", "Daily deal flow", "Messages", "Statements", "Team performance", "Team access"]);
});

test("pages a type does not get are refused, not just unlisted", () => {
  assert.equal(partnerPageAllowed("links", viewer("publisher")), false);
  assert.equal(partnerPageAllowed("links", viewer("marketing")), false);
  assert.equal(partnerPageAllowed("campaigns", viewer("publisher")), false);
  assert.equal(partnerPageAllowed("campaigns", viewer("affiliate")), false);
  assert.equal(partnerPageAllowed("refer", viewer("publisher")), false, "a publisher sends the full application");
  assert.equal(partnerPageAllowed("submit", viewer("affiliate")), false, "an affiliate sends the short form");
  assert.equal(partnerPageAllowed("submit", viewer("marketing")), true, "the full application stays optional for marketing");
  assert.equal(partnerPageAllowed("deal-flow", viewer("marketing")), false);
  assert.equal(partnerPageAllowed("team-review", viewer("marketing")), false);
});

test("statements and team pages stay the partner admin's, whatever the type", () => {
  for (const type of ["publisher", "marketing", "affiliate"]) {
    for (const page of ["statements", "team", "team-review"]) assert.equal(partnerPageAllowed(page, viewer(type, "partner_user", true)), false, `${type} ${page}`);
    assert.equal(partnerPageAllowed("statements", viewer(type)), true);
  }
});

test("an unknown partner type is no type at all", () => {
  assert.equal(asPartnerType("publisher"), "publisher");
  assert.equal(asPartnerType("vendor"), null);
  assert.equal(asPartnerType(null), null);
});

test("every portal page asks the rule on the server", async () => {
  const pages = {
    "deal-flow/page.tsx": "deal-flow",
    "payouts/page.tsx": "statements",
    "campaigns/page.tsx": "campaigns",
    "links/page.tsx": "links",
    "refer/page.tsx": "refer",
    "submit-lead/drafts/page.tsx": "submit",
  };
  for (const [file, page] of Object.entries(pages)) {
    const source = await readFile(`app/partner/(portal)/${file}`, "utf8");
    assert.match(source, new RegExp(`partnerPageContext\\("${page}"\\)`), file);
  }
  const section = await readFile("app/partner/(portal)/section-page.tsx", "utf8");
  assert.match(section, /partnerPageContext\(SECTION_PAGE\[section\]\)/);
  for (const path of Object.values(PARTNER_PAGE_PATHS)) assert.match(path, /^\/partner(\/|$)/);
});

test("every route that belongs to a typed page refuses the other types", async () => {
  const routes = {
    "links/route.ts": "links",
    "campaigns/route.ts": "campaigns",
    "referrals/route.ts": "refer",
    "deal-flow/route.ts": "deal-flow",
    "team-review/pulse/route.ts": "team-review",
    "users/route.ts": "team",
    "users/[userId]/route.ts": "team",
    "users/[userId]/resend-invite/route.ts": "team",
    "leads/route.ts": "submit",
    "drafts/route.ts": "submit",
    "forms/[productCode]/route.ts": "submit",
    "forms/[productCode]/draft/route.ts": "submit",
    "forms/[productCode]/duplicates/route.ts": "submit",
    "forms/[productCode]/screen/route.ts": "submit",
  };
  for (const [file, page] of Object.entries(routes)) {
    const source = await readFile(`app/api/partner/${file}`, "utf8");
    assert.ok(source.includes(`partnerMayOpen(auth.context, "${page}")`) || source.includes(`requirePartnerPage("${page}"`), `${file} must refuse a type without ${page}`);
  }
});

test("the new partner routes read only the session's tenant and partner", async () => {
  for (const file of ["links/route.ts", "campaigns/route.ts", "referrals/route.ts"]) {
    const source = await readFile(`app/api/partner/${file}`, "utf8");
    assert.match(source, /auth\.context\.(tenantId|partnerId)|context\.tenantId/);
    assert.doesNotMatch(source, /searchParams\.get\(\s*["']partner/);
    assert.doesNotMatch(source, /body\??\.\s*partner_?[Ii]d/);
  }
  const links = await readFile("lib/affiliate/partnerLinks.ts", "utf8");
  assert.match(links, /\.from\("affiliate_links"\)[\s\S]*?\.eq\("tenant_id", tenantId\)[\s\S]*?\.eq\("partner_id", partnerId\)/);
  assert.doesNotMatch(links, /\.rpc\(|\.update\(|recordAffiliateClick\(/, "reading the links never counts a click");
  const campaigns = await readFile("lib/partnerLeads/campaigns.ts", "utf8");
  assert.match(campaigns, /\.eq\("tenant_id", tenantId\)\s*\.eq\("partner_id", partnerId\)\s*\.in\("agent_leads\.created_by"/);
});

test("the portal referral goes through the one intake path, not the public link", async () => {
  const route = await readFile("app/api/partner/referrals/route.ts", "utf8");
  for (const step of ["buildAffiliateTemplate(", "evaluateTransfer(", "createPartnerLead(", "writePartnerIntakeArtifacts(", "linkVerdictToLead("]) assert.ok(route.includes(step), step);
  assert.doesNotMatch(route, /recordAffiliateClick|\/api\/affiliate/);
  assert.match(route, /partnerStatus !== "active"/);
  const form = await readFile("components/partner/partner-refer-form.tsx", "utf8");
  assert.match(form, /fetch\("\/api\/partner\/referrals"/);
  assert.doesNotMatch(form, /\/api\/affiliate\//);
});
