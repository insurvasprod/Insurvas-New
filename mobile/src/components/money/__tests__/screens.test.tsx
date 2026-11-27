import { render, screen, userEvent, waitFor } from "@testing-library/react-native";

import { BillScreen } from "../bill";
import { DepositScreen } from "../deposit";
import { ExpenseSheet } from "../expense";
import { localToday } from "../logic";
import { MoneyTab } from "../money-tab";
import { MyPayScreen } from "../my-pay";
import { BalanceScreen } from "../balance";
import { PayIssuesScreen } from "../pay-issues";
import { PnlScreen } from "../pnl";
import { StatementScreen } from "../statement";
import type { Invoice, Payment, PnlSummary, StatementAnswer, TodoItem } from "../types";

/**
 * The Money screens against a mocked api: what each reads, what it draws, and that every approval asks for a fresh
 * fingerprint or Face ID before it calls the web's own route (writes are exercised here only, never on a server).
 */
const mockApi = jest.fn();
const mockAuth = jest.fn();
const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock("@/lib/session", () => ({ useSession: () => ({ api: mockApi, refreshToken: async () => "tok", me: { user: { id: "me" }, tenant: { name: "Ellery & Fields" }, role: "owner" } }) }));
jest.mock("expo-router", () => ({ router: { push: (...a: unknown[]) => mockPush(...a), back: () => mockBack() }, Stack: { Screen: () => null } }));
jest.mock("expo-local-authentication", () => ({ hasHardwareAsync: async () => true, isEnrolledAsync: async () => true, authenticateAsync: (o: unknown) => mockAuth(o) }));
jest.mock("expo-file-system", () => ({ File: class {}, Paths: { cache: "cache" } }));
jest.mock("expo-image-picker", () => ({ requestCameraPermissionsAsync: async () => ({ granted: true }), launchCameraAsync: async () => ({ canceled: true }) }));
jest.mock("react-native-safe-area-context", () => jest.requireActual("react-native-safe-area-context/jest/mock").default);

type Call = { path: string; method?: string; body?: unknown };
let calls: Call[] = [];
function serve(answers: Record<string, unknown | ((c: Call) => unknown)>) {
  mockApi.mockImplementation(async (path: string, init?: { method?: string; body?: unknown }) => {
    const call = { path, method: init?.method, body: init?.body };
    calls.push(call);
    const key = Object.keys(answers).find((k) => (init?.method ? `${init.method} ${path}` === k : path === k));
    if (!key) throw new Error(`unexpected ${init?.method ?? "GET"} ${path}`);
    const a = answers[key];
    return typeof a === "function" ? (a as (c: Call) => unknown)(call) : a;
  });
}
beforeEach(() => { calls = []; mockApi.mockReset(); mockAuth.mockReset(); mockPush.mockReset(); mockBack.mockReset(); });

// ─── G1 ────────────────────────────────────────────────────────────────────────────────────────
const m = localToday().slice(0, 7);
const run = (id: string, start: string, paidOn: string, net: number) => ({ id, periodStart: `${start}-01`, periodEnd: `${start}-28`, status: "paid", netCents: net, withheldCents: 0, paidOn });
const myPay = {
  balances: [{ basis: "reported", balanceCents: 629200, earnedCents: 0, chargebackCents: 0, paidCents: 0 }],
  entries: [
    { id: "e1", entryType: "split_advance", basis: "reported", policyNumber: "A1", carrierId: "c1", carrierName: "AMAM", clientName: "Earl", amountCents: 690400, occurredOn: `${m}-02`, reason: null },
    { id: "e2", entryType: "split_chargeback", basis: "reported", policyNumber: "A2", carrierId: "c2", carrierName: "TA", clientName: "Vernon Hayes", amountCents: -61200, occurredOn: `${m}-03`, reason: null },
  ],
  runs: [run("r1", "2026-10", "2026-11-05", 620450), run("r2", "2026-09", "2026-10-05", 601800), run("r3", "2026-08", "2026-09-05", 482025), run("r4", "2026-07", "2026-08-05", 1)],
  facts: { advanceMonthsByCarrier: { c1: 9 }, policyMonthByEntry: { e2: 4 } },
};

