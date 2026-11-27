import { render, screen, userEvent } from "@testing-library/react-native";

import { HomeOwner } from "../home-owner";

/**
 * Board B2 · the agency owner's Home drawn from mocked answers of the routes it reads. Nothing is written: the
 * screen only reads, and a tap only moves to another screen.
 */
const mockApi = jest.fn();
const mockPush = jest.fn();
jest.mock("@/lib/session", () => ({
  useSession: () => ({ api: mockApi, me: { user: { id: "me", email: "dana@example.test", name: "Dana Ellery" }, tenant: { id: "t", name: "Ellery & Fields", status: "active", plan_code: null }, role: "owner", memberRole: "owner", agencyTitle: null, roles: ["owner"] } }),
}));
jest.mock("expo-router", () => ({ router: { push: (...a: unknown[]) => mockPush(...a), back: jest.fn() } }));
jest.mock("expo-notifications", () => ({ getPermissionsAsync: jest.fn(async () => ({ granted: false })) }));

const NOW = new Date(2026, 10, 16, 15, 0, 0);
const at = (d: number, m = 11, h = 12) => new Date(2026, m - 1, d, h).toISOString();
beforeEach(() => {
  mockApi.mockReset();
  mockPush.mockReset();
  jest.spyOn(Date, "now").mockReturnValue(NOW.getTime());
});
afterEach(() => jest.restoreAllMocks());

const route = (answers: Record<string, unknown>) => async (path: string) => {
  if (path in answers) {
    const a = answers[path];
    if (a instanceof Error) throw a;
    return a;
  }
  throw new Error(`unexpected ${path}`);
};

const person = (id: string, name: string, periodCents: number, extra = {}) => ({
  producerUserId: id, displayName: name, status: "active", balanceBeforeCents: 0, earnedCents: periodCents, chargebackCents: 0, periodCents, balanceCents: periodCents,
  alreadyRun: false, planModel: null, salaryCents: 0, bonusCents: 0, saveFeeCents: 0, absorbedCount: 0, ...extra,
});
const rules = { negativePolicy: "carry_forward", recoveryPctBp: 2000 };

test("B2 · needs you, the month's submitted premium against last month, then the producers by premium", async () => {
  mockApi.mockImplementation(route({
    "/api/app/applications": { applications: [
      { applicationId: "1", caseId: "c", status: "closed", outcome: "issued", monthlyPremiumCents: 50000, submittedAt: at(2), closedAt: at(4), updatedAt: at(4) },
      { applicationId: "2", caseId: "c", status: "submitted", outcome: null, monthlyPremiumCents: 25000, submittedAt: at(10), closedAt: null, updatedAt: at(10) },
      { applicationId: "3", caseId: "c", status: "submitted", outcome: null, monthlyPremiumCents: 50000, submittedAt: at(5, 10), closedAt: null, updatedAt: at(5, 10) },
    ] },
    "/api/app/agency/dashboard": { period: { from: "2026-11-01", to: "2026-11-30" }, alerts: [{ producerUserId: "a", name: "Ava Kim", item: "Licence", detail: "State licence · TX", expiresOn: "2026-12-09", daysLeft: 23 }], producers: [
      // Jordan issued more policies, Ava more premium: the board ranks by premium dollars.
      { producerUserId: "b", producerId: "pb", name: "Jordan Reyes", submitted: 9, issued: 5, placement: "55%", chargebackCents: -214000, chargebacks: 3, issuedAnnualCents: 1148000 },
      { producerUserId: "a", producerId: "pa", name: "Ava Kim", submitted: 7, issued: 4, placement: "57%", chargebackCents: 0, chargebacks: 0, issuedAnnualCents: 1492000 },
    ] },
    // Team payouts: October still has two people to pay ($9,120 each), so that is the month waiting on the owner.
    "/api/app/agency/payouts?from=2026-10-01&to=2026-10-31": { period: { from: "2026-10-01", to: "2026-10-31" }, rules, preview: [
      person("a", "Ava Kim", 912000), person("b", "Jordan Reyes", 912000), person("c", "Paid Already", 50000, { alreadyRun: true }),
    ] },
    "/api/app/compliance/complaints": { complaints: [{ id: "x", status: "investigating", respondedAt: null, resolvedAt: null, countdown: { tone: "red", daysLeft: 2, label: "" } }] },
    "/api/app/needs-you/item": { ok: true, total: 6, phone: { total: 4 }, computer: { total: 2 } },
  }));
  const user = userEvent.setup();
  await render(<HomeOwner />);

  expect(await screen.findByText("Ellery & Fields")).toBeOnTheScreen();
  expect(await screen.findByText("November so far · 2 producers")).toBeOnTheScreen();

  expect(await screen.findByRole("button", { name: "Approve payouts: 2" })).toBeOnTheScreen();
  expect(screen.getByText("$18,240")).toBeOnTheScreen();
  expect(await screen.findByText("1 in 2 days")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Carrier decisions: 6" })).toBeOnTheScreen();
  expect(screen.getByText("Pick a client · 4")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Licences expiring: 1" })).toBeOnTheScreen();
  expect(screen.getByText("TX · 9 Dec")).toBeOnTheScreen();

  expect(screen.getByLabelText("$9,000")).toBeOnTheScreen();
  expect(screen.getByText("↑ 50% vs Oct")).toBeOnTheScreen();
  expect(screen.getByLabelText("Issued: $6,000")).toBeOnTheScreen();
  expect(screen.getByText("50% placement")).toBeOnTheScreen();
  expect(screen.getByLabelText("Chargebacks: $2,140")).toBeOnTheScreen();
  expect(screen.getByText("3 policies")).toBeOnTheScreen();

  expect(screen.getByText("All 2")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "1. Ava Kim, $14,920" })).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "2. Jordan Reyes, $11,480" })).toBeOnTheScreen();

  await user.press(screen.getByRole("button", { name: "Approve payouts: 2" }));
  expect(mockPush).toHaveBeenCalledWith("/money");
  await user.press(screen.getByRole("button", { name: "1. Ava Kim, $14,920" }));
  expect(mockPush).toHaveBeenCalledWith("/team/a");
});

