import { Alert } from "react-native";
import { render, screen, userEvent, within } from "@testing-library/react-native";

import Inbox from "@/app/(tabs)/inbox";
import NewMessage from "@/app/chat/new";
import Notifications from "@/app/notifications";
import Workspaces from "@/app/workspaces";

/**
 * Board H1 · H2 · H4 · J5 against mocked server answers: read alerts stay listed (only unread carry the dot),
 * the swipe's Read and Snooze, the Alerts / Messages switch for everyone, groups first, chat search and a new
 * message, the board's notification groups with quiet hours set on the phone, and alert counts per workspace.
 */
const mockApi = jest.fn();
const mockPush = jest.fn();
const mockReplace = jest.fn();
let mockMe: { role: string; user: { id: string } } = { role: "producer", user: { id: "u1" } };
let mockParams: Record<string, string> = {};
jest.mock("expo-router", () => ({
  router: { push: (...a: unknown[]) => mockPush(...a), replace: (...a: unknown[]) => mockReplace(...a), back: jest.fn(), canGoBack: () => true, dismissAll: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));
jest.mock("@/lib/session", () => ({ useSession: () => ({ api: mockApi, me: mockMe, adoptTokens: jest.fn() }), currentRefreshToken: async () => "r" }));
jest.mock("@/lib/counts", () => ({ useCounts: () => ({ refresh: jest.fn(), calls: 0, inbox: 0, money: 0, nav: null }) }));
jest.mock("@/lib/nav", () => ({ currentTabs: () => ["index", "calls", "leads", "inbox", "menu"] }));
jest.mock("@/lib/secure", () => ({ readSecret: async () => null, writeSecret: async () => undefined }));

const today = (h: number) => { const d = new Date(); d.setHours(h, 0, 0, 0); return d.toISOString(); };
const alert = (id: string, title: string, at: string, extra: object = {}) => ({ id, kind: "callback_reminder", title, body: "Corebridge", link: "/app/leads/3afad3ae-2c84-4bde-a6b5-1dabd5d4bc2d", created_at: at, event_type: "callback_due", ...extra });

beforeEach(() => {
  mockApi.mockReset(); mockPush.mockReset(); mockReplace.mockReset();
  mockMe = { role: "producer", user: { id: "u1" } };
  mockParams = {};
});

describe("H1 · alerts", () => {
  beforeEach(() => {
    mockApi.mockImplementation(async (path: string) => {
      if (path === "/api/app/notifications?recent=1") return { alerts: [alert("a1", "Frank Delgado was approved", today(0))], read: [alert("r1", "Robert Chen’s callback was kept", today(0), { read_at: today(0) })] };
      if (path === "/api/app/partner-chat") return { channels: [], directory: { tenantUsers: [], partnerUsers: [] }, viewerId: "u1" };
      return { read: 1 };
    });
  });

  test("read alerts stay listed without the dot; unread carry it; the switch counts unread", async () => {
    await render(<Inbox />);
    expect(await screen.findByText("Frank Delgado was approved")).toBeOnTheScreen();
    expect(screen.getByText("Robert Chen’s callback was kept")).toBeOnTheScreen();
    expect(within(screen.getByTestId("alert-a1")).getByTestId("unread-dot")).toBeOnTheScreen();
    expect(within(screen.getByTestId("alert-r1")).queryByTestId("unread-dot")).toBeNull();
    expect(screen.getByTestId("seg-messages")).toBeOnTheScreen();
  });

  test("swipe Read marks it read on the server and it stays listed; Snooze puts it away", async () => {
    const user = userEvent.setup();
    const ask = jest.spyOn(Alert, "alert").mockImplementation((_t, _m, buttons) => { buttons?.[0]?.onPress?.(); });
    await render(<Inbox />);
    await user.press(await screen.findByTestId("swipe-a1-read"));
    expect(mockApi).toHaveBeenCalledWith("/api/app/notifications", { method: "POST", body: { ids: ["a1"] } });
    expect(screen.getByText("Frank Delgado was approved")).toBeOnTheScreen();
    expect(within(screen.getByTestId("alert-a1")).queryByTestId("unread-dot")).toBeNull();
    // A read alert offers Snooze only.
    expect(screen.queryByTestId("swipe-r1-read")).toBeNull();
    await user.press(screen.getByTestId("swipe-r1-snooze"));
    expect(ask).toHaveBeenCalled();
    expect(screen.queryByText("Robert Chen’s callback was kept")).toBeNull();
    ask.mockRestore();
  });
});

describe("H2 · messages", () => {
  const chats = {
    viewerId: "u1",
    directory: { tenantUsers: [{ user_id: "u1", role: "producer", users: { name: "Jordan Reyes", email: null } }, { user_id: "u2", role: "producer", users: { name: "Ava Chen", email: null } }], partnerUsers: [{ user_id: "p1", partner_id: "x", users: { name: "Maya Santos", email: null }, partners: { name: "Apex Leads" } }] },
    channels: [
      { channel: { id: "d1", name: "Ava Chen", channel_type: "direct", status: "active" }, unreadCount: 0, messages: [{ id: "m1", message: "Lunch?", messageKind: "text", createdBy: "u2", createdAt: "2026-11-24T18:00:00Z" }] },
      { channel: { id: "g1", name: "Apex Leads", channel_type: "partner", status: "active" }, unreadCount: 2, messages: [{ id: "m2", message: "Dolores is warm", messageKind: "text", createdBy: "p1", createdAt: "2026-11-24T14:12:00Z" }] },
    ],
  };

  test("groups first, search filters, the pencil starts a new message", async () => {
    mockParams = { part: "messages" };
    mockApi.mockImplementation(async (path: string) => (path === "/api/app/partner-chat" ? chats : path.startsWith("/api/app/partner-chat?search=") ? { hits: [], truncated: false } : { alerts: [], read: [] }));
    const user = userEvent.setup();
    await render(<Inbox />);
    const first = await screen.findByTestId("chat-g1");
    expect(within(first).getByText("Maya: Dolores is warm")).toBeOnTheScreen();
    const ids = screen.getAllByTestId(/^chat-/).map((n) => n.props.testID);
    expect(ids).toEqual(["chat-g1", "chat-d1"]);
    await user.press(screen.getByLabelText("Search chats"));
    await user.type(screen.getByTestId("chat-search"), "ava");
    expect(screen.queryByTestId("chat-g1")).toBeNull();
    expect(screen.getByTestId("chat-d1")).toBeOnTheScreen();
    await user.press(screen.getByLabelText("New message"));
    expect(mockPush).toHaveBeenCalledWith("/chat/new");
  });

  test("the switch shows for a role partner chat is not open to, and the chat route is never asked", async () => {
    mockMe = { role: "setter", user: { id: "u9" } };
    mockApi.mockResolvedValue({ alerts: [], read: [] });
    const user = userEvent.setup();
    await render(<Inbox />);
    await user.press(await screen.findByTestId("seg-messages"));
    expect(screen.getByText("No conversations yet")).toBeOnTheScreen();
    expect(mockApi).not.toHaveBeenCalledWith("/api/app/partner-chat");
  });

  test("a new message to two people starts a group on the chat route and opens it", async () => {
    mockApi.mockImplementation(async (path: string, init?: { method?: string }) => (init?.method === "POST" ? { channel: { id: "new1" } } : chats));
    const user = userEvent.setup();
    await render(<NewMessage />);
    await user.press(await screen.findByTestId("person-u2"));
    await user.press(screen.getByTestId("person-p1"));
    expect(screen.queryByTestId("person-u1")).toBeNull();
    await user.press(screen.getByTestId("start-chat"));
    expect(mockApi).toHaveBeenCalledWith("/api/app/partner-chat", { method: "POST", body: { action: "create_channel", channel_type: "group", user_ids: ["u2", "p1"] } });
    expect(mockReplace).toHaveBeenCalledWith({ pathname: "/chat/[threadId]", params: { threadId: "new1" } });
  });
});

describe("H4 · notification settings", () => {
  const ev = (key: string, label: string, group: string, push = true, extra: object = {}) => ({ key, label, description: `${label} described`, group, supportsDigest: false, protected: false, protectedReason: null, delivery: { in_app: true, email: false, push, digest: "immediate", protected: false }, ...extra });
  const prefs = {
    available: true, timeZone: "America/New_York", quiet: { enabled: true, start: "21:00", end: "07:30" }, callbackReminderMinutes: 5,
    events: [ev("new_lead", "New lead waiting", "Acquisition"), ev("handoff_offered", "Handoff offered to you", "Acquisition"), ev("callback_due", "Callback due", "Acquisition"),
      ev("appointment_due", "Appointment due", "Acquisition"), ev("partner_message", "Partner message", "Acquisition"), ev("servicing_failed", "Servicing request failed", "Retention", false)],
  };

  test("the board's groups and row names, each bound to its server event; quiet hours set on the phone", async () => {
    mockApi.mockImplementation(async (_p: string, init?: { method?: string; body?: unknown }) => (init?.method === "PUT" ? { ...prefs, quiet: (init.body as { quiet: object }).quiet } : prefs));
    const user = userEvent.setup();
    await render(<Notifications />);
    expect(await screen.findByText("Calls")).toBeOnTheScreen();
    expect(screen.getByText("Transfer waiting")).toBeOnTheScreen();
    expect(screen.getByText("Callback in 5 minutes")).toBeOnTheScreen();
    expect(screen.getByText("Someone handed a call to you")).toBeOnTheScreen();
    // Exactly the board's rows: an event the board does not draw is left to the web's settings.
    expect(screen.queryByText("Appointment due")).toBeNull();
    expect(screen.getByText("Sales and book")).toBeOnTheScreen();
    expect(screen.getByText("A policy is at risk")).toBeOnTheScreen();
    expect(screen.getByText("Messages")).toBeOnTheScreen();
    expect(screen.getByText("Partner chat")).toBeOnTheScreen();
    expect(screen.getByText("From 9:00 pm to 7:30 am")).toBeOnTheScreen();

    await user.press(screen.getByTestId("pref-quiet"));
    await user.press(screen.getByTestId("choice-start"));
    await user.press(await screen.findByTestId("choice-22:00"));
    expect(mockApi).toHaveBeenCalledWith("/api/app/notification-preferences", { method: "PUT", body: { quiet: { enabled: true, start: "22:00", end: "07:30" } } });
  });
});

describe("J5 · switch workspace", () => {
  test("another workspace says how many of your alerts wait there", async () => {
    mockApi.mockResolvedValue({ workspaces: [{ tenantId: "t1", name: "Ellery & Fields", roleLabel: "Producer", current: true }, { tenantId: "t2", name: "Reyes Family Insurance", roleLabel: "Owner", current: false, alerts: 2 }] });
    await render(<Workspaces />);
    expect(await screen.findByText("Owner · 2 alerts")).toBeOnTheScreen();
    expect(screen.getByText("Producer")).toBeOnTheScreen();
  });
});
