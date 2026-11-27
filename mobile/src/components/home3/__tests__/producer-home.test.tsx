import { render, screen, userEvent } from "@testing-library/react-native";

import { HomeProducer } from "../home-producer";

/**
 * Board B1 · the producer's Home drawn from mocked answers of the routes it reads. Nothing is written: the screen
 * only reads, and a tap only moves to another screen.
 */
const mockApi = jest.fn();
const mockPush = jest.fn();
const mockGo = jest.fn();
let mockCounts: Record<string, number> | null = null;
jest.mock("@/lib/session", () => ({
  useSession: () => ({ api: mockApi, me: { user: { id: "me", email: "jordan@example.test", name: "Jordan Reyes" }, tenant: { id: "t", name: "Ellery & Fields", status: "active", plan_code: null }, role: "producer", memberRole: "producer", agencyTitle: null, roles: ["producer"] } }),
}));
jest.mock("expo-router", () => ({ router: { push: (...a: unknown[]) => mockPush(...a), back: jest.fn() } }));
jest.mock("@/lib/nav", () => ({ useNav: () => ({ go: (...a: unknown[]) => mockGo(...a) }) }));
jest.mock("@/lib/counts", () => ({ useCounts: () => ({ calls: 0, inbox: 0, money: 0, nav: mockCounts ? { counts: mockCounts } : null, refresh: jest.fn() }) }));

// Tuesday 24 November 2026, 3 pm on the phone: this week is Mon 23 – Tue 24, last week's same days 16 – 17.
const NOW = new Date(2026, 10, 24, 15, 0, 0);
const local = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).toISOString();
beforeEach(() => {
  mockApi.mockReset();
  mockPush.mockReset();
  mockGo.mockReset();
  mockCounts = null;
  jest.spyOn(Date, "now").mockReturnValue(NOW.getTime());
});
afterEach(() => jest.restoreAllMocks());

const route = (answers: Record<string, unknown>) => async (path: string) => {
  const key = path.startsWith("/api/app/calendar?") ? "/api/app/calendar" : path;
  if (key in answers) {
    const a = answers[key];
    if (a instanceof Error) throw a;
    return a;
  }
  throw new Error(`unexpected ${path}`);
};

const callback = (id: string, name: string, at: string, extra: Record<string, unknown> = {}) => ({
  id, leadId: `l-${id}`, workItemId: null, customerName: name, scheduledAtUtc: at, customerTimezone: null, customerTime: null, agentTime: null,
  assignedTo: "me", assigneeName: "Jordan Reyes", note: null, status: "scheduled", productName: null, phone: null, state: null, attemptNumber: null,
  isOverdue: false, isDueToday: true, ...extra,
});

