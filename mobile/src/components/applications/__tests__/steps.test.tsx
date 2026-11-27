import { act, fireEvent, render, screen, userEvent, waitFor, within } from "@testing-library/react-native";

import ApplicationScreen from "@/app/application/[caseId]";
import type { CaseView } from "../types";
import { kase } from "../test-fixtures";
import { REVEAL_REASON } from "../bank-details";
import { dateWords, nextDraftDate, todayKey } from "../logic";

const useDay = (day: number) => `Use ${dateWords(nextDraftDate(day, todayKey()))}`;

/**
 * The application screen against a mocked server: each step's writes go to the same routes, with the
 * same bodies, as the web workspace's (components/app/applications/workspace/context.tsx).
 */
const mockApi = jest.fn();
const mockParams: { caseId: string; step?: string } = { caseId: "c1" };
const mockSetParams = jest.fn((next: { step?: string }) => { mockParams.step = next.step; });
const mockAuth = jest.fn();
const mockOpen = jest.fn();
jest.mock("@/lib/session", () => ({ useSession: () => ({ api: mockApi, me: { user: { id: "me" }, role: "producer" } }) }));
jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true, setParams: (n: { step?: string }) => mockSetParams(n) },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => mockParams,
}));
jest.mock("expo-local-authentication", () => ({
  hasHardwareAsync: async () => true, isEnrolledAsync: async () => true,
  authenticateAsync: (o: unknown) => mockAuth(o),
}));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: (u: string) => mockOpen(u) }));
const mockSecrets = new Map<string, string>();
jest.mock("@/lib/secure", () => ({
  readSecret: async (k: string) => mockSecrets.get(k) ?? null,
  writeSecret: async (k: string, v: string | null) => { if (v === null) mockSecrets.delete(k); else mockSecrets.set(k, v); },
}));

let current: CaseView;
const writes: { method: string; path: string; body: unknown }[] = [];

function serve(c: CaseView, extra: (method: string, path: string, body: unknown) => unknown = () => undefined) {
  current = c;
  writes.length = 0;
  mockApi.mockImplementation(async (path: string, init?: { method?: string; body?: unknown }) => {
    const method = init?.method ?? "GET";
    if (method === "GET" && path === "/api/app/applications/cases/c1") return current;
    if (method !== "GET") writes.push({ method, path, body: init?.body });
    const answer = extra(method, path, init?.body);
    if (answer !== undefined) return answer;
    if (method === "GET") throw new Error(`unexpected GET ${path}`);
    return {};
  });
}

beforeEach(() => { mockApi.mockReset(); mockSetParams.mockClear(); mockAuth.mockReset(); mockOpen.mockReset(); mockSecrets.clear(); delete mockParams.step; });

