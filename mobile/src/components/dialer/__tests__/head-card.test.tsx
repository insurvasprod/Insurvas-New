import { render, screen, userEvent } from "@testing-library/react-native";

import { callLength } from "../../call-sheet";
import { HeadCard, headLine, queueMeta, rowChip, type HeadPanel, type QueueRow } from "../head-card";
import { campaignChoices, isKind, QueueSheet, searchName } from "../queue-sheet";

/**
 * Board C7 · the current lead's card and the Up next rows say only what the queue row and the dialer
 * panel hold; the ticks fold the panel's checks and the call still goes through the server.
 */
const mockApi = jest.fn();
jest.mock("@/lib/session", () => ({ useSession: () => ({ api: mockApi }) }));

const row: QueueRow = {
  workItemId: "wi-1", leadId: "lead-1", tier: 1, tierName: "High", name: "Harold Nguyen", state: "TX", attemptsMade: 2,
  localTime: "13:12", campaignName: "TX Term Nov", phone: "(713) 555-0144", timezone: "America/Chicago", productLine: "term_life",
};
const panel: HeadPanel = {
  lead: { id: "lead-1", fullName: "Harold Nguyen", state: "TX", city: "Houston", phone: "+17135550144", productCode: "term_life", age: "64", attemptsMade: 2, attemptCeiling: 6 },
  window: { allowed: true, startMinute: 480, endMinute: 1200, zone: "America/Chicago", reason: "open" },
  eligibility: { allowed: true, reason: "ready", message: "", checkedAt: "2026-11-24T19:11:00Z", timezone: "America/Chicago", dncCheck: "clear", suppression: "clear", suppressionHits: [] },
  consent: { hasCertificate: true, provider: "web_form", status: "captured", capturedAt: "2026-11-18T21:42:00Z", consentTimestamp: "2026-11-18T21:42:00Z" },
  campaign: { name: "TX Term Nov", vendorName: "Summit", leadType: "fresh" },
  client: { status: "clear", basis: null },
  viewerTimezone: "America/New_York",
};

beforeEach(() => mockApi.mockReset());

test("the head line and the Up next meta use only what the lead holds", () => {
  expect(headLine(panel, row)).toBe("64 yrs · Houston, TX · Term life");
  expect(headLine(null, row)).toBe("TX · Term life");
  expect(queueMeta({ ...row, productLine: "final_expense", state: "GA", attemptsMade: 0 })).toBe("Final expense · GA · attempt 1");
  expect(queueMeta({ ...row, productLine: null })).toBe("TX · attempt 3");
});

test("the card reads the panel for this lead, shows its ticks and window, and Details opens the checks", async () => {
  mockApi.mockResolvedValue(panel);
  const onDetails = jest.fn();
  const onCall = jest.fn();
  const user = userEvent.setup();
  await render(<HeadCard row={row} position={1} total={38} busy={false} onSkip={() => undefined} onCall={onCall} onDetails={onDetails} />);

  expect(await screen.findByText("64 yrs · Houston, TX · Term life")).toBeOnTheScreen();
  expect(mockApi).toHaveBeenCalledWith("/api/app/dialer/panel?lead_id=lead-1");
  expect(screen.getByText("Now · lead 1 of 38")).toBeOnTheScreen();
  expect(screen.getByText("Open till 8 pm CT")).toBeOnTheScreen();
  expect(screen.getByText("Summit")).toBeOnTheScreen();
  expect(screen.getByText("Attempt 3")).toBeOnTheScreen();
  // Board C7: the five ticks, "Not a client" last.
  for (const t of ["Consent", "DNC clear", "Not suppressed", "In window", "Not a client"]) expect(screen.getByLabelText(t)).toBeOnTheScreen();
  await user.press(screen.getByRole("button", { name: "Details" }));
  expect(onDetails).toHaveBeenCalledWith(panel);
  await user.press(screen.getByRole("button", { name: "Call (713) 555-0144" }));
  expect(onCall).toHaveBeenCalled();
});

test("the queue sheet's campaigns are the list's own, most leads first", () => {
  expect(campaignChoices(["A", "B", "A", null, "C", "D", "E", "A", "B"])).toEqual({ names: ["A", "B", "C", "D"], more: 1 });
  expect(searchName({ first_name: "Linda", last_name: "Okafor" })).toBe("Linda Okafor");
});

test("C8's call length runs from the tap to the return", () => {
  expect(callLength(new Date("2026-11-24T19:00:00Z"), new Date("2026-11-24T19:06:42Z"))).toBe("6:42");
  expect(callLength(new Date("2026-11-24T19:00:00Z"), new Date("2026-11-24T20:01:05Z"))).toBe("1:01:05");
});

test("Up next: a due callback is an info chip with its time on the customer's clock; others carry the server's priority", () => {
  const cb: QueueRow = { ...row, tier: 2, tierName: "callback", productLine: "final_expense", state: "OH", timezone: "America/New_York", callbackAt: "2026-11-24T20:00:00Z", priority: "High" };
  expect(rowChip(cb)).toEqual({ tone: "info", label: "Callback" });
  expect(queueMeta(cb)).toBe("Final expense · OH · callback 3:00");
  expect(rowChip({ ...row, tier: 5, tierName: "fresh", priority: "Low" })).toEqual({ tone: "brand", label: "Low" });
});

test("C7e: lead types are read from each row; Callable now only is the server's rule, on and fixed", async () => {
  expect(isKind({ ...row, tierName: "fresh" }, "fresh")).toBe(true);
  expect(isKind({ ...row, leadType: "aged" }, "aged")).toBe(true);
  expect(isKind({ ...row, tierName: "retry", callbackAt: "2026-11-25T15:00:00Z" }, "callbacks")).toBe(true);
  expect(isKind({ ...row, recycled: true }, "recycled")).toBe(true);
  expect(isKind(row, "recycled")).toBe(false);

  const onKind = jest.fn();
  const user = userEvent.setup();
  await render(<QueueSheet visible onClose={() => undefined} priority="all" onPriority={() => undefined} campaign={null} onCampaign={() => undefined} campaigns={["TX Term Nov"]}
    kind={null} onKind={onKind} autoNext onAutoNext={() => undefined} showing={17} loading={false} onOpenLead={() => undefined} />);
  for (const k of ["Fresh", "Aged", "Callbacks", "Recycled"]) expect(screen.getByRole("button", { name: k })).toBeOnTheScreen();
  await user.press(screen.getByRole("button", { name: "Aged" }));
  expect(onKind).toHaveBeenCalledWith("aged");
  const callable = screen.getByLabelText("Callable now only");
  expect(callable.props.value ?? callable.props.accessibilityState?.checked).toBe(true);
  expect(screen.getByRole("button", { name: "Show 17 leads" })).toBeOnTheScreen();
});
