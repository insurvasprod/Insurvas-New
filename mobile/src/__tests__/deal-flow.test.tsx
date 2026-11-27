import { render, screen, userEvent, within } from "@testing-library/react-native";

import DealFlow from "@/app/deal-flow";

/**
 * Board E7: the day's deals from GET /api/app/deal-flow, listed as "Written today" (written deals only),
 * premium for owners and producers only, the rise against the same weekday last week, one chip
 * ("Unsigned") on a written deal whose application still waits on the signature (GET
 * /api/app/applications), and the calendar picks another day.
 */
const mockApi = jest.fn();
const mockPush = jest.fn();
let mockRole = "owner";
jest.mock("expo-router", () => ({ router: { push: (...a: unknown[]) => mockPush(...a), back: jest.fn() } }));
jest.mock("@/lib/session", () => ({ useSession: () => ({ api: mockApi, me: { role: mockRole } }) }));

const kpis = (won: number) => ({ deals_worked: 3, won: 2, won_annualised_cents: won, won_unpriced: 0, in_progress: 0, oldest_in_progress_days: null, lost: 1 });
const row = (over: Record<string, unknown>) => ({ id: "d1", lead_id: "l1", insured_name: "Linda Okafor", agent_name: "Ava Kim", carrier: "American Amicable", partner_name: "No partner", monthly_premium_cents: 5217, created_at: "2026-11-25T19:46:00Z", disposition_at: null, stage_name: "Issued", stage_type: "won", ...over });
const applications = { applications: [
  { caseId: "c3", applicationId: "a3", leadId: "l3", clientName: "Ann Murphy", carrierName: "Corebridge", productLabel: null, status: "ready", outcome: null, updatedAt: "2026-11-25T19:00:00Z" },
  { caseId: "c1", applicationId: "a1", leadId: "l1", clientName: "Linda Okafor", carrierName: "American Amicable", productLabel: null, status: "submitted", outcome: null, updatedAt: "2026-11-25T19:50:00Z" },
] };

beforeEach(() => {
  mockApi.mockReset(); mockPush.mockReset(); mockRole = "owner";
  mockApi.mockImplementation(async (path: string) => {
    if (path === "/api/app/applications") return applications;
    if (path.endsWith("page_size=1")) return { rows: [], total: 0, kpis: kpis(50_000) };
    return {
      rows: [
        row({}),
        row({ id: "d2", lead_id: "l2", insured_name: "Paul Stewart", agent_name: "Marcus Ortiz", stage_type: "lost", stage_name: "Not interested" }),
        row({ id: "d3", lead_id: "l3", insured_name: "Ann Murphy", agent_name: "Sam Lee", carrier: "Corebridge", monthly_premium_cents: 9500, created_at: "2026-11-25T17:20:00Z" }),
      ],
      total: 3, kpis: kpis(62_604),
    };
  });
});

test("an owner sees the premium, the bold rise on last week, written deals only and Unsigned on the one waiting for a signature", async () => {
  const user = userEvent.setup();
  await render(<DealFlow />);
  const tile = await screen.findByTestId("deal-premium");
  expect(within(tile).getByText("$626")).toBeOnTheScreen();
  expect(within(tile).getByText(/↑ \$126/)).toBeOnTheScreen();
  // The tile and Linda's row; the lost deal is not in "Written today".
  expect(screen.getAllByText("$626")).toHaveLength(2);
  expect(screen.getByText("Written today")).toBeOnTheScreen();
  expect(screen.queryByTestId("deal-d2")).toBeNull();
  expect(screen.queryByText("Not interested")).toBeNull();
  expect(within(screen.getByTestId("deal-d3")).getByText("Unsigned")).toBeOnTheScreen();
  expect(within(screen.getByTestId("deal-d1")).queryByText("Unsigned")).toBeNull();
  expect(within(screen.getByTestId("deal-count")).getByText("1 needs a signature")).toBeOnTheScreen();
  await user.press(screen.getByTestId("deal-d1"));
  expect(mockPush).toHaveBeenCalledWith("/lead/l1");
});

test("a role the web keeps from premium sees counts and no money", async () => {
  mockRole = "assistant";
  await render(<DealFlow />);
  expect(await screen.findByTestId("deal-won")).toBeOnTheScreen();
  expect(screen.queryByText(/\$/)).toBeNull();
  // The day and the signature state are asked for; last week's premium is not.
  expect(mockApi.mock.calls.map(([p]) => p as string).sort()).toEqual([expect.stringMatching(/page_size=500$/), "/api/app/applications"].sort());
  expect(mockApi.mock.calls.some(([p]) => (p as string).endsWith("page_size=1"))).toBe(false);
});

test("without the applications list the deals still show, with no chip", async () => {
  mockApi.mockImplementation(async (path: string) => {
    if (path === "/api/app/applications") throw new Error("not on the plan");
    if (path.endsWith("page_size=1")) return { rows: [], total: 0, kpis: kpis(50_000) };
    return { rows: [row({ id: "d3", lead_id: "l3" })], total: 1, kpis: kpis(62_604) };
  });
  await render(<DealFlow />);
  expect(await screen.findByTestId("deal-d3")).toBeOnTheScreen();
  expect(screen.queryByText("Unsigned")).toBeNull();
});

test("the calendar shows another day's deals", async () => {
  const user = userEvent.setup();
  await render(<DealFlow />);
  await screen.findByTestId("deal-premium");
  await user.press(screen.getByRole("button", { name: "Pick a day" }));
  const first = mockApi.mock.calls.find(([p]) => /page_size=500/.test(p as string))![0] as string;
  await user.press(screen.getByText("Yesterday"));
  expect(await screen.findByText(/^Written \w{3} \d+ \w{3}$/)).toBeOnTheScreen();
  const day = (path: string) => /from=(\d{4}-\d{2}-\d{2})&to=\1&page_size=500/.exec(path)?.[1];
  const asked = mockApi.mock.calls.map(([p]) => day(p as string)).filter(Boolean);
  expect(asked).toHaveLength(2);
  expect(Date.parse(asked[0]!) - Date.parse(asked[1]!)).toBe(86_400_000);
  expect(asked[0]).toBe(day(first));
});
