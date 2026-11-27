import { render, screen, userEvent } from "@testing-library/react-native";

import { callTodayRows, clockTime, countdown, lastFileSub, ringCard } from "../home-logic";
import { RetentionHome } from "../retention-home";
import type { CaseItem } from "../types";

/**
 * Board B7 · Home · retention, drawn from mocked answers of GET /api/app/retention/cases (with the board's two added
 * facts: `lastFileAt` and `team`) and GET /api/app/retention/servicing?list=waiting.
 */
const mockApi = jest.fn();
const mockPush = jest.fn();
jest.mock("@/lib/session", () => ({ useSession: () => ({ api: mockApi }) }));
jest.mock("expo-router", () => ({ router: { push: (...a: unknown[]) => mockPush(...a), back: jest.fn() } }));

const NOW = new Date(2026, 10, 25, 9, 30, 0);
beforeEach(() => {
  mockApi.mockReset();
  mockPush.mockReset();
  jest.spyOn(Date, "now").mockReturnValue(NOW.getTime());
});
afterEach(() => jest.restoreAllMocks());

const evidence = { status: null, carrierWord: null, fileDate: "2026-11-25", paidTo: null, lapsedOn: null, daysPastDue: null, byPerson: false };
const kase = (over: Partial<CaseItem>): CaseItem => ({
  id: "a", clientName: "Ruth Alva", carrierName: "Mutual of Omaha", policyNumber: "MO-1", step: "pending_lapse", reason: "pending_lapse",
  reasonLabel: "Carrier says lapse pending", status: "open", deadline: "2026-11-27", daysLeft: 2, contactAttempts: 0, unreachable: false,
  lastContactAt: null, lastCall: null, openedAt: "2026-11-16T10:00:00Z", evidence, ...over,
});
const sixOhTwo = new Date(2026, 10, 25, 6, 2, 0).toISOString();
const answer = (over = {}) => ({
  available: true, today: "2026-11-25", lastFileDate: "2026-11-25", lastFileAt: sixOhTwo,
  month: { saved: 23, lost: 18, closedNoSave: 2 }, team: { saved: 48, lost: 52 },
  cases: [
    kase({ id: "a" }),
    kase({ id: "b", clientName: "Calvin Reed", carrierName: "Corebridge", daysLeft: 4, deadline: "2026-11-29" }),
    kase({ id: "c", clientName: "Howard Kim", carrierName: "Transamerica", step: "payment_problem", daysLeft: 20, deadline: "2026-12-15" }),
  ],
  ...over,
});
const waiting = {
  available: true,
  requests: [{ id: "r1", caseId: "c", clientName: "Mae Thompson", carrierName: "Royal Neighbors", policyNumber: "RN-1", type: "draft_date_change", status: "submitted", createdAt: "2026-11-19T12:00:00Z", submittedAt: "2026-11-19T12:00:00Z", expectedEffectiveDate: null, verifiedAt: null, verifiedSnapshotDate: null, checkedSnapshotDate: null, unprovable: false }],
};
const detail = (over = {}) => ({ case: { ...kase({ id: "a" }), phone: "4025550100", leadId: "lead-a", canDial: true, ...over } });
const routes = (cases: unknown, one: unknown = detail()) => async (path: string) => (path === "/api/app/retention/cases" ? cases : path === "/api/app/retention/servicing?list=waiting" ? waiting
  : path === "/api/app/retention/cases?id=a" ? one : null);