test("My pay draws this month as the board words it, the last three statements, and the pay day the statements agree on", async () => {
  serve({ "/api/app/agency/my-pay": myPay });
  const user = userEvent.setup();
  await render(<MyPayScreen />);
  expect(await screen.findByText("$6,904.00")).toBeOnTheScreen();
  expect(screen.getByText(/paid on the 5th$/)).toBeOnTheScreen();
  expect(screen.getByText("Renewals and months 10–12")).toBeOnTheScreen();
  expect(screen.getByText("1 policy lapsed in month 4")).toBeOnTheScreen();
  expect(screen.getByText("1 lapsed")).toBeOnTheScreen();
  expect(screen.getByText("−$612.00")).toBeOnTheScreen();
  expect(screen.getByText("Kept by Ellery & Fields")).toBeOnTheScreen();
  expect(screen.getByText("Not shown")).toBeOnTheScreen();
  // Three statements, as drawn; the header's download is the newest one's PDF.
  expect(screen.queryByTestId("pay-statement-r4")).toBeNull();
  expect(screen.getByLabelText("Share the October 2026 statement PDF")).toBeOnTheScreen();
  await user.press(screen.getByTestId("pay-statement-r1"));
  expect(mockPush).toHaveBeenCalledWith({ pathname: "/money/statement/[id]", params: { id: "r1" } });
});

// ─── G7 ────────────────────────────────────────────────────────────────────────────────────────
test("My balance adds up this month's share, the chargebacks owed back and the advance from the agency", async () => {
  serve({ "/api/app/agency/my-pay": myPay });
  await render(<BalanceScreen />);
  expect(await screen.findByText(/^Owed to you on 5 /)).toBeOnTheScreen();
  expect(screen.getByText(/^Your share of .+ commission$/)).toBeOnTheScreen();
  expect(screen.getByText("Vernon Hayes")).toBeOnTheScreen();
  expect(screen.getByText("Advance from the agency")).toBeOnTheScreen();
  expect(screen.getByText("None taken")).toBeOnTheScreen();
  // 6,904.00 − 612.00 = 6,292.00: the balance; nothing carried, so no extra row.
  expect(screen.queryByTestId("balance-carried")).toBeNull();
});

// ─── G2 ────────────────────────────────────────────────────────────────────────────────────────
test("a statement lists one line per policy, the chargeback in its chip, and folds a long group", async () => {
  const line = (id: string, over: object = {}) => ({ id, client: `Client ${id}`, carrier: "Mutual of Omaha", policy: id, premiumCents: null, premiumMode: null, levelBps: null, grossCents: 10000, chargebackCents: null, netCents: 10000, basis: "reported", label: "Share of an advance", ...over });
  const answer: StatementAnswer = {
    run: { id: "r1", producerUserId: "me", periodStart: "2026-10-01", periodEnd: "2026-10-31", status: "paid", paidOn: "2026-11-05", method: "Direct deposit", reference: null, withheldCents: 0, decision: null, decisionReason: null },
    producer: "Ava", agency: "E&F",
    statement: { openingCents: 0, lines: [line("a"), line("b"), line("c"), line("d"), line("e"), line("x", { grossCents: null, chargebackCents: -37260, netCents: -37260, label: "Share of a chargeback" })], adjustments: [], payouts: [{ id: "p", amountCents: -12740 }], movementCents: 0, closingCents: 0 },
  };
  serve({ "/api/app/agency/statements/r1": { ...answer, lineFacts: { a: { advanceMonths: 9, policyMonth: null }, x: { advanceMonths: 9, policyMonth: 4 } } } });
  const user = userEvent.setup();
  await render(<StatementScreen runId="r1" />);
  expect(await screen.findByText("October 2026")).toBeOnTheScreen();
  expect(screen.getByText("Charged back")).toBeOnTheScreen();
  expect(screen.getByText("Mutual of Omaha · 9 mo advance")).toBeOnTheScreen();
  expect(screen.getByText("Mutual of Omaha · lapsed in month 4")).toBeOnTheScreen();
  expect(screen.getByText("5 Nov · Direct deposit")).toBeOnTheScreen();
  expect(screen.getByText("+ 2 more")).toBeOnTheScreen();
  await user.press(screen.getByTestId("statement-more-advances"));
  expect(screen.getByText("Client e")).toBeOnTheScreen();
});

