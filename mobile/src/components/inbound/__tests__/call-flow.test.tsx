import { render, screen, userEvent, waitFor } from "@testing-library/react-native";

import CallScreen from "@/app/call/[workItemId]";

/**
 * The inbound call in the web's order (boards C3 → C4 → C6): the caller, then verification field by
 * field (each tap saved at once), then the outcome — the walk is opened with POST { action: "start" }
 * only on Finish, an outcome question's answer is saved before the outcome it names is recorded, and an
 * assistant never opens the outcome walk (the server's role gate; they hand the call on instead).
 */
const mockApi = jest.fn();
let mockRole = "producer";
jest.mock("@/lib/session", () => ({ useSession: () => ({ api: mockApi, me: { user: { id: "me" }, role: mockRole } }) }));
jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn(async () => true) }));
jest.mock("expo-router", () => ({ router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true }, useLocalSearchParams: () => ({ workItemId: "w1" }) }));
const mockRouter = (jest.requireMock("expo-router") as { router: { push: jest.Mock; replace: jest.Mock } }).router;

const W = "w1";
const panel = (state: "outstanding" | "confirmed" = "outstanding") => ({
  session: { id: "s1", progress_percentage: state === "confirmed" ? 100 : 0, completed_at: null, started_at: "2026-11-24T14:00:00Z" },
  workItem: { id: W, leadId: "l1", productLine: "final_expense" },
  lead: { id: "l1", values: { full_name: "Dolores King", phone: "9045550117", beneficiary: "Karen King" } },
  template: { product_name: "Final expense" },
  sections: [{ section_key: "s", label: "S", sort_order: 1, fields: [{ field_key: "beneficiary", label: "Beneficiary", type: "text", options: [], is_required: true, is_visible: true, state, old_value: null, new_value: null, confirmed_at: null }] }],
  requiredCount: 1, visibleCount: 1, sensitiveKeys: [],
  context: { claim: { at: null, byName: "You", isYou: true }, partnerName: "Apex Leads", callStartedAt: null },
  preflight: { status: "new_household" },
});
const node = { id: "n1", label: "Interested?", prompt: "Is she interested?", node_type: "choice", options: [
  { id: "o1", option_key: "later", label: "Yes, not today", next_node_id: null, disposition_key: "not_interested", sort_order: 1 },
] };
const wizard = {
  walk: { id: "walk1", status: "open", current_node_id: "n1", final_disposition_key: null },
  flow: { nodes: [node] }, currentNode: node, steps: [], lead: { id: "l1", values: {} }, customerTimezone: "America/New_York", customerName: "Dolores King",
  outcomeOptions: [{ disposition_key: "not_interested", label: "Not interested", closes_as: "completed", description: "", stage: { id: "st", name: "Closed", pipeline_name: "Sales", is_current: false }, application: false, needs_verification: false, adds_to_do_not_call: false }],
  verification: { progress: 100, complete: true },
};

function serve(calls: string[]) {
  mockApi.mockImplementation(async (path: string, init?: { method?: string; body?: { action?: string; state?: string } }) => {
    const tag = `${init?.method ?? "GET"} ${path.split("?")[0]}${init?.body?.action ? ` ${init.body.action}` : ""}${init?.body?.state ? ` ${init.body.state}` : ""}`;
    calls.push(tag);
    if (path.startsWith("/api/app/inbound/verification") && !init?.method) return panel();
    if (path === "/api/app/inbound/verification") return { panel: panel("confirmed") };
    if (path.startsWith("/api/app/inbound/caller")) return { leadId: "l1", notes: [{ id: "n", body: "An old note", author: "Sam", createdAt: "2026-11-01T10:00:00Z" }], calls: { count: 0, last: null }, transfers: 1, consent: { provider: "trustedform", status: "claimed", consentAt: "2026-11-22T15:00:00Z", capturedAt: "2026-11-22T15:00:01Z" }, zones: null, campaign: "FE-Florida-2", sentAt: new Date(Date.now() - 150_000).toISOString(), partnerNote: "Wants $10k to cover burial." };
    if (path === "/api/app/applications/start") return { caseId: "case1", leadId: "l1", resumed: false };
    if (path.startsWith("/api/app/inbound/screening")) return { steps: [], checked: true, summary: "", checkedAt: null, warning: null };
    if (path === "/api/app/inbound/disposition" && init?.body?.action === "start") return wizard;
    if (path === "/api/app/inbound/disposition" && init?.body?.action === "answer") return { result: {}, wizard: { ...wizard, currentNode: null, walk: { ...wizard.walk, status: "completed", final_disposition_key: "not_interested" } } };
    if (path === "/api/app/inbound/disposition" && init?.body?.action === "complete") return { result: { label: "Not interested" } };
    throw new Error(`unexpected ${tag}`);
  });
}

