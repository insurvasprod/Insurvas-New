import { render, screen, userEvent, waitFor } from "@testing-library/react-native";

import { NeedsYouScreen } from "../needs-you";
import type { NeedsYouItem, NeedsYouList, PickClientItem } from "../types";

/**
 * Board F6: a phone settles "which client is this?" in one tap, through the web's own Policy matching API; money
 * that doesn't match opens on the computer. Decisions are exercised against a mocked api only.
 */
const mockApi = jest.fn();
jest.mock("@/lib/session", () => ({ useSession: () => ({ api: mockApi }) }));
const mockPush = jest.fn();
jest.mock("expo-router", () => ({ router: { push: (...a: unknown[]) => mockPush(...a), back: jest.fn() } }));

const R1 = "aa8271c4-b2d8-47bf-bdeb-a6f3c4c043ed";
const R2 = "3239adc2-e7ff-4b12-978d-5354947fd116";
const item = (id: string, over: Partial<NeedsYouItem> = {}): NeedsYouItem => ({
  kind: "pick-client", id, label: "Pick the client", todo: "Pick the client", about: "0119993301 · American Amicable", why: "2 sales could be it", since: "2026-11-22", ageDays: 3, tone: "warning", webPath: `/app/needs-you/pick-client/${id}`, ...over,
});
const list = (): NeedsYouList => ({
  ok: true, total: 4,
  phone: { total: 2, items: [item(R1), item(R2)] },
  computer: { total: 2, items: [item("m1", { kind: "money", label: "Money doesn’t match", about: "Paid short · $214.00", why: "Corebridge statement · 3 policies", webPath: "/app/needs-you/money/m1" })] },
  notes: [], readOnly: false,
});
const detail = (reviewId: string, likely = true): PickClientItem => ({
  ok: true, readOnly: false, row: { fileName: "AMAM-policies.xlsx", rowNumber: 88 },
  detail: {
    kind: "pick-client", reviewId, policyNumber: "0119993301", carrierName: "American Amicable",
    carrierRow: { name: "PATEL, G", dob: "1961-07-02", fileDate: "2026-11-22" },
    candidates: [
      { index: 0, type: "application", date: "2026-10-27", name: "George Patel", dob: "1961-07-02", fields: { surname: "match", givenName: "partial", dob: "match", phone: "missing", premium: "match", face: "match" }, score: 80, likely },
      { index: 1, type: "deal_flow", date: "2026-10-29", name: "Gita Patel", dob: "1961-02-07", fields: { surname: "match" }, score: 20, likely: false },
    ],
  },
  candidateFacts: [
    { index: 0, stage: "Applied", agentName: "Jordan Reyes", policyNumber: null, policyAgentName: null },
    { index: 1, stage: "Sold", agentName: "Sam Lee", policyNumber: "0119990088", policyAgentName: "Ava Kim" },
  ],
});

function serve(posts: unknown[]) {
  mockApi.mockImplementation(async (path: string, init?: { method?: string; body?: unknown }) => {
    if (init?.method === "POST") { posts.push({ path, body: init.body }); return { ok: true }; }
    if (path === "/api/app/needs-you/item") return list();
    if (path === `/api/app/needs-you/item?kind=pick-client&id=${R1}`) return detail(R1);
    if (path === `/api/app/needs-you/item?kind=pick-client&id=${R2}`) return detail(R2, false);
    throw new Error(`unexpected ${path}`);
  });
}

beforeEach(() => { mockApi.mockReset(); mockPush.mockReset(); });

test("the carrier's row and the sales it could be; the likely one is chosen; Link resolves it and the next card comes", async () => {
  const posts: unknown[] = [];
  serve(posts);
  const user = userEvent.setup();
  await render(<NeedsYouScreen />);
  expect(await screen.findByText("“PATEL, G  DOB 07/02/1961  POL 0119993301”")).toBeOnTheScreen();
  expect(screen.getByText("4 decisions from carrier files")).toBeOnTheScreen();
  expect(screen.getByText("1 of 2 · Which client is this?")).toBeOnTheScreen();
  expect(screen.getByText("American Amicable policy file · 22 Nov · row 88")).toBeOnTheScreen();
  expect(screen.getByRole("radio", { name: "George Patel" })).toBeChecked();
  // Who each one is in the agency, as drawn: the lead's stage and agent, or the policy they already hold.
  expect(screen.getByText("Born 2 Jul 1961 · lead in Applied · Jordan Reyes")).toBeOnTheScreen();
  expect(screen.getByText("Born 7 Feb 1961 · policy 0119990088 · Ava Kim")).toBeOnTheScreen();
  expect(screen.getByText("Neither · a sale no carrier had")).toBeOnTheScreen();
  expect(screen.getByText("Opens a new policy from this row")).toBeOnTheScreen();
  expect(screen.getByText("American Amicable file")).toBeOnTheScreen();
  await user.press(screen.getByTestId("pick-save"));
  expect(posts).toEqual([{ path: "/api/app/policy-matching", body: { action: "resolve", review_id: R1, candidate: 0 } }]);
  expect(await screen.findByText("2 of 2 · Which client is this?")).toBeOnTheScreen();
  expect(screen.getByText("3 decisions from carrier files")).toBeOnTheScreen();
});

test("with no likely candidate nothing is chosen; Neither records no client", async () => {
  const posts: unknown[] = [];
  serve(posts);
  const user = userEvent.setup();
  await render(<NeedsYouScreen />);
  await user.press(await screen.findByTestId("pick-skip"));
  expect(posts).toEqual([]);
  await screen.findByText("2 of 2 · Which client is this?");
  await waitFor(() => expect(screen.getByTestId("pick-save")).toBeDisabled());
  await user.press(screen.getByTestId("pick-none"));
  expect(screen.getByText("Open a new policy")).toBeOnTheScreen();
  await user.press(screen.getByTestId("pick-save"));
  expect(posts).toEqual([{ path: "/api/app/policy-matching", body: { action: "resolve", review_id: R2, candidate: null } }]);
});

test("money that doesn't match opens on the computer (no \"All N\" row: the board has none)", async () => {
  serve([]);
  const user = userEvent.setup();
  await render(<NeedsYouScreen />);
  await user.press(await screen.findByTestId("needs-computer-m1"));
  expect(screen.queryByTestId("needs-computer-all")).toBeNull();
  expect(mockPush).toHaveBeenCalledWith(expect.objectContaining({ pathname: "/computer", params: expect.objectContaining({ path: "/app/needs-you/money/m1" }) }));
});

test("a refused save keeps the card and says why", async () => {
  mockApi.mockImplementation(async (path: string, init?: { method?: string }) => {
    if (init?.method === "POST") throw new Error("Your role does not have access to this action");
    if (path === "/api/app/needs-you/item") return list();
    return detail(R1);
  });
  const user = userEvent.setup();
  await render(<NeedsYouScreen />);
  await user.press(await screen.findByTestId("pick-save"));
  expect(await screen.findByText("Your role does not have access to this action")).toBeOnTheScreen();
  expect(screen.getByText("1 of 2 · Which client is this?")).toBeOnTheScreen();
});