// ─── G3 + G4 + G3b ─────────────────────────────────────────────────────────────────────────────
const todo = (over: Partial<TodoItem>): TodoItem => ({ key: "bill-b1", group: "bills", what: "Bill to approve · Apex Leads", detail: "INV-1 · leads 1 Nov – 15 Nov 2026", where: "Vendor bills", amountCents: 1153600, since: "2026-11-15", next: "Check it", step: "Approve", chip: { label: "To approve", tone: "warning" }, yours: true, href: "/app/vendor-bills/b1", ...over });
const pnl: PnlSummary = {
  kind: "month", basis: "accrual", range: { from: "2026-11-01", to: "2026-12-01", label: "November 2026" }, today: "2026-11-25",
  totals: { inCents: 6488000, acquisitionCents: -2141000, overheadCents: -610500, splitsCents: -1824000, netProfitCents: 1912500, heldCents: 0 },
  lines: { in: [], acquisition: [], overhead: [], splits: [] },
  previous: { range: { from: "2026-10-01", to: "2026-11-01", label: "October 2026" }, inCents: 0, acquisitionCents: 0, overheadCents: 0, splitsCents: 0, netProfitCents: 2500000 },
  // The month before through the same day: what "vs October at this point" compares with (not the whole October).
  previousToDate: { range: { from: "2026-10-01", to: "2026-10-26", label: "1 Oct 2026 to 25 Oct 2026" }, inCents: 0, acquisitionCents: 0, overheadCents: 0, splitsCents: 0, netProfitCents: 1618500 },
  trend: [],
};
const payment: Payment = { id: "s1", carrierId: "c1", carrierName: "Corebridge", statementDate: "2026-11-16", paidCents: 1463000, money: "landed", verdict: "bad_math", dueBy: "2026-11-19", missingCents: 0, shortCents: 21400, landedCents: 1441600, deposits: [{ postedOn: "2026-11-18", appliedCents: 1441600, account: "Truist ••4471", confirmed: true }] };
const preview = (id: string, name: string, cents: number) => ({ producerUserId: id, displayName: name, status: "active", balanceBeforeCents: 0, earnedCents: cents, chargebackCents: 0, periodCents: cents, balanceCents: cents, alreadyRun: false, planModel: "big_split", salaryCents: 0, bonusCents: 0, saveFeeCents: 0, absorbedCount: 0 });

function serveMoney(extra: Record<string, unknown> = {}) {
  serve({
    "/api/app/accounting/steps?items=1": { counts: {}, items: [todo({}), todo({ key: "payout-drafts", group: "payouts", what: "Partner payout runs to review", detail: "2 drafts", amountCents: 431000, href: "/app/payouts?status=draft" }), todo({ key: "pay-s1", group: "bank", what: "Bad math · Corebridge", amountCents: 21400, chip: { label: "short", tone: "danger", amount: true } })] },
    // The Money tab reads the month its calendar shows (this month to start).
    [`/api/app/accounting/pnl/drill?view=summary&kind=month&anchor=${localToday().slice(0, 7)}`]: pnl,
    "/api/app/accounting/bank?payments=1": { payments: [payment] },
    ...extra,
  });
}

