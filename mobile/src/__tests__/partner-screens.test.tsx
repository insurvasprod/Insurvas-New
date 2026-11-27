import { fireEvent, render, screen, userEvent, within } from "@testing-library/react-native";

import { PartnerAccount } from "@/components/partner/account";
import { PartnerHome } from "@/components/partner/home";
import { PartnerLead } from "@/components/partner/lead";
import { PartnerMessages } from "@/components/partner/messages";
import { PartnerNotifications } from "@/components/partner/notifications";
import { PartnerPipeline } from "@/components/partner/pipeline";
import { PartnerSend } from "@/components/partner/send";
import { PartnerTeam } from "@/components/partner/team";

/**
 * Board K1–K6 against a mocked partner api: what each screen asks the partner routes for, what it draws,
 * and what a write would send. Nothing reaches a server.
 */
const mockApi = jest.fn();
const mockPush = jest.fn();
const mockCopy = jest.fn();
let mockMe: Record<string, unknown> = {};
jest.mock("expo-router", () => ({ router: { push: (...a: unknown[]) => mockPush(...a), back: jest.fn(), replace: jest.fn(), canGoBack: () => true } }));
jest.mock("expo-clipboard", () => ({ setStringAsync: (...a: unknown[]) => mockCopy(...a) }));
jest.mock("@/components/partner/session", () => ({ usePartnerSession: () => ({ api: mockApi, me: mockMe, signOut: jest.fn() }) }));

const admin = { userId: "u1", name: "Maya Santos", partnerId: "p1", partnerName: "Apex Leads", role: "partner_admin", partnerType: "publisher", partnerStatus: "active", hasTeam: true, agencyName: "Ellery & Fields" };
const row = (over: Record<string, unknown>) => ({ id: "l1", workItemId: "w1", customer: "Linda Okafor", submittedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), product: "Final expense", stageId: "s1", stageName: "Contacted", stageType: "open", disposition: null, outcome: null, submittedBy: { id: "u1", name: "Maya Santos" }, status: "claimed", lane: "claimed", ...over });
const stages = [{ id: "s1", pipelineId: "x", name: "Contacted", position: 0, stageType: "open", isArchived: false, leadCount: 2 }, { id: "s2", pipelineId: "x", name: "Sold", position: 1, stageType: "won", isArchived: false, leadCount: 1 }, { id: "s3", pipelineId: "x", name: "Returned", position: 2, stageType: "lost", isArchived: false, leadCount: 1 }];
const claimedAt = new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate(), 14, 9).toISOString();
const month = { rows: [row({ lane: "verification", live: { claimedBy: "Jordan", claimedAt, callbackAt: null } }), row({ id: "l2", customer: "Ida Collins", stageType: "lost", stageName: "Returned", outcome: "wrong number", status: "completed", lane: "closed" }), row({ id: "l3", customer: "George Patel", stageType: "won", stageName: "Sold", status: "completed", disposition: "sold", lane: "converted" }), row({ id: "l4", customer: "Walter Brooks", status: "unclaimed", stageName: "Needs review", lane: "new" })], stages, total: 4, nextOffset: null };
const payout = { method: "Bank transfer", expectedOn: { r1: "2026-12-05" }, next: { runId: "r1", lines: [{ itemType: "sale", count: 41, rateCents: 9500 }, { itemType: "transfer", count: 12, rateCents: 3500 }], revenueShareCents: null } };
const runs = [{ id: "r1", periodStart: "2026-11-01", periodEnd: "2026-11-30", status: "published", netCents: 431_000, paidOn: null, invoiceNumber: null }, { id: "r2", periodStart: "2026-10-01", periodEnd: "2026-10-31", status: "paid", netCents: 372_500, paidOn: "2026-11-05", invoiceNumber: null }];

