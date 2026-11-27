import { answerState, chatTime, clockWords, countWords, joinName, splitName } from "@/lib/answer-state";
import { chatRows, type ChatsAnswer } from "@/lib/chats";
import { planSetup } from "@/lib/first-run";
import { groupEvents, pushChanges, type PrefEvent } from "@/lib/notification-prefs";
import { languageWord, zoneLabel } from "@/lib/profile-options";

jest.mock("expo-local-authentication", () => ({ hasHardwareAsync: jest.fn(), isEnrolledAsync: jest.fn() }));
jest.mock("expo-notifications", () => ({ getPermissionsAsync: jest.fn() }));
jest.mock("expo-secure-store", () => ({ getItemAsync: jest.fn(), setItemAsync: jest.fn(), deleteItemAsync: jest.fn(), WHEN_UNLOCKED_THIS_DEVICE_ONLY: 1 }));

describe("first sign-in steps (A7 → A3 → A4)", () => {
  const fresh = { seenBefore: false, workspaces: 1, alertsUndecided: false, biometricReady: false, biometricChosen: false };
  test("nothing after the first sign-in on this phone", () => {
    expect(planSetup({ ...fresh, seenBefore: true, workspaces: 3, alertsUndecided: true, biometricReady: true })).toEqual([]);
  });
  test("in the board's order, each only when it applies", () => {
    expect(planSetup({ ...fresh, workspaces: 2, alertsUndecided: true, biometricReady: true })).toEqual(["workspace", "alerts", "biometric"]);
    expect(planSetup(fresh)).toEqual([]);
  });
  test("one workspace is not a choice; a phone already asked is not asked again", () => {
    expect(planSetup({ ...fresh, workspaces: 1, alertsUndecided: false, biometricReady: true })).toEqual(["biometric"]);
  });
  test("Face ID is not offered when the invite already chose it or the phone has none", () => {
    expect(planSetup({ ...fresh, biometricReady: true, biometricChosen: true })).toEqual([]);
    expect(planSetup({ ...fresh, biometricReady: false })).toEqual([]);
  });
});

describe("what a refused answer means (board section 13)", () => {
  test("no answer is offline", () => expect(answerState({ status: 0, code: null })).toBe("offline"));
  test("suspended and read-only are paused", () => {
    for (const code of ["tenant_suspended", "read_only", "maintenance_read_only", "maintenance_locked"]) expect(answerState({ status: 403, code })).toBe("paused");
  });
  test("a plan gate and a role gate are told apart", () => {
    expect(answerState({ status: 403, code: "feature_not_entitled" })).toBe("plan");
    expect(answerState({ status: 403, code: "role_not_allowed" })).toBe("role");
    expect(answerState({ status: 403, code: "feature_disabled_for_tenant" })).toBe("role");
  });
  test("anything else failed; nothing is nothing", () => {
    expect(answerState({ status: 503, code: "feature_unavailable" })).toBe("failed");
    expect(answerState({ status: 500, code: null })).toBe("failed");
    expect(answerState(null)).toBeNull();
  });
});

describe("words", () => {
  test("quiet hours read like the board", () => {
    expect(clockWords("21:00")).toBe("9:00 pm");
    expect(clockWords("07:30")).toBe("7:30 am");
    expect(clockWords("00:05")).toBe("12:05 am");
    expect(clockWords("12:00")).toBe("12:00 pm");
  });
  test("chat times: clock today, weekday this week, date before", () => {
    const now = new Date(2026, 10, 24, 15, 0);
    expect(chatTime(new Date(2026, 10, 24, 14, 12).toISOString(), now)).toBe("2:12");
    expect(chatTime(new Date(2026, 10, 23, 9, 0).toISOString(), now)).toBe("Mon");
    expect(chatTime(new Date(2026, 10, 2, 9, 0).toISOString(), now)).toBe("2 Nov");
  });
  test("one stored name round-trips through First and Last", () => {
    expect(splitName("Mary Ann  Smith")).toEqual({ first: "Mary", last: "Ann Smith" });
    expect(joinName("Mary", "Ann Smith")).toBe("Mary Ann Smith");
    expect(joinName("Cher", " ")).toBe("Cher");
    expect(splitName("")).toEqual({ first: "", last: "" });
  });
  test("counts in words up to ten", () => {
    expect(countWords(3, "place")).toBe("three places");
    expect(countWords(1, "place")).toBe("one place");
    expect(countWords(12, "place")).toBe("12 places");
  });
  test("time zones and languages read as the web shows them", () => {
    expect(zoneLabel(null)).toBe("The agency’s time zone");
    expect(zoneLabel("America/New_York")).toBe("Eastern · New York");
    expect(languageWord("es")).toBe("Spanish");
    expect(languageWord("haitian creole")).toBe("Haitian Creole");
  });
});

