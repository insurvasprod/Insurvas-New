import { render, screen } from "@testing-library/react-native";

import { CallbackDetail, callbackTimeline } from "../callback-detail";
import type { CallbackView } from "@/lib/types";

/**
 * Board C12 · Callback detail: the sub-line is product · city, state, and History mixes the callback's
 * own events with the lead's calls (their outcome; no length, there is no phone provider) and its arrival.
 */
const mockApi = jest.fn();
jest.mock("@/lib/session", () => ({ useSession: () => ({ api: mockApi, me: { user: { id: "u1", name: "Jordan Reyes" } } }) }));
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));

const cb: CallbackView = {
  id: "cb-1", leadId: "lead-1", workItemId: "wi-1", customerName: "Maria Alvarez", scheduledAtUtc: "2026-11-24T15:30:00Z",
  customerTimezone: "America/Chicago", customerTime: null, agentTime: null, assignedTo: "u1", assigneeName: "Jordan Reyes", note: null,
  status: "scheduled", productName: "Final expense", phone: null, state: "FL", attemptNumber: 2, isOverdue: true, isDueToday: true,
};
const leadHistory = {
  city: "Miami", arrivedAt: "2026-11-22T14:00:00Z", vendorName: "Apex Leads",
  calls: [{ id: "a1", at: "2026-11-23T16:00:00Z", disposition: "interested_not_today", outcome: "Interested, not today", byYou: false }],
};

beforeEach(() => mockApi.mockReset());

test("the timeline is newest first: the callback set by you, the call with its outcome, then the lead's arrival", () => {
  const events = callbackTimeline(
    [{ id: "h1", action: "created", createdAt: "2026-11-23T16:05:00Z", actorName: "Jordan Reyes", note: "Wants to talk to her son first" }],
    leadHistory, "America/New_York", "Jordan Reyes",
  );
  expect(events.map((e) => e.title)).toEqual(["Callback set by you", "Call", "Lead arrived from Apex Leads"]);
  expect(events[0].detail).toBe("Mon 23 Nov · “Wants to talk to her son first”");
  expect(events[1].detail).toBe("Mon 23 Nov · Interested, not today");
  expect(events[2].detail).toBe("Sun 22 Nov");
});

test("the sheet reads one callback with its history and names the city", async () => {
  mockApi.mockResolvedValue({ callbacks: [{ ...cb, history: [] }], leadHistory });
  await render(<CallbackDetail callback={cb} viewerZone="America/New_York" canDial onClose={() => undefined} onChanged={() => undefined} onCall={() => undefined} />);
  expect(await screen.findByText("Final expense · Miami, FL")).toBeOnTheScreen();
  expect(mockApi).toHaveBeenCalledWith("/api/app/callbacks?callback_id=cb-1&include_history=true");
  expect(await screen.findByText("Lead arrived from Apex Leads")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Cancel this callback" })).toBeOnTheScreen();
});