test("B7 · as drawn: last file's time, the ring as a percentage with the team average, Call today, Waiting on the carrier", async () => {
  mockApi.mockImplementation(routes(answer()));
  const user = userEvent.setup();
  await render(<RetentionHome />);

  expect(await screen.findByText("23 saved of 41 worked")).toBeOnTheScreen();
  expect(screen.getByText("November · team average 48%")).toBeOnTheScreen();
  expect(screen.getByLabelText("56%")).toBeOnTheScreen();
  expect(screen.getByText("Last carrier file 6:02 am")).toBeOnTheScreen();
  expect(screen.getByText("Call today")).toBeOnTheScreen();
  expect(screen.getByText("Pending lapse · Mutual of Omaha")).toBeOnTheScreen();
  expect(screen.getByText("2 days left")).toBeOnTheScreen();
  expect(screen.getByText("4 days left")).toBeOnTheScreen();
  // Twenty days out is not today's call.
  expect(screen.queryByText("Howard Kim")).not.toBeOnTheScreen();
  expect(await screen.findByText("Waiting on the carrier")).toBeOnTheScreen();
  expect(screen.getByText("New draft date sent · 19 Nov")).toBeOnTheScreen();
  expect(screen.getByText("Not in a file yet")).toBeOnTheScreen();
  // Counts of policies, never dollars.
  expect(screen.queryByText(/\$/)).not.toBeOnTheScreen();

  await user.press(screen.getByTestId("case-row-b"));
  expect(mockPush).toHaveBeenCalledWith("/retention/b");

  // Call the next case starts the call through the dialer's checks (the call sheet of the lead behind the policy), not the case page.
  await user.press(screen.getByRole("button", { name: "Call the next case" }));
  expect(mockApi).toHaveBeenCalledWith("/api/app/retention/cases?id=a");
  expect(mockApi).toHaveBeenCalledWith("/api/app/dialer/panel?lead_id=lead-a");
  expect(mockPush).not.toHaveBeenCalledWith("/retention/a");
});

test("B7 · Call the next case with no dialer for this role: F4's call dialog, never a bare tel:", async () => {
  mockApi.mockImplementation(routes(answer(), detail({ canDial: false })));
  const user = userEvent.setup();
  await render(<RetentionHome />);

  await user.press(await screen.findByRole("button", { name: "Call the next case" }));
  expect(await screen.findByText("Call Ruth Alva")).toBeOnTheScreen();
  expect(screen.getByTestId("call-dialog-log")).toBeOnTheScreen();
  expect(mockApi).not.toHaveBeenCalledWith("/api/app/dialer/panel?lead_id=lead-a");
});

test("B7 · Call the next case is always there: with nothing due it opens the Cases list", async () => {
  mockApi.mockImplementation(routes(answer({ cases: [], month: { saved: 0, lost: 0, closedNoSave: 0 }, team: null })));
  const user = userEvent.setup();
  await render(<RetentionHome />);

  expect(await screen.findByText("No cases worked yet")).toBeOnTheScreen();
  expect(screen.getByText("November")).toBeOnTheScreen();
  await user.press(screen.getByRole("button", { name: "Call the next case" }));
  expect(mockPush).toHaveBeenCalledWith("/retention");
});

test("B7 rules · the ring, the subtitle, the rows and the countdown", () => {
  expect(ringCard({ saved: 23, lost: 18 }, "2026-11-25", { saved: 12, lost: 13 })).toEqual({ pct: (23 / 41) * 100, label: "56%", title: "23 saved of 41 worked", line: "November · team average 48%" });
  expect(ringCard({ saved: 0, lost: 0 }, "2026-11-25", { saved: 0, lost: 0 }).line).toBe("November");
  expect(clockTime(new Date(2026, 10, 25, 18, 5))).toBe("6:05 pm");
  expect(clockTime(new Date(2026, 10, 25, 0, 7))).toBe("12:07 am");
  expect(lastFileSub(new Date(2026, 10, 19, 6, 2).toISOString(), null, NOW)).toBe("Last carrier file 19 Nov");
  expect(lastFileSub(null, "2026-11-18", NOW)).toBe("Last carrier file 18 Nov");
  expect(lastFileSub(null, null, NOW)).toBeUndefined();
  expect(callTodayRows([kase({ id: "x", daysLeft: -3 }), kase({ id: "y", daysLeft: 7 }), kase({ id: "z", daysLeft: 8 })]).map((c) => c.id)).toEqual(["x", "y"]);
  expect(countdown({ daysLeft: -1 })).toBe("1 day over");
  expect(countdown({ daysLeft: 0 })).toBe("Due today");
  expect(countdown({ daysLeft: null })).toBeNull();
});
