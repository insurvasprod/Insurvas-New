import { Alert } from "react-native";
import { act, render, screen, userEvent } from "@testing-library/react-native";

import { LeadMenu } from "../actions";
import type { FullWorkspace } from "../types";

/**
 * Board D5 / D5b: the ⋯ menu lists only what the server's `actions` allow, a release is confirmed
 * before it is posted, and a handoff goes to the licensed agent chosen through the web's route.
 */
const mockApi = jest.fn();
jest.mock("@/lib/session", () => ({ useSession: () => ({ api: mockApi }) }));
jest.mock("expo-router", () => ({ router: { push: jest.fn(), back: jest.fn() } }));
const mockSetString = jest.fn((_text: string) => Promise.resolve(true));
jest.mock("expo-clipboard", () => ({ setStringAsync: (text: string) => mockSetString(text) }));

const workspace = (over: Partial<FullWorkspace> = {}): FullWorkspace => ({
  lead: { id: "lead-1", values: { first_name: "Linda", last_name: "Okafor" }, product_line: "final_expense", created_at: "2026-11-20T10:00:00Z" },
  stage: { id: "s1", name: "Interested" }, stages: [{ id: "s1", name: "Interested" }, { id: "s2", name: "Quoted" }],
  partner: null, owner: { id: "u1", name: "Ava Kim" }, disposition: null, timeline: [], nextAction: null, readOnly: false,
  queue: { id: "q-1", status: "claimed", owner_user_id: "u1" },
  actions: { canClaim: false, canHandoff: false, canDisposition: true, canChangeStage: false, canUnassign: true },
  licensedAgents: [], ...over,
} as FullWorkspace);

beforeEach(() => { mockApi.mockReset(); jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

test("shows only the permitted actions", async () => {
  await render(<LeadMenu visible onClose={() => undefined} w={workspace()} onDone={() => undefined} />);
  expect(screen.getByRole("button", { name: "Nudge the team" })).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Unassign" })).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Re-check: existing customer?" })).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Hand off to a licensed agent" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Change stage without an outcome" })).toBeNull();
});

test("unassign asks first, and posts nothing when the person keeps it", async () => {
  const alert = jest.spyOn(Alert, "alert").mockImplementation((_t, _m, buttons) => { buttons?.find((b) => b.style === "cancel")?.onPress?.(); });
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  await render(<LeadMenu visible onClose={() => undefined} w={workspace()} onDone={() => undefined} />);
  await user.press(screen.getByRole("button", { name: "Unassign" }));
  await act(async () => { jest.advanceTimersByTime(500); });
  expect(alert).toHaveBeenCalledWith("Give this transfer back?", expect.stringContaining("Give Linda Okafor back to the queue?"), expect.any(Array), expect.any(Object));
  expect(mockApi).not.toHaveBeenCalled();
});

test("unassign, once confirmed, goes through the release route", async () => {
  jest.spyOn(Alert, "alert").mockImplementation((_t, _m, buttons) => { buttons?.find((b) => b.style !== "cancel")?.onPress?.(); });
  mockApi.mockResolvedValue({});
  const onDone = jest.fn();
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  await render(<LeadMenu visible onClose={() => undefined} w={workspace()} onDone={onDone} />);
  await user.press(screen.getByRole("button", { name: "Unassign" }));
  await act(async () => { jest.advanceTimersByTime(500); });
  expect(mockApi).toHaveBeenCalledWith("/api/app/inbound/release", { method: "POST", body: { action: "unassign", work_item_id: "q-1" } });
  expect(onDone).toHaveBeenCalledWith("Transfer back in the queue");
});

test("a handoff offers the lead to the chosen licensed agent", async () => {
  mockApi.mockResolvedValue({});
  const onDone = jest.fn();
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  const w = workspace({ actions: { canClaim: false, canHandoff: true, canDisposition: false, canChangeStage: false }, licensedAgents: [{ id: "agent-7", name: "Jordan Reyes", role: "producer" }] });
  await render(<LeadMenu visible onClose={() => undefined} w={w} onDone={onDone} />);
  await user.press(screen.getByRole("button", { name: "Hand off to a licensed agent" }));
  await act(async () => { jest.advanceTimersByTime(500); });
  expect(screen.getByText("Hand Linda to another agent?")).toBeOnTheScreen();
  await user.press(screen.getByTestId("handoff-confirm"));
  expect(mockApi).toHaveBeenCalledWith("/api/app/inbound/handoff", { method: "POST", body: { action: "offer", work_item_id: "q-1", target_user_id: "agent-7" } });
  expect(onDone).toHaveBeenCalledWith("Handoff offered to Jordan Reyes");
});

test("Copy lead ID puts the lead's id on the clipboard and says so", async () => {
  const onDone = jest.fn();
  const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
  await render(<LeadMenu visible onClose={() => undefined} w={workspace()} onDone={onDone} />);
  await user.press(screen.getByRole("button", { name: "Copy lead ID" }));
  await act(async () => { jest.advanceTimersByTime(500); });
  expect(mockSetString).toHaveBeenCalledWith("lead-1");
  expect(onDone).toHaveBeenCalledWith("Lead ID copied");
  expect(mockApi).not.toHaveBeenCalled();
});