describe("E2 · the interview, one question per screen, in three steps", () => {
  test("Eligibility: saves each answer at once, opens and closes follow-ups, then goes on to Personal details", async () => {
    serve(kase());
    mockParams.step = "eligibility";
    const user = userEvent.setup();
    await render(<ApplicationScreen />);

    expect(await screen.findByText("When does your Social Security arrive?")).toBeOnTheScreen();
    expect(screen.getByText("Eligibility · 1 of 2")).toBeOnTheScreen();
    expect(screen.getByText("Step 3 of 10 · No carrier yet")).toBeOnTheScreen();
    // A required question waits for its answer.
    expect(screen.getByRole("button", { name: "Next question" })).toBeDisabled();
    await user.press(screen.getByRole("radio", { name: "3rd Wednesday" }));
    expect(await screen.findByTestId("app-q-saved")).toBeOnTheScreen();
    expect(writes[0]).toEqual({ method: "PUT", path: "/api/app/applications/cases/c1/interview", body: { insured_role: "primary", answers: [{ key: "ss_deposit_day", value: "3rd Wednesday" }], hidden: [] } });

    await user.press(screen.getByRole("button", { name: "Next question" }));
    await user.press(await screen.findByRole("radio", { name: "Yes" }));
    await user.press(screen.getByRole("button", { name: "Next question" }));
    // The yes opened its follow-up, straight after it, in the same step.
    expect(await screen.findByText("Does that policy have a cash value you plan to move?")).toBeOnTheScreen();
    expect(screen.getByText("Eligibility · 3 of 3")).toBeOnTheScreen();
    await user.press(screen.getByRole("radio", { name: "Yes" }));
    await user.press(screen.getByRole("button", { name: "Back" }));
    await user.press(await screen.findByRole("radio", { name: "No" }));
    await waitFor(() => expect(writes.at(-1)?.body).toEqual({ insured_role: "primary", answers: [{ key: "existing_coverage", value: false }], hidden: ["existing_cash_value"] }));
    // The last eligibility question goes on to the next step, without finishing the interview.
    await user.press(screen.getByRole("button", { name: "Next" }));
    expect(mockSetParams).toHaveBeenLastCalledWith({ step: "personal" });
    expect(writes.some((w) => w.method === "POST")).toBe(false);
  });

  test("Health is step 5 of 10: a knockout says so, a typed number is saved as a number", async () => {
    serve(kase({}, { carrierName: "American Amicable" }, { answers: { ss_deposit_day: { value: "3rd Wednesday" }, existing_coverage: { value: false } } }));
    mockParams.step = "health";
    const user = userEvent.setup();
    await render(<ApplicationScreen />);
    expect(await screen.findByText("Health · 1 of 2")).toBeOnTheScreen();
    expect(screen.getByText("Step 5 of 10 · American Amicable")).toBeOnTheScreen();
    await user.press(screen.getByRole("radio", { name: "Yes" }));
    expect(await screen.findByTestId("app-q-knockout")).toHaveTextContent("A yes declines level; quote graded.");
    await user.press(screen.getByRole("button", { name: "Next question" }));
    await user.type(await screen.findByTestId("app-a-typed"), "64");
    await user.press(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(writes.at(-1)?.body).toMatchObject({ answers: [{ key: "health_height", value: 64 }] }));
    expect(mockSetParams).toHaveBeenLastCalledWith({ step: "medications" });
  });

  test("Medications' Finish marks the interview complete and goes on to the beneficiary", async () => {
    serve(kase());
    mockParams.step = "medications";
    const user = userEvent.setup();
    await render(<ApplicationScreen />);
    await user.press(await screen.findByRole("radio", { name: "Takes no medicines" }));
    await user.press(screen.getByRole("button", { name: "Finish interview" }));
    await waitFor(() => expect(writes.at(-1)).toEqual({ method: "POST", path: "/api/app/applications/cases/c1/interview?insured=primary", body: undefined }));
    expect(mockSetParams).toHaveBeenLastCalledWith({ step: "beneficiaries" });
  });

  test("a refused save keeps the answer on screen and says why", async () => {
    const { ApiError } = jest.requireActual("@/lib/api");
    serve(kase(), (method) => { if (method === "PUT") throw new ApiError(409, { error: "This interview is locked." }); });
    mockParams.step = "eligibility";
    const user = userEvent.setup();
    await render(<ApplicationScreen />);
    await user.press(await screen.findByRole("radio", { name: "2nd Wednesday" }));
    expect(await screen.findByTestId("app-q-error")).toHaveTextContent("This interview is locked.");
    expect(screen.getByRole("radio", { name: "2nd Wednesday" })).toBeSelected();
  });

  test("with no signal the answer waits on the phone and goes with the next save", async () => {
    const { ApiError } = jest.requireActual("@/lib/api");
    let online = false;
    serve(kase(), (method) => { if (method === "PUT" && !online) throw new ApiError(0, {}); });
    mockParams.step = "eligibility";
    const user = userEvent.setup();
    await render(<ApplicationScreen />);
    await user.press(await screen.findByRole("radio", { name: "3rd Wednesday" }));
    expect(await screen.findByTestId("app-q-queued")).toHaveTextContent("Saved on this phone · sends when you’re back online");
    // L4: it waits in the app's outbox (lib/outbox.ts), one Keychain entry an item, listed in the index.
    const waiting = () => [...mockSecrets.entries()].filter(([k]) => k.startsWith("insurvas.outbox."));
    expect(waiting().map(([, v]) => v).join()).toContain("3rd Wednesday");
    expect(mockSecrets.get("insurvas.outbox")).toContain("answers:c1");
    online = true;
    await user.press(screen.getByRole("button", { name: "Next question" }));
    await user.press(await screen.findByRole("radio", { name: "No" }));
    // The queued answer goes first, then the new one; the phone's copy is emptied.
    await waitFor(() => expect(writes.filter((w) => w.method === "PUT").slice(-2).map((w) => (w.body as { answers: { key: string }[] }).answers[0].key)).toEqual(["ss_deposit_day", "existing_coverage"]));
    expect(waiting()).toEqual([]);
    expect(mockSecrets.has("insurvas.outbox")).toBe(false);
  });
});