test("Money lists what waits first, then the month and the deposits; a part the person may not open is left out", async () => {
  serveMoney();
  // Team payouts refused (403): the row is simply not there.
  const base = mockApi.getMockImplementation()!;
  mockApi.mockImplementation(async (path: string, init?: { method?: string }) => {
    if (path.startsWith("/api/app/agency/payouts")) { const { ApiError } = jest.requireActual("@/lib/api"); throw new ApiError(403, { error: "No" }); }
    return base(path, init);
  });
  const user = userEvent.setup();
  await render(<MoneyTab />);
  expect(await screen.findByText("Waiting on you · 3")).toBeOnTheScreen();
  expect(screen.queryByTestId("money-team")).toBeNull();
  // Waiting on you always carries the amount (no chip); the deposit says the shortfall in its one chip, whole dollars.
  expect(screen.getByText("$214")).toBeOnTheScreen();
  expect(screen.getByText("$214 short")).toBeOnTheScreen();
  expect(screen.getByText("18 Nov · statement says $14,630")).toBeOnTheScreen();
  expect(screen.getByText("$64,880")).toBeOnTheScreen();
  expect(screen.getByText("−$21,410")).toBeOnTheScreen();
  expect(screen.getByText("↑ $2,940")).toBeOnTheScreen();
  expect(screen.getByText(" vs October at this point", { exact: false })).toBeOnTheScreen();
  expect(screen.queryByText("Owed by carriers")).toBeNull();
  await user.press(screen.getByTestId("money-todo-bill-b1"));
  expect(mockPush).toHaveBeenCalledWith({ pathname: "/money/bills/[id]", params: { id: "b1" } });
  await user.press(screen.getByTestId("money-payment-s1"));
  expect(mockPush).toHaveBeenCalledWith({ pathname: "/money/deposits/[id]", params: { id: "s1" } });
});

test("approving team payouts asks for the fingerprint first, then sends the web's own decision", async () => {
  const posts: Call[] = [];
  const team = { period: { from: "x", to: "y" }, preview: [preview("u1", "Ava Kim", 492000), preview("u2", "Jordan Reyes", 414000)], rules: { negativePolicy: "carry_forward", recoveryPctBp: 2000 }, facts: { u1: { shareBps: 8000, policies: 14, chargebacks: 0, applications: 0 } } };
  serveMoney({ "POST /api/app/agency/payouts": (c: Call) => { posts.push(c); return { ok: true, runs: [] }; } });
  const base = mockApi.getMockImplementation()!;
  mockApi.mockImplementation(async (path: string, init?: { method?: string; body?: unknown }) => (path.startsWith("/api/app/agency/payouts?") ? team : base(path, init)));
  const user = userEvent.setup();
  await render(<MoneyTab />);
  await user.press(await screen.findByTestId("money-team"));
  expect(screen.getByText("Ava Kim")).toBeOnTheScreen();
  expect(screen.getByText("80% of advance · 14 policies")).toBeOnTheScreen();
  expect(screen.queryByText("How you’ll pay them")).toBeNull();
  // A refused fingerprint approves nothing.
  mockAuth.mockResolvedValueOnce({ success: false, error: "user_cancel" });
  await user.press(screen.getByTestId("team-approve"));
  expect(posts).toHaveLength(0);
  mockAuth.mockResolvedValueOnce({ success: true });
  await user.press(screen.getByTestId("team-approve"));
  await waitFor(() => expect(posts).toHaveLength(1));
  const body = posts[0].body as { decisions: { producerUserId: string; mode: string }[]; method: string };
  expect(body.method).toBe("");
  expect(body.decisions.map((d) => [d.producerUserId, d.mode])).toEqual([["u1", "pay_full"], ["u2", "pay_full"]]);
  expect(mockAuth).toHaveBeenCalledTimes(2);
});

