import { render, screen, userEvent, waitFor, within } from "@testing-library/react-native";

import QuickQuote from "@/app/quote";
import { quickMeta, quickQuoteRows, type QuickCatalog } from "../quick-quote";

const mockApi = jest.fn();
const mockPush = jest.fn();
const mockParams: Record<string, string> = {};
jest.mock("@/lib/session", () => ({ useSession: () => ({ api: mockApi, me: { user: { id: "me" }, role: "producer" } }) }));
jest.mock("expo-router", () => ({
  router: { push: (...a: unknown[]) => mockPush(...a), replace: jest.fn(), back: jest.fn() },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => mockParams,
}));

const product = (over: Partial<QuickCatalog["carriers"][number]["products"][number]> = {}) => ({
  id: "p-aa", carrierId: "car-aa", name: "Senior Choice", productCode: "final_expense", tiers: ["level", "graded"], issueAgeMin: 50, issueAgeMax: 85, faceMinCents: 200_000, faceMaxCents: 5_000_000, ...over,
});
const catalog: QuickCatalog = {
  carriers: [
    { id: "car-mo", name: "Mutual of Omaha", appointed: { ok: true, reason: null }, products: [product({ id: "p-mo", carrierId: "car-mo", name: "Living Promise", issueAgeMax: 65 })] },
    { id: "car-aa", name: "American Amicable", appointed: { ok: true, reason: null }, products: [product()] },
    { id: "car-cb", name: "Corebridge", appointed: { ok: false, reason: "No active Corebridge appointment in GA." }, products: [product({ id: "p-cb", carrierId: "car-cb", name: "GIWL", tiers: ["gi"] })] },
    { id: "car-rn", name: "Royal Neighbors", appointed: { ok: true, reason: null }, products: [] },
  ],
};

beforeEach(() => {
  mockApi.mockReset(); mockPush.mockReset();
  for (const k of Object.keys(mockParams)) delete mockParams[k];
});

describe("E1 · the rules", () => {
  test("carriers offering the tier, the ones that can write the client first; nothing priced", () => {
    const rows = quickQuoteRows(catalog, { age: 68, faceCents: 1_500_000, tier: "level" });
    expect(rows.map((r) => [r.carrierName, quickMeta(r)])).toEqual([
      ["American Amicable", "Senior Choice · Level"],
      ["Royal Neighbors", "Level"],
      ["Mutual of Omaha", "Living Promise · Level · Issues to age 65"],
    ]);
    expect(quickQuoteRows(catalog, { age: 68, faceCents: null, tier: "gi" }).map((r) => [r.carrierName, r.problem])).toEqual([
      ["Royal Neighbors", null],
      ["Corebridge", "No active Corebridge appointment in GA."],
    ]);
  });
});

describe("E1 · Quick quote", () => {
  test("from a lead: answers filled in, carriers for the state, Apply carries the pick into Start an application", async () => {
    mockParams.leadId = "lead-1";
    mockApi.mockImplementation(async (path: string) => {
      if (path === "/api/app/leads/lead-1") return { lead: { id: "lead-1", product_line: "final_expense", values: { first_name: "Linda", last_name: "Okafor", age: "68", state: "ga", coverage_amount: "15000" } }, queue: null };
      if (path === "/api/app/quoting/catalog?state=GA&product=final_expense") return catalog;
      throw new Error(`unexpected ${path}`);
    });
    const user = userEvent.setup();
    await render(<QuickQuote />);
    expect(await screen.findByText("American Amicable")).toBeOnTheScreen();
    expect(screen.getByTestId("qq-age")).toHaveDisplayValue("68");
    expect(screen.getByTestId("qq-coverage")).toHaveDisplayValue("$15,000");
    expect(screen.getByText("3 carriers · level")).toBeOnTheScreen();
    expect(within(screen.getByTestId("qq-row-car-mo")).getByText("Outside limits")).toBeOnTheScreen();
    // No premium is invented: the rows carry no dollar figure.
    expect(screen.queryByText(/^\$\d/)).toBeNull();
    await user.press(screen.getByRole("button", { name: "Apply with American Amicable" }));
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/application/start", params: {
      leadId: "lead-1", from: "quote", carrier: "car-aa", carrierName: "American Amicable", product: "Senior Choice", productCode: "final_expense", tier: "level", face: "1500000",
    } });
  });

  test("from Menu: pick the state, switch the tier, then find whose application it is", async () => {
    mockApi.mockImplementation(async (path: string) => {
      if (path === "/api/app/quoting/catalog?state=GA&product=final_expense") return catalog;
      if (path.startsWith("/api/app/search?q=linda")) return { hits: [{ group: "Leads", title: "Linda Okafor", meta: "Savannah, GA", href: "/app/leads/0b5a5a52-1111-4a4a-9a9a-000000000001" }, { group: "Policies", title: "Linda's policy", meta: null, href: "/app/policies/x" }] };
      throw new Error(`unexpected ${path}`);
    });
    const user = userEvent.setup();
    await render(<QuickQuote />);
    expect(await screen.findByText("Pick the client’s state")).toBeOnTheScreen();
    await user.press(screen.getByRole("button", { name: /^State/ }));
    await user.press(await screen.findByTestId("qq-state-GA"));
    expect(await screen.findByText("American Amicable")).toBeOnTheScreen();
    await user.press(screen.getByTestId("seg-gi"));
    expect(await screen.findByText("Royal Neighbors")).toBeOnTheScreen();
    expect(screen.queryByText("American Amicable")).toBeNull();
    await user.press(screen.getByRole("button", { name: "Apply with Royal Neighbors" }));
    await user.type(await screen.findByTestId("qq-who-search"), "linda");
    await user.press(await screen.findByTestId("qq-who-0b5a5a52-1111-4a4a-9a9a-000000000001"));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith({ pathname: "/application/start", params: expect.objectContaining({ leadId: "0b5a5a52-1111-4a4a-9a9a-000000000001", carrier: "car-rn", tier: "gi" }) }));
    expect(screen.queryByText("Linda's policy")).toBeNull();
  });
});