describe("E2b · all ten steps", () => {
  test("opens on the first step not finished, and the sheet shows done, now and locked in the board's order", async () => {
    serve(kase({}, {}, { completedAt: null, answers: { ss_deposit_day: { value: "3rd Wednesday" } } }));
    const user = userEvent.setup();
    await render(<ApplicationScreen />);
    // Verify is done, Quote is not: the case resumes on the Quote step.
    expect(await screen.findByTestId("app-quote")).toBeOnTheScreen();
    await user.press(screen.getByRole("button", { name: "All steps" }));
    const labels = ["Verify", "Quote", "Eligibility", "Personal details", "Health", "Medications", "Beneficiary", "Payment", "Review", "Sign"];
    const sheet = within(screen.getByTestId("app-steps-sheet"));
    for (const l of labels) expect(sheet.getByText(l)).toBeOnTheScreen();
    expect(screen.getByTestId("app-step-verify")).toHaveTextContent(/Done/);
    expect(screen.getByTestId("app-step-quote")).toHaveTextContent(/Now/);
    // A locked step can't be opened.
    await user.press(screen.getByTestId("app-step-payment"));
    expect(mockSetParams).not.toHaveBeenCalled();
    await user.press(screen.getByTestId("app-step-verify"));
    expect(mockSetParams).toHaveBeenCalledWith({ step: "verify" });
  });

  test("the question in hand reads \"Now · 2 of 2\" on its step", async () => {
    serve(kase({}, { selectedQuoteId: "q1" }, { answers: { ss_deposit_day: { value: "3rd Wednesday" } } }));
    mockParams.step = "eligibility";
    const user = userEvent.setup();
    await render(<ApplicationScreen />);
    await user.press(await screen.findByTestId("app-step-name"));
    expect(screen.getByTestId("app-step-eligibility")).toHaveTextContent(/Now · 2 of 2/);
  });

  test("the web's own step names still open the step that holds them", async () => {
    serve(kase({}, { selectedQuoteId: "q1" }, { answers: { ss_deposit_day: { value: "3rd Wednesday" }, existing_coverage: { value: false } } }));
    mockParams.step = "interview";
    await render(<ApplicationScreen />);
    expect(await screen.findByText("Health · 1 of 2")).toBeOnTheScreen();
  });
});
describe("E2c · bank details, protected", () => {
  const onFile = kase({}, { payment: { method: "ach", draftDay: null, draftDayRecommended: null, draftOverrideReason: null, incomeType: null, incomeInputs: {}, accountType: "checking", bankName: "Truist", nameOnAccount: "Linda A. Okafor", routing: { masked: "•••••0104", hasValue: true }, account: { masked: "••••4471", hasValue: true } } });

  test("a masked number shows again only after the biometric check, and the reveal says why", async () => {
    serve(onFile, (method, path) => (path.endsWith("/reveal") ? { value: "061000104" } : undefined));
    mockParams.step = "payment";
    mockAuth.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    await render(<ApplicationScreen />);
    // Resumes on the draft day (a bank is on file, no day yet); Bank goes back to the numbers.
    await user.press(await screen.findByRole("button", { name: /^Bank: Truist/ }));
    expect(screen.getByTestId("app-bank-account")).toHaveDisplayValue("••••4471");
    await user.press(screen.getByRole("button", { name: "Show the routing number" }));
    expect(mockAuth).toHaveBeenCalledWith(expect.objectContaining({ promptMessage: "Show bank details" }));
    await waitFor(() => expect(screen.getByTestId("app-bank-routing")).toHaveDisplayValue("061000104"));
    expect(writes).toEqual([{ method: "POST", path: "/api/app/applications/attempts/a1/reveal", body: { field_key: "pay.routing_number", reason: REVEAL_REASON } }]);
  });

  test("a failed check reveals nothing", async () => {
    serve(onFile);
    mockParams.step = "payment";
    mockAuth.mockResolvedValue({ success: false, error: "user_cancel" });
    const user = userEvent.setup();
    await render(<ApplicationScreen />);
    await user.press(await screen.findByRole("button", { name: /^Bank: Truist/ }));
    await user.press(screen.getByRole("button", { name: "Show the account number" }));
    await waitFor(() => expect(mockAuth).toHaveBeenCalled());
    expect(writes).toEqual([]);
    expect(screen.getByTestId("app-bank-account")).toHaveDisplayValue("••••4471");
  });

  test("new numbers are sent once; a number left alone keeps the one on file", async () => {
    serve(kase({}, { payment: null }));
    mockParams.step = "payment";
    const user = userEvent.setup();
    await render(<ApplicationScreen />);
    await user.type(await screen.findByTestId("app-bank-name"), "Truist");
    await user.type(screen.getByTestId("app-bank-routing"), "12345");
    await user.press(screen.getByTestId("app-bank-save"));
    expect(await screen.findByTestId("app-bank-error")).toHaveTextContent("A routing number has 9 digits.");
    await user.clear(screen.getByTestId("app-bank-routing"));
    await user.type(screen.getByTestId("app-bank-routing"), "061000104");
    await user.type(screen.getByTestId("app-bank-account"), "12344471");
    await user.press(screen.getByTestId("app-bank-save"));
    await waitFor(() => expect(writes[0]).toEqual({ method: "PUT", path: "/api/app/applications/attempts/a1/payment", body: { method: "ach", bank_name: "Truist", account_type: "checking", name_on_account: null, routing: "061000104", account: "12344471" } }));
  });
});

