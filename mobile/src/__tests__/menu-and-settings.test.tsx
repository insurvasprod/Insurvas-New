import { act, render, screen, userEvent, within } from "@testing-library/react-native";

import Menu from "@/app/(tabs)/menu";
import Settings from "@/app/settings";
import { appHrefFor } from "@/lib/links";
import { alertKinds, boardGroups, rowChanges, type PrefEvent } from "@/lib/notification-prefs";
import { setAppearance } from "@/theme/use-palette";

/**
 * Board J1 · J3 against mocked answers, and the pure rules behind them: phone pages carry a chevron, not the
 * laptop mark (Appointments & setters, Vendors & campaigns, Quote, Commission ledger); "Carrier appointments";
 * Settings' rows always there, Appearance set on the phone, Saved for offline counted from this phone's queue.
 */
const mockApi = jest.fn();
const mockPush = jest.fn();
const mockQueue = jest.fn(async (_caseId: string) => [] as unknown[]);
const PRODUCER_KEYS = ["sell.calendar", "sell.setters", "leads.lists", "leads.campaigns", "sell.applications", "sell.quoting", "book.ledger", "book.carrier_files", "book.appointments"];
jest.mock("expo-router", () => ({ router: { push: (...a: unknown[]) => mockPush(...a), back: jest.fn(), replace: jest.fn() }, Stack: { Screen: () => null } }));
jest.mock("@/lib/session", () => ({
  useSession: () => ({ api: mockApi, me: { role: "producer", memberRole: "producer", agencyTitle: null, roles: [], user: { id: "u1", email: "jordan@example.com", name: "Jordan Reyes" }, tenant: { id: "t1", name: "Ellery & Fields" }, plan: null, menuKeys: PRODUCER_KEYS }, biometricOn: true, setBiometricOn: jest.fn(), signOut: jest.fn() }),
}));
jest.mock("@/lib/counts", () => ({ useCounts: () => ({ refresh: jest.fn(), calls: 0, inbox: 0, money: 0, nav: { counts: {}, presence: null } }) }));
jest.mock("@/lib/nav", () => ({ useNav: () => ({ tabs: ["index", "calls", "leads", "inbox", "menu"] }), currentTabs: () => ["index", "calls", "leads", "inbox", "menu"] }));
jest.mock("@/lib/secure", () => ({ readSecret: async () => null, writeSecret: async () => undefined, KEYS: { pushToken: "p" } }));
jest.mock("@/components/applications/answer-queue", () => ({ readQueue: (id: string) => mockQueue(id) }));
jest.mock("@/lib/push", () => ({ registerForPush: async () => "on" }));
jest.mock("expo-notifications", () => ({ getPermissionsAsync: async () => ({ granted: true, canAskAgain: true }) }));
jest.mock("@/widgets/available", () => ({ widgetsAvailable: false }));
jest.mock("@/widgets/sync", () => ({ pinWidget: async () => true }));
jest.mock("@/lib/tab-choice", () => ({ useProducerTabs: () => false, setProducerTabs: jest.fn() }));

beforeEach(() => { mockApi.mockReset(); mockPush.mockReset(); mockQueue.mockReset(); mockQueue.mockResolvedValue([]); });

test("J1: phone pages open with a chevron, computer pages carry the laptop mark; labels as drawn", async () => {
  await render(<Menu />);
  const laptop = (key: string) => within(screen.getByTestId(`menu-${key}`)).queryByLabelText("Opens on a computer");
  for (const key of ["sell.setters", "leads.campaigns", "sell.quoting", "book.ledger", "sell.calendar", "book.appointments"]) expect(laptop(key)).toBeNull();
  for (const key of ["leads.lists", "book.carrier_files"]) expect(laptop(key)).toBeOnTheScreen();
  expect(screen.getByText("Carrier appointments")).toBeOnTheScreen();
  const user = userEvent.setup();
  await user.press(screen.getByTestId("menu-book.ledger"));
  expect(mockPush).toHaveBeenCalledWith("/money/pay");
  // Re-audit 2026-11-27: Appointments & setters is the setter ranking (Team activity), not a second Calendar.
  await user.press(screen.getByTestId("menu-sell.setters"));
  expect(mockPush).toHaveBeenCalledWith("/reports/activity");
});

