import { render, screen } from "@testing-library/react-native";

import { VendorScreen } from "../vendor-screen";

/**
 * Board D10 drawn (B2: owner-home, B6 and B8: bookkeeper-home and manager-home tests) from mocked answers of the routes they read. Nothing is written: every
 * screen here only reads, and a tap only moves to another screen.
 */
const mockApi = jest.fn();
const mockPush = jest.fn();
jest.mock("@/lib/session", () => ({
  useSession: () => ({ api: mockApi, me: { user: { id: "me", email: "dana@example.test", name: "Dana Ellery" }, tenant: { id: "t", name: "Ellery & Fields", status: "active", plan_code: null }, role: "owner", memberRole: "owner", agencyTitle: null, roles: ["owner"] } }),
}));
jest.mock("expo-router", () => ({ router: { push: (...a: unknown[]) => mockPush(...a), back: jest.fn() } }));
jest.mock("expo-notifications", () => ({ getPermissionsAsync: jest.fn(async () => ({ granted: false })) }));

const NOW = new Date(2026, 10, 16, 15, 0, 0);
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

test("D10 · a vendor's month: what a lead and a sale really cost, against last month, by campaign", async () => {
  const vendor = (over = {}) => ({ vendor_id: "v", vendor_name: "Apex Leads", campaigns: 3, leads_received: 412, contacted_leads: 157, issued_policies: 41, cost_per_record_cents: 2800, effective_cost_per_issued_policy_cents: 28100, contact_rate_percent: 38.1, ...over });
  const camp = (id: string, name: string, leads: number, sold: number, cps: number, rank: number) => ({ campaign_id: id, vendor_id: "v", campaign_name: name, leads_received: leads, issued_policies: sold, cost_per_record_cents: 2800, effective_cost_per_issued_policy_cents: cps, contact_rate_percent: 38, cost_rank: rank });
  mockApi.mockImplementation(route({
    "/api/app/true-cpa?vendor_id=v&from=2026-11-01&to=2026-11-16": { from: "2026-11-01", to: "2026-11-16", vendor_rows: [vendor()], rows: [camp("g", "FE-Georgia-Nov", 180, 21, 24000, 1), camp("f", "FE-Florida-2", 132, 14, 26400, 2), camp("o", "FE-Ohio-Aged", 100, 6, 46700, 3)] },
    "/api/app/true-cpa?vendor_id=v&from=2026-10-01&to=2026-10-31": { from: "2026-10-01", to: "2026-10-31", vendor_rows: [vendor({ effective_cost_per_issued_policy_cents: 30300 })], rows: [] },
    "/api/app/vendors": { vendors: [{ id: "v", name: "Apex Leads", contact: {} }] },
  }));
  await render(<VendorScreen id="v" />);

  expect(await screen.findByText("FE-Georgia-Nov")).toBeOnTheScreen();
  expect(screen.getByText("Vendor · 3 campaigns · November")).toBeOnTheScreen();
  expect(screen.getByText("$28.00 each")).toBeOnTheScreen();
  expect(screen.getByLabelText("$281")).toBeOnTheScreen();
  expect(await screen.findByText("↓ $22")).toBeOnTheScreen();
  expect(screen.getByText("38%")).toBeOnTheScreen();
  expect(screen.getByText("10 per 100")).toBeOnTheScreen();
  expect(screen.getByText("180 leads · 21 sold")).toBeOnTheScreen();
  expect(screen.getByText("$467")).toBeOnTheScreen();
  expect(screen.getAllByText("Costly")).toHaveLength(1);
  expect(screen.getByText("Right column: true cost per sale.")).toBeOnTheScreen();
});
