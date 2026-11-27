import { buildWidgetSnapshot } from "@/components/native/widget-snapshot";
import type { CallbackView } from "@/lib/types";

/** Board L1's data contract: what the widgets draw, built only from what the server sent. */
const NOW = new Date("2026-11-25T15:40:00Z"); // 9:40 am in Chicago

function cb(over: Partial<CallbackView>): CallbackView {
  return {
    id: "c", leadId: "l", workItemId: null, customerName: "Robert Chen", scheduledAtUtc: "2026-11-25T17:30:00Z",
    customerTimezone: "America/Chicago", customerTime: null, agentTime: null, assignedTo: null, assigneeName: null, note: null,
    status: "scheduled", productName: null, phone: null, state: "TX", attemptNumber: null, isOverdue: false, isDueToday: true,
    ...over,
  } as CallbackView;
}

const callbacks = [
  cb({ id: "c1", leadId: "l1", customerName: "ROBERT CHEN", scheduledAtUtc: "2026-11-25T17:30:00Z" }),
  cb({ id: "c2", leadId: "l2", customerName: "Linda Ortiz", scheduledAtUtc: "2026-11-25T20:00:00Z", customerTimezone: "America/Los_Angeles" }),
  cb({ id: "c3", leadId: "l3", scheduledAtUtc: "2026-11-25T13:00:00Z", isOverdue: true, status: "missed" }),
  cb({ id: "c4", leadId: "l4", scheduledAtUtc: "2026-11-27T17:00:00Z" }),
  cb({ id: "c5", leadId: "l5", scheduledAtUtc: "2026-11-25T18:00:00Z", status: "completed" }),
];

it("names the next callback in both zones and counts today's", () => {
  const s = buildWidgetSnapshot({ userId: "u1", role: "producer", viewerZone: "America/New_York", now: NOW, callbacks, goal: { done: 16, target: 25 } });
  expect(s.v).toBe(1);
  expect(s.today.next).toEqual({ name: "Robert Chen", yours: "12:30", theirs: "11:30", zone: "CT", link: "insurvas://lead/l1" });
  expect(s.today.dueToday).toBe(3); // c1, c2 and the missed c3; not Friday's, not the completed one
  expect(s.today.goalPct).toBe(64);
  expect(s.today.canDial).toBe(true);
  expect(s.today.links.startCalling).toBe("insurvas://serve-next");
});

it("shows the agency month to an owner, never to a manager or producer", () => {
  const agencyMonth = { month: "2026-11", submittedCents: 8_640_000, previousCents: 7_714_286 };
  expect(buildWidgetSnapshot({ userId: "u1", role: "owner", viewerZone: "UTC", now: NOW, callbacks: [], agencyMonth }).agency)
    .toEqual({ month: "2026-11", submittedCents: 8_640_000, changePct: 12, link: "insurvas://" });
  expect(buildWidgetSnapshot({ userId: "u1", role: "manager", viewerZone: "UTC", now: NOW, callbacks: [], agencyMonth }).agency).toBeNull();
  expect(buildWidgetSnapshot({ userId: "u1", role: "producer", viewerZone: "UTC", now: NOW, callbacks: [], agencyMonth }).agency).toBeNull();
});

it("draws nothing it wasn't given", () => {
  const s = buildWidgetSnapshot({ userId: "u1", role: "assistant", viewerZone: "UTC", now: NOW, callbacks: [] });
  expect(s.today.next).toBeNull();
  expect(s.today.goalPct).toBeNull();
  expect(s.today.canDial).toBe(false);
  expect(s.agency).toBeNull();
});