beforeEach(() => {
  mockApi.mockReset(); mockPush.mockReset(); mockCopy.mockReset();
  mockMe = { ...admin };
  mockApi.mockImplementation(async (path: string) => {
    if (path.startsWith("/api/partner/leads/pipeline") && path.includes("limit=1&")) return { ...month, rows: [], total: 0 };
    if (path.startsWith("/api/partner/leads/pipeline") && path.includes("date_to=")) return { ...month, rows: [], total: 3 };
    if (path.startsWith("/api/partner/leads/pipeline")) return month;
    if (path === "/api/partner/payouts?phone=1") return { runs, payout };
    if (path === "/api/partner/links") return { links: [{ id: "k1", slug: "bp-fe", campaign: "Final expense · Facebook", isActive: true, clicks: 1904, referrals: 41, createdAt: "" }] };
    if (path.startsWith("/api/partner/users")) return { sentThisMonth: { u1: 3, u3: 120 }, users: [{ id: "m3", user_id: "u3", name: "Devon King", email: "d@x", role: "partner_user", status: "active", invited_at: "", accepted_at: "2026-02-01", last_login_at: null }, { id: "m1", user_id: "u1", name: "Maya Santos", email: "m@x", role: "partner_admin", status: "active", invited_at: "", accepted_at: "2026-01-01", last_login_at: null }, { id: "m2", user_id: "u2", name: "Rita Pope", email: "r@x", role: "partner_user", status: "active", invited_at: "", accepted_at: null, last_login_at: null }] };
    if (path === "/api/partner/products") return { products: [{ code: "final_expense", name: "Final expense" }] };
    throw new Error(`unexpected ${path}`);
  });
});

test("K1: a call centre admin sees sent with the gold rise, accepted, sold and what they're owed", async () => {
  await render(<PartnerHome />);
  const sent = await screen.findByTestId("tile-sent");
  expect(within(sent).getByText("4")).toBeOnTheScreen();
  expect(within(sent).getByText("↑ 1")).toBeOnTheScreen();
  expect(within(screen.getByTestId("tile-accepted")).getByText("75% of sent")).toBeOnTheScreen();
  expect(within(screen.getByTestId("tile-sold")).getByText("1")).toBeOnTheScreen();
  expect(within(screen.getByTestId("tile-owed")).getByText("$4,310")).toBeOnTheScreen();
  expect(within(screen.getByTestId("tile-owed")).getByText("Paid on 5 Dec")).toBeOnTheScreen();
  expect(within(screen.getByTestId("lead-l4")).getByText("Sent today · agency is reviewing")).toBeOnTheScreen();
  expect(within(screen.getByTestId("lead-l1")).getByText("Transferred 2:09 pm · Jordan took it")).toBeOnTheScreen();
  expect(mockApi).toHaveBeenCalledWith(expect.stringMatching(/\/api\/partner\/leads\/pipeline\?date_from=.*&live=1$/));
  expect(within(screen.getByTestId("lead-l2")).getByText("Returned")).toBeOnTheScreen();
  expect(screen.getByText("Sending to Ellery & Fields · " + new Date().toLocaleString("en-US", { month: "long" }))).toBeOnTheScreen();
  const user = userEvent.setup();
  await user.press(screen.getByTestId("lead-l2"));
  expect(mockPush).toHaveBeenCalledWith("/partner/lead/l2");
});

test("K1: a partner user sees no money and never asks for statements", async () => {
  mockMe = { ...admin, role: "partner_user" };
  await render(<PartnerHome />);
  await screen.findByTestId("tile-sent");
  expect(screen.queryByTestId("tile-owed")).toBeNull();
  expect(within(screen.getByTestId("tile-working")).getByText("2")).toBeOnTheScreen();
  expect(screen.queryByText(/\$/)).toBeNull();
  expect(mockApi.mock.calls.some(([p]) => String(p).startsWith("/api/partner/payouts"))).toBe(false);
});

test("K1b: an affiliate sees clicks and referrals and copies a link instead of a form", async () => {
  mockMe = { ...admin, partnerType: "affiliate", partnerName: "Bright Path" };
  const user = userEvent.setup();
  await render(<PartnerHome />);
  expect(within(await screen.findByTestId("tile-clicks")).getByText("1,904")).toBeOnTheScreen();
  expect(screen.getByText("Affiliate · Ellery & Fields")).toBeOnTheScreen();
  expect(within(screen.getByTestId("link-k1")).getByText(/\/affiliate\/bp-fe · 41 referrals$/)).toBeOnTheScreen();
  expect(screen.queryByTestId("home-send")).toBeNull();
  await user.press(screen.getByLabelText("Copy the link for Final expense · Facebook"));
  expect(mockCopy).toHaveBeenCalledWith(expect.stringMatching(/\/affiliate\/bp-fe$/));
});