test("partner payouts publish each draft after the fingerprint", async () => {
  const posts: Call[] = [];
  serveMoney({
    "/api/app/accounting/payouts": { runs: [{ id: "d1", partnerId: "p", partnerName: "Apex Leads", periodStart: "2026-11-01", periodEnd: "2026-11-30", status: "draft", netCents: 431500 }, { id: "d2", partnerId: "q", partnerName: "Summit Media", periodStart: "2026-11-01", periodEnd: "2026-11-30", status: "draft", netCents: -500 }, { id: "d0", partnerName: "Zero", status: "draft", netCents: 0 }, { id: "x", partnerName: "Old", status: "paid", netCents: 5 }] },
    "/api/app/accounting/payouts/d1": { run: { id: "d1", partnerId: "p", partnerName: "Apex Leads", periodStart: "2026-11-01", periodEnd: "2026-11-30", status: "draft", netCents: 431500, grossCents: 0, deductionsCents: 0, disputedCents: 0, lines: [{ itemType: "sale", label: "Sales", count: 41, rateCents: 9500, amountCents: 389500 }, { itemType: "transfer", label: "Accepted transfers", count: 12, rateCents: 3500, amountCents: 42000 }] } },
    "/api/app/accounting/payouts/d2": { run: { id: "d2", partnerId: "q", partnerName: "Summit Media", periodStart: "2026-11-01", periodEnd: "2026-11-30", status: "draft", netCents: -500, grossCents: 0, deductionsCents: 0, disputedCents: 0, lines: [{ itemType: "clawback", label: "Chargebacks taken back", count: 1, rateCents: 500, amountCents: -500 }] } },
    "POST /api/app/accounting/payouts/d1": (c: Call) => { posts.push(c); return { run: {} }; },
    "POST /api/app/accounting/payouts/d2": (c: Call) => { posts.push(c); return { run: {} }; },
  });
  const base = mockApi.getMockImplementation()!;
  mockApi.mockImplementation(async (path: string, init?: { method?: string; body?: unknown }) => (path.startsWith("/api/app/agency/payouts?") ? { period: {}, preview: [], rules: { negativePolicy: "x", recoveryPctBp: 2000 } } : base(path, init)));
  const user = userEvent.setup();
  await render(<MoneyTab />);
  await user.press(await screen.findByTestId("money-todo-payout-drafts"));
  expect(await screen.findByText("41 sold × $95 · 12 transfers × $35")).toBeOnTheScreen();
  expect(screen.getByText("November partner payouts")).toBeOnTheScreen();
  expect(screen.getByText("Clawback: 1 returned lead")).toBeOnTheScreen();
  expect(screen.getByText("Returned")).toBeOnTheScreen();
  expect(screen.getByText("−$5")).toBeOnTheScreen();
  expect(screen.getByText("Each partner sees their statement in their portal when you approve.")).toBeOnTheScreen();
  mockAuth.mockResolvedValueOnce({ success: true });
  await user.press(screen.getByTestId("partner-approve"));
  await waitFor(() => expect(posts.map((p) => p.path)).toEqual(["/api/app/accounting/payouts/d1", "/api/app/accounting/payouts/d2"]));
});

// ─── G3c ───────────────────────────────────────────────────────────────────────────────────────
const invoice = (status: Invoice["status"] = "received"): Invoice => ({
  id: "b1", sourceType: "vendor", sourceName: "Apex Leads", invoiceNumber: "INV-1", invoiceDate: "2026-11-16", periodStart: "2026-11-01", periodEnd: "2026-11-15", dueDate: "2026-11-27",
  totalCents: 1153600, status, paidOn: null, flagged: false, differenceCents: null, paidMethod: null, paymentReference: null, note: null,
  lines: [{ id: "l1", description: "Leads", quantity: 412, unitPriceCents: 2800, amountCents: 1153600 }],
  comparison: { rows: [{ lineId: "l1", invoicedQuantity: 412, unitPriceCents: 2800, countable: true, accepted: 412, rejected: 0, recorded: 412, creditedCount: 0, creditedCents: 0, ourCount: 412, ourCents: 1153600, differenceCents: 0 }], summary: { invoicedCents: 1153600, ourCents: 1153600, differenceCents: 0, flagged: false, toleranceCents: 100, uncountedLines: 0 } },
});

test("a vendor bill: checked against what arrived; Approve needs the fingerprint, Dispute sends the note", async () => {
  const posts: Call[] = [];
  serve({ "/api/app/accounting/invoices/b1": { invoice: invoice() }, "POST /api/app/accounting/invoices/b1": (c: Call) => { posts.push(c); return { invoice: invoice((c.body as { action: string }).action === "approve" ? "approved" : "disputed") }; } });
  const user = userEvent.setup();
  await render(<BillScreen id="b1" />);
  expect(await screen.findByText("Apex Leads · Nov 1–15")).toBeOnTheScreen();
  expect(screen.getByText("Matches")).toBeOnTheScreen();
  expect(screen.getByText("412 × $28.00")).toBeOnTheScreen();
  expect(screen.getByText("Fri 27 Nov")).toBeOnTheScreen();
  expect(screen.queryByText("Invoice")).toBeNull();
  mockAuth.mockResolvedValueOnce({ success: true });
  await user.press(screen.getByTestId("bill-approve"));
  await waitFor(() => expect(posts).toEqual([{ path: "/api/app/accounting/invoices/b1", method: "POST", body: { action: "approve" } }]));
  expect(mockAuth).toHaveBeenCalledTimes(1);
});

