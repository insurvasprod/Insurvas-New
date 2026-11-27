import { render, screen, userEvent } from "@testing-library/react-native";

import { handOffTime, handoffLines, versusYesterday, type MyHandoff } from "../assistant-handoffs";
import { HomeAssistant } from "../home-assistant";
import { HomeSetter } from "../home-setter";
import { setterAppointments, setterRange } from "../setter-appointments";

/**
 * Boards B3 (setter) and B5 (assistant), drawn from mocked answers of the routes they read. Nothing is written:
 * both screens only read, and a tap only moves to another screen.
 */
const mockApi = jest.fn();
const mockPush = jest.fn();
const mockGo = jest.fn();
let mockRole = "setter";
jest.mock("@/lib/session", () => ({
  useSession: () => ({ api: mockApi, me: { user: { id: "me", email: "lena@example.test", name: "Lena Park" }, tenant: { id: "t", name: "Ellery & Fields", status: "active", plan_code: null }, role: mockRole, memberRole: mockRole, agencyTitle: null, roles: [mockRole], plan: { features: null } } }),
}));
jest.mock("expo-router", () => ({ router: { push: (...a: unknown[]) => mockPush(...a), back: jest.fn() } }));
jest.mock("@/lib/nav", () => ({ useNav: () => ({ go: (...a: unknown[]) => mockGo(...a) }) }));

// Tuesday 24 November 2026, 1:00 pm ET.
const NOW = Date.parse("2026-11-24T18:00:00Z");
beforeEach(() => {
  mockApi.mockReset();
  mockPush.mockReset();
  mockGo.mockReset();
  jest.spyOn(Date, "now").mockReturnValue(NOW);
});
afterEach(() => jest.restoreAllMocks());

/** Answers by path prefix; an Error answer is thrown. */
const route = (answers: [string, unknown][]) => async (path: string) => {
  const hit = answers.find(([prefix]) => path.startsWith(prefix));
  if (!hit) throw new Error(`unexpected ${path}`);
  if (hit[1] instanceof Error) throw hit[1];
  return hit[1];
};

const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const appt = (over: Record<string, unknown>) => ({
  appointmentId: "a", leadId: "l", customerName: "Someone", agentUserId: "ag", agentName: "Ava Kim", startsAtUtc: "2026-11-26T19:00:00Z", durationMinutes: 30,
  customerTimezone: "America/New_York", status: "booked", notes: null, bookedByUserId: "me", bookedByName: "Lena Park", product: null, ...over,
});
const CALENDAR = { appointments: [
  appt({ appointmentId: "a1", leadId: "l1", customerName: "Linda Okafor" }),
  appt({ appointmentId: "a2", leadId: "l2", customerName: "George Patel", agentName: "Jordan Reyes", startsAtUtc: "2026-11-26T22:30:00Z", customerTimezone: "America/Chicago", status: "confirmed" }),
  appt({ appointmentId: "a3", leadId: "l3", customerName: "Betty Holmes", agentName: "Marcus Ortiz", startsAtUtc: "2026-11-24T16:00:00Z", status: "showed" }),
  // Another setter's booking (redacted by the server) and a cancelled one never show.
  appt({ appointmentId: "a4", customerName: "Booked", bookedByUserId: null, redacted: true }),
  appt({ appointmentId: "a5", customerName: "Gone Away", status: "cancelled" }),
] };