test("K3: the pipeline filters by the partner's own stage types, counts from the server", async () => {
  const user = userEvent.setup();
  await render(<PartnerPipeline />);
  expect(await screen.findByText("Working · 2")).toBeOnTheScreen();
  expect(screen.queryByTestId("lead-l3")).toBeNull();
  expect(within(screen.getByTestId("lead-l1")).getByText("On a call with Jordan · 2:09 pm")).toBeOnTheScreen();
  expect(within(screen.getByTestId("lead-l4")).getByText("Agency is reviewing")).toBeOnTheScreen();
  await user.press(screen.getByRole("button", { name: /Returned/ }));
  expect(await screen.findByText("Returned · 1")).toBeOnTheScreen();
  expect(screen.getByTestId("lead-l2")).toBeOnTheScreen();
  await user.press(screen.getByRole("button", { name: /Sold/ }));
  expect(await screen.findByText("Sold · 1")).toBeOnTheScreen();
  expect(screen.getByTestId("lead-l3")).toBeOnTheScreen();
});

test("K3b: the lead in the partner's words, its history newest first, and a message about it", async () => {
  mockApi.mockImplementation(async (path: string) => {
    if (path === "/api/partner/leads/l2?phone=1") return { ...month.rows[1], notes: [], attempts: { count: 3, firstAt: "2026-11-20T16:00:00Z", lastAt: "2026-11-21T09:00:00Z" }, live: { claimedBy: "Jordan", claimedAt: null, callbackAt: null }, timeline: [
      { type: "submitted", label: "Lead submitted", at: "2026-11-20T19:12:00Z", detail: "Maya Santos" },
      { type: "claimed", label: "Lead claimed", at: "2026-11-20T19:14:00Z", detail: "Jordan Lee" },
      { type: "message", label: "Message", at: "2026-11-20T19:15:00Z", detail: "internal chat" },
      { type: "outcome", label: "Returned: wrong number", at: "2026-11-21T10:00:00Z", detail: null },
    ] };
    if (path === "/api/partner/chat") return { channels: [{ channel: { id: "c1", name: "Ellery & Fields", channel_type: "partner", status: "active" }, messages: [], unreadCount: 0 }], directory: {}, viewerId: "u1", agencyName: null };
    throw new Error(`unexpected ${path}`);
  });
  const user = userEvent.setup();
  await render(<PartnerLead id="l2" />);
  expect(await screen.findByText("Returned · wrong number")).toBeOnTheScreen();
  expect(within(screen.getByTestId("event-0")).getByText("Returned: wrong number")).toBeOnTheScreen();
  expect(within(screen.getByTestId("event-1")).getByText("Called 3 times")).toBeOnTheScreen();
  expect(within(screen.getByTestId("event-1")).getByText("20–21 Nov")).toBeOnTheScreen();
  expect(within(screen.getByTestId("event-2")).getByText(/· Jordan$/)).toBeOnTheScreen();
  expect(screen.queryByText(/Jordan Lee/)).toBeNull();
  expect(within(screen.getByTestId("event-3")).getByText("Sent by Maya Santos")).toBeOnTheScreen();
  expect(screen.queryByText("internal chat")).toBeNull();
  await user.press(screen.getByTestId("lead-message"));
  expect(mockPush).toHaveBeenCalledWith({ pathname: "/partner/thread/[id]", params: { id: "c1", draft: "About Ida Collins: " } });
});

test("K4: what is owed next and every statement; Team access for the admin", async () => {
  await render(<PartnerAccount />);
  expect(await screen.findByLabelText("$4,310.00")).toBeOnTheScreen();
  expect(screen.getByText("Next payout · 5 Dec")).toBeOnTheScreen();
  expect(screen.getByText("41 sold leads × $95 + 12 transfers × $35")).toBeOnTheScreen();
  expect(within(screen.getByTestId("payout-details")).getByText("Bank transfer")).toBeOnTheScreen();
  const user = userEvent.setup();
  await user.press(screen.getByTestId("partner-notifications"));
  expect(mockPush).toHaveBeenCalledWith("/partner/notifications");
  expect(within(screen.getByTestId("statement-r2")).getByText("$3,725.00")).toBeOnTheScreen();
  expect(within(screen.getByTestId("statement-r2")).getByText(/^Paid /)).toBeOnTheScreen();
  expect(screen.getByText("3 people")).toBeOnTheScreen();
});

test("K4: a partner user sees their account and no money", async () => {
  mockMe = { ...admin, role: "partner_user" };
  await render(<PartnerAccount />);
  expect(await screen.findByTestId("partner-sign-out")).toBeOnTheScreen();
  expect(screen.queryByText(/\$/)).toBeNull();
  expect(screen.queryByText("Team access")).toBeNull();
  expect(screen.queryByTestId("payout-details")).toBeNull();
  expect(screen.getByTestId("partner-notifications")).toBeOnTheScreen();
  expect(mockApi).not.toHaveBeenCalled();
});