test("B2 · last month all paid: the payouts tile reads this month; nothing waiting is 0, not a hidden tile", async () => {
  mockApi.mockImplementation(route({
    "/api/app/applications": { applications: [] },
    "/api/app/agency/dashboard": { period: { from: "2026-11-01", to: "2026-11-30" }, alerts: [], producers: [] },
    "/api/app/agency/payouts?from=2026-10-01&to=2026-10-31": { period: { from: "2026-10-01", to: "2026-10-31" }, rules, preview: [person("a", "Ava Kim", 912000, { alreadyRun: true })] },
    "/api/app/agency/payouts?from=2026-11-01&to=2026-11-30": { period: { from: "2026-11-01", to: "2026-11-30" }, rules, preview: [] },
    "/api/app/compliance/complaints": { complaints: [] },
    "/api/app/needs-you/item": { ok: true, total: 0, phone: { total: 0 }, computer: { total: 0 } },
  }));
  await render(<HomeOwner />);
  expect(await screen.findByRole("button", { name: "Approve payouts: 0" })).toBeOnTheScreen();
  expect(await screen.findByRole("button", { name: "Complaints due: 0" })).toBeOnTheScreen();
  expect(await screen.findByRole("button", { name: "Carrier decisions: 0" })).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Licences expiring: 0" })).toBeOnTheScreen();
  expect(screen.getByText("Nothing clawed back")).toBeOnTheScreen();
});

test("B2 · a read that fails shows a dash in its tile; the rest still draws", async () => {
  mockApi.mockImplementation(route({
    "/api/app/applications": { applications: [] },
    "/api/app/agency/dashboard": new Error("no"),
    "/api/app/agency/payouts?from=2026-10-01&to=2026-10-31": new Error("no"),
    "/api/app/compliance/complaints": new Error("no"),
    "/api/app/needs-you/item": new Error("no"),
  }));
  await render(<HomeOwner />);
  expect(await screen.findByText("Submitted premium")).toBeOnTheScreen();
  expect(screen.queryByText("Producers")).not.toBeOnTheScreen();
  expect(await screen.findByRole("button", { name: "Approve payouts: –" })).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Licences expiring: –" })).toBeOnTheScreen();
  // Re-audit 2026-11-27: Issued and Chargebacks never vanish; a failed read is a dash with what went wrong.
  expect(screen.getByLabelText("Chargebacks: unknown")).toBeOnTheScreen();
  expect(screen.getByLabelText("Issued: $0")).toBeOnTheScreen();
  expect(screen.getByText("Couldn’t load")).toBeOnTheScreen();
});

test("B2 · licences open Licences and appointments; nothing points at the dead /team", async () => {
  mockApi.mockImplementation(route({
    "/api/app/applications": { applications: [] },
    "/api/app/agency/dashboard": { period: { from: "2026-11-01", to: "2026-11-30" }, alerts: [], producers: [] },
    "/api/app/agency/payouts?from=2026-10-01&to=2026-10-31": new Error("no"),
    "/api/app/compliance/complaints": new Error("no"),
    "/api/app/needs-you/item": new Error("no"),
  }));
  const user = userEvent.setup();
  await render(<HomeOwner />);
  await user.press(await screen.findByRole("button", { name: "Licences expiring: 0" }));
  expect(mockPush).toHaveBeenCalledWith("/compliance/licences");
  expect(mockPush).not.toHaveBeenCalledWith("/team");
});