test("disputing a bill sends its note, no fingerprint needed", async () => {
  const posts: Call[] = [];
  serve({ "/api/app/accounting/invoices/b1": { invoice: invoice() }, "POST /api/app/accounting/invoices/b1": (c: Call) => { posts.push(c); return { invoice: invoice("disputed") }; } });
  const user = userEvent.setup();
  await render(<BillScreen id="b1" />);
  await user.press(await screen.findByTestId("bill-dispute"));
  await user.type(screen.getByTestId("bill-dispute-note"), "41 returns not credited");
  await user.press(screen.getByTestId("bill-dispute-send"));
  await waitFor(() => expect(posts[0]?.body).toEqual({ action: "dispute", note: "41 returns not credited" }));
  expect(mockAuth).not.toHaveBeenCalled();
});

// ─── G3d ───────────────────────────────────────────────────────────────────────────────────────
test("a short deposit lists the lines paid short and opens a pay issue in one tap", async () => {
  const posts: Call[] = [];
  serve({
    "/api/app/accounting/bank?payment=s1": { payment: { ...payment, policies: [{ policyNumber: "TER1", paidCents: 0, promisedCents: 12840, state: "short", shortCents: 12840, findingId: "f1", clientName: "George Patel", lineType: "Advance" }, { policyNumber: "TER2", paidCents: 100, promisedCents: 8660, state: "short", shortCents: 8560, findingId: "f2", clientName: null, lineType: null }, { policyNumber: "OK1", paidCents: 5000, promisedCents: 5000, state: "ok", shortCents: 0, findingId: null }] } },
    "POST /api/app/commission-discrepancies": (c: Call) => { posts.push(c); return { ok: true, id: "d", totalCents: 21400 }; },
  });
  const user = userEvent.setup();
  await render(<DepositScreen id="s1" />);
  expect(await screen.findByText("Corebridge · 18 Nov")).toBeOnTheScreen();
  expect(screen.getByText("Landed in Truist ••4471")).toBeOnTheScreen();
  expect(screen.getByText("Statement said $14,630.00")).toBeOnTheScreen();
  expect(screen.queryByText("OK1")).toBeNull();
  // A line named by the insured and its kind; one the server could not name keeps its policy number.
  expect(screen.getByText("George Patel")).toBeOnTheScreen();
  expect(screen.getByText("Advance")).toBeOnTheScreen();
  expect(screen.getByText("TER2")).toBeOnTheScreen();
  await user.press(screen.getByTestId("deposit-issue"));
  await waitFor(() => expect(posts[0]?.body).toEqual({ action: "draft_dispute", ids: ["f1", "f2"], recipient: null }));
});

// ─── G8 ────────────────────────────────────────────────────────────────────────────────────────
test("pay issues: the total to the cent, then each carrier", async () => {
  serve({ "/api/app/discrepancies?view=carriers": { ok: true, available: true, owedCents: 391240, count: 18, kinds: { short_paid: 14, missing: 4 }, carriers: [{ carrierKey: "c1", carrierName: "Corebridge", owedToYouCents: 184410, owedToCarrierCents: 0, count: 9, kinds: { short_paid: 9 } }] } });
  const user = userEvent.setup();
  await render(<PayIssuesScreen />);
  expect(await screen.findByText("18 items · 4 never paid, 14 paid short")).toBeOnTheScreen();
  expect(screen.getByText("$1,844.10")).toBeOnTheScreen();
  await user.press(screen.getByTestId("issues-carrier-0"));
  expect(mockPush).toHaveBeenCalledWith(expect.objectContaining({ pathname: "/computer", params: expect.objectContaining({ path: "/app/discrepancies?carrier=c1" }) }));
});

