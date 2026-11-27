import { Linking } from "react-native";
import { fireEvent, render, screen, userEvent } from "@testing-library/react-native";

import { CallSheet, disclosureLine, outcomeOrder } from "../call-sheet";

const mockRemind = jest.fn(async (..._args: unknown[]) => true);
jest.mock("../calls/reminder", () => ({ remindBefore: (...args: unknown[]) => mockRemind(...args) }));

/**
 * The phone dials only after the server's checks pass (board C7; the "never a raw tel: link" rule).
 * The order is the web dialer's one-click call: panel → the words beside Call → POST attempt → POST
 * attempt/:id/disclosure (the record the server requires before a click) → POST attempt/:id/click →
 * the phone's dialer, then C7c on the call. A blocking disclosure or a refused click never dials.
 */
const mockApi = jest.fn();
jest.mock("@/lib/session", () => ({ useSession: () => ({ api: mockApi }) }));

const LEAD = "3afad3ae-2c84-4bde-a6b5-1dabd5d4bc2d";
const panel = (overrides: Record<string, unknown> = {}) => ({
  lead: { id: LEAD, fullName: "Minnie Hargrove", state: "FL", phone: "+13055552409", productCode: "term_life" },
  script: { id: "b3597c1a-38fd-4a8b-85c9-d7b39593879d", version: 5, productCode: "term_life" },
  disclosure: { state: "FL", productCode: "term_life", requiredText: "This call may be recorded.", configured: true, blocking: false, approved: true },
  outcomes: { source: "tenant", outcomes: [{ key: "no_answer", label: "No answer", position: 1 }, { key: "callback_scheduled", label: "Callback scheduled", position: 2 }] },
  window: { allowed: true, zone: "America/New_York", reason: "open" },
  ...overrides,
});

let openURL: jest.SpyInstance;
beforeEach(() => {
  mockApi.mockReset();
  openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
});
afterEach(() => openURL.mockRestore());

test("shows the disclosure word for word beside Call, then dials only after attempt and click succeed", async () => {
  const calls: string[] = [];
  mockApi.mockImplementation(async (path: string, init?: { method?: string }) => {
    calls.push(`${init?.method ?? "GET"} ${path}`);
    if (path.startsWith("/api/app/dialer/panel")) return panel();
    if (path === "/api/app/dialer/attempt") return { attempt: { id: "att-1" } };
    if (path === "/api/app/dialer/attempt/att-1/disclosure") return { attempt: { id: "att-1" } };
    if (path === "/api/app/dialer/attempt/att-1/click") return { attempt: { id: "att-1" } };
    throw new Error(`unexpected ${path}`);
  });
  const user = userEvent.setup();
  await render(<CallSheet leadId={LEAD} visible onClose={() => undefined} onSaved={() => undefined} />);

  expect(await screen.findByText("This call may be recorded.")).toBeOnTheScreen();
  expect(openURL).not.toHaveBeenCalled();
  // Before the dial there is nothing to answer yet: no voicemail link, no timer.
  expect(screen.queryByText(/didn’t answer/)).not.toBeOnTheScreen();

  await user.press(screen.getByRole("button", { name: "Call (305) 555-2409" }));

  expect(calls).toEqual([
    `GET /api/app/dialer/panel?lead_id=${LEAD}`,
    "POST /api/app/dialer/attempt",
    "POST /api/app/dialer/attempt/att-1/disclosure",
    "POST /api/app/dialer/attempt/att-1/click",
  ]);
  // "I read it" is recorded for the state and product whose wording was shown.
  expect(mockApi.mock.calls[2][1].body).toEqual({ state: "FL", product_code: "term_life" });
  expect(openURL).toHaveBeenCalledWith("tel:+13055552409");
  // The attempt carries the disclosure that was shown.
  expect(mockApi.mock.calls[1][1].body).toMatchObject({ lead_id: LEAD, disclosure_state: "FL", disclosure_product_code: "term_life", script_version: 5 });
});