describe("E3 · the draft date", () => {
  const banked = { method: "ach" as const, draftDay: null, draftDayRecommended: null, draftOverrideReason: null, incomeType: "ssa" as const, incomeInputs: {}, accountType: "checking" as const, bankName: "Truist", nameOnAccount: null, routing: { masked: "•••••0104", hasValue: true }, account: { masked: "••••4471", hasValue: true } };
  const rec = { kind: "recommended", recommended: { day: 18, minGapDays: 3, reason: "x" }, alternates: [{ day: 17, minGapDays: 2, reason: "x" }, { day: 19, minGapDays: 4, reason: "x" }], schedule: "Your Social Security lands on the second Wednesday" };

  test("asks the optimiser with the birth day from the date of birth, and saves the recommended day", async () => {
    serve(kase({}, { payment: banked }), (method, path) => (path === "/api/app/draft-dates/recommend" ? rec : undefined));
    mockParams.step = "payment";
    const user = userEvent.setup();
    await render(<ApplicationScreen />);
    expect(await screen.findByTestId("app-draft-why")).toHaveTextContent("Your Social Security lands on the second Wednesday. Drafts two days after a deposit clear most often.");
    expect(writes[0]).toEqual({ method: "POST", path: "/api/app/draft-dates/recommend", body: { income_type: "ssa", birthDay: 14, before1997: false } });
    // The days read as the dates they first come out; the recommendation carries Best.
    expect(screen.getByTestId("app-draft-day-18")).toHaveTextContent(new RegExp(`^${dateWords(nextDraftDate(18, todayKey()))}`));
    expect(screen.getByTestId("app-draft-day-18")).toHaveTextContent(/Best$/);
    await user.press(screen.getByRole("button", { name: useDay(18) }));
    await waitFor(() => expect(writes.at(-1)).toEqual({ method: "PUT", path: "/api/app/applications/attempts/a1/draft-day", body: { day: 18, income_type: "ssa", income_inputs: { birthDay: 14, before1997: false }, override_reason: null } }));
    expect(mockSetParams).toHaveBeenLastCalledWith({ step: "review" });
  });

  test("another day needs the reason the server keeps", async () => {
    serve(kase({}, { payment: banked }), (method, path) => (path === "/api/app/draft-dates/recommend" ? rec : undefined));
    mockParams.step = "payment";
    const user = userEvent.setup();
    await render(<ApplicationScreen />);
    await user.press(await screen.findByTestId("app-draft-day-19"));
    await user.press(screen.getByRole("button", { name: useDay(19) }));
    expect(await screen.findByTestId("app-draft-error")).toHaveTextContent("Say why the 19th and not the 18th.");
    await user.type(screen.getByTestId("app-draft-reason"), "Her pension lands on the 17th");
    await user.press(screen.getByRole("button", { name: useDay(19) }));
    await waitFor(() => expect(writes.at(-1)?.body).toMatchObject({ day: 19, override_reason: "Her pension lands on the 17th" }));
  });
});