describe("B3 · Home for a setter", () => {
  beforeEach(() => { mockRole = "setter"; });

  test("the ring, Serve next lead, the four Today tiles and the appointments they set, in the board's order", async () => {
    const today = new Date();
    const older = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 20);
    mockApi.mockImplementation(route([
      ["/api/app/scorecard", { rows: [
        { userId: "me", day: key(today), dials: 96, contacts: 21, booked: 18, showed: 0, noShow: 0 },
        { userId: "me", day: key(older), dials: 0, contacts: 0, booked: 0, showed: 8, noShow: 5 },
      ] }],
      ["/api/app/goals", { goal: { state: "set", target: 25 } }],
      ["/api/app/calendar", CALENDAR],
    ]));
    const user = userEvent.setup();
    await render(<HomeSetter />);

    expect(await screen.findByText("7 to go this week")).toBeOnTheScreen();
    expect(screen.getByText("18/25")).toBeOnTheScreen();
    expect(screen.getByText(/^Week \d+ · target 25 appointments$/)).toBeOnTheScreen();
    expect(screen.getByText("Serve next lead")).toBeOnTheScreen();
    expect(screen.getByText("96")).toBeOnTheScreen();
    expect(screen.getByText("21")).toBeOnTheScreen();
    expect(screen.getByText("Appointments set")).toBeOnTheScreen();
    expect(screen.getByText("62%")).toBeOnTheScreen();
    expect(screen.getByText("last 30 days")).toBeOnTheScreen();

    expect(await screen.findByText("Linda Okafor")).toBeOnTheScreen();
    expect(screen.getByText("With Ava Kim · Thu 2:00 pm ET")).toBeOnTheScreen();
    expect(screen.getByText("With Jordan Reyes · Thu 4:30 pm CT")).toBeOnTheScreen();
    expect(screen.getByText("With Marcus Ortiz · Tue 11:00 am")).toBeOnTheScreen();
    expect(screen.getAllByText("Scheduled")).toHaveLength(2);
    expect(screen.getByText("Showed")).toBeOnTheScreen();
    expect(screen.queryByText("Gone Away")).toBeNull();
    expect(screen.queryByText("Booked")).toBeNull();

    // The calendar is read for the past week and the next two.
    const r = setterRange(NOW);
    expect(mockApi).toHaveBeenCalledWith(`/api/app/calendar?from=${encodeURIComponent(r.from)}&to=${encodeURIComponent(r.to)}`);

    await user.press(screen.getByText("Serve next lead"));
    expect(mockGo).toHaveBeenCalledWith("/calls?part=dialer");
    await user.press(screen.getByText("All"));
    expect(mockPush).toHaveBeenCalledWith("/calendar");
    await user.press(screen.getByText("Linda Okafor"));
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/appointment/[id]", params: { id: "a1", at: "2026-11-26T19:00:00Z" } });
  });

  test("no weekly target: the ring card still shows the week's count; tiles stay", async () => {
    mockApi.mockImplementation(route([
      ["/api/app/scorecard", { rows: [{ userId: "me", day: key(new Date()), dials: 3, contacts: 1, booked: 2, showed: 0, noShow: 0 }] }],
      ["/api/app/goals", { goal: { state: "none" } }],
      ["/api/app/calendar", { appointments: [] }],
    ]));
    await render(<HomeSetter />);
    expect(await screen.findByText("2 set this week")).toBeOnTheScreen();
    expect(screen.getByText(/^Week \d+ · no weekly target set$/)).toBeOnTheScreen();
    expect(screen.getByText("–")).toBeOnTheScreen(); // show rate with nothing closed out
    expect(await screen.findByText("No appointments set yet")).toBeOnTheScreen();
  });

  test("a failed scorecard says so with a retry; the tiles stay, with no figure invented", async () => {
    mockApi.mockImplementation(route([
      ["/api/app/scorecard", new Error("The scorecard is unavailable.")],
      ["/api/app/goals", { goal: { state: "set", target: 25 } }],
      ["/api/app/calendar", { appointments: [] }],
    ]));
    await render(<HomeSetter />);
    expect(await screen.findByText("We couldn’t load your week")).toBeOnTheScreen();
    expect(screen.getByText("Dials")).toBeOnTheScreen();
    // Four tiles and the placeholder ring.
    expect(screen.getAllByText("–")).toHaveLength(5);
  });
});