test("an unclaimed lead is claimed through the web's pick, then the attempt starts again", async () => {
  const { ApiError } = jest.requireActual("@/lib/api");
  const calls: string[] = [];
  let attempts = 0;
  mockApi.mockImplementation(async (path: string, init?: { method?: string; body?: unknown }) => {
    calls.push(`${init?.method ?? "GET"} ${path}`);
    if (path.startsWith("/api/app/dialer/panel")) return panel();
    if (path === "/api/app/dialer/attempt") {
      attempts += 1;
      if (attempts === 1) throw new ApiError(409, { error: "Claim this lead before preparing a dial attempt." });
      return { attempt: { id: "att-c" } };
    }
    if (path === "/api/app/dialer/pick") return { served: { leadId: LEAD } };
    if (path.startsWith("/api/app/dialer/attempt/att-c/")) return { attempt: { id: "att-c" } };
    throw new Error(`unexpected ${path}`);
  });
  const user = userEvent.setup();
  await render(<CallSheet leadId={LEAD} visible onClose={() => undefined} onSaved={() => undefined} />);
  await user.press(await screen.findByRole("button", { name: "Call (305) 555-2409" }));

  expect(calls).toEqual([
    `GET /api/app/dialer/panel?lead_id=${LEAD}`,
    "POST /api/app/dialer/attempt",
    "POST /api/app/dialer/pick",
    "POST /api/app/dialer/attempt",
    "POST /api/app/dialer/attempt/att-c/disclosure",
    "POST /api/app/dialer/attempt/att-c/click",
  ]);
  expect(mockApi.mock.calls.find(([p]) => p === "/api/app/dialer/pick")?.[1].body).toEqual({ lead_id: LEAD });
  expect(openURL).toHaveBeenCalledWith("tel:+13055552409");
});

test("a pick the server refuses never dials", async () => {
  const { ApiError } = jest.requireActual("@/lib/api");
  mockApi.mockImplementation(async (path: string) => {
    if (path.startsWith("/api/app/dialer/panel")) return panel();
    if (path === "/api/app/dialer/attempt") throw new ApiError(409, { error: "Claim this lead before preparing a dial attempt." });
    if (path === "/api/app/dialer/pick") throw new ApiError(409, { error: "Another agent is on this lead." });
    throw new Error(`unexpected ${path}`);
  });
  const user = userEvent.setup();
  await render(<CallSheet leadId={LEAD} visible onClose={() => undefined} onSaved={() => undefined} />);
  await user.press(await screen.findByRole("button", { name: "Call (305) 555-2409" }));

  expect(await screen.findByText("Another agent is on this lead.")).toBeOnTheScreen();
  expect(openURL).not.toHaveBeenCalled();
});

test("a server refusal at the click never opens the phone's dialer", async () => {
  const { ApiError } = jest.requireActual("@/lib/api");
  mockApi.mockImplementation(async (path: string) => {
    if (path.startsWith("/api/app/dialer/panel")) return panel();
    if (path === "/api/app/dialer/attempt") return { attempt: { id: "att-2" } };
    if (path === "/api/app/dialer/attempt/att-2/disclosure") return { attempt: { id: "att-2" } };
    throw new ApiError(422, { error: "This number is on the National Do Not Call Registry.", code: "dnc_listed" });
  });
  const user = userEvent.setup();
  await render(<CallSheet leadId={LEAD} visible onClose={() => undefined} onSaved={() => undefined} />);
  await user.press(await screen.findByRole("button", { name: "Call (305) 555-2409" }));

  expect(await screen.findByText("This number is on the National Do Not Call Registry.")).toBeOnTheScreen();
  expect(openURL).not.toHaveBeenCalled();
  // The attempt exists, so its outcome can still be recorded.
  expect(screen.getByRole("button", { name: "No answer" })).toBeOnTheScreen();
});

test("an outcome is a tile, then Save outcome records it on the attempt (board C8)", async () => {
  const { ApiError } = jest.requireActual("@/lib/api");
  const calls: string[] = [];
  mockApi.mockImplementation(async (path: string, init?: { method?: string; body?: unknown }) => {
    calls.push(`${init?.method ?? "GET"} ${path}`);
    if (path.startsWith("/api/app/dialer/panel")) return panel();
    if (path === "/api/app/dialer/attempt") return { attempt: { id: "att-3" } };
    if (path === "/api/app/dialer/attempt/att-3/disclosure") return { attempt: { id: "att-3" } };
    if (path === "/api/app/dialer/attempt/att-3/disposition") return { attempt: { id: "att-3" } };
    throw new ApiError(422, { error: "Outside the calling window.", code: "outside_window" });
  });
  const user = userEvent.setup();
  await render(<CallSheet leadId={LEAD} visible onClose={() => undefined} onSaved={() => undefined} />);
  await user.press(await screen.findByRole("button", { name: "Call (305) 555-2409" }));
  await user.press(await screen.findByRole("button", { name: "No answer" }));
  await user.press(screen.getByRole("button", { name: "Save outcome" }));

  expect(calls).toContain("POST /api/app/dialer/attempt/att-3/disposition");
  expect(mockApi.mock.calls.find(([p]) => p === "/api/app/dialer/attempt/att-3/disposition")?.[1].body).toEqual({ disposition: "no_answer" });
  expect(openURL).not.toHaveBeenCalled();
});

