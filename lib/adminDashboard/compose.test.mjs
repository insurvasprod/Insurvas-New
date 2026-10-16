import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  START_STEPS,
  attentionEmptyAction,
  attentionFor,
  canOpenAdminHref,
  homeFigureSet,
  monthOverMonth,
  platformTiles,
  revenueTiles,
  startStepsFor,
  summariseSnapshot,
  supportTiles,
  tilesFor,
} from "./compose.ts";

const ROLES = ["super_admin", "support_agent", "billing_admin", "platform_config"];

const REVENUE = {
  snapshotDate: "2026-10-12", snapshotAgeDays: 1, mrrCents: 110_000, mrrMonthAgoCents: 100_000,
  activeCustomers: 12, newThisMonth: 2, churnedThisMonth: 1,
  invoicedThisMonthCents: 200_000, collectedThisMonthCents: 150_000, mismatchedInvoices: 1, overdueInvoices: 3,
  trialsInFlight: 4, trialsEndingThisWeek: 2,
};
const SUPPORT = {
  tenants: 9, suspendedTenants: 1, signedInLast15Min: 3, signInsToday: 20, failedSignInsToday: 2,
  invitedUsers: 5, invitedStale: 1, auditToday: 7, auditWeek: 40, auditIsOwn: true,
};
const PLATFORM = {
  maintenanceLevel: "off", maintenanceScheduled: null, announcementsLive: 1, announcementsScheduled: 2,
  featuresOff: 1, featuresBeta: 0, complianceSources: 3, complianceSourcesFailing: 0,
};
const tilesOf = { revenue: revenueTiles(REVENUE), support: supportTiles(SUPPORT), platform: platformTiles(PLATFORM) };

