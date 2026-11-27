import { Linking } from "react-native";
import { render, screen, userEvent, waitFor, within } from "@testing-library/react-native";

import Applications from "@/app/application";
import StartApplication from "@/app/application/start";
import type { ApplicationRow } from "../types";
import { kase } from "../test-fixtures";

const mockApi = jest.fn();
const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockParams: Record<string, string> = { leadId: "lead-1" };
jest.mock("@/lib/session", () => ({ useSession: () => ({ api: mockApi, me: { user: { id: "me", email: "ava@example.com" }, role: "producer" } }) }));
jest.mock("expo-router", () => ({
  router: { push: (...a: unknown[]) => mockPush(...a), replace: (...a: unknown[]) => mockReplace(...a), back: jest.fn() },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => mockParams,
}));

beforeEach(() => {
  mockApi.mockReset(); mockPush.mockReset(); mockReplace.mockReset();
  for (const k of Object.keys(mockParams)) delete mockParams[k];
  mockParams.leadId = "lead-1";
});

const row = (id: string, status: ApplicationRow["status"], name: string, updatedAt = "2026-11-24T10:00:00Z"): ApplicationRow => ({
  caseId: `case-${id}`, applicationId: id, leadId: "l", clientName: name, insuredRole: "primary", state: "GA", carrierName: "American Amicable", productLabel: "Final Expense", attemptNo: 1, status, monthlyPremiumCents: 5218, updatedAt,
});

describe("E0 · Applications", () => {
  test("drafts resume with their step, signatures sit under Needs signature, closed stay on the web; Resume opens the case", async () => {
    const list = { applications: [row("a", "draft", "Linda Okafor"), row("b", "ready", "Paul Stewart"), row("c", "pending_carrier", "Carl Weber"), row("d", "closed", "Old Case")] };
    mockApi.mockImplementation(async (path: string) => {
      if (path === "/api/app/applications") return list;
      if (path === "/api/app/applications/cases/case-a") {
        return kase({ caseId: "case-a" }, { id: "a", carrierName: "American Amicable", selectedQuoteId: "q1" }, { answers: { ss_deposit_day: { value: "x" }, existing_coverage: { value: false } } });
      }
      throw new Error(`unexpected ${path}`);
    });
    const user = userEvent.setup();
    await render(<Applications />);
    expect(await screen.findByText("Linda Okafor")).toBeOnTheScreen();
    // The draft says where it stopped, read from its own case.
    expect(await screen.findByText("American Amicable · step 5 of 10 · Health")).toBeOnTheScreen();
    // The chip and the heading over Paul's row.
    expect(screen.getAllByText("Needs signature")).toHaveLength(2);
    expect(within(screen.getByTestId("app-row-b")).getByText("Sign")).toBeOnTheScreen();
    expect(screen.queryByText("Carl Weber")).toBeNull();
    expect(screen.queryByText("Old Case")).toBeNull();
    await user.press(screen.getByTestId("app-row-a"));
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/application/[caseId]", params: { caseId: "case-a" } });

    await user.press(screen.getByRole("button", { name: /^Submitted/ }));
    const submitted = await screen.findByTestId("app-row-c");
    expect(within(submitted).getByText("$52.18")).toBeOnTheScreen();
    expect(within(submitted).getByText(/Pending carrier/)).toBeOnTheScreen();
  });

  test("search narrows by client", async () => {
    mockApi.mockImplementation(async (path: string) => {
      if (path === "/api/app/applications") return { applications: [row("a", "draft", "Linda Okafor"), row("e", "draft", "Harold Nguyen")] };
      throw new Error("no case");
    });
    const user = userEvent.setup();
    await render(<Applications />);
    await screen.findByText("Linda Okafor");
    await user.press(screen.getByRole("button", { name: "Search" }));
    await user.type(screen.getByTestId("app-list-search"), "harold");
    await waitFor(() => expect(screen.queryByText("Linda Okafor")).toBeNull());
    expect(screen.getByText("Harold Nguyen")).toBeOnTheScreen();
  });
});