test("a blocking disclosure stops before any attempt", async () => {
  mockApi.mockResolvedValueOnce(panel({ disclosure: { state: "TX", productCode: "term_life", requiredText: "No approved disclosure is configured for TX. Dialing is blocked until Compliance publishes one.", configured: false, blocking: true, approved: false } }));
  await render(<CallSheet leadId={LEAD} visible onClose={() => undefined} onSaved={() => undefined} />);

  expect(await screen.findByText(/Dialing is blocked until Compliance publishes one/)).toBeOnTheScreen();
  // Board C10: the refusal is a dialog titled in plain words.
  expect(screen.getByText("We can’t call this number")).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Call (305) 555-2409" })).not.toBeOnTheScreen();
  expect(mockApi).toHaveBeenCalledTimes(1);
  expect(openURL).not.toHaveBeenCalled();
});

test("a dial the server already refuses stops before the disclosure is read", async () => {
  mockApi.mockResolvedValueOnce(panel({ eligibility: {
    allowed: false, reason: "licence_refused", message: "", checkedAt: "2026-11-25T14:21:00Z", timezone: "America/New_York", dncCheck: "clear",
    licence: { status: "refused", state: "FL", expiresAt: null, message: "Dialing is refused: the agency's FL licence has expired." },
  } }));
  await render(<CallSheet leadId={LEAD} visible onClose={() => undefined} onSaved={() => undefined} />);

  expect(await screen.findByText("Dialing is refused: the agency's FL licence has expired.")).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Call (305) 555-2409" })).not.toBeOnTheScreen();
  expect(mockApi).toHaveBeenCalledTimes(1);
  expect(openURL).not.toHaveBeenCalled();
});

test("a placeholder disclosure says so", async () => {
  mockApi.mockResolvedValueOnce(panel({ disclosure: { state: "FL", productCode: "term_life", requiredText: "[PLACEHOLDER] Hello…", configured: true, blocking: false, approved: false } }));
  await render(<CallSheet leadId={LEAD} visible onClose={() => undefined} onSaved={() => undefined} />);
  expect(await screen.findByText("Placeholder wording")).toBeOnTheScreen();
});

/** Past the disclosure to the outcome step, with the click refused so the phone's dialer never opens. */
async function toOutcome(user: ReturnType<typeof userEvent.setup>) {
  await user.press(await screen.findByRole("button", { name: "Call (305) 555-2409" }));
  await screen.findByRole("button", { name: "No answer" });
}
const refuseClick = (extra: (path: string, init?: { method?: string; body?: unknown }) => unknown) => async (path: string, init?: { method?: string; body?: unknown }) => {
  const { ApiError } = jest.requireActual("@/lib/api");
  if (path === "/api/app/dialer/attempt") return { attempt: { id: "att-m" } };
  if (path === "/api/app/dialer/attempt/att-m/disclosure") return { attempt: { id: "att-m" } };
  if (path === "/api/app/dialer/attempt/att-m/click") throw new ApiError(422, { error: "Outside the calling window.", code: "outside_window" });
  const answer = extra(path, init);
  if (answer !== undefined) return answer;
  throw new Error(`unexpected ${path}`);
};