test("J3: every row drawn; Appearance set on the phone; Saved for offline counts drafts waiting here", async () => {
  mockQueue.mockImplementation(async (id: string) => (id === "c1" || id === "c2" ? [{ key: "q", value: 1, hidden: [] }] : []));
  mockApi.mockImplementation(async (path: string) => {
    if (path === "/api/app/applications") return { applications: [{ caseId: "c1", status: "draft" }, { caseId: "c2", status: "draft" }, { caseId: "c3", status: "draft" }, { caseId: "c4", status: "submitted" }] };
    if (path === "/api/app/profile/sessions") return { sessions: [{ id: "s1" }, { id: "s2" }, { id: "s3" }], available: true };
    if (path === "/api/app/profile/two-factor") return { enabled: true };
    if (path === "/api/app/availability") return null;
    if (path === "/api/app/nav/counts") return { counts: {}, presence: "ready" };
    throw new Error(path);
  });
  const user = userEvent.setup();
  await render(<Settings />);
  expect(await screen.findByText("2 drafts")).toBeOnTheScreen();
  for (const id of ["settings-taking-calls", "settings-working-hours", "settings-two-step", "settings-devices", "settings-notifications", "settings-appearance", "settings-offline", "settings-workspace", "settings-sign-out"]) {
    expect(screen.getByTestId(id)).toBeOnTheScreen();
  }
  expect(within(screen.getByTestId("settings-appearance")).getByText("System")).toBeOnTheScreen();
  await user.press(screen.getByTestId("settings-appearance"));
  await user.press(await screen.findByTestId("choice-light"));
  expect(within(screen.getByTestId("settings-appearance")).getByText("Light")).toBeOnTheScreen();
  await act(async () => { await setAppearance("system"); });
});

describe("links and groups", () => {
  test("role-aware pages: the Commission ledger is My pay for a producer, the book for an owner, the computer otherwise", () => {
    expect(appHrefFor("/app/ledger", null, "producer")).toBe("/money/pay");
    expect(appHrefFor("/app/ledger", null, "owner")).toBe("/book");
    expect(appHrefFor("/app/ledger")).toBeNull();
    expect(appHrefFor("/app/setters")).toBe("/reports/activity");
    expect(appHrefFor("/app/calendar")).toBe("/calendar");
    // Team for an owner whose bar has no Team tab is the pushed twin.
    expect(appHrefFor("/app/producers", ["index", "calls", "leads", "inbox", "menu"])).toBe("/team");
    expect(appHrefFor("/app/producers", ["index", "teamtab", "moneytab", "inbox", "menu"])).toBe("/teamtab");
    expect(appHrefFor("/app/partner-chat")).toBe("/inbox?part=messages");
    // Kept: vendors and quote (2026-11-26), and the role-aware tab twins.
    expect(appHrefFor("/app/campaigns")).toBe("/vendor");
    expect(appHrefFor("/app/quoting")).toBe("/quote");
    expect(appHrefFor("/app/dialer", ["index", "teamtab", "moneytab", "inbox", "menu"])).toBe("/calls-page?part=dialer");
  });

  test("H4: exactly the board's rows, each drawn when the server sends one of its events; nothing else added", () => {
    const ev = (key: string, group: string, extra: Partial<PrefEvent> = {}): PrefEvent => ({ key, label: key, description: `${key} d`, group, supportsDigest: false, protected: false, protectedReason: null, delivery: { in_app: true, email: false, push: true, digest: "immediate", protected: false }, ...extra });
    const groups = boardGroups([ev("new_lead", "Acquisition"), ev("callback_due", "Acquisition"), ev("mentioned", "Acquisition"), ev("partner_message", "Acquisition"), ev("reinstatement_closing", "Retention", { protected: true, protectedReason: "Last chance" }), ev("servicing_failed", "Retention", { delivery: { in_app: true, email: false, push: false, digest: "immediate", protected: false } }), ev("doi_deadline", "Compliance")]);
    expect(groups.map((g) => g.title)).toEqual(["Calls", "Sales and book", "Messages"]);
    expect(groups[0].rows.map((r) => r.label)).toEqual(["Transfer waiting", "callback_due"]);
    expect(groups[0].rows[0].events.map((e) => e.key)).toEqual(["new_lead"]);
    // One row for both "at risk" events: off while either is off, not locked while one can change.
    expect(groups[1].rows[0]).toMatchObject({ label: "A policy is at risk", on: false, locked: false });
    expect(rowChanges(groups[1].rows[0], true)).toEqual([{ event_key: "servicing_failed", push: true }]);
    expect(groups[2].rows.map((r) => r.label)).toEqual(["Partner chat"]);
    expect(groups[2].rows[0].meta).toBeNull();
    expect(boardGroups([ev("callback_due", "Acquisition")], { callbackMinutes: 15 })[0].rows[0].label).toBe("Callback in 15 minutes");
    expect(alertKinds([ev("partner_message", "Acquisition"), ev("new_lead", "Acquisition")]).map((r) => r.label)).toEqual(["A transfer is waiting for you", "Partner messages"]);
  });
});
