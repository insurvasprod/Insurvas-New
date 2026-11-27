import { render, screen } from "@testing-library/react-native";

import MoneyTabScreen from "@/app/(tabs)/moneytab";

/** Which screen the Money tab draws: the owner's Money (G3), or Pay issues (G8) for the bookkeeper and a Ledger plan. */
const mockApi = jest.fn();
let mockMe: { role: string; plan: { features: string[] } | null; tenant: { name: string }; user: { id: string } };
jest.mock("@/lib/session", () => ({ useSession: () => ({ api: mockApi, refreshToken: async () => "tok", me: mockMe }) }));
jest.mock("expo-router", () => ({ router: { push: jest.fn(), back: jest.fn() }, Stack: { Screen: () => null } }));
jest.mock("expo-local-authentication", () => ({ hasHardwareAsync: async () => true, isEnrolledAsync: async () => true, authenticateAsync: async () => ({ success: true }) }));
jest.mock("expo-file-system", () => ({ File: class {}, Paths: { cache: "cache" } }));
jest.mock("expo-image-picker", () => ({ requestCameraPermissionsAsync: async () => ({ granted: true }), launchCameraAsync: async () => ({ canceled: true }) }));
jest.mock("react-native-safe-area-context", () => jest.requireActual("react-native-safe-area-context/jest/mock").default);

const issues = { ok: true, available: true, owedCents: 391240, count: 18, kinds: { short_paid: 14, missing: 4 }, carriers: [] };
beforeEach(() => {
  mockApi.mockReset();
  mockApi.mockImplementation(async (path: string) => {
    if (path === "/api/app/discrepancies?view=carriers") return issues;
    throw new Error(`unexpected ${path}`);
  });
});

const both = ["profit_and_loss", "discrepancy_report", "producer_payouts"];

test("the bookkeeper's Money tab is Pay issues, as board G8 draws it", async () => {
  mockMe = { role: "bookkeeper", plan: { features: both }, tenant: { name: "E&F" }, user: { id: "b" } };
  await render(<MoneyTabScreen />);
  expect(await screen.findByText("Pay issues")).toBeOnTheScreen();
  expect(screen.getByText("Owed to you")).toBeOnTheScreen();
  expect(mockApi).toHaveBeenCalledWith("/api/app/discrepancies?view=carriers");
});

test("a plan without the accounting draws Pay issues for the owner too", async () => {
  mockMe = { role: "owner", plan: { features: ["discrepancy_report"] }, tenant: { name: "E&F" }, user: { id: "o" } };
  await render(<MoneyTabScreen />);
  expect(await screen.findByText("Pay issues")).toBeOnTheScreen();
});

test("the owner's Money tab is Money (G3)", async () => {
  mockMe = { role: "owner", plan: { features: both }, tenant: { name: "E&F" }, user: { id: "o" } };
  mockApi.mockImplementation(async () => { const { ApiError } = jest.requireActual("@/lib/api"); throw new ApiError(403, { error: "No" }); });
  await render(<MoneyTabScreen />);
  expect(await screen.findByText("Money")).toBeOnTheScreen();
  expect(mockApi).not.toHaveBeenCalledWith("/api/app/discrepancies?view=carriers");
});