test("C7b: the compliance details open from the panel alone (behind More) and never dial", async () => {
  mockApi.mockImplementation(refuseClick((path) => (path.startsWith("/api/app/dialer/panel") ? panel({ eligibility: { allowed: true, reason: "ready", message: "", checkedAt: "2026-11-24T19:11:00Z", timezone: "America/New_York", dncCheck: "clear", suppression: "clear", suppressionHits: [{ listType: "tcpa_litigator", reason: "", addedAt: null }] } }) : undefined)));
  const user = userEvent.setup();
  await render(<CallSheet leadId={LEAD} visible onClose={() => undefined} onSaved={() => undefined} />);
  await toOutcome(user);
  await user.press(screen.getByRole("button", { name: "More" }));
  await user.press(await screen.findByRole("button", { name: "Compliance details" }));

  expect(screen.getByText("Checks for (305) 555-2409")).toBeOnTheScreen();
  expect(screen.getByLabelText(/^Known litigator list: refused/)).toBeOnTheScreen();
  expect(screen.getByLabelText(/^National Do Not Call list: passed/)).toBeOnTheScreen();
  expect(screen.getByText("The server repeats these checks the moment you tap Call.")).toBeOnTheScreen();
  expect(mockApi.mock.calls.filter(([p]) => String(p).startsWith("/api/app/dialer/panel"))).toHaveLength(1);
  expect(openURL).not.toHaveBeenCalled();
});

test("C7d: the script and rebuttals are the panel's, rebuttals first", async () => {
  mockApi.mockImplementation(refuseClick((path) => (path.startsWith("/api/app/dialer/panel") ? panel({
    script: { id: "s1", version: 12, productCode: "term_life", sections: { opening: "Hi Minnie, this is Ray.", close: "Shall we start?" } },
    rebuttals: [{ id: "r1", label: "Too expensive", body: "We can look at a smaller amount." }],
  }) : undefined)));
  const user = userEvent.setup();
  await render(<CallSheet leadId={LEAD} visible onClose={() => undefined} onSaved={() => undefined} />);
  await toOutcome(user);
  await user.press(screen.getByRole("button", { name: "More" }));
  await user.press(await screen.findByRole("button", { name: "Script and rebuttals" }));

  expect(screen.getByText("“Too expensive.”")).toBeOnTheScreen();
  expect(screen.getByText("We can look at a smaller amount.")).toBeOnTheScreen();
  await user.press(screen.getByRole("tab", { name: "Script" }));
  expect(screen.getByText("Hi Minnie, this is Ray.")).toBeOnTheScreen();
  expect(screen.getByText("Script v12")).toBeOnTheScreen();
  expect(openURL).not.toHaveBeenCalled();
});

