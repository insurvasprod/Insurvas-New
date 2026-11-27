import { render, screen, userEvent } from "@testing-library/react-native";

import { CaseScreen } from "../case-screen";
import { CasesScreen } from "../cases-screen";
import { RetentionHome } from "../retention-home";
import { WinbackScreen } from "../win-back-screen";
import type { CaseItem } from "../types";
import { ApiError } from "@/lib/api";

/**
 * Boards B7, F3, F4 and F3c drawn from mocked answers of the routes they read: GET /api/app/retention/cases (the
 * list and `?id=`), GET /api/app/retention/servicing?list=waiting and GET /api/app/retention/winback.
 */
const mockApi = jest.fn();
const mockPush = jest.fn();
jest.mock("@/lib/session", () => ({ useSession: () => ({ api: mockApi }) }));
jest.mock("expo-router", () => ({ router: { push: (...a: unknown[]) => mockPush(...a), back: jest.fn() } }));
jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn(async () => true) }));

beforeEach(() => { mockApi.mockReset(); mockPush.mockReset(); });

const evidence = { status: null, carrierWord: null, fileDate: "2026-11-18", paidTo: null, lapsedOn: null, daysPastDue: null, byPerson: false };
const kase = (over: Partial<CaseItem>): CaseItem => ({
  id: "a", clientName: "Ruth Alva", carrierName: "Mutual of Omaha", policyNumber: "MO-1", step: "pending_lapse", reason: "pending_lapse",
  reasonLabel: "Carrier says lapse pending", status: "open", deadline: "2026-11-27", daysLeft: 2, contactAttempts: 0, unreachable: false,
  lastContactAt: null, lastCall: null, openedAt: "2026-11-16T10:00:00Z", evidence, ...over,
});
const list = {
  available: true, today: "2026-11-25", lastFileDate: "2026-11-18", month: { saved: 23, lost: 18, closedNoSave: 0 },
  cases: [
    kase({ id: "a" }),
    kase({ id: "b", clientName: "Calvin Reed", carrierName: "Corebridge", daysLeft: -3, deadline: "2026-11-22" }),
    kase({ id: "c", clientName: "Howard Kim", carrierName: "Transamerica", step: "payment_problem", reason: "first_draft_failed", reasonLabel: "First payment missed", daysLeft: 20, deadline: "2026-12-15", contactAttempts: 1 }),
    kase({ id: "d", clientName: "Harriet Lowe", step: "paperwork", reason: "payment_date_change", reasonLabel: "Wants a new payment date", daysLeft: null, deadline: null }),
  ],
};
const waiting = {
  available: true,
  requests: [{ id: "r1", caseId: "c", clientName: "Mae Thompson", carrierName: "Royal Neighbors", policyNumber: "RN-1", type: "draft_date_change", status: "submitted", createdAt: "2026-11-19T12:00:00Z", submittedAt: "2026-11-19T12:00:00Z", expectedEffectiveDate: null, verifiedAt: null, verifiedSnapshotDate: null, checkedSnapshotDate: null, unprovable: false }],
};

test("B7 · the rep's day in counts: the save rate, the next case, today's calls and what waits on a carrier", async () => {
  mockApi.mockImplementation(async (path: string) => (path === "/api/app/retention/cases" ? list : path === "/api/app/retention/servicing?list=waiting" ? waiting : null));
  const user = userEvent.setup();
  await render(<RetentionHome />);

  expect(await screen.findByText("23 saved of 41 worked")).toBeOnTheScreen();
  expect(screen.getByText("Last carrier file 18 Nov")).toBeOnTheScreen();
  expect(screen.getByLabelText("56%")).toBeOnTheScreen();
  expect(screen.queryByText(/\$/)).not.toBeOnTheScreen();
  // Past the carrier's date first, with its real days over.
  expect(screen.getByText("3 days over")).toBeOnTheScreen();
  expect(await screen.findByText("Not in a file yet")).toBeOnTheScreen();
  await user.press(screen.getByRole("button", { name: "Call the next case" }));
  expect(mockPush).toHaveBeenCalledWith("/retention/b");
});

test("F3 · tiles count each step, cases group as drawn (past the date sits in this week), and a tile picks its step", async () => {
  mockApi.mockResolvedValue({ ...list, lastFileAt: "2026-11-18T11:02:00Z" });
  const user = userEvent.setup();
  await render(<CasesScreen />);

  expect(await screen.findByText("Lost this week unless worked · 2")).toBeOnTheScreen();
  expect(screen.queryByText(/Past the carrier’s date/)).not.toBeOnTheScreen();
  expect(screen.getByText("This month · 1")).toBeOnTheScreen();
  expect(screen.getByText("From carrier files · last file 18 Nov")).toBeOnTheScreen();
  expect(screen.getByText("Address, bank, beneficiary")).toBeOnTheScreen();
  expect(screen.getByText("1 this week")).toBeOnTheScreen();
  expect(screen.queryByText("Harriet Lowe")).not.toBeOnTheScreen();
  await user.press(screen.getByRole("button", { name: "Paperwork: 1" }));
  expect(screen.getByText("Harriet Lowe")).toBeOnTheScreen();
  expect(screen.queryByText("Ruth Alva")).not.toBeOnTheScreen();
  await user.press(screen.getByRole("button", { name: /Harriet Lowe/ }));
  expect(mockPush).toHaveBeenCalledWith("/retention/d");
});

