import { render, screen } from "@testing-library/react-native";

import { HomeManager } from "../home-manager";

/**
 * Board B8 · the manager's Floor, drawn from mocked answers of the routes it reads. People in counts, never dollars.
 */
const mockApi = jest.fn();
const mockPush = jest.fn();
jest.mock("@/lib/session", () => ({
  useSession: () => ({ api: mockApi, me: { user: { id: "me", email: "dana@example.test", name: "Dana Ellery" }, tenant: { id: "t", name: "Ellery & Fields", status: "active", plan_code: null }, role: "producer", memberRole: "producer", agencyTitle: "manager", roles: ["producer"] } }),
}));
jest.mock("expo-router", () => ({ router: { push: (...a: unknown[]) => mockPush(...a), back: jest.fn() } }));
jest.mock("@/lib/nav", () => ({ useNav: () => ({ go: jest.fn() }) }));

const NOW = new Date(2026, 10, 17, 15, 0, 0);
const t = (h: number, m: number, s = 0) => new Date(2026, 10, 17, h, m, s).toISOString();
const at = (d: number, h = 12) => new Date(2026, 10, d, h).toISOString();
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

const member = (id: string, name: string, availability: string, extra = {}) => ({ id, name, role: "producer", availability, away: false, lastSeenAt: null, statusChangedAt: null, call: null, lastCall: null, ...extra });
const floor = {
  generatedAt: t(15, 0),
  waiting: [{ id: "w1", customer: "Walter Brooks", queuedAt: t(14, 59, 12) }],
  members: [
    member("me", "Dana Ellery", "ready"),
    member("s", "Sam Lee", "ready", { statusChangedAt: t(14, 57) }),
    member("t", "Tom Baker", "off", { statusChangedAt: t(11, 20) }),
    member("a", "Ava Kim", "on_call", { call: { workItemId: "x", leadId: "l", customer: "Linda Okafor", partnerName: null, startedAt: t(14, 53, 48) } }),
  ],
  callbacks: [
    { id: "cb1", isOverdue: true, status: "missed", assignedTo: "a" },
    { id: "cb2", isOverdue: true, status: "due", assignedTo: "s" },
    { id: "cb3", isOverdue: false, isDueToday: true, status: "scheduled", assignedTo: "s" },
  ],
};

test("B8 · the floor in counts, rows on a call → away → ready, never dollars", async () => {
  mockApi.mockImplementation(route({
    "/api/app/agent-floor": floor,
    "/api/app/applications": { applications: [
      { applicationId: "1", caseId: "c", status: "submitted", outcome: null, monthlyPremiumCents: 5000, submittedAt: at(17, 10), updatedAt: at(17) },
      { applicationId: "2", caseId: "c", status: "submitted", outcome: null, monthlyPremiumCents: 5000, submittedAt: at(17, 11), updatedAt: at(17) },
    ] },
  }));
  await render(<HomeManager />);

  expect(await screen.findByText("On a call · 6:12 · Linda Okafor")).toBeOnTheScreen();
  expect(screen.getByText("Floor")).toBeOnTheScreen();
  expect(screen.getByText("Your team · 3 producers")).toBeOnTheScreen();
  expect(screen.getByText("of 2 taking calls")).toBeOnTheScreen();
  expect(screen.getByText("Longest 0:48")).toBeOnTheScreen();
  expect(screen.getByText("2 people")).toBeOnTheScreen();
  expect(await screen.findByText("↑ 2")).toBeOnTheScreen();
  expect(screen.getByText("Not taking calls since 11:20")).toBeOnTheScreen();
  expect(screen.getByText("Waiting for a transfer · 3 min")).toBeOnTheScreen();
  // The board's order: busy first, free to take the next transfer last.
  expect(screen.getAllByTestId(/^floor-[ast]$/).map((r) => r.props.testID)).toEqual(["floor-a", "floor-t", "floor-s"]);
  expect(screen.queryByText(/\$/)).not.toBeOnTheScreen();
  expect(screen.queryByText("Dana Ellery")).not.toBeOnTheScreen();
});

test("B8 · the Applications tile stays when its read fails: a dash, and the four tiles keep their grid", async () => {
  mockApi.mockImplementation(route({ "/api/app/agent-floor": floor, "/api/app/applications": new Error("no") }));
  await render(<HomeManager />);

  expect(await screen.findByText("Not available")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Applications today: —" })).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "On a call now: 1" })).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Transfers waiting: 1" })).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Callbacks overdue: 2" })).toBeOnTheScreen();
});
