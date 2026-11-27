import type { ReactNode } from "react";
import { render, renderHook, screen, waitFor } from "@testing-library/react-native";

import { ALERT_BADGE, barBadgeTone, needsAttention, tabBadges, useTabBadges } from "../app-tabs-badges";
import { AppTabs } from "../app-tabs";

/**
 * The tab badges: gold counts, the kit's red `.badge.alert` for an Inbox holding alerts that need attention (board
 * B2 "!6"), and the retention Cases tab's count of cases needing work (boards B7/F3 "9", nav count
 * `retention.save-queue`).
 */
const mockApi = jest.fn();
const mockCounts = { calls: 0, inbox: 0, money: 0, nav: null as { counts: Record<string, number>; presence: null } | null, refresh: () => undefined };
let mockRole = "retention";
jest.mock("@/lib/session", () => ({ useSession: () => ({ api: mockApi, me: { role: mockRole, memberRole: mockRole, plan: { features: ["chargeback_radar"] }, solo: false } }) }));
jest.mock("@/lib/counts", () => ({ useCounts: () => mockCounts }));
jest.mock("@/lib/nav", () => ({ useTabs: () => [] }));
jest.mock("@/lib/sheet-inset", () => ({ useAndroidKeyboardShown: () => false }));
jest.mock("@/lib/tab-choice", () => ({ useProducerTabs: () => false }));
// The bar's icons ship only as @3x files, which Metro resolves and Jest does not.
jest.mock("../../../assets/images/tabs/home.png", () => 1, { virtual: true });
jest.mock("../../../assets/images/tabs/phone.png", () => 1, { virtual: true });
jest.mock("../../../assets/images/tabs/contact.png", () => 1, { virtual: true });
jest.mock("../../../assets/images/tabs/buoy.png", () => 1, { virtual: true });
jest.mock("../../../assets/images/tabs/users.png", () => 1, { virtual: true });
jest.mock("../../../assets/images/tabs/wallet.png", () => 1, { virtual: true });
jest.mock("../../../assets/images/tabs/book.png", () => 1, { virtual: true });
jest.mock("../../../assets/images/tabs/inbox.png", () => 1, { virtual: true });
jest.mock("../../../assets/images/tabs/grid.png", () => 1, { virtual: true });
jest.mock("../../../assets/images/tabs/phoneOut.png", () => 1, { virtual: true });
// The native bar has no JS implementation under Jest: a stand-in that prints each trigger, its badge and the bar's colours.
jest.mock("expo-router/native-tabs", () => {
  const { Text, View } = jest.requireActual<typeof import("react-native")>("react-native");
  function Trigger({ name, hidden, children }: { name: string; hidden?: boolean; children: ReactNode }) { return hidden ? null : <View testID={`tab-${name}`}>{children}</View>; }
  Trigger.Icon = function Icon() { return null; };
  Trigger.Label = function Label({ children }: { children: ReactNode }) { return <Text>{children}</Text>; };
  Trigger.Badge = function Badge({ children }: { children: ReactNode }) { return <Text testID="badge">{children}</Text>; };
  function NativeTabs({ children, badgeBackgroundColor, badgeTextColor }: { children: ReactNode; badgeBackgroundColor: string; badgeTextColor: string }) {
    return <View testID="bar" accessibilityLabel={`${badgeBackgroundColor} ${badgeTextColor}`}>{children}</View>;
  }
  NativeTabs.Trigger = Trigger;
  return { NativeTabs };
});

beforeEach(() => {
  mockApi.mockReset();
  Object.assign(mockCounts, { calls: 0, inbox: 0, money: 0, nav: null });
  mockRole = "retention";
});

test("badges: gold counts, the Inbox red only for alerts that need attention, the Cases count, 99 at most", () => {
  const plain = tabBadges({ calls: 2, inbox: 4, money: 0, cases: 9, inboxAlert: false });
  expect(plain).toEqual({ calls: { text: "2", tone: "count" }, ladder: { text: "9", tone: "count" }, inbox: { text: "4", tone: "count" } });
  expect(tabBadges({ calls: 0, inbox: 6, money: 0, cases: 0, inboxAlert: true })).toEqual({ inbox: { text: "6", tone: "alert" } });
  expect(tabBadges({ calls: 0, inbox: 0, money: 0, cases: 0, inboxAlert: true })).toEqual({});
  expect(tabBadges({ calls: 120, inbox: 0, money: 0, cases: 0, inboxAlert: false }).calls?.text).toBe("99");
  expect(needsAttention(["new_lead", "doi_deadline"])).toBe(true);
  expect(needsAttention(["new_lead", "callback_due", "mentioned"])).toBe(false);
  // One colour per native bar: red only when every badge showing is an alert (board B2: the Inbox's "!6" alone).
  expect(barBadgeTone({ inbox: { text: "6", tone: "alert" } }, ["index", "teamtab", "moneytab", "inbox", "menu"])).toBe("alert");
  expect(barBadgeTone({ inbox: { text: "6", tone: "alert" }, moneytab: { text: "1", tone: "count" } }, ["index", "teamtab", "moneytab", "inbox", "menu"])).toBe("count");
  expect(barBadgeTone({ inbox: { text: "6", tone: "alert" }, calls: { text: "1", tone: "count" } }, ["index", "teamtab", "moneytab", "inbox", "menu"])).toBe("alert");
  expect(barBadgeTone({}, ["index"])).toBe("count");
});

test("useTabBadges reads the Cases count and which alerts sit in the Inbox", async () => {
  Object.assign(mockCounts, { inbox: 6, nav: { counts: { "retention.save-queue": 9 }, presence: null } });
  mockApi.mockResolvedValue({ alerts: [{ id: "1", event_type: "credential_expiring" }] });
  const { result } = await renderHook(() => useTabBadges());
  await waitFor(() => expect(result.current.inbox).toEqual({ text: "6", tone: "alert" }));
  expect(result.current.ladder).toEqual({ text: "9", tone: "count" });
  expect(mockApi).toHaveBeenCalledWith("/api/app/notifications");
});

test("no alerts to read when the Inbox is empty", async () => {
  const { result } = await renderHook(() => useTabBadges());
  await waitFor(() => expect(result.current).toEqual({}));
  expect(mockApi).not.toHaveBeenCalled();
});

test("B7 tab bar: the retention Cases tab carries its 9 and the bar stays gold beside the Inbox's plain 2", async () => {
  Object.assign(mockCounts, { inbox: 2, nav: { counts: { "retention.save-queue": 9 }, presence: null } });
  mockApi.mockResolvedValue({ alerts: [{ id: "1", event_type: "mentioned" }, { id: "2", event_type: "callback_due" }] });
  await render(<AppTabs />);
  await waitFor(() => expect(screen.getAllByTestId("badge").map((b) => b.props.children)).toEqual(["9", "2"]));
  expect(screen.getByTestId("tab-ladder")).toBeOnTheScreen();
  expect(screen.getByTestId("bar").props.accessibilityLabel).not.toContain(ALERT_BADGE.bg);
});

test("B2 tab bar: an owner's Inbox with alerts that need attention turns the badge red", async () => {
  mockRole = "owner";
  Object.assign(mockCounts, { inbox: 6 });
  mockApi.mockResolvedValue({ alerts: [{ id: "1", event_type: "doi_deadline" }] });
  await render(<AppTabs />);
  await waitFor(() => expect(screen.getByTestId("bar").props.accessibilityLabel).toBe(`${ALERT_BADGE.bg} ${ALERT_BADGE.fg}`));
  expect(screen.getAllByTestId("badge").map((b) => b.props.children)).toEqual(["6"]);
});