describe("E1 · the quote", () => {
  test("a premium typed from the carrier's tool is saved in cents, then Apply selects the cheapest", async () => {
    const catalog = { carriers: [{ id: "car-aa", name: "American Amicable", appointed: { ok: true, reason: null }, products: [] }] };
    serve(kase({}, {}, { completedAt: "2026-11-24T10:00:00Z" }), (method, path) => {
      if (path === "/api/app/applications/cases/c1/catalog") return catalog;
      if (path === "/api/app/applications/cases/c1/quotes") {
        current = kase({}, { quotes: [
          { id: "q2", carrierId: "car-x", carrierName: "Mutual of Omaha", productLabel: "Living Promise", tier: "level", faceAmountCents: 1_500_000, monthlyPremiumCents: 5490, status: "draft", appointed: { ok: true, reason: null }, warnings: [] },
          { id: "q1", carrierId: "car-aa", carrierName: "American Amicable", productLabel: "Senior Choice", tier: "level", faceAmountCents: 1_500_000, monthlyPremiumCents: 5218, status: "draft", appointed: { ok: true, reason: null }, warnings: [] },
        ] }, { completedAt: "2026-11-24T10:00:00Z" });
        return { id: "q1", warnings: [] };
      }
      return undefined;
    });
    mockParams.step = "quote";
    const user = userEvent.setup();
    await render(<ApplicationScreen />);
    await user.press(await screen.findByTestId("app-quote-carrier"));
    await user.press(await screen.findByText("American Amicable"));
    await user.type(screen.getByTestId("app-quote-monthly"), "52.18");
    await user.press(screen.getByTestId("app-quote-add"));
    await waitFor(() => expect(writes[0]).toEqual({ method: "POST", path: "/api/app/applications/cases/c1/quotes", body: { insured_role: "primary", carrier_id: "car-aa", carrier_product_id: null, product_code: "final_expense", tier: "level", face_amount_cents: 1_500_000, monthly_premium_cents: 5218, riders: [], rating_inputs: {} } }));
    expect(await screen.findByText("$52.18")).toBeOnTheScreen();
    await user.press(screen.getByRole("button", { name: "Apply with American Amicable" }));
    await waitFor(() => expect(writes.at(-1)).toEqual({ method: "POST", path: "/api/app/quotes/q1/select", body: undefined }));
  });
});