beforeEach(() => { mockApi.mockReset(); mockRouter.push.mockReset(); mockRouter.replace.mockReset(); mockRole = "producer"; });

test("caller → verification → finish, each step on the server in the web's order", async () => {
  const calls: string[] = [];
  serve(calls);
  const user = userEvent.setup();
  await render(<CallScreen />);

  // C3: the caller, nothing written yet.
  expect(await screen.findByText("Step 1 of 4 · Caller profile")).toBeOnTheScreen();
  expect(screen.getAllByText("Dolores King").length).toBeGreaterThan(0);
  expect(calls.filter((c) => c.startsWith("POST"))).toEqual([]);
  expect(await screen.findByText("Consent on file")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Copy the phone number" })).toBeOnTheScreen();
  // The board's C3: From is partner · campaign; the partner's words with when and how often; no notes card.
  expect(await screen.findByText("Apex Leads · FE-Florida-2")).toBeOnTheScreen();
  expect(screen.getByText("“Wants $10k to cover burial.”")).toBeOnTheScreen();
  expect(screen.getByText("Apex Leads · 2 min ago · first call with us")).toBeOnTheScreen();
  expect(screen.queryByText("An old note")).not.toBeOnTheScreen();

  // C4: confirm the field in Now; it is saved the moment it is tapped.
  await user.press(screen.getByRole("button", { name: "Next: Verification" }));
  expect(await screen.findByText("0 of 1 confirmed")).toBeOnTheScreen();
  await user.press(screen.getByRole("button", { name: "Confirm" }));
  expect(await screen.findByText("1 of 1 confirmed")).toBeOnTheScreen();
  expect(mockApi.mock.calls.find(([p, i]) => p === "/api/app/inbound/verification" && i?.method === "POST")?.[1].body).toEqual({ work_item_id: W, field_key: "beneficiary", state: "confirmed" });
  expect(calls.some((c) => c.includes("disposition"))).toBe(false);

  // C4's footer: Continue opens the phone's own application (the web's one doorway, with this work
  // item); Skip goes to Finish.
  await user.press(screen.getByRole("button", { name: "Continue to Application" }));
  expect(mockApi.mock.calls.find(([p]) => p === "/api/app/applications/start")?.[1].body).toEqual({ work_item_id: W, product_line: "final_expense" });
  expect(mockRouter.push).toHaveBeenCalledWith({ pathname: "/application/[caseId]", params: { caseId: "case1" } });

  // C6: the walk opens only now; the outcome question's answer is saved, then its outcome recorded.
  await user.press(screen.getByRole("link", { name: "Skip · finish the call" }));
  expect(await screen.findByText("Is she interested?")).toBeOnTheScreen();
  await user.press(screen.getByRole("radio", { name: "Yes, not today" }));
  expect(screen.getByText(/Lead moves to\s+Closed/)).toBeOnTheScreen();
  await user.press(screen.getByRole("button", { name: "Save outcome" }));

  const posts = calls.filter((c) => c.startsWith("POST"));
  expect(posts).toEqual([
    "POST /api/app/inbound/verification confirmed",
    "POST /api/app/applications/start",
    "POST /api/app/inbound/disposition start",
    "POST /api/app/inbound/disposition answer",
    "POST /api/app/inbound/disposition complete",
  ]);
  const complete = mockApi.mock.calls.find(([, i]) => i?.body?.action === "complete")?.[1].body;
  expect(complete).toEqual({ work_item_id: W, walk_id: "walk1", action: "complete", disposition_key: "not_interested" });
  // Saved, the phone opens Daily deal flow straight away, as the web does (board C6: no toast, no wait).
  await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith("/deal-flow"));
  expect(screen.queryByText("Outcome saved · Not interested")).toBeNull();
});