const caseAnswer = (over: Record<string, unknown> = {}) => ({
  case: {
    ...kase({ evidence: { ...evidence, carrierWord: "DRAFT RTN NSF 11/02, 11/16 — PENDING LAPSE" } }), phone: "4045550142", monthlyCents: 3890, product: "living_promise", ownerName: "Jo",
    servicingRequestId: null, nextAction: "Take the payment", resolvedAt: null, outcomeReason: null,
    calls: [{ at: "2026-11-23T15:00:00Z", outcome: "no_answer", did: null, note: null, by: "Jo" }],
    leadId: "lead-9", canDial: true, clientState: "TX", clientZone: "America/Chicago", fileRow: 1204, clientCallsCarrier: false, ...over,
  },
});

test("F4 · Lost on the real date, the file and its row, the board's four steps; Call goes through the lead's dialer", async () => {
  mockApi.mockImplementation(async (path: string) => {
    if (path === "/api/app/retention/cases?id=a") return caseAnswer();
    // The call sheet's own read: refused here, so the test stops at the dialer.
    throw new Error("no dialer in this test");
  });
  const user = userEvent.setup();
  await render(<CaseScreen id="a" />);

  expect(await screen.findByText("Fri 27 Nov")).toBeOnTheScreen();
  expect(screen.getByText("Lost on")).toBeOnTheScreen();
  expect(screen.getByText("2 days left · grace ends at the carrier")).toBeOnTheScreen();
  expect(screen.getByText("“DRAFT RTN NSF 11/02, 11/16 — PENDING LAPSE”")).toBeOnTheScreen();
  expect(screen.getByText("Mutual of Omaha policy file · 18 Nov · row 1,204")).toBeOnTheScreen();
  expect(screen.getByText(/\$38\.90\/mo/)).toBeOnTheScreen();
  expect(screen.getByText("Call Ruth and find a draft date that clears")).toBeOnTheScreen();
  expect(screen.getByText("Called 23 Nov · no answer")).toBeOnTheScreen();
  expect(screen.getByText("Wait for the next file to show it paid")).toBeOnTheScreen();
  await user.press(screen.getByRole("button", { name: "Call Ruth" }));
  expect(mockApi).toHaveBeenCalledWith("/api/app/dialer/panel?lead_id=lead-9");
  expect(screen.queryByText(/\(404\) 555-0142/)).not.toBeOnTheScreen();
});

test("F4 · a role the dialer refuses (retention) never dials: the reason, the number and Log attempt", async () => {
  mockApi.mockResolvedValue(caseAnswer({ canDial: false }));
  const user = userEvent.setup();
  await render(<CaseScreen id="a" />);
  await user.press(await screen.findByRole("button", { name: "Call Ruth" }));
  expect(screen.getByText(/The dialer is for owners, producers and setters/)).toBeOnTheScreen();
  expect(screen.getByText(/\(404\) 555-0142/)).toBeOnTheScreen();
  expect(mockApi).not.toHaveBeenCalledWith("/api/app/dialer/panel?lead_id=lead-9");
  await user.press(screen.getByTestId("call-dialog-log"));
  expect(await screen.findByText("Log an attempt")).toBeOnTheScreen();
});

test("F3c · a retention rep is told win-back isn't theirs (the server's 403)", async () => {
  mockApi.mockRejectedValue(new ApiError(403, { error: "Only owners and producers can use this." }));
  await render(<WinbackScreen />);
  expect(await screen.findByText("Win-back isn’t part of your role")).toBeOnTheScreen();
});

test("F3c · ready people come first and open their lead's call sheet", async () => {
  mockApi.mockImplementation(async (path: string) => {
    if (path === "/api/app/retention/winback") {
      return { available: true, today: "2026-11-25", people: [
        { id: "w2", clientName: "Opal Simms", carrierName: "AMAM", policyNumber: "A-2", lapsedOn: "2026-03-02", category: "unknown", band: "fair", eligibleFrom: "2026-12-05", releasedAt: null, leadId: null, blockedReason: null },
        { id: "w1", clientName: "Vernon Hayes", carrierName: "Transamerica", policyNumber: "T-1", lapsedOn: "2026-06-10", category: "affordability", band: "strong", eligibleFrom: "2026-10-01", releasedAt: "2026-10-02T00:00:00Z", leadId: "lead-1", blockedReason: null },
      ] };
    }
    // The call sheet's own read: refused here, so the test stops at its dialog.
    throw new Error("no dialer in this test");
  });
  const user = userEvent.setup();
  await render(<WinbackScreen />);
  expect(await screen.findByText("Cooling-off passed · 1 person")).toBeOnTheScreen();
  const rows = screen.getAllByText(/Vernon Hayes|Opal Simms/).map((n) => n.props.children);
  expect(rows).toEqual(["Vernon Hayes", "Opal Simms"]);
  expect(screen.getByText("Try in Dec")).toBeOnTheScreen();
  await user.press(screen.getByRole("button", { name: /Vernon Hayes/ }));
  expect(mockApi).toHaveBeenCalledWith("/api/app/dialer/panel?lead_id=lead-1");
});