/** An application with every step before Review finished (Review and Sign hold Mark ready back otherwise). */
const done = {
  selectedQuoteId: "q1",
  quotes: [{ id: "q1", carrierId: "car-aa", carrierName: "American Amicable", productLabel: "Senior Choice", tier: "level", faceAmountCents: 1_500_000, monthlyPremiumCents: 5218, status: "selected" as const, appointed: { ok: true, reason: null }, warnings: [] }],
  beneficiaries: [{ id: "b1", first_name: "Sam", last_name: "Okafor", share_bp: 10000, tier: "primary" as const }],
  payment: { method: "ach" as const, draftDay: 18, draftDayRecommended: 18, draftOverrideReason: null, incomeType: "ssa" as const, incomeInputs: {} },
};
const finished = { completedAt: "2026-11-27T10:00:00Z" };

describe("E4 · sign and submit", () => {
  const touch = { touchBank: [{ touchActive: true, startPageX: 10, startPageY: 10, startTimeStamp: 0, currentPageX: 10, currentPageY: 10, currentTimeStamp: 0, previousPageX: 10, previousPageY: 10, previousTimeStamp: 0 }], numberActiveTouches: 1, indexOfSingleActiveTouch: 0, mostRecentTimeStamp: 0 };
  const at = (x: number, y: number) => ({ nativeEvent: { locationX: x, locationY: y, touches: [], changedTouches: [], timestamp: 0 }, touchHistory: touch });

  test("Submit waits for the signature, then marks ready and records the submission", async () => {
    serve(kase({}, { ...done, carrierName: "American Amicable", carrierPortalUrl: "https://carrier.example/esign" }, finished));
    mockParams.step = "submit";
    const user = userEvent.setup();
    await render(<ApplicationScreen />);
    const submit = await screen.findByRole("button", { name: "Submit to American Amicable" });
    expect(submit).toBeDisabled();
    const pad = screen.getByTestId("app-sign-pad");
    await act(async () => {
      fireEvent(pad, "responderGrant", at(20, 40));
      fireEvent(pad, "responderMove", at(60, 80));
    });
    await act(async () => { fireEvent(pad, "responderRelease", at(60, 80)); });
    expect(await screen.findByText(/^Signed on this phone · /)).toBeOnTheScreen();
    await user.press(screen.getByRole("button", { name: "Submit to American Amicable" }));
    await waitFor(() => expect(writes.map((w) => `${w.method} ${w.path}`)).toEqual(["POST /api/app/applications/attempts/a1/transition", "POST /api/app/applications/attempts/a1/submissions"]));
    expect(writes[1].body).toMatchObject({ reference: null, reference_kind: "application_no", submitted_via: "carrier_portal_manual", notes: expect.stringMatching(/^The client signed on the agent's phone at /) });

    await user.press(screen.getByRole("link", { name: "Send the carrier’s e-sign link instead" }));
    expect(mockOpen).toHaveBeenCalledWith("https://carrier.example/esign");
  });

  test("the producer gate is said before Submit, and Clear starts the signature again", async () => {
    serve(kase({ submitGate: { canSubmit: false, code: "cannot_submit", reason: "Your agency hasn’t switched on submitting for you." } }, { ...done, carrierName: "American Amicable" }, finished));
    mockParams.step = "submit";
    await render(<ApplicationScreen />);
    expect(await screen.findByTestId("app-sign-error")).toHaveTextContent("Your agency hasn’t switched on submitting for you.");
    const pad = screen.getByTestId("app-sign-pad");
    await act(async () => { fireEvent(pad, "responderGrant", at(20, 40)); });
    await act(async () => { fireEvent(pad, "responderRelease", at(20, 40)); });
    expect(screen.getByRole("button", { name: "Submit to American Amicable" })).toBeDisabled();
    const user = userEvent.setup();
    await user.press(screen.getByTestId("app-sign-clear"));
    expect(screen.getByText("Linda signs above with a finger")).toBeOnTheScreen();
  });
});

describe("Review (9 of 10) and Sign (10 of 10)", () => {
  const quoted = { selectedQuoteId: "q1", carrierName: "American Amicable", productLabel: "Senior Choice", quotes: [{ id: "q1", carrierId: "car-aa", carrierName: "American Amicable", productLabel: "Senior Choice", tier: "level", faceAmountCents: 1_500_000, monthlyPremiumCents: 5218, status: "selected" as const, appointed: { ok: true, reason: null }, warnings: [] }] };

  test("Review marks the application ready through the server's check, then goes on to Sign", async () => {
    serve(kase({}, { ...done, ...quoted, disclosures: [{ id: "d1", status: "required" }] }, finished));
    mockParams.step = "review";
    const user = userEvent.setup();
    await render(<ApplicationScreen />);
    expect(await screen.findByText("Review · 9 of 10")).toBeOnTheScreen();
    expect(screen.getByTestId("app-review-disclosures")).toHaveTextContent("1 disclosure still to read and record.");
    await user.press(screen.getByRole("button", { name: "Mark ready" }));
    await waitFor(() => expect(writes.at(-1)?.path).toBe("/api/app/applications/attempts/a1/transition"));
    expect(mockSetParams).toHaveBeenLastCalledWith({ step: "submit" });
  });

  test("Sign is 10 of 10 and the summary says the first draft as a date", async () => {
    serve(kase({}, { ...done, ...quoted }, finished));
    mockParams.step = "submit";
    await render(<ApplicationScreen />);
    expect(await screen.findByText("Sign · 10 of 10")).toBeOnTheScreen();
    const summary = screen.getByTestId("app-sign-summary");
    expect(summary).toHaveTextContent(/Monthly\$52\.18/);
    expect(summary).toHaveTextContent(new RegExp(`First draft${dateWords(nextDraftDate(18, todayKey()))}`));
  });

  test("with steps left, Mark ready waits and Save draft says where to finish on the computer", async () => {
    const { router } = jest.requireMock("expo-router");
    // Quote and payment on the phone; beneficiaries and the personal details not yet.
    serve(kase({}, { ...quoted, payment: done.payment, requiredKeys: ["insured.first_name", "insured.ssn"] }, finished));
    mockParams.step = "review";
    const user = userEvent.setup();
    await render(<ApplicationScreen />);
    expect(await screen.findByText("Finish these 2 steps to mark it ready")).toBeOnTheScreen();
    expect(screen.getByTestId("app-left-personal")).toBeOnTheScreen();
    expect(screen.getByTestId("app-left-beneficiaries")).toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Mark ready" })).toBeDisabled();
    await user.press(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(router.push).toHaveBeenLastCalledWith({ pathname: "/computer", params: expect.objectContaining({ path: "/app/applications/c1?step=application", title: "Draft saved", saved: "1" }) }));
    expect(router.push.mock.calls.at(-1)[0].params.why).toMatch(/Still to finish: Personal details, Beneficiary\./);
    expect(writes.some((w) => w.path.endsWith("/transition"))).toBe(false);
  });

  test("Sign with steps left shows them and Save draft instead of the signature", async () => {
    serve(kase({}, { ...quoted }, finished));
    mockParams.step = "submit";
    await render(<ApplicationScreen />);
    expect(await screen.findByTestId("app-sign-blocked")).toBeOnTheScreen();
    expect(screen.queryByTestId("app-sign-pad")).not.toBeOnTheScreen();
    expect(screen.getByRole("button", { name: "Save draft" })).toBeOnTheScreen();
  });

  test("a submitted application opens its case", async () => {
    const { router } = jest.requireMock("expo-router");
    serve(kase({}, { ...quoted, status: "submitted", submissions: [{ id: "s1", submittedAt: "2026-11-24T19:46:00Z" }] }));
    const user = userEvent.setup();
    await render(<ApplicationScreen />);
    expect(await screen.findByText("Submitted to American Amicable")).toBeOnTheScreen();
    await user.press(screen.getByRole("button", { name: "Open the case" }));
    expect(router.replace).toHaveBeenCalledWith({ pathname: "/cases/[caseId]", params: { caseId: "c1" } });
  });
});