const answers = {
  "/api/app/callbacks": { viewer: { userId: "me", role: "producer" }, callbacks: [
    callback("c1", "Maria Alvarez", local(24, 13), { isOverdue: true, status: "missed" }),
    callback("c2", "James Whitfield", local(24, 18, 15)),
    callback("c3", "Done Already", local(24, 9), { status: "completed" }),
  ] },
  "/api/app/calendar": { appointments: [
    { appointmentId: "a1", leadId: "l9", customerName: "Patricia Moore", agentUserId: "me", agentName: "Jordan Reyes", startsAtUtc: local(24, 16), durationMinutes: 30, customerTimezone: "", status: "booked", notes: null, bookedByUserId: null, bookedByName: null, product: null },
    // Someone else's diary and a cancelled one stay off this schedule.
    { appointmentId: "a2", leadId: "l8", customerName: "Not Mine", agentUserId: "ava", agentName: "Ava Kim", startsAtUtc: local(24, 17), durationMinutes: 30, customerTimezone: "", status: "booked", notes: null, bookedByUserId: null, bookedByName: null, product: null },
    { appointmentId: "a3", leadId: "l7", customerName: "Called Off", agentUserId: "me", agentName: "Jordan Reyes", startsAtUtc: local(24, 17), durationMinutes: 30, customerTimezone: "", status: "cancelled", notes: null, bookedByUserId: null, bookedByName: null, product: null },
  ] },
  "/api/app/inbound/waiting": { count: 2, readOnly: false, sla: null, items: [
    { id: "w1", customer: "A", productLine: null, partnerName: null, state: null, waitSeconds: 48, screening: "" },
    { id: "w2", customer: "B", productLine: null, partnerName: null, state: null, waitSeconds: 20, screening: "" },
  ] },
  "/api/app/calling-windows": { now: { openStates: 31, closesAt: "9:00 pm ET", opensAt: null } },
  "/api/app/pending": { counteroffers: [], requirements: [
    { id: "r1", applicationId: "x", caseId: "k1", clientName: "Ann Lee", carrierName: "Corebridge", kind: "aps", description: "", waitingOn: "client", status: "open", raisedAt: "2026-11-10", dueAt: null, daysOpen: 14, ageing: "red" },
    // The carrier's own work is not the producer's to do.
    { id: "r2", applicationId: "y", caseId: "k2", clientName: "Bo Diaz", carrierName: "Mutual", kind: "aps", description: "", waitingOn: "carrier", status: "open", raisedAt: "2026-11-20", dueAt: null, daysOpen: 4, ageing: "ok" },
  ] },
  "/api/app/home/producer": { today: "2026-11-24", money: true, available: true, paymentMissed: { count: 2, saveBy: "2026-12-02" }, issued: { since: "2026-10-01", days: [
    { day: "2026-10-20", count: 3, cents: 910000 },
    { day: "2026-11-16", count: 1, cents: 417200 },
    { day: "2026-11-23", count: 1, cents: 300000 },
    { day: "2026-11-24", count: 1, cents: 181200 },
  ] } },
  "/api/app/scorecard?days=14": { scope: "own", rows: [
    { userId: "me", day: "2026-11-24T00:00:00+00:00", dials: 212 },
    { userId: "me", day: "2026-11-23T00:00:00+00:00", dials: 200 },
    { userId: "me", day: "2026-11-17T00:00:00+00:00", dials: 188 },
    { userId: "me", day: "2026-11-16T00:00:00+00:00", dials: 190 },
    // Last Wednesday is past the same days of last week.
    { userId: "me", day: "2026-11-18T00:00:00+00:00", dials: 500 },
  ] },
  "/api/app/applications": { applications: [
    { applicationId: "1", status: "submitted", outcome: null, submittedAt: local(23, 11) },
    { applicationId: "2", status: "pending_carrier", outcome: null, submittedAt: local(24, 10) },
    { applicationId: "3", status: "submitted", outcome: null, submittedAt: local(20, 10) },
    { applicationId: "4", status: "ready", outcome: null, submittedAt: null },
  ] },
  "/api/app/goals?kind=premium&for=me": { goal: { state: "set", target: 1200000 }, period: "month", money: true },
};

