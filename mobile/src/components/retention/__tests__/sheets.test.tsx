import { fireEvent, render, screen, userEvent, waitFor } from "@testing-library/react-native";

import { LogAttemptSheet, retryLabel } from "../log-attempt-sheet";
import { NewCaseSheet } from "../new-case-sheet";
import type { CaseDetail } from "../types";

/**
 * Boards F5 and F3d, the two Retention writes, against a mocked server only: logging an attempt
 * (POST cases {action: "call"} with when to try again, then {action: "fix"} when the change is marked sent) and
 * opening a case (the policy search, then POST cases {action: "open"}).
 */
const mockApi = jest.fn();
jest.mock("@/lib/session", () => ({ useSession: () => ({ api: mockApi }) }));

beforeEach(() => mockApi.mockReset());

const item: CaseDetail = {
  id: "11111111-1111-4111-8111-111111111111", clientName: "Ruth Alva", carrierName: "Mutual of Omaha", policyNumber: "MO-87004213", step: "pending_lapse",
  reason: "pending_lapse", reasonLabel: "Carrier says lapse pending", status: "working", deadline: "2026-11-26", daysLeft: 2, contactAttempts: 1,
  unreachable: false, lastContactAt: null, lastCall: null, openedAt: "2026-11-16T10:00:00Z",
  evidence: { status: null, carrierWord: null, fileDate: null, paidTo: null, lapsedOn: null, daysPastDue: null, byPerson: false },
  phone: null, monthlyCents: 3890, product: null, ownerName: null, servicingRequestId: null, nextAction: "Take the payment", resolvedAt: null, outcomeReason: null, calls: [],
  clientState: "TX", clientZone: "America/Chicago",
};

test("F5 · the board's sheet: an outcome, what changed, Try again in the client's time, and the change marked sent (drawn on)", async () => {
  mockApi.mockResolvedValue({ ok: true });
  const onSaved = jest.fn();
  const user = userEvent.setup();
  await render(<LogAttemptSheet item={item} visible onClose={() => undefined} onSaved={onSaved} />);

  // Drawn defaults: Reached chosen, Try again filled at 10:00 their time the next day, the switch on.
  expect(screen.getByRole("button", { name: "Save attempt" })).toBeEnabled();
  expect(screen.getByRole("button", { name: /^Try again: \w{3} \d{1,2} \w{3} · 10:00 am their time$/ })).toBeOnTheScreen();
  // No "What you did" chips: the board has none.
  expect(screen.queryByText("What you did")).not.toBeOnTheScreen();
  await user.press(screen.getByRole("button", { name: "Reached them" }));
  await user.type(screen.getByLabelText("What changed"), "New bank, draft on the 5th");
  await user.press(screen.getByRole("button", { name: /^Try again:/ }));
  expect(screen.getByText("Their time")).toBeOnTheScreen();
  await user.press(screen.getByText("10:00 am"));
  expect(screen.getByRole("button", { name: /^Try again: \w{3} \d{1,2} \w{3} · 10:00 am their time$/ })).toBeOnTheScreen();
  expect(screen.getByLabelText("Mark “Send the change” as done")).toBeOnTheScreen();
  await user.press(screen.getByRole("button", { name: "Save attempt" }));

  await waitFor(() => expect(onSaved).toHaveBeenCalled());
  const call = mockApi.mock.calls[0];
  expect(call[0]).toBe("/api/app/retention/cases");
  expect(call[1].body).toMatchObject({ action: "call", id: item.id, outcome: "reached_agreed", did: "none", note: "New bank, draft on the 5th" });
  const at = new Date(call[1].body.next_attempt_at);
  // 10:00 in Chicago is 15:00 or 16:00 UTC, whatever the phone's own zone.
  expect([15, 16]).toContain(at.getUTCHours());
  expect(call[1].body.next_attempt_label).toBe(retryLabel(at, "America/Chicago", true));
  expect(call[1].body.client_calls_carrier).toBeUndefined();
  expect(mockApi.mock.calls[1]).toEqual(["/api/app/retention/cases", { method: "POST", body: { action: "fix", id: item.id, kind: "sent_to_carrier", note: null } }]);
});