describe("notification preferences (H4, A3)", () => {
  const ev = (key: string, group: string, push: boolean, locked = false): PrefEvent => ({
    key, label: key, description: "", group, supportsDigest: false, protected: locked, protectedReason: null,
    delivery: { in_app: true, email: false, push, digest: "immediate", protected: locked },
  });
  const events = [ev("new_lead", "Acquisition", true), ev("callback_due", "Acquisition", true), ev("servicing_failed", "Retention", false), ev("doi_deadline", "Compliance", true, true)];
  test("groups keep the server's order", () => {
    expect(groupEvents(events).map((g) => [g.title, g.events.length])).toEqual([["Acquisition", 2], ["Retention", 1], ["Compliance", 1]]);
  });
  test("only changed, unlocked switches are saved, one event per call", () => {
    expect(pushChanges(events, { new_lead: true, callback_due: false, servicing_failed: true, doi_deadline: false })).toEqual([
      { event_key: "callback_due", push: false }, { event_key: "servicing_failed", push: true },
    ]);
  });
});

describe("partner chats (H2)", () => {
  const answer: ChatsAnswer = {
    viewerId: "me",
    directory: { tenantUsers: [{ user_id: "me", users: { name: "Jordan Reyes", email: null } }], partnerUsers: [{ user_id: "maya", users: { name: "Maya Santos", email: null } }] },
    channels: [
      { channel: { id: "a", name: "Apex Leads", channel_type: "partner", status: "active" }, unreadCount: 2, messages: [{ id: "1", message: "Dolores is warm", messageKind: "text", createdBy: "maya", createdAt: "2026-11-24T14:12:00Z" }] },
      { channel: { id: "b", name: "Summit Media", channel_type: "partner", status: "active" }, unreadCount: 0, messages: [{ id: "2", message: "Walter needs a review first", messageKind: "text", createdBy: "me", createdAt: "2026-11-24T15:40:00Z" }] },
      { channel: { id: "c", name: "Old", channel_type: "group", status: "archived" }, unreadCount: 0, messages: [] },
      { channel: { id: "d", name: "Floor", channel_type: "group", status: "active" }, unreadCount: 0, messages: [], state: { archivedAt: "2026-11-01T00:00:00Z", pinnedAt: null } },
    ],
  };
  test("newest first, archived left out, the writer named", () => {
    expect(chatRows(answer)).toEqual([
      { id: "b", name: "Summit Media", kind: "partner", preview: "You: Walter needs a review first", at: "2026-11-24T15:40:00Z", unread: 0, pinned: false },
      { id: "a", name: "Apex Leads", kind: "partner", preview: "Maya: Dolores is warm", at: "2026-11-24T14:12:00Z", unread: 2, pinned: false },
    ]);
  });
  test("groups first: a one-to-one message comes after the group conversations, a pinned one before all", () => {
    const direct = { channel: { id: "e", name: "Ava Chen", channel_type: "direct" as const, status: "active" as const }, unreadCount: 0, messages: [{ id: "3", message: "Lunch?", messageKind: "text" as const, createdBy: "me", createdAt: "2026-11-24T18:00:00Z" }] };
    expect(chatRows({ ...answer, channels: [...answer.channels, direct] }).map((r) => r.id)).toEqual(["b", "a", "e"]);
    const pinned = { ...direct, state: { archivedAt: null, pinnedAt: "2026-11-20T00:00:00Z" } };
    expect(chatRows({ ...answer, channels: [...answer.channels, pinned] }).map((r) => r.id)).toEqual(["e", "b", "a"]);
  });
});