test("B1 · what to do next, today's schedule, this week's numbers and the month's goal, every figure from the server", async () => {
  mockCounts = { "leads.dialer": 38, "leads.inbound": 2, "sell.callbacks": 3 };
  mockApi.mockImplementation(route(answers));
  const user = userEvent.setup();
  await render(<HomeProducer />);

  // The hero.
  expect(await screen.findByText("38 leads ready to call")).toBeOnTheScreen();
  expect(screen.getByText("Calling window open in 31 states · closes 9:00 pm ET")).toBeOnTheScreen();

  // Needs you: four tiles, each with the board's detail.
  expect(screen.getByRole("button", { name: "Transfers waiting: 2" })).toBeOnTheScreen();
  expect(await screen.findByText("Longest 0:48")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Callbacks due: 3" })).toBeOnTheScreen();
  expect(await screen.findByText("1 overdue")).toBeOnTheScreen();
  expect(await screen.findByRole("button", { name: "Case needs a doc: 1" })).toBeOnTheScreen();
  expect(screen.getByText("Corebridge · APS")).toBeOnTheScreen();
  expect(await screen.findByRole("button", { name: "Payment missed: 2" })).toBeOnTheScreen();
  expect(screen.getByText("Save by 2 Dec")).toBeOnTheScreen();

  // Schedule: callbacks and appointments together, soonest first; nothing done, cancelled or someone else's.
  expect(await screen.findByText("Patricia Moore")).toBeOnTheScreen();
  expect(screen.getByText("Maria Alvarez")).toBeOnTheScreen();
  expect(screen.getByText("James Whitfield")).toBeOnTheScreen();
  expect(screen.queryByText("Not Mine")).not.toBeOnTheScreen();
  expect(screen.queryByText("Called Off")).not.toBeOnTheScreen();
  expect(screen.queryByText("Done Already")).not.toBeOnTheScreen();
  expect(screen.getByText("Overdue")).toBeOnTheScreen();
  expect(screen.getByText("Appointment")).toBeOnTheScreen();

  // This week: 412 dials against 378 (↑ 9%), applications sent this week, issued premium against last week.
  expect(await screen.findByRole("button", { name: "Dials: 412" })).toBeOnTheScreen();
  expect(screen.getByText("↑ 9%")).toBeOnTheScreen();
  expect(screen.getByText("Talk time")).toBeOnTheScreen();
  expect(screen.getByText("Not recorded on calls yet")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Applications: 2" })).toBeOnTheScreen();
  expect(screen.getByText("1 ready to submit")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Issued premium: $4,812" })).toBeOnTheScreen();
  expect(screen.getByText("↑ $640")).toBeOnTheScreen();

  // The goal: $8,984 issued in November against $12,000; Tue 24 to Mon 30 is five working days.
  expect(await screen.findByText("November goal")).toBeOnTheScreen();
  expect(screen.getByText("$8,984 of $12,000 issued annual premium · 5 working days left")).toBeOnTheScreen();
  expect(screen.getByLabelText("75%")).toBeOnTheScreen();

  await user.press(screen.getByRole("button", { name: "Start calling" }));
  expect(mockGo).toHaveBeenCalledWith("/calls?part=dialer");
  await user.press(screen.getByText("Activity"));
  expect(mockPush).toHaveBeenCalledWith("/reports/activity");
  await user.press(screen.getByRole("button", { name: "Payment missed: 2" }));
  expect(mockPush).toHaveBeenCalledWith("/retention");
});

test("B1 · the tiles always draw: nothing yet is 0, a read that fails is a dash, and nothing is made up", async () => {
  mockCounts = { "leads.dialer": 0, "leads.inbound": 0, "sell.callbacks": 0 };
  mockApi.mockImplementation(route({
    "/api/app/callbacks": { viewer: { userId: "me", role: "producer" }, callbacks: [] },
    "/api/app/calendar": { appointments: [] },
    "/api/app/inbound/waiting": { count: 0, readOnly: false, sla: null, items: [] },
    "/api/app/calling-windows": new Error("no"),
    "/api/app/pending": { counteroffers: [], requirements: [] },
    "/api/app/home/producer": new Error("no"),
    "/api/app/scorecard?days=14": { scope: "own", rows: [] },
    "/api/app/applications": new Error("no"),
    "/api/app/goals?kind=premium&for=me": new Error("no"),
  }));
  await render(<HomeProducer />);

  expect(await screen.findByText("Nothing booked for today")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Transfers waiting: 0" })).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Callbacks due: 0" })).toBeOnTheScreen();
  expect(await screen.findByRole("button", { name: "Case needs a doc: 0" })).toBeOnTheScreen();
  expect(screen.getByText("Payment missed")).toBeOnTheScreen();
  expect(await screen.findByRole("button", { name: "Dials: 0" })).toBeOnTheScreen();
  for (const label of ["Talk time", "Applications", "Issued premium"]) expect(screen.getByText(label)).toBeOnTheScreen();
  expect(screen.queryByText("November goal")).not.toBeOnTheScreen();
  expect(screen.queryByText(/↑/)).not.toBeOnTheScreen();
});