/** The page file a /admin/... href resolves to. */
const routeExists = (href) => {
  const path = href.split(/[?#]/)[0].replace(/^\/admin/, "");
  return existsSync(join("app", "admin", "(protected)", ...path.split("/").filter(Boolean), "page.tsx"));
};

test("each role gets its own figure set", () => {
  assert.equal(homeFigureSet("super_admin"), "revenue");
  assert.equal(homeFigureSet("billing_admin"), "revenue");
  assert.equal(homeFigureSet("support_agent"), "support");
  // The old home showed platform_config no tiles at all.
  assert.equal(homeFigureSet("platform_config"), "platform");
});

test("every role sees 3–6 tiles, every one linking to a page that exists and that the role can open", () => {
  for (const role of ROLES) {
    const tiles = tilesFor(role, tilesOf[homeFigureSet(role)]);
    assert.ok(tiles.length >= 3 && tiles.length <= 6, `${role}: ${tiles.length} tiles`);
    for (const tile of tiles) {
      assert.ok(routeExists(tile.href), `${tile.href} is not a route`);
      assert.ok(canOpenAdminHref(role, tile.href), `${role} cannot open ${tile.href}`);
    }
  }
});

test("no role's set is cut down by its own gate (the sets match the permissions)", () => {
  for (const role of ROLES) {
    const set = tilesOf[homeFigureSet(role)];
    assert.equal(tilesFor(role, set).length, set.length, role);
  }
});

test("money and customer figures never reach the roles that may not open them", () => {
  for (const tile of tilesOf.revenue) {
    assert.equal(canOpenAdminHref("support_agent", tile.href), false, tile.href);
    assert.equal(canOpenAdminHref("platform_config", tile.href), false, tile.href);
  }
  // The audit log is every admin's page (each reads its own rows); the customer pages are not.
  for (const tile of tilesOf.support.filter((t) => t.key !== "audit")) assert.equal(canOpenAdminHref("platform_config", tile.href), false, tile.href);
  // A platform figure handed to a support agent is filtered out, not shown as a dead link.
  assert.deepEqual(tilesFor("support_agent", tilesOf.platform), []);
});

test("canOpenAdminHref follows the nav: records under a page, query strings ignored, /admin not a wildcard", () => {
  assert.ok(canOpenAdminHref("support_agent", "/admin/tenants/abc"));
  assert.ok(canOpenAdminHref("billing_admin", "/admin/subscriptions?status=past_due"));
  assert.ok(!canOpenAdminHref("support_agent", "/admin/invoices"));
  assert.ok(!canOpenAdminHref("platform_config", "/admin/tenants/abc"));
  assert.ok(!canOpenAdminHref("billing_admin", "/admin/payments"));
  assert.ok(canOpenAdminHref("platform_config", "/admin"));
  assert.ok(!canOpenAdminHref("platform_config", "/admin/revenue"));
});

test("Start here keeps only the pages the role can open", () => {
  const platform = startStepsFor("platform_config").flatMap((s) => s.links.map((l) => l.href));
  assert.ok(!platform.includes("/admin/tenants") && !platform.includes("/admin/users") && !platform.includes("/admin/plans"));
  assert.ok(platform.includes("/admin/features") && platform.includes("/admin/system"));
  // The first kept step is the open one, even when step 1 was dropped.
  assert.equal(startStepsFor("platform_config")[0].open, true);
  assert.equal(startStepsFor("platform_config")[0].title, "Configure what customers can buy");

  const support = startStepsFor("support_agent").flatMap((s) => s.links.map((l) => l.href));
  assert.deepEqual(support, ["/admin/tenants", "/admin/users", "/admin/audit-log"]);

  const all = START_STEPS.flatMap((s) => s.links.map((l) => l.href));
  assert.deepEqual(startStepsFor("super_admin").flatMap((s) => s.links.map((l) => l.href)), all);
  for (const role of ROLES) {
    for (const step of startStepsFor(role)) {
      assert.ok(step.links.length > 0);
      for (const link of step.links) assert.ok(canOpenAdminHref(role, link.href) && routeExists(link.href), `${role} ${link.href}`);
    }
  }
});

test("Needs attention drops an alert whose page the role cannot open, and its empty state names a page the role can open", () => {
  const alerts = [
    { id: "seats-1", link: "/admin/tenants/t1" },
    { id: "maintenance", link: "/admin/system" },
    { id: "past-due", link: "/admin/subscriptions?status=past_due" },
  ];
  assert.deepEqual(attentionFor("platform_config", alerts).map((a) => a.id), ["maintenance"]);
  assert.deepEqual(attentionFor("support_agent", alerts).map((a) => a.id), ["seats-1"]);
  assert.deepEqual(attentionFor("billing_admin", alerts).map((a) => a.id), ["seats-1", "past-due"]);
  for (const role of ROLES) {
    const next = attentionEmptyAction(role);
    assert.ok(canOpenAdminHref(role, next.href) && routeExists(next.href), `${role} -> ${next.href}`);
    assert.ok(next.hint.length > 0);
  }
});

test("MRR: month-over-month, an absent snapshot is '—' not $0, and a stale one is flagged", () => {
  assert.equal(monthOverMonth(110, 100), 10);
  assert.equal(monthOverMonth(110, 0), null);
  assert.equal(monthOverMonth(110, null), null);
  const [mrr] = revenueTiles(REVENUE);
  assert.equal(mrr.value, "$1,100.00");
  assert.deepEqual(mrr.delta, { value: 10, unit: "%", goodWhen: "up" });
  assert.equal(mrr.href, "/admin/revenue");
  const [none] = revenueTiles({ ...REVENUE, snapshotDate: null, snapshotAgeDays: null });
  assert.equal(none.value, "—");
  assert.equal(none.tone, "warning");
  const [stale] = revenueTiles({ ...REVENUE, snapshotAgeDays: 5 });
  assert.match(stale.footnote, /5 days old/);
});

test("summariseSnapshot: newest day, the base 30 days before it, and this calendar month", () => {
  const day = (date, mrr, extra = {}) => ({ date, mrr_cents: mrr, active_customers: 1, new_customers: 0, churned_customers: 0, ...extra });
  const days = [
    day("2026-09-10", 50), day("2026-09-12", 80), day("2026-09-20", 90, { new_customers: 5 }),
    day("2026-10-01", 95, { new_customers: 1 }), day("2026-10-12", 100, { new_customers: 2, churned_customers: 1, active_customers: 7 }),
  ];
  const out = summariseSnapshot(days, Date.parse("2026-10-13T09:00:00Z"));
  assert.equal(out.mrrCents, 100);
  assert.equal(out.mrrMonthAgoCents, 80); // 2026-09-12 is the newest day on or before 30 days back
  assert.equal(out.activeCustomers, 7);
  assert.equal(out.newThisMonth, 3);
  assert.equal(out.churnedThisMonth, 1);
  assert.equal(summariseSnapshot([], Date.now()).mrrMonthAgoCents, null);
});

test("platform tiles: unreadable announcements are '—', a scheduled window is named", () => {
  const tiles = platformTiles({ ...PLATFORM, announcementsLive: null, announcementsScheduled: null, maintenanceLevel: "banner_only", maintenanceScheduled: "read_only" });
  assert.equal(tiles.find((t) => t.key === "announcements").value, "—");
  const maintenance = tiles.find((t) => t.key === "maintenance");
  assert.equal(maintenance.value, "Banner only");
  assert.equal(maintenance.footnote, "Read only scheduled");
});