test("a caller whose zone isn't known: the agent picks it, and it goes with the callback", async () => {
  const cbNode = { ...node, options: [{ id: "o2", option_key: "cb", label: "Call me Monday", next_node_id: null, disposition_key: "callback_scheduled", sort_order: 1 }] };
  const cbWizard = {
    ...wizard, flow: { nodes: [cbNode] }, currentNode: cbNode, customerTimezone: null,
    outcomeOptions: [{ ...wizard.outcomeOptions[0], disposition_key: "callback_scheduled", label: "Callback scheduled" }],
  };
  mockApi.mockImplementation(async (path: string, init?: { method?: string; body?: { action?: string } }) => {
    if (path.startsWith("/api/app/inbound/verification") && !init?.method) return panel();
    if (path.startsWith("/api/app/inbound/caller")) return { leadId: "l1", notes: [], calls: { count: 0, last: null }, transfers: 1, consent: null, zones: null, campaign: null, sentAt: null, partnerNote: null };
    if (path.startsWith("/api/app/inbound/screening")) return { steps: [], checked: true, summary: "", checkedAt: null, warning: null };
    if (path === "/api/app/inbound/disposition" && init?.body?.action === "start") return cbWizard;
    if (path === "/api/app/inbound/disposition" && init?.body?.action === "answer") return { result: {}, wizard: { ...cbWizard, currentNode: null, walk: { ...cbWizard.walk, status: "completed", final_disposition_key: "callback_scheduled" } } };
    if (path === "/api/app/inbound/disposition" && init?.body?.action === "complete") return { result: { label: "Callback scheduled" } };
    return {};
  });
  const user = userEvent.setup();
  await render(<CallScreen />);
  await user.press(await screen.findByRole("button", { name: "Next: Verification" }));
  await user.press(await screen.findByRole("link", { name: "Skip · finish the call" }));
  await user.press(await screen.findByRole("radio", { name: "Call me Monday" }));
  expect(screen.getByText("Ask which time zone they’re in.")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Save outcome" })).toBeDisabled();
  await user.press(screen.getByTestId("finish-zone-America/Chicago"));
  await user.press(screen.getAllByTestId(/^finish-time-\d/)[0]);
  await user.press(screen.getByRole("button", { name: "Save outcome" }));
  await waitFor(() => expect(mockApi.mock.calls.find(([, i]) => i?.body?.action === "complete")?.[1].body).toMatchObject({ disposition_key: "callback_scheduled", callback_timezone: "America/Chicago", callback_local: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/) }));
});

test("an assistant hands the call on and never opens the outcome walk", async () => {
  mockRole = "assistant";
  const calls: string[] = [];
  serve(calls);
  const user = userEvent.setup();
  await render(<CallScreen />);
  await user.press(await screen.findByRole("button", { name: "Next: Verification" }));
  expect(await screen.findByRole("button", { name: "Hand to a licensed agent" })).toBeOnTheScreen();
  expect(screen.queryByRole("link", { name: "Skip · finish the call" })).not.toBeOnTheScreen();
  expect(calls.some((c) => c.includes("disposition"))).toBe(false);
});
