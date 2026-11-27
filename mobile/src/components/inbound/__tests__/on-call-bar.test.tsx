import { render, screen, userEvent, waitFor } from "@testing-library/react-native";

import { OnCallBar } from "@/components/inbound/on-call-bar";

/**
 * Board L2 · A call in progress, the in-app card: a dialer call shows as well as a transfer, with the board's line,
 * and its Outcome is saved on the attempt the server has open (the dialer's own save).
 */
const mockApi = jest.fn();
jest.mock("@/lib/session", () => ({ useSession: () => ({ api: mockApi, me: { user: { id: "me" }, role: "producer" } }) }));
const mockPush = jest.fn();
let mockParams: Record<string, string> = {};
jest.mock("expo-router", () => ({ router: { push: (...a: unknown[]) => mockPush(...a) }, useLocalSearchParams: () => mockParams }));
jest.mock("@/components/native/ongoing-call", () => ({ ...jest.requireActual("@/components/native/ongoing-call"), syncOngoingNotification: jest.fn(async () => undefined) }));

const DIAL = { call: { attemptId: "a1", leadId: "l1", customer: "Harold Nguyen", state: "TX", productCode: "term_life", attemptNumber: 3, disclosureRead: true, startedAt: new Date(Date.now() - 258_000).toISOString() } };
const PANEL = { lead: { state: "TX" }, viewerTimezone: "America/Chicago", window: { zone: "America/Chicago" }, outcomes: { source: "agency", outcomes: [{ key: "callback_scheduled", label: "Callback", position: 2 }, { key: "no_answer", label: "No answer", position: 1 }, { key: "interested", label: "Interested", position: 0 }] } };

function answer(path: string, init?: { method?: string }) {
  if (path === "/api/app/agent-floor") return Promise.resolve({ members: [], onCalls: [], ownStatus: "ready" });
  if (path === "/api/app/widget/call") return Promise.resolve(DIAL);
  if (path.startsWith("/api/app/dialer/panel")) return Promise.resolve(PANEL);
  if (path === "/api/app/dialer/attempt/a1/disposition" && init?.method === "POST") return Promise.resolve({ ok: true });
  return Promise.reject(new Error(`unexpected ${path}`));
}

beforeEach(() => { mockApi.mockReset(); mockApi.mockImplementation(answer); mockPush.mockReset(); mockParams = {}; });

it("shows a dialer call with the board's line and running time", async () => {
  await render(<OnCallBar />);
  expect(await screen.findByText("Harold Nguyen")).toBeTruthy();
  expect(screen.getByTestId("on-call-line").props.children).toBe("Term life · TX · attempt 3 · disclosure read");
  expect(screen.getByTestId("on-call-clock").props.children).toMatch(/^Insurvas · on a call · 4:1\d$/);
  expect(screen.getByRole("button", { name: "Outcome" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Add a note" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Callback" })).toBeTruthy();
});

it("saves a dialer call's outcome on its open attempt", async () => {
  await render(<OnCallBar />);
  await screen.findByText("Harold Nguyen");
  const user = userEvent.setup();
  await user.press(screen.getByRole("button", { name: "Outcome" }));
  await user.press(await screen.findByRole("button", { name: "No answer" }));
  await waitFor(() => expect(mockApi).toHaveBeenCalledWith("/api/app/dialer/attempt/a1/disposition", { method: "POST", body: { disposition: "no_answer" } }));
  // The callback outcome is the Callback move's, not a tile here.
  expect(screen.queryByTestId("outcome-callback_scheduled")).toBeNull();
});

it("takes the move the notification's button asked for", async () => {
  mockParams = { oncall: "outcome" };
  await render(<OnCallBar />);
  expect(await screen.findByText("Outcome for Harold Nguyen")).toBeTruthy();
});

it("draws nothing as the watcher, or without an open call", async () => {
  await render(<OnCallBar card={false} />);
  await waitFor(() => expect(mockApi).toHaveBeenCalledWith("/api/app/widget/call"));
  expect(screen.queryByTestId("on-call-bar")).toBeNull();

  mockApi.mockImplementation((path: string) => (path === "/api/app/widget/call" ? Promise.resolve({ call: null }) : answer(path)));
  await render(<OnCallBar />);
  await waitFor(() => expect(mockApi).toHaveBeenCalledTimes(4));
  expect(screen.queryByTestId("on-call-bar")).toBeNull();
});