test("K6: the admin's people with fixed roles; an invite is a partner user", async () => {
  const user = userEvent.setup();
  await render(<PartnerTeam />);
  expect(await screen.findByText("Maya Santos (you)")).toBeOnTheScreen();
  expect(within(screen.getByTestId("member-u2")).getByText("Invited")).toBeOnTheScreen();
  expect(within(screen.getByTestId("member-u2")).getByText("Invited · not joined")).toBeOnTheScreen();
  expect(within(screen.getByTestId("member-u3")).getByText("Partner user · sent 120 this month")).toBeOnTheScreen();
  mockApi.mockImplementationOnce(async () => ({ invite: { delivered: true } }));
  await user.press(screen.getByRole("button", { name: "Invite someone" }));
  await user.type(screen.getByTestId("invite-name"), "Devon King");
  await user.type(screen.getByTestId("invite-email"), "devon@apex.test");
  await user.press(screen.getByTestId("invite-send"));
  expect(mockApi).toHaveBeenCalledWith("/api/partner/users", { method: "POST", body: { name: "Devon King", email: "devon@apex.test", role: "partner_user" } });
});

describe("K2: consent is proof", () => {
  test("a referral is not sent without proof, then sends the attestation with it", async () => {
    mockMe = { ...admin, partnerType: "marketing" };
    const user = userEvent.setup();
    await render(<PartnerSend />);
    await user.type(await screen.findByTestId("refer-name"), "Ida Collins");
    await user.type(screen.getByTestId("refer-phone"), "2055550182");
    await user.press(screen.getByTestId("refer-state"));
    await user.press(screen.getByText("Alabama"));
    await user.press(screen.getByTestId("send-submit"));
    expect(await screen.findByText("Paste the TrustedForm certificate or the Jornaya LeadiD.")).toBeOnTheScreen();
    expect(mockApi.mock.calls.some(([p]) => p === "/api/partner/referrals")).toBe(false);
    mockApi.mockImplementationOnce(async () => ({ ok: true, leadId: "new1" })).mockImplementation(async () => ({ ...month.rows[0], id: "new1", customer: "Ida Collins", notes: [], timeline: [] }));
    await user.type(screen.getByTestId("consent-proof"), "https://cert.trustedform.com/7f3c0a1b2c3d4e5f60718293a4b5c6d7e8f9a19e");
    await user.press(screen.getByTestId("send-submit"));
    const call = mockApi.mock.calls.find(([p]) => p === "/api/partner/referrals")!;
    expect(call[1]).toMatchObject({ method: "POST", body: { product_code: "final_expense", consent_attested: true, values: { full_name: "Ida Collins", phone: "2055550182", state: "AL", product_interest: "final_expense", consent: true } } });
    expect(call[1].body.submission_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await screen.findByText("Sent to Ellery & Fields")).toBeOnTheScreen();
  });

  test("a call centre's live transfer files the proof in the template's consent field and shows the claim", async () => {
    const fields = [
      { field_key: "first_name", label: "First name", type: "text", is_required: true, options: [], sort_order: 0 },
      { field_key: "phone", label: "Phone", type: "phone", is_required: true, options: [], sort_order: 1 },
      { field_key: "trustedform_url", label: "TrustedForm", type: "text", is_required: false, options: [], sort_order: 2 },
    ];
    mockApi.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === "/api/partner/products") return { products: [{ code: "final_expense", name: "Final expense" }] };
      if (path === "/api/partner/forms/final_expense") return { template: { template: { fields } } };
      if (path === "/api/partner/leads" && init?.method === "POST") return { lead: { id: "new2" } };
      if (path === "/api/partner/leads/new2?phone=1") return { ...month.rows[0], id: "new2", customer: "Ida Collins", notes: [], agentsReady: 4, live: { claimedBy: "Jordan", claimedAt: new Date().toISOString(), callbackAt: null }, timeline: [{ type: "submitted", label: "Lead submitted", at: new Date().toISOString(), detail: "Maya" }, { type: "claimed", label: "Lead claimed", at: new Date().toISOString(), detail: "Jordan Lee" }] };
      throw new Error(`unexpected ${path}`);
    });
    const user = userEvent.setup();
    await render(<PartnerSend />);
    await user.press(await screen.findByTestId("seg-live"));
    await user.type(await screen.findByTestId("field-first_name"), "Ida");
    await user.type(screen.getByTestId("field-phone"), "2055550182");
    // The template's own consent field is the proof control, not a question.
    expect(screen.queryByTestId("field-trustedform_url")).toBeNull();
    await user.type(screen.getByTestId("consent-proof"), "7f3c0a1b2c3d4e5f60718293a4b5c6d7e8f9a19e");
    await user.press(screen.getByTestId("send-submit"));
    const call = mockApi.mock.calls.find(([p, i]) => p === "/api/partner/leads" && i?.method === "POST")!;
    expect(call[1].body).toMatchObject({ product_code: "final_expense", consent_attested: true, live_transfer: true, values: { first_name: "Ida", phone: "2055550182", trustedform_url: "7f3c0a1b2c3d4e5f60718293a4b5c6d7e8f9a19e" } });
    expect(await screen.findByText("Claimed by Jordan")).toBeOnTheScreen();
    expect(screen.queryByText(/Jordan Lee/)).toBeNull();
  });

  test("K2 · the board's field order with pairs; a lead-only send says so; history opens the pipeline", async () => {
    const fields = [
      { field_key: "phone", label: "Phone", type: "phone", is_required: true, options: [], sort_order: 0 },
      { field_key: "agent_note", label: "Note for the agent", type: "long_text", is_required: false, options: [], sort_order: 1 },
      { field_key: "last_name", label: "Last name", type: "text", is_required: true, options: [], sort_order: 2 },
      { field_key: "first_name", label: "First name", type: "text", is_required: true, options: [], sort_order: 3 },
    ];
    mockApi.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === "/api/partner/products") return { products: [{ code: "final_expense", name: "Final expense" }] };
      if (path === "/api/partner/forms/final_expense") return { template: { template: { fields } } };
      if (path === "/api/partner/leads" && init?.method === "POST") return { lead: { id: "new3" } };
      if (path.startsWith("/api/partner/leads/new3")) return { ...month.rows[0], id: "new3", customer: "Ida Collins", notes: [], timeline: [] };
      throw new Error(`unexpected ${path}`);
    });
    const user = userEvent.setup();
    await render(<PartnerSend />);
    await screen.findByTestId("field-first_name");
    const ids = screen.getAllByTestId(/^(field-|send-product$|consent-proof$)/).map((n) => n.props.testID as string);
    const order = [...new Set(ids)];
    expect(order.indexOf("field-first_name")).toBeLessThan(order.indexOf("field-last_name"));
    expect(order.indexOf("field-last_name")).toBeLessThan(order.indexOf("field-phone"));
    expect(order.indexOf("field-phone")).toBeLessThan(order.indexOf("send-product"));
    expect(order.indexOf("consent-proof")).toBeLessThan(order.indexOf("field-agent_note"));
    await user.type(screen.getByTestId("field-first_name"), "Ida");
    await user.type(screen.getByTestId("field-last_name"), "Collins");
    await user.type(screen.getByTestId("field-phone"), "2055550182");
    await user.type(screen.getByTestId("consent-proof"), "7f3c0a1b2c3d4e5f60718293a4b5c6d7e8f9a19e");
    await user.press(screen.getByTestId("send-submit"));
    const call = mockApi.mock.calls.find(([p, i]) => p === "/api/partner/leads" && i?.method === "POST")!;
    expect(call[1].body.live_transfer).toBe(false);
    await user.press(screen.getByRole("button", { name: "What you sent" }));
    expect(mockPush).toHaveBeenCalledWith("/partner/pipeline");
  });

  test("K2b · while waiting: the caller's age, state and product, and how many agents are ready", async () => {
    const fields = [{ field_key: "first_name", label: "First name", type: "text", is_required: true, options: [], sort_order: 0 }];
    mockApi.mockImplementation(async (path: string, init?: { method?: string }) => {
      if (path === "/api/partner/products") return { products: [{ code: "final_expense", name: "Final expense" }] };
      if (path === "/api/partner/forms/final_expense") return { template: { template: { fields } } };
      if (path === "/api/partner/leads" && init?.method === "POST") return { lead: { id: "new4" } };
      if (path === "/api/partner/leads/new4?phone=1") return { ...month.rows[0], id: "new4", customer: "Ida Collins", product: "Final expense", values: { date_of_birth: "1956-01-02", state: "AL" }, notes: [], agentsReady: 4, live: null, timeline: [{ type: "submitted", label: "Lead submitted", at: new Date().toISOString(), detail: "Maya" }] };
      throw new Error(`unexpected ${path}`);
    });
    const user = userEvent.setup();
    await render(<PartnerSend />);
    await user.press(await screen.findByTestId("seg-live"));
    await user.type(await screen.findByTestId("field-first_name"), "Ida");
    await user.type(screen.getByTestId("consent-proof"), "7f3c0a1b2c3d4e5f60718293a4b5c6d7e8f9a19e");
    await user.press(screen.getByTestId("send-submit"));
    expect(await screen.findByText("Waiting for an agent to claim · 4 ready")).toBeOnTheScreen();
    expect(screen.getByTestId("sent-facts")).toHaveTextContent(/^\d+ · AL · final expense$/);
    expect(screen.getByText("Checks passed · consent proof attached")).toBeOnTheScreen();
    // No partner route can take a transfer back yet, so nothing offers to.
    expect(screen.queryByText("Cancel transfer")).toBeNull();
    expect(screen.queryByTestId("send-again")).toBeNull();
  });
});