describe("E1b · start an application", () => {
  const lead = (queue: unknown) => ({ lead: { id: "lead-1", product_line: "whole_life", values: { first_name: "Linda", last_name: "Okafor", age: "68", state: "GA" } }, queue, currentUserId: "me" });
  const products = { products: [{ code: "final_expense", name: "Final Expense", category: "life" }, { code: "whole_life", name: "Whole Life", category: "life" }, { code: "medicare_supplement", name: "Medicare Supplement", category: "health" }] };
  const serve = () => mockApi.mockImplementation(async (path: string, init?: { method?: string }) => {
    if (path === "/api/app/leads/lead-1") return lead({ id: "wi-1", status: "claimed", owner_user_id: "me" });
    if (path === "/api/app/products/sold") return products;
    if (path === "/api/app/applications/start" && init?.method === "POST") return { caseId: "case-9" };
    throw new Error(`unexpected ${path}`);
  });

  test("picks the lead's product, starts it with the work item, and opens the case", async () => {
    serve();
    const user = userEvent.setup();
    await render(<StartApplication />);
    expect(await screen.findByText("For Linda Okafor · 68 · Georgia")).toBeOnTheScreen();
    expect(within(screen.getByTestId("app-start-whole_life")).getByText("Picked")).toBeOnTheScreen();
    expect(screen.getByText("Every step saves as you go and works with a weak signal.")).toBeOnTheScreen();
    // A product without the deep flow emails the person the lead's link.
    const open = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
    expect(within(screen.getByTestId("app-start-medicare_supplement")).getByText("Uses your agency’s own form")).toBeOnTheScreen();
    await user.press(screen.getByText("Medicare Supplement"));
    expect(open).toHaveBeenCalledWith(expect.stringMatching(/^mailto:ava%40example\.com\?subject=Medicare%20Supplement%20application/));
    open.mockRestore();
    await user.press(screen.getByTestId("app-start-final_expense"));
    await user.press(screen.getByRole("button", { name: "Start final expense application" }));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith({ pathname: "/application/[caseId]", params: { caseId: "case-9" } }));
    expect(mockApi).toHaveBeenCalledWith("/api/app/applications/start", { method: "POST", body: { work_item_id: "wi-1", product_line: "final_expense" } });
  });

  test("from Quick quote: back says Quote, the coverage and the quoted carrier show, and the pick rides into the case", async () => {
    Object.assign(mockParams, { from: "quote", carrier: "car-aa", carrierName: "American Amicable", product: "Senior Choice", productCode: "final_expense", tier: "level", face: "1500000" });
    serve();
    const user = userEvent.setup();
    await render(<StartApplication />);
    expect(await screen.findByText("For Linda Okafor · 68 · Georgia · $15,000")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Back to Quote" })).toBeOnTheScreen();
    const fe = screen.getByTestId("app-start-final_expense");
    expect(within(fe).getByText("American Amicable · Senior Choice")).toBeOnTheScreen();
    expect(within(fe).getByText("Picked")).toBeOnTheScreen();
    await user.press(screen.getByRole("button", { name: "Start final expense application" }));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith({ pathname: "/application/[caseId]", params: { caseId: "case-9", carrier: "car-aa", tier: "level", face: "1500000" } }));
  });

  test("a lead someone else holds can't start here, and says why", async () => {
    mockApi.mockImplementation(async (path: string) => {
      if (path === "/api/app/leads/lead-1") return lead({ id: "wi-1", status: "claimed", owner_user_id: "someone-else" });
      if (path === "/api/app/products/sold") return products;
      throw new Error(`unexpected ${path}`);
    });
    await render(<StartApplication />);
    expect(await screen.findByTestId("app-start-blocked")).toHaveTextContent("Someone else is working this lead; they start its application.");
    expect(screen.getByRole("button", { name: "Start whole life application" })).toBeDisabled();
  });
});
