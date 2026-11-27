import { render, screen, userEvent } from "@testing-library/react-native";

import CallsTab from "@/app/(tabs)/calls";

/**
 * Boards C1 / C7 / C11 on the Calls tab, from mocked answers of the routes they read: the availability
 * card is always drawn (sliders opens the Inbound team), the dialer's figures include today's Apps and
 * a due callback's row says so, and Callbacks shows Overdue · Today · Tomorrow with no "Later" group,
 * a later day picked from the week strip instead.
 */
const mockApi = jest.fn();
const mockPush = jest.fn();
let mockPart = "incoming";
jest.mock("@/lib/session", () => ({
  useSession: () => ({ api: mockApi, me: { user: { id: "me", email: "j@example.test", name: "Jordan Reyes" }, tenant: { id: "t", name: "Ellery & Fields", status: "active", plan_code: null }, role: "producer", memberRole: "producer", agencyTitle: null, roles: ["producer"] } }),
}));
jest.mock("@/lib/counts", () => ({ useCounts: () => ({ nav: { counts: { "leads.inbound": 2, "sell.callbacks": 3 }, presence: null }, refresh: jest.fn() }) }));
jest.mock("expo-router", () => ({
  router: { push: (...a: unknown[]) => mockPush(...a), back: jest.fn(), setParams: jest.fn() },
  useLocalSearchParams: () => ({ part: mockPart }),
  usePathname: () => "/calls",
}));
jest.mock("expo-notifications", () => ({ getPermissionsAsync: jest.fn(async () => ({ granted: false })) }));

const route = (answers: Record<string, unknown>) => async (path: string) => {
  for (const [prefix, a] of Object.entries(answers)) if (path.startsWith(prefix)) return a;
  throw new Error(`unexpected ${path}`);
};

beforeEach(() => { mockApi.mockReset(); mockPush.mockReset(); });

test("C1 · the availability card is always there and sliders opens the Inbound team", async () => {
  mockPart = "incoming";
  mockApi.mockImplementation(route({
    "/api/app/inbound/waiting": { count: 3, items: [{ id: "w1", customer: "Dolores King", productLine: "final_expense", partnerName: "Apex Leads", state: "FL", waitSeconds: 48, screening: "DNC clear" }], sla: null, readOnly: false, handoffs: [] },
    "/api/app/agent-floor": { members: [], onCalls: [] },
  }));
  const user = userEvent.setup();
  await render(<CallsTab />);
  expect(await screen.findByText("Dolores King")).toBeOnTheScreen();
  // No presence row on the server reads as not taking calls, and the card is drawn anyway.
  expect(screen.getByText("You’re not taking calls")).toBeOnTheScreen();
  // Not on the board: the "Showing the N longest" line.
  expect(screen.queryByText(/Showing the/)).not.toBeOnTheScreen();
  await user.press(screen.getByRole("button", { name: "Inbound team" }));
  expect(mockPush).toHaveBeenCalledWith("/call/team");
});

test("C7 · Called, Contacts and Apps from the server; a due callback reads Callback with its time", async () => {
  mockPart = "dialer";
  const row = (over: Record<string, unknown>) => ({ workItemId: "wi", leadId: "l", tier: 5, tierName: "fresh", name: "Harold Nguyen", state: "TX", attemptsMade: 2, localTime: null, campaignName: "TX Term Nov", phone: "(713) 555-0144", timezone: "America/Chicago", productLine: "term_life", priority: "Low", ...over });
  mockApi.mockImplementation(route({
    "/api/app/dialer/queue": { available: true, count: 2, capped: false, stats: { dials: 41, contacts: 9 }, apps: 2, emptyReason: null,
      rows: [row({}), row({ workItemId: "wi2", leadId: "l2", name: "Ruth Simmons", tier: 2, tierName: "callback", state: "OH", timezone: "America/New_York", productLine: "final_expense", callbackAt: "2026-11-24T20:00:00Z", priority: "High" })] },
    "/api/app/dialer/panel": { lead: { id: "l", fullName: "Harold Nguyen", state: "TX", phone: "+17135550144", productCode: "term_life" }, window: null, client: { status: "clear", basis: null } },
  }));
  await render(<CallsTab />);
  expect(await screen.findByLabelText("Apps 2")).toBeOnTheScreen();
  expect(screen.getByLabelText("Called 41")).toBeOnTheScreen();
  expect(screen.getByText("Final expense · OH · callback 3:00")).toBeOnTheScreen();
  expect(screen.getAllByText("Callback").length).toBeGreaterThan(0);
});

test("C11 · Overdue, Today and Tomorrow only; a later day comes from the week strip", async () => {
  mockPart = "callbacks";
  const day = 86_400_000;
  const at = (ms: number) => new Date(Date.now() + ms).toISOString();
  const cb = (id: string, name: string, when: string, over: Record<string, unknown> = {}) => ({ id, leadId: `lead-${id}`, workItemId: null, customerName: name, scheduledAtUtc: when, customerTimezone: "America/New_York", customerTime: null, agentTime: null, assignedTo: "me", assigneeName: "Jordan Reyes", note: null, status: "scheduled", productName: null, phone: null, state: "NY", attemptNumber: 1, isOverdue: false, isDueToday: false, ...over });
  mockApi.mockImplementation(route({
    "/api/app/callbacks": { viewer: { userId: "me", role: "producer" }, viewerTimezone: "America/New_York", callbacks: [
      cb("1", "Maria Alvarez", at(-2 * 3600_000), { isOverdue: true }),
      cb("2", "Patricia Moore", at(4 * day)),
    ] },
    "/api/app/calendar": { appointments: [] },
  }));
  const user = userEvent.setup();
  await render(<CallsTab />);
  expect(await screen.findByText("Maria Alvarez")).toBeOnTheScreen();
  expect(screen.queryByText(/^Later/)).not.toBeOnTheScreen();
  expect(screen.queryByText("Patricia Moore")).not.toBeOnTheScreen();
  // Pick the day four days out on the strip: its callbacks show under that day.
  const strip = screen.getAllByRole("button").filter((b) => /^[A-Z][a-z]* \d+$/.test(String(b.props.accessibilityLabel)));
  await user.press(strip[4]);
  expect(await screen.findByText("Patricia Moore")).toBeOnTheScreen();
});
