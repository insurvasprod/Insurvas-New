import { render, screen, userEvent } from "@testing-library/react-native";

import VendorsRoute from "@/app/vendor";

/** Board D10's way in: every vendor with this month's leads, sales and true cost per sale; a row opens the card. */
const mockApi = jest.fn();
const mockPush = jest.fn();
jest.mock("@/lib/session", () => ({ useSession: () => ({ api: mockApi }) }));
jest.mock("expo-router", () => ({ router: { push: (...a: unknown[]) => mockPush(...a), back: jest.fn() }, Stack: { Screen: () => null } }));

beforeEach(() => {
  mockApi.mockReset(); mockPush.mockReset();
  mockApi.mockImplementation(async (path: string) => {
    if (path === "/api/app/vendors") return { vendors: [{ id: "v2", name: "Summit Media", contact: null }, { id: "v1", name: "Apex Leads", contact: null }] };
    if (path.startsWith("/api/app/true-cpa?from=")) return { from: "", to: "", rows: [], vendor_rows: [{ vendor_id: "v1", vendor_name: "Apex Leads", campaigns: 4, leads_received: 412, contacted_leads: 150, issued_policies: 41, cost_per_record_cents: 2800, effective_cost_per_issued_policy_cents: 28100, contact_rate_percent: 38 }] };
    throw new Error(`unexpected ${path}`);
  });
});

test("lists every vendor by name with this month's figures, and opens one", async () => {
  await render(<VendorsRoute />);
  expect(await screen.findByText("412 leads · 41 sold")).toBeOnTheScreen();
  expect(screen.getByText("Summit Media")).toBeOnTheScreen();
  expect(screen.getByText("$281")).toBeOnTheScreen();
  await userEvent.setup().press(screen.getByTestId("vendor-v1"));
  expect(mockPush).toHaveBeenCalledWith({ pathname: "/vendor/[id]", params: { id: "v1", name: "Apex Leads" } });
});