test("C8b: booking posts the chosen slot for the lead and never dials", async () => {
  const { ApiError } = jest.requireActual("@/lib/api");
  jest.useFakeTimers({ now: new Date("2026-11-24T15:00:00Z"), doNotFake: ["nextTick", "setImmediate", "queueMicrotask"] });
  try {
    mockApi.mockImplementation(async (path: string, init?: { method?: string; body?: unknown }) => {
      if (path.startsWith("/api/app/dialer/panel")) return panel();
      if (path === "/api/app/dialer/attempt") return { attempt: { id: "att-9" } };
      if (path === "/api/app/dialer/attempt/att-9/disclosure") return { attempt: { id: "att-9" } };
      if (path.startsWith("/api/app/appointments") && !init?.method) return {
        agents: [{ userId: "ava", name: "Ava Kim", timezone: "America/New_York" }],
        availability: [{ userId: "ava", weekday: 3, startTime: "10:00", endTime: "11:00", timezone: "America/New_York" }],
        blocks: [], policy: [{ userId: "ava", appointmentMinutes: 60, bufferMinutes: 0, maxPerDay: null }], upcoming: [], busy: [],
      };
      if (path === "/api/app/appointments" && init?.method === "POST") return { appointment: { startsAtUtc: "2026-11-25T15:00:00.000Z" } };
      throw new ApiError(422, { error: "Outside the calling window.", code: "outside_window" });
    });
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    await render(<CallSheet leadId={LEAD} visible onClose={() => undefined} onSaved={() => undefined} />);
    await user.press(await screen.findByRole("button", { name: "Call (305) 555-2409" }));
    await user.press(await screen.findByRole("button", { name: "More" }));
    await user.press(await screen.findByRole("button", { name: "Book an appointment" }));
    await user.press(await screen.findByRole("button", { name: "Wed 10:00" }));
    await user.press(screen.getByRole("button", { name: "Book Wed 25 Nov, 10:00 am" }));

    const post = mockApi.mock.calls.find(([p, i]) => p === "/api/app/appointments" && i?.method === "POST");
    expect(post?.[1].body).toEqual({ lead_id: LEAD, agent_user_id: "ava", starts_at_utc: "2026-11-25T15:00:00.000Z" });
    expect(await screen.findByText("Appointment booked · Wed 25 Nov, 10:00 am")).toBeOnTheScreen();
    expect(openURL).not.toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});

test("C8: the note goes on the lead after the outcome, and Start application is offered", async () => {
  const calls: string[] = [];
  mockApi.mockImplementation(refuseClick((path, init) => {
    calls.push(`${init?.method ?? "GET"} ${path}`);
    if (path.startsWith("/api/app/dialer/panel")) return panel({ lead: { id: LEAD, fullName: "Minnie Hargrove", state: "FL", phone: "+13055552409", productCode: "term_life", workItemId: "wi-1" } });
    if (path === "/api/app/dialer/attempt/att-m/disposition") return { attempt: { id: "att-m" } };
    if (path === `/api/app/leads/${LEAD}/notes`) return { note: { id: "n1" } };
    return undefined;
  }));
  const user = userEvent.setup();
  await render(<CallSheet leadId={LEAD} visible onClose={() => undefined} onSaved={() => undefined} />);
  await toOutcome(user);
  expect(screen.getByRole("button", { name: "Start application" })).toBeOnTheScreen();
  await user.press(screen.getByRole("button", { name: "No answer" }));
  await user.type(screen.getByLabelText("Note for the next agent"), "Wife on the call next time.");
  await user.press(screen.getByRole("button", { name: "Save outcome" }));

  const note = mockApi.mock.calls.find(([p]) => p === `/api/app/leads/${LEAD}/notes`);
  expect(note?.[1]).toMatchObject({ method: "POST", body: { body: "Wife on the call next time.", idempotency_key: "call-att-m" } });
  expect(calls.indexOf("POST /api/app/dialer/attempt/att-m/disposition")).toBeLessThan(calls.indexOf(`POST /api/app/leads/${LEAD}/notes`));
});

test("C10: a refusal offers the checks the server ran", async () => {
  mockApi.mockImplementation(async (path: string) => {
    if (path.startsWith("/api/app/dialer/panel")) return panel({ disclosure: { state: "TX", productCode: "term_life", requiredText: "No approved disclosure is configured for TX.", configured: false, blocking: true, approved: false } });
    throw new Error(`unexpected ${path}`);
  });
  const user = userEvent.setup();
  await render(<CallSheet leadId={LEAD} visible onClose={() => undefined} onSaved={() => undefined} onSkip={() => undefined} />);
  await user.press(await screen.findByRole("button", { name: "See the checks" }));
  expect(screen.getByText("Checks for (305) 555-2409")).toBeOnTheScreen();
  expect(openURL).not.toHaveBeenCalled();
});

/** A placed call: attempt, disclosure and click all succeed, so the phone's dialer opens. */
const placed = (extra: (path: string, init?: { method?: string; body?: unknown }) => unknown = () => undefined) => async (path: string, init?: { method?: string; body?: unknown }) => {
  if (path.startsWith("/api/app/dialer/panel")) return panel({ disclosure: { state: "FL", productCode: "term_life", requiredText: "This call may be recorded.", configured: true, blocking: false, approved: true, version: 4 },
    outcomes: { source: "tenant", outcomes: [{ key: "no_answer", label: "No answer", position: 1 }, { key: "voicemail", label: "Voicemail", position: 2 }, { key: "interested", label: "Interested", position: 3 }, { key: "callback_scheduled", label: "Callback scheduled", position: 4 }] } });
  if (path === "/api/app/dialer/attempt") return { attempt: { id: "att-p" } };
  if (path === "/api/app/dialer/attempt/att-p/disclosure" || path === "/api/app/dialer/attempt/att-p/click") return { attempt: { id: "att-p" } };
  const answer = extra(path, init);
  if (answer !== undefined) return answer;
  throw new Error(`unexpected ${path}`);
};

test("C7c on the call: the words with the call's time, then I read it opens C8 with when it was read", async () => {
  jest.useFakeTimers({ now: new Date("2026-11-24T19:00:00Z"), doNotFake: ["nextTick", "setImmediate", "queueMicrotask"] });
  try {
    mockApi.mockImplementation(placed());
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    await render(<CallSheet leadId={LEAD} visible onClose={() => undefined} onSaved={() => undefined} />);
    expect(await screen.findByText("Florida · outbound disclosure v4 · 5 words")).toBeOnTheScreen();
    await user.press(screen.getByRole("button", { name: "Call (305) 555-2409" }));
    expect(openURL).toHaveBeenCalledWith("tel:+13055552409");

    expect(await screen.findByText("On the call 0:00")).toBeOnTheScreen();
    expect(screen.getByText("This call may be recorded.")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Minnie didn’t answer · voicemail" })).toBeOnTheScreen();
    await jest.advanceTimersByTimeAsync(9000);
    expect(screen.getByText("On the call 0:09")).toBeOnTheScreen();

    await user.press(screen.getByRole("button", { name: "I read it" }));
    expect(await screen.findByText("Read at 0:09")).toBeOnTheScreen();
    // Board C8: Interested leads the tiles, whatever the agency's order.
    const tiles = screen.getAllByRole("button").map((b) => String(b.props.accessibilityLabel)).filter((l) => ["Interested", "No answer", "Voicemail"].includes(l));
    expect(tiles).toEqual(["Interested", "No answer", "Voicemail"]);
  } finally {
    jest.useRealTimers();
  }
});

test("C7c: nobody answered · voicemail goes to C8 with Voicemail chosen and the disclosure not reached", async () => {
  mockApi.mockImplementation(placed((path) => (path === "/api/app/dialer/attempt/att-p/disposition" ? { attempt: { id: "att-p" } } : undefined)));
  const user = userEvent.setup();
  await render(<CallSheet leadId={LEAD} visible onClose={() => undefined} onSaved={() => undefined} />);
  await user.press(await screen.findByRole("button", { name: "Call (305) 555-2409" }));
  await user.press(await screen.findByRole("button", { name: "Minnie didn’t answer · voicemail" }));

  expect(await screen.findByText("Not reached")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Voicemail" }).props.accessibilityState).toMatchObject({ selected: true });
  await user.press(screen.getByRole("button", { name: "Save outcome" }));
  expect(mockApi.mock.calls.find(([p]) => p === "/api/app/dialer/attempt/att-p/disposition")?.[1].body).toEqual({ disposition: "voicemail" });
});

test("C9 in the call: the callback is booked, handed to the team and reminded on this phone", async () => {
  mockRemind.mockClear();
  mockApi.mockImplementation(placed((path, init) => {
    if (path === "/api/app/dialer/attempt/att-p/disposition") return { attempt: { id: "att-p" } };
    if (path === `/api/app/callbacks?lead_id=${LEAD}`) return { lead: { open: { id: "cb-7" } } };
    if (path === "/api/app/callbacks" && init?.method === "PATCH") return { ok: true };
    return undefined;
  }));
  const user = userEvent.setup();
  await render(<CallSheet leadId={LEAD} visible onClose={() => undefined} onSaved={() => undefined} />);
  await user.press(await screen.findByRole("button", { name: "Call (305) 555-2409" }));
  await user.press(await screen.findByRole("button", { name: "I read it" }));
  await user.press(await screen.findByRole("button", { name: "Callback scheduled" }));
  expect(screen.getByLabelText("Remind me 5 minutes before")).toBeOnTheScreen();
  fireEvent(screen.getByLabelText("Anyone on the team can take it"), "valueChange", true);
  await user.press(screen.getByRole("button", { name: "4:00 pm" }));
  await user.press(screen.getByRole("button", { name: "Save callback" }));

  const disposition = mockApi.mock.calls.find(([p]) => p === "/api/app/dialer/attempt/att-p/disposition");
  expect(disposition?.[1].body).toMatchObject({ disposition: "callback_scheduled", customer_timezone: "America/New_York" });
  expect(mockApi.mock.calls.find(([p, i]) => p === "/api/app/callbacks" && i?.method === "PATCH")?.[1].body).toEqual({ action: "hand_over", callback_ids: ["cb-7"], to: "queue" });
  expect(mockRemind).toHaveBeenCalledTimes(1);
});

test("helpers: Interested first, and the disclosure's own line", () => {
  expect(outcomeOrder([{ key: "no_answer", label: "No answer", position: 1 }, { key: "not_interested", label: "Not interested", position: 2 }, { key: "interested", label: "Interested", position: 3 }]).map((o) => o.key))
    .toEqual(["interested", "no_answer", "not_interested"]);
  expect(disclosureLine("TX", 4, 31)).toBe("Texas · outbound disclosure v4 · 31 words");
  expect(disclosureLine("TX", null, 31)).toBe("Texas · outbound disclosure · 31 words");
});
