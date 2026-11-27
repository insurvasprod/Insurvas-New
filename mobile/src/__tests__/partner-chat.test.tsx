import { render, screen, userEvent } from "@testing-library/react-native";

import ChatThreadRoute from "@/app/chat/[threadId]";
import { PartnerMessages, PartnerThread } from "@/components/partner/messages";

/**
 * Board H3 (the agent's side) and K5 (the partner's side) against mocked apis: the thread reads its own
 * route, marks itself read, sends to its own route, and a lead card opens the lead.
 */
const mockApi = jest.fn();
const mockPartnerApi = jest.fn();
const mockPush = jest.fn();
jest.mock("expo-router", () => ({ router: { push: (...a: unknown[]) => mockPush(...a), back: jest.fn(), replace: jest.fn(), canGoBack: () => true }, useLocalSearchParams: () => ({ threadId: "c1" }) }));
jest.mock("expo-image-picker", () => ({ launchImageLibraryAsync: jest.fn(async () => ({ canceled: true, assets: [] })) }));
jest.mock("@/lib/session", () => ({ useSession: () => ({ api: mockApi, refreshToken: jest.fn() }) }));
jest.mock("@/components/partner/session", () => ({ usePartnerSession: () => ({ api: mockPartnerApi, upload: jest.fn(), me: { role: "partner_admin" } }) }));

const at = (min: number) => new Date(Date.UTC(2026, 10, 25, 19, min)).toISOString();
const messages = [
  { id: "m1", channelId: "c1", workItemId: null, message: "Transferring Dolores King now, 71, Jacksonville.", messageKind: "text", cardType: null, cardPayload: {}, createdBy: "maya", createdAt: at(9), attachments: [] },
  { id: "m2", channelId: "c1", workItemId: "w9", message: "Dolores King is available for Final Expense", messageKind: "system_card", cardType: "new_lead", cardPayload: { customer: "Dolores King", product: "Final Expense", state: "FL" }, createdBy: "maya", createdAt: at(10), attachments: [] },
  { id: "m3", channelId: "c1", workItemId: null, message: "Got her, on the call now. Thanks Maya.", messageKind: "text", cardType: null, cardPayload: {}, createdBy: "jordan", createdAt: at(12), attachments: [] },
];
const directory = { tenantUsers: [{ user_id: "jordan", users: { name: "Jordan Lee", email: null } }], partnerUsers: [{ user_id: "maya", users: { name: "Maya Santos", email: null } }] };

beforeEach(() => {
  mockApi.mockReset(); mockPartnerApi.mockReset(); mockPush.mockReset();
  mockApi.mockImplementation(async (path: string, init?: { method?: string }) => {
    if (path === "/api/app/partner-chat?with=leads") return { channels: [{ channel: { id: "c1", name: "Apex Leads", channel_type: "partner", status: "active" }, messages, unreadCount: 1, othersReadAt: at(12) }], directory, viewerId: "jordan", leadIds: { w9: "lead-9" } };
    if (init?.method === "PATCH" || init?.method === "POST") return { ok: true };
    throw new Error(`unexpected ${path}`);
  });
});

test("H3: bubbles on each side, the lead as a record card that opens the lead, read on open", async () => {
  const user = userEvent.setup();
  await render(<ChatThreadRoute />);
  expect(await screen.findByText("Transferring Dolores King now, 71, Jacksonville.")).toBeOnTheScreen();
  expect(screen.getByText(/^Maya · Apex Leads · /)).toBeOnTheScreen();
  expect(screen.getByText(/^Read /)).toBeOnTheScreen();
  expect(mockApi).toHaveBeenCalledWith("/api/app/partner-chat", { method: "PATCH", body: { channel_id: "c1" } });
  await user.press(screen.getByTestId("card-m2"));
  expect(mockPush).toHaveBeenCalledWith("/lead/lead-9");
});

test("H3: a message goes to the conversation on the agent's own route", async () => {
  const user = userEvent.setup();
  await render(<ChatThreadRoute />);
  await user.type(await screen.findByLabelText("Message Apex Leads"), "On it");
  await user.press(screen.getByTestId("chat-send"));
  expect(mockApi).toHaveBeenCalledWith("/api/app/partner-chat", { method: "POST", body: { channel_id: "c1", message: "On it" } });
});

test("H3: the header's more menu pins the conversation for this person; the clip offers the camera and photos", async () => {
  const user = userEvent.setup();
  await render(<ChatThreadRoute />);
  await user.press(await screen.findByLabelText("More"));
  await user.press(await screen.findByTestId("choice-pin"));
  expect(mockApi).toHaveBeenCalledWith("/api/app/partner-chat", { method: "POST", body: { action: "conversation_state", channel_id: "c1", pinned: true } });
  await user.press(screen.getByTestId("chat-attach"));
  expect(await screen.findByText("Take a photo")).toBeOnTheScreen();
  expect(screen.getByText("Choose from photos")).toBeOnTheScreen();
});

test("K5: the partner's conversations, unread in gold, and a thread on the partner route", async () => {
  mockPartnerApi.mockImplementation(async (path: string, init?: { method?: string }) => {
    if (path === "/api/partner/chat" && !init) return { channels: [{ channel: { id: "c1", name: "Ellery & Fields · transfers", channel_type: "partner", status: "active" }, messages, unreadCount: 2 }], directory, viewerId: "maya", agencyName: "Ellery & Fields" };
    return { ok: true };
  });
  const user = userEvent.setup();
  const { unmount } = await render(<PartnerMessages />);
  expect(await screen.findByText("Jordan: Got her, on the call now. Thanks Maya.")).toBeOnTheScreen();
  expect(screen.getByText("2")).toBeOnTheScreen();
  await user.press(screen.getByTestId("conversation-c1"));
  expect(mockPush).toHaveBeenCalledWith({ pathname: "/partner/thread/[id]", params: { id: "c1" } });
  await unmount();

  await render(<PartnerThread id="c1" draft="About Ida Collins: " />);
  const box = await screen.findByLabelText("Message Ellery & Fields · transfers");
  expect(box.props.value).toBe("About Ida Collins: ");
  await user.press(screen.getByTestId("chat-send"));
  expect(mockPartnerApi).toHaveBeenCalledWith("/api/partner/chat", { method: "POST", body: { channel_id: "c1", message: "About Ida Collins:" } });
  expect(mockPartnerApi).toHaveBeenCalledWith("/api/partner/chat", { method: "PATCH", body: { channel_id: "c1" } });
  // The agency side is never called from the partner app.
  expect(mockApi).not.toHaveBeenCalled();
});
