import { Platform } from "react-native";

import type { Floor } from "@/components/inbound/types";
import {
  moveHref, ONGOING_CHANNEL, ONGOING_ID, ongoingCall, ongoingCallHref, ongoingContent, resetOngoingForTests, showDialCall, syncOngoingNotification,
  type DialCallAnswer,
} from "@/components/native/ongoing-call";

/**
 * Board L2 · A call in progress: one model for a dialer call and a transfer, each from the server's own record, and
 * Android's ongoing notification drawn from it (shown, updated only when its words change, cleared at the outcome).
 */
const mockSchedule = jest.fn(async () => "id");
const mockDismiss = jest.fn(async () => undefined);
const mockChannel = jest.fn(async () => null);
const mockCategory = jest.fn(async () => null);
jest.mock("expo-notifications", () => ({
  scheduleNotificationAsync: (...a: unknown[]) => (mockSchedule as (...x: unknown[]) => Promise<string>)(...a),
  dismissNotificationAsync: (...a: unknown[]) => (mockDismiss as (...x: unknown[]) => Promise<undefined>)(...a),
  setNotificationChannelAsync: (...a: unknown[]) => (mockChannel as (...x: unknown[]) => Promise<null>)(...a),
  setNotificationCategoryAsync: (...a: unknown[]) => (mockCategory as (...x: unknown[]) => Promise<null>)(...a),
  AndroidImportance: { LOW: 2 },
  AndroidNotificationVisibility: { PRIVATE: 0 },
}));

const DIAL: DialCallAnswer = {
  call: { attemptId: "a1", leadId: "l1", customer: "Harold Nguyen", state: "TX", productCode: "term_life", attemptNumber: 3, disclosureRead: true, startedAt: "2026-11-27T15:00:00Z" },
};
const FLOOR: Floor = {
  ownStatus: "ready",
  members: [{ id: "me", name: "Ava", role: "producer", availability: "on_call", away: false, lastSeenAt: null, statusChangedAt: null, call: { workItemId: "w1", leadId: "l2", customer: "Ruth Sims", partnerName: "Blue Peak", startedAt: "2026-11-27T15:01:00Z" }, lastCall: null, supporting: false }],
  onCalls: [{ id: "w1", customer: "Ruth Sims", agentId: "me", agentName: "Ava", startedAt: "2026-11-27T15:01:00Z", productLine: "final_expense", state: "AL", verificationPercent: 50, buffer: null }],
};

describe("ongoingCall", () => {
  it("draws a dialer call with the board's line", () => {
    expect(ongoingCall(null, DIAL, "me")).toEqual({ kind: "dialer", id: "a1", leadId: "l1", customer: "Harold Nguyen", line: "Term life · TX · attempt 3 · disclosure read", startedAt: "2026-11-27T15:00:00Z" });
  });

  it("says only what the server sent", () => {
    const bare: DialCallAnswer = { call: { ...DIAL.call!, state: null, productCode: null, attemptNumber: null, disclosureRead: false } };
    expect(ongoingCall(null, bare, "me")?.line).toBe("");
  });

  it("puts a transfer first: it is the live call", () => {
    const call = ongoingCall(FLOOR, DIAL, "me");
    expect(call).toMatchObject({ kind: "transfer", id: "w1", leadId: "l2", customer: "Ruth Sims" });
    expect(call?.line).toBe("Final expense · AL · from Blue Peak · verification 50% done");
  });

  it("is nothing without an open call, and never someone else's", () => {
    expect(ongoingCall(null, { call: null }, "me")).toBeNull();
    expect(ongoingCall(FLOOR, { call: null }, "someone-else")).toBeNull();
  });
});

describe("the three moves", () => {
  it("send a transfer to its call page's Finish step, a dialer call to the card on Calls", () => {
    expect(moveHref({ kind: "transfer", id: "w1" }, "outcome")).toBe("/call/w1?phase=finish");
    expect(moveHref({ kind: "transfer", id: "w1" }, "callback")).toBe("/call/w1?phase=finish&outcome=callback_scheduled");
    expect(moveHref({ kind: "transfer", id: "w1" }, "note")).toBe("/calls?part=incoming&oncall=note");
    expect(moveHref({ kind: "dialer", id: "a1" }, "outcome")).toBe("/calls?part=dialer&oncall=outcome");
    expect(moveHref({ kind: "dialer", id: "a1" }, null)).toBe("/calls?part=dialer");
  });

  it("route the notification's buttons, and nothing that isn't the ongoing notification", () => {
    const content = ongoingContent(ongoingCall(null, DIAL, "me")!);
    expect(ongoingCallHref("callback", content.data)).toBe("/calls?part=dialer&oncall=callback");
    expect(ongoingCallHref("expo.modules.notifications.actions.DEFAULT", content.data)).toBe("/calls?part=dialer");
    expect(ongoingCallHref("outcome", { href: "/app/inbox" })).toBeNull();
    expect(ongoingCallHref("outcome", undefined)).toBeNull();
  });
});

describe("Android's ongoing notification", () => {
  const original = Platform.OS;
  beforeEach(() => {
    Object.defineProperty(Platform, "OS", { value: "android", configurable: true });
    resetOngoingForTests();
    [mockSchedule, mockDismiss, mockChannel, mockCategory].forEach((m) => m.mockClear());
  });
  afterAll(() => Object.defineProperty(Platform, "OS", { value: original, configurable: true }));

  it("is sticky and quiet, with the card's three buttons, and posts again only when its words change", async () => {
    const call = ongoingCall(null, DIAL, "me")!;
    await syncOngoingNotification(call);
    expect(mockChannel).toHaveBeenCalledWith(ONGOING_CHANNEL, expect.objectContaining({ importance: 2, sound: null }));
    expect(mockCategory).toHaveBeenCalledWith("call-in-progress", [
      expect.objectContaining({ identifier: "outcome", buttonTitle: "Outcome" }),
      expect.objectContaining({ identifier: "note", buttonTitle: "Add a note" }),
      expect.objectContaining({ identifier: "callback", buttonTitle: "Callback" }),
    ]);
    expect(mockSchedule).toHaveBeenCalledWith({
      identifier: ONGOING_ID,
      content: expect.objectContaining({ title: "Harold Nguyen", subtitle: "on a call", body: "Term life · TX · attempt 3 · disclosure read", sticky: true, autoDismiss: false, sound: false }),
      trigger: { channelId: ONGOING_CHANNEL },
    });
    await syncOngoingNotification({ ...call });
    expect(mockSchedule).toHaveBeenCalledTimes(1);
  });

  it("stops when the outcome is saved (no open call)", async () => {
    await syncOngoingNotification(ongoingCall(null, DIAL, "me"));
    await syncOngoingNotification(null);
    expect(mockDismiss).toHaveBeenCalledWith(ONGOING_ID);
  });

  it("can be posted by the dialer the moment the server accepts the click", async () => {
    await showDialCall({ attemptId: "a9", leadId: "l9", customer: "Earl Jones", state: "GA", productCode: "final_expense", attemptNumber: 1 });
    expect(mockSchedule).toHaveBeenCalledWith(expect.objectContaining({ content: expect.objectContaining({ title: "Earl Jones", body: "Final expense · GA · attempt 1 · disclosure read" }) }));
  });

  it("does nothing off Android", async () => {
    Object.defineProperty(Platform, "OS", { value: "ios", configurable: true });
    await syncOngoingNotification(ongoingCall(null, DIAL, "me"));
    expect(mockSchedule).not.toHaveBeenCalled();
  });
});
