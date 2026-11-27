import { fireEvent, render, screen, userEvent } from "@testing-library/react-native";

import { ScheduleCallback } from "../schedule-callback";

/**
 * Board C9 from the Callbacks tab: the lead's own zone from the server, the time picked in it, the
 * booking through POST /api/app/callbacks, and "Anyone on the team can take it" as the web's
 * hand-over to the queue.
 */
const mockApi = jest.fn();
jest.mock("@/lib/session", () => ({ useSession: () => ({ api: mockApi }) }));
const mockRemind = jest.fn(async (..._args: unknown[]) => true);
jest.mock("../reminder", () => ({ remindBefore: (...args: unknown[]) => mockRemind(...args) }));

const facts = { lead: { leadId: "lead-1", customerName: "Harold Nguyen", state: "TX", timezone: "America/Chicago", timezoneProblem: null, open: null } };

beforeEach(() => { mockApi.mockReset(); mockRemind.mockClear(); });

test("books the callback in the customer's zone and hands it to the team when asked", async () => {
  mockApi.mockImplementation(async (path: string, init?: { method?: string }) => {
    if (path === "/api/app/callbacks?lead_id=lead-1") return facts;
    if (path === "/api/app/callbacks" && init?.method === "POST") return { result: { callback_id: "cb-9" } };
    if (path === "/api/app/callbacks" && init?.method === "PATCH") return { ok: true };
    throw new Error(`unexpected ${path}`);
  });
  const onSaved = jest.fn();
  const user = userEvent.setup();
  await render(<ScheduleCallback leadId="lead-1" onClose={() => undefined} onSaved={onSaved} />);

  expect(await screen.findByText("Call Harold back")).toBeOnTheScreen();
  expect(screen.getByText("Their time · Texas (Central)")).toBeOnTheScreen();
  await user.press(screen.getByRole("button", { name: "1:00 pm" }));
  fireEvent(screen.getByLabelText("Anyone on the team can take it"), "valueChange", true);
  await user.press(screen.getByRole("button", { name: "Save callback" }));

  const post = mockApi.mock.calls.find(([p, i]) => p === "/api/app/callbacks" && i?.method === "POST");
  expect(post?.[1].body).toMatchObject({ lead_id: "lead-1", callback_local: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T13:00$/), idempotency_key: expect.any(String) });
  const patch = mockApi.mock.calls.find(([p, i]) => p === "/api/app/callbacks" && i?.method === "PATCH");
  expect(patch?.[1].body).toEqual({ action: "hand_over", callback_ids: ["cb-9"], to: "queue" });
  expect(onSaved).toHaveBeenCalledWith("Callback saved for the team");
  // C9 "Remind me 5 minutes before" is on by default: a reminder on this phone for the booked time.
  expect(mockRemind).toHaveBeenCalledTimes(1);
  expect(mockRemind.mock.calls[0][1]).toBe("Harold Nguyen");
});

test("with the reminder off nothing is scheduled on the phone", async () => {
  mockApi.mockImplementation(async (path: string, init?: { method?: string }) => {
    if (path === "/api/app/callbacks?lead_id=lead-1") return facts;
    if (path === "/api/app/callbacks" && init?.method === "POST") return { result: { callback_id: "cb-9" } };
    throw new Error(`unexpected ${path}`);
  });
  const onSaved = jest.fn();
  const user = userEvent.setup();
  await render(<ScheduleCallback leadId="lead-1" onClose={() => undefined} onSaved={onSaved} />);
  await user.press(await screen.findByRole("button", { name: "1:00 pm" }));
  fireEvent(screen.getByLabelText("Remind me 5 minutes before"), "valueChange", false);
  await user.press(screen.getByRole("button", { name: "Save callback" }));
  expect(mockRemind).not.toHaveBeenCalled();
  expect(onSaved).toHaveBeenCalledWith("Callback saved");
});

test("a lead without a time zone says why instead of offering times", async () => {
  mockApi.mockResolvedValue({ lead: { ...facts.lead, timezone: null, timezoneProblem: "This lead has no state." } });
  await render(<ScheduleCallback leadId="lead-1" onClose={() => undefined} onSaved={() => undefined} />);
  expect(await screen.findByText("This lead has no state.")).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Save callback" })).not.toBeOnTheScreen();
});
