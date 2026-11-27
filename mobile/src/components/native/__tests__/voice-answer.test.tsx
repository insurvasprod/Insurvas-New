import { render, screen, userEvent } from "@testing-library/react-native";

import { nextCallbackAnswer, VoiceAnswerScreen, zoneWord } from "@/components/native/voice-answer";
import type { CallbackView } from "@/lib/types";

/**
 * Board L5 · Ask Siri or Google: "What's my next callback?" answered on a card from the server's callbacks, with
 * Open and Call now (the dialer's call, never a raw tel: link); nothing is read until the app is unlocked.
 */
let mockStatus = "signedIn";
const mockUnlock = jest.fn(async () => true);
const mockApi = jest.fn();
jest.mock("@/lib/session", () => ({ useSession: () => ({ status: mockStatus, api: mockApi, unlock: mockUnlock, me: { user: { id: "me" }, role: "producer" } }) }));
const mockReplace = jest.fn();
jest.mock("expo-router", () => ({ router: { replace: (...a: unknown[]) => mockReplace(...a), back: jest.fn(), canGoBack: () => false } }));
jest.mock("@/components/call-sheet", () => {
  const { Text } = jest.requireActual("react-native");
  return { CallSheet: ({ leadId }: { leadId: string }) => <Text>{`Calling ${leadId}`}</Text> };
});

const NOW = new Date("2026-11-25T15:40:00Z");
function cb(over: Partial<CallbackView>): CallbackView {
  return {
    id: "c", leadId: "l1", workItemId: null, customerName: "Robert Chen", scheduledAtUtc: "2026-11-25T17:30:00Z",
    customerTimezone: "America/Chicago", customerTime: null, agentTime: null, assignedTo: null, assigneeName: null, note: "Wants a quote for $25,000",
    status: "scheduled", productName: null, phone: null, state: "TX", attemptNumber: null, isOverdue: false, isDueToday: true, ...over,
  } as CallbackView;
}

describe("nextCallbackAnswer", () => {
  it("names the next callback in your time, then theirs with the zone's name, then its note", () => {
    const later = cb({ id: "c2", leadId: "l2", customerName: "Linda Ortiz", scheduledAtUtc: "2026-11-25T20:00:00Z" });
    const missed = cb({ id: "c3", scheduledAtUtc: "2026-11-25T13:00:00Z", isOverdue: true, status: "missed" });
    expect(nextCallbackAnswer([later, missed, cb({})], NOW, "America/New_York")).toEqual({
      kind: "next", title: "Robert Chen at 12:30", line: "11:30 their time, Central. Wants a quote for $25,000.", leadId: "l1",
    });
  });

  it("says what is left when nothing is coming up", () => {
    expect(nextCallbackAnswer([cb({ isOverdue: true, status: "missed", scheduledAtUtc: "2026-11-25T13:00:00Z" })], NOW, "UTC"))
      .toEqual({ kind: "none", title: "No callbacks coming up", line: "1 overdue callback still needs a call." });
    expect(nextCallbackAnswer([], NOW, "UTC")).toEqual({ kind: "none", title: "No callbacks coming up", line: "Nothing is scheduled." });
  });

  it("words US zones the way they are said", () => {
    expect(zoneWord("America/Chicago", NOW)).toBe("Central");
    expect(zoneWord("America/Los_Angeles", NOW)).toBe("Pacific");
  });
});

describe("the answer card", () => {
  beforeEach(() => { mockApi.mockReset(); mockReplace.mockReset(); mockUnlock.mockClear(); });

  it("answers after unlock, with Open and Call now", async () => {
    mockStatus = "signedIn";
    mockApi.mockResolvedValue({ callbacks: [cb({ scheduledAtUtc: new Date(Date.now() + 3_600_000).toISOString() })], viewer: { userId: "me", role: "producer" } });
    await render(<VoiceAnswerScreen />);
    expect(screen.getByText("“What’s my next callback?”")).toBeTruthy();
    expect(await screen.findByText(/^Robert Chen at /)).toBeTruthy();
    expect(screen.getByTestId("ask-line").props.children).toMatch(/their time, Central\. Wants a quote for \$25,000\.$/);
    const user = userEvent.setup();
    await user.press(screen.getByRole("button", { name: "Call now" }));
    expect(screen.getByText("Calling l1")).toBeTruthy();
    await user.press(screen.getByRole("button", { name: "Open" }));
    expect(mockReplace).toHaveBeenCalledWith("/lead/l1");
  });

  it("locked, it asks to unlock and reads nothing (the lock-screen rule)", async () => {
    mockStatus = "locked";
    await render(<VoiceAnswerScreen />);
    expect(screen.getByText("Unlock Insurvas to hear it")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Call now" })).toBeNull();
    await userEvent.setup().press(screen.getByRole("button", { name: "Unlock" }));
    expect(mockUnlock).toHaveBeenCalled();
    expect(mockApi).not.toHaveBeenCalled();
  });
});