test("K6: tapping someone opens resend and remove access, each on the partner routes", async () => {
  const user = userEvent.setup();
  await render(<PartnerTeam />);
  await user.press(await screen.findByTestId("member-u2"));
  mockApi.mockImplementationOnce(async () => ({ invite: { delivered: true } }));
  await user.press(screen.getByTestId("member-resend"));
  expect(mockApi).toHaveBeenCalledWith("/api/partner/users/u2/resend-invite", { method: "POST" });
  await user.press(screen.getByTestId("member-u3"));
  expect(screen.queryByTestId("member-resend")).toBeNull();
  await user.press(screen.getByTestId("member-revoke"));
  mockApi.mockImplementationOnce(async () => ({ ok: true, status: "revoked" }));
  await user.press(screen.getByTestId("member-revoke-confirm"));
  expect(mockApi).toHaveBeenCalledWith("/api/partner/users/u3", { method: "PATCH", body: { action: "deactivate" } });
});

test("K5: the pencil starts a direct conversation with someone at the agency", async () => {
  mockApi.mockImplementation(async (path: string, init?: { method?: string }) => {
    if (path === "/api/partner/chat" && init?.method === "POST") return { channel: { id: "d1" } };
    if (path === "/api/partner/chat") return { channels: [{ channel: { id: "c1", name: "Ellery & Fields · transfers", channel_type: "partner", status: "active" }, messages: [], unreadCount: 2 }], directory: { tenantUsers: [{ user_id: "a1", users: { name: "Jordan Reyes", email: null } }], partnerUsers: [{ user_id: "u1", users: { name: "Maya Santos", email: null } }] }, viewerId: "u1", agencyName: "Ellery & Fields" };
    throw new Error(`unexpected ${path}`);
  });
  const user = userEvent.setup();
  await render(<PartnerMessages />);
  await screen.findByTestId("conversation-c1");
  await user.press(screen.getByRole("button", { name: "New message" }));
  expect(screen.queryByTestId("person-u1")).toBeNull();
  await user.press(screen.getByTestId("person-a1"));
  expect(mockApi).toHaveBeenCalledWith("/api/partner/chat", { method: "POST", body: { action: "create_channel", channel_type: "direct", user_ids: ["a1"] } });
  expect(mockPush).toHaveBeenCalledWith({ pathname: "/partner/thread/[id]", params: { id: "d1" } });
});

test("Account › Notifications: each switch saves the whole set on the partner route", async () => {
  const settings = { enabled_events: { partner_message: true, lead_status_changed: true, partner_account_changed: true, team_access_changed: true }, do_not_disturb: false, sound_muted: true, sound_volume: 70, sound_opted_in_at: null };
  mockApi.mockImplementation(async (path: string, init?: { method?: string; body?: unknown }) => {
    if (path === "/api/partner/notifications" && init?.method === "PATCH") return { settings: init.body };
    if (path === "/api/partner/notifications") return { alerts: [], settings };
    throw new Error(`unexpected ${path}`);
  });
  await render(<PartnerNotifications />);
  await screen.findByText("Lead status updates");
  fireEvent(screen.getByLabelText("New messages"), "valueChange", false);
  expect(mockApi).toHaveBeenCalledWith("/api/partner/notifications", { method: "PATCH", body: { ...settings, enabled_events: { ...settings.enabled_events, partner_message: false } } });
});