test("F5 · They'll call the carrier is a reached call the server keeps as theirs; the switch can be turned off", async () => {
  mockApi.mockResolvedValue({ ok: true });
  const user = userEvent.setup();
  await render(<LogAttemptSheet item={item} visible onClose={() => undefined} onSaved={() => undefined} />);
  await user.press(screen.getByRole("button", { name: "They’ll call the carrier" }));
  fireEvent(screen.getByLabelText("Mark “Send the change” as done"), "valueChange", false);
  await user.press(screen.getByRole("button", { name: "Save attempt" }));
  await waitFor(() => expect(mockApi).toHaveBeenCalledTimes(1));
  expect(mockApi.mock.calls[0][1].body).toMatchObject({ action: "call", id: item.id, outcome: "reached_agreed", did: "none", note: null, client_calls_carrier: true });
});

test("F5 · nobody reached: no switch, and only the call is posted", async () => {
  mockApi.mockResolvedValue({ ok: true });
  const user = userEvent.setup();
  await render(<LogAttemptSheet item={item} visible onClose={() => undefined} onSaved={() => undefined} />);
  await user.press(screen.getByRole("button", { name: "No answer" }));
  expect(screen.queryByLabelText("Mark “Send the change” as done")).not.toBeOnTheScreen();
  await user.press(screen.getByRole("button", { name: "Save attempt" }));
  await waitFor(() => expect(mockApi).toHaveBeenCalledTimes(1));
  expect(mockApi.mock.calls[0][1].body).toMatchObject({ action: "call", id: item.id, outcome: "no_answer", did: "none", note: null });
  expect(mockApi.mock.calls[0][1].body.next_attempt_at).toEqual(expect.any(String));
});

test("F5 · a case already with the carrier offers no 'sent' switch, and the server's refusal is shown", async () => {
  mockApi.mockRejectedValue(Object.assign(new Error("This case is closed."), { status: 409 }));
  const user = userEvent.setup();
  await render(<LogAttemptSheet item={{ ...item, status: "waiting_on_carrier" }} visible onClose={() => undefined} onSaved={() => undefined} />);
  await user.press(screen.getByRole("button", { name: "Reached them" }));
  expect(screen.queryByLabelText("Mark “Send the change” as done")).not.toBeOnTheScreen();
  await user.press(screen.getByRole("button", { name: "Save attempt" }));
  expect(await screen.findByRole("alert")).toBeOnTheScreen();
});

test("F3d · find the policy, pick one of the board's five reasons, and open the case", async () => {
  mockApi.mockImplementation(async (path: string, init?: { method?: string; body?: Record<string, unknown> }) => {
    if (path.startsWith("/api/app/retention/servicing/policies?q=")) return { policies: [{ carrierId: "c-rn", carrierName: "Royal Neighbors", policyNumber: "RN-2210987", clientName: "Harriet Lowe", phone: null, status: "active" }] };
    if (path === "/api/app/retention/cases" && init?.method === "POST") return { ok: true, id: "case-9" };
    throw new Error(`unexpected ${path}`);
  });
  const onOpened = jest.fn();
  const user = userEvent.setup();
  await render(<NewCaseSheet visible onClose={() => undefined} onOpened={onOpened} />);

  for (const reason of ["Changed banks", "Can’t afford it", "Moved", "Wants to cancel", "Beneficiary change"]) expect(screen.getByRole("button", { name: reason })).toBeOnTheScreen();
  await user.type(screen.getByLabelText("Policy"), "Lowe");
  await user.press(await screen.findByRole("button", { name: /Harriet Lowe/ }, { timeout: 2000 }));
  expect(screen.getByLabelText("Policy")).toHaveDisplayValue("Harriet Lowe · RN-2210987 · Royal Neighbors");
  await user.press(screen.getByRole("button", { name: "Changed banks" }));
  await user.type(screen.getByLabelText("What they said"), "New account at Navy Federal from December");
  await user.press(screen.getByRole("button", { name: "Open case" }));

  await waitFor(() => expect(onOpened).toHaveBeenCalledWith("case-9"));
  const post = mockApi.mock.calls.find(([p, i]) => p === "/api/app/retention/cases" && i?.method === "POST");
  expect(post?.[1].body).toEqual({ action: "open", carrier_id: "c-rn", policy_number: "RN-2210987", reason: "payment_date_change", note: "Changed banks: New account at Navy Federal from December" });
});

test("F3d · opened from a policy, the policy is already chosen", async () => {
  await render(<NewCaseSheet visible initial={{ carrierId: "c-am", carrierName: "American Amicable", policyNumber: "0119990312", clientName: "Maria Alvarez", phone: null, status: null }} onClose={() => undefined} onOpened={() => undefined} />);
  expect(screen.getByLabelText("Policy")).toHaveDisplayValue("Maria Alvarez · 0119990312 · American Amicable");
});