describe("B5 · Home for an assistant", () => {
  beforeEach(() => { mockRole = "assistant"; });

  const MINE = {
    timezone: "America/New_York",
    handoffs: [
      { id: "h2", workItemId: "w2", leadId: "l2", customer: "Earl Johnson", agentName: "Ava Kim", state: "accepted", offeredAt: "2026-11-24T15:55:00Z", acceptedAt: new Date(2026, 10, 24, 11, 2).toISOString(), checked: 12, fields: 12, disposition: "sold" },
      { id: "h1", workItemId: "w1", leadId: "l1", customer: "Nora Bell", agentName: "Jordan Reyes", state: "waiting", offeredAt: new Date(NOW - 3 * 60_000).toISOString(), acceptedAt: null, checked: 9, fields: 12, disposition: null },
    ],
    today: { verified: 14, handedOff: 9, handedOffYesterday: 6, avgSecondsToHandOff: 400, accepted: 8 },
  };

  test("Take the next caller, your handoffs, today's four tiles, then the callbacks you help with", async () => {
    mockApi.mockImplementation(route([
      ["/api/app/inbound/handoff?mine=1", MINE],
      ["/api/app/inbound/handoff", { licensedAgents: [1, 2, 3, 4, 5, 6].map((n) => ({ id: String(n), name: `Agent ${n}`, role: "producer" })), canOffer: true }],
      ["/api/app/callbacks", { callbacks: [], viewer: { userId: "me", role: "assistant" } }],
    ]));
    const user = userEvent.setup();
    await render(<HomeAssistant />);

    expect(await screen.findByText("Verifying for 6 licensed agents")).toBeOnTheScreen();
    expect(screen.getByText("Take the next caller")).toBeOnTheScreen();
    expect(await screen.findByText("Nora Bell → Jordan Reyes")).toBeOnTheScreen();
    expect(screen.getByText("Offered 3 min ago · 9 of 12 checked")).toBeOnTheScreen();
    expect(screen.getByText("Waiting")).toBeOnTheScreen();
    expect(screen.getByText("Earl Johnson → Ava Kim")).toBeOnTheScreen();
    expect(screen.getByText("Accepted 11:02 · sold")).toBeOnTheScreen();
    // The row's chip and the Today tile's label (board B5 has both).
    expect(screen.getAllByText("Accepted")).toHaveLength(2);

    expect(screen.getByText("Calls verified")).toBeOnTheScreen();
    expect(screen.getByText("14")).toBeOnTheScreen();
    expect(screen.getByText("↑ 3 vs yesterday")).toBeOnTheScreen();
    expect(screen.getByText("6m 40s")).toBeOnTheScreen();
    expect(screen.getByText("8 of 9")).toBeOnTheScreen();
    expect(await screen.findByText("No callbacks due today")).toBeOnTheScreen();

    await user.press(screen.getByText("Take the next caller"));
    expect(mockGo).toHaveBeenCalledWith("/calls?part=incoming");
    await user.press(screen.getByText("Nora Bell → Jordan Reyes"));
    expect(mockPush).toHaveBeenCalledWith("/lead/l1");
    await user.press(screen.getByText("All"));
    expect(mockGo).toHaveBeenCalledWith("/calls?part=callbacks");
  });

  test("a failed handoff read says so; the tiles show no invented figure", async () => {
    mockApi.mockImplementation(route([
      ["/api/app/inbound/handoff?mine=1", new Error("The handoff service is unavailable.")],
      ["/api/app/inbound/handoff", { licensedAgents: [], canOffer: true }],
      ["/api/app/callbacks", { callbacks: [], viewer: { userId: "me", role: "assistant" } }],
    ]));
    await render(<HomeAssistant />);
    expect(await screen.findByText("We couldn’t load your handoffs")).toBeOnTheScreen();
    expect(screen.getAllByText("–")).toHaveLength(4);
  });
});

describe("B3 / B5 helpers", () => {
  test("appointments you set: upcoming soonest first, then closed out latest first, own bookings only", () => {
    const rows = setterAppointments(CALENDAR.appointments, "me", NOW);
    expect(rows.map((r) => [r.title, r.chip.label])).toEqual([["Linda Okafor", "Scheduled"], ["George Patel", "Scheduled"], ["Betty Holmes", "Showed"]]);
    expect(setterAppointments(CALENDAR.appointments, null, NOW)).toEqual([]);
    expect(setterAppointments([appt({ appointmentId: "n", status: "no_show", startsAtUtc: "2026-11-23T16:00:00Z" })], "me", NOW)[0].chip).toEqual({ tone: "warn", label: "No-show" });
  });

  test("handoff lines put waiting ones first and say when one came back", () => {
    const back: MyHandoff = { id: "r", workItemId: "w", leadId: null, customer: "Ruth Alva", agentName: "Sam Lee", state: "expired", offeredAt: new Date(NOW - 20 * 60_000).toISOString(), acceptedAt: null, checked: null, fields: null, disposition: null };
    const [line] = handoffLines([back], NOW);
    expect(line).toMatchObject({ title: "Ruth Alva → Sam Lee", meta: "Offered 20 min ago", chip: { tone: "warn", label: "Timed out" } });
  });

  test("time to hand off and the change against yesterday", () => {
    expect(handOffTime(400)).toBe("6m 40s");
    expect(handOffTime(45)).toBe("45s");
    expect(handOffTime(3900)).toBe("1h 05m");
    expect(handOffTime(null)).toBe("–");
    expect(versusYesterday(9, 6)).toEqual({ strong: "↑ 3", rest: "vs yesterday", good: true });
    expect(versusYesterday(4, 6)).toEqual({ strong: "↓ 2", rest: "vs yesterday", good: false });
    expect(versusYesterday(5, 5)).toEqual({ strong: "Same", rest: "as yesterday", good: false });
  });
});