// ─── G6 ────────────────────────────────────────────────────────────────────────────────────────
test("a new expense suggests the vendor's last category, saves as the web does, then attaches the receipt", async () => {
  const posts: Call[] = [];
  serve({
    "/api/app/accounting/expenses": { expenses: [{ id: "x", category: "office", vendorName: "Staples", amountCents: 100, incurredOn: "2026-10-01", status: "confirmed", paidMethod: null }] },
    "POST /api/app/accounting/expenses": (c: Call) => { posts.push(c); return { id: "e9", generated: 0 }; },
  });
  const fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) } as Response);
  const user = userEvent.setup();
  const saved = jest.fn();
  await render(<ExpenseSheet visible photo={{ uri: "file:///r.jpg", name: "r.jpg", type: "image/jpeg" }} onPhoto={() => undefined} onClose={() => undefined} onSaved={saved} />);
  expect(screen.getByText("New expense")).toBeOnTheScreen();
  expect(screen.getByText("Receipt attached")).toBeOnTheScreen();
  await user.type(screen.getByTestId("expense-amount"), "155.12");
  await user.type(screen.getByTestId("expense-vendor"), "Staples");
  expect(await screen.findByText("You used this for Staples last time.")).toBeOnTheScreen();
  expect(screen.getByLabelText("Category: Office & equipment")).toBeOnTheScreen();
  await user.clear(screen.getByTestId("expense-date"));
  await user.type(screen.getByTestId("expense-date"), "23 Nov 2026");
  await user.press(screen.getByTestId("expense-save"));
  await waitFor(() => expect(saved).toHaveBeenCalledWith("Expense saved: Staples, $155.12."));
  expect(posts[0].body).toEqual({ category: "office", vendor_name: "Staples", description: null, amount_cents: 15512, incurred_on: "2026-11-23", recurrence: "one_off", recurrence_end_on: null, is_acquisition_cost: null, paid_on: "2026-11-23", paid_method: "card" });
  expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining("/api/app/accounting/expenses/e9"), expect.objectContaining({ method: "PATCH" }));
  fetchSpy.mockRestore();
});

// ─── G3e ───────────────────────────────────────────────────────────────────────────────────────
test("profit & loss rolls the cost lines up into the board's categories, in whole dollars", async () => {
  const line = (over: Partial<PnlSummary["lines"]["acquisition"][number]>) => ({ section: "acquisition" as const, entryType: "lead_cost", sourceType: "vendor" as const, sourceId: "v1", sourceName: null, amountCents: -1000000, entries: 3, ...over });
  serve({
    "/api/app/accounting/pnl/drill?view=summary&kind=month": {
      ...pnl, splitPeople: 6,
      lines: {
        in: [],
        acquisition: [line({}), line({ sourceId: "v2", amountCents: -1141000 })],
        splits: [{ section: "splits", entryType: "producer_split", sourceType: null, sourceId: null, sourceName: null, amountCents: -1824000, entries: 6 }],
        overhead: [
          { section: "overhead", entryType: "expense", sourceType: "expense_category", sourceId: null, sourceName: "telephony", amountCents: -288000, entries: 2 },
          { section: "overhead", entryType: "expense", sourceType: "expense_category", sourceId: null, sourceName: "office", amountCents: -160550, entries: 4 },
          { section: "overhead", entryType: "tool_subscription", sourceType: null, sourceId: null, sourceName: null, amountCents: -100000, entries: 1 },
          { section: "overhead", entryType: "expense", sourceType: "expense_category", sourceId: null, sourceName: "software", amountCents: -62000, entries: 1 },
        ],
      },
    },
  });
  await render(<PnlScreen />);
  expect(await screen.findByText("Leads")).toBeOnTheScreen();
  expect(screen.getByText("2 vendors")).toBeOnTheScreen();
  expect(screen.getByText("$21,410")).toBeOnTheScreen();
  expect(screen.getByText("Team pay")).toBeOnTheScreen();
  expect(screen.getByText("6 people")).toBeOnTheScreen();
  expect(screen.getByText("Dialer and phone lines")).toBeOnTheScreen();
  expect(screen.getByText("Office and equipment")).toBeOnTheScreen();
  expect(screen.getByText("$1,606")).toBeOnTheScreen();
  // Software is the expense category and the tool subscriptions together.
  expect(screen.getByText("$1,620")).toBeOnTheScreen();
  expect(screen.getByText(" vs October at this point", { exact: false })).toBeOnTheScreen();
  expect(screen.queryByText(/Tax summaries/)).toBeNull();
});
