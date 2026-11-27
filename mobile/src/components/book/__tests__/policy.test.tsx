import { render, screen, userEvent, waitFor } from "@testing-library/react-native";

import { LedgerScreen } from "../ledger";
import { PolicyScreen } from "../policy";
import type { CarrierPolicy, PolicyAnswer } from "../types";

/**
 * Board F2 and F2b: the web's policy page on the phone — the client as the title, the figures with where each came
 * from, the commission — and calls only through the call sheet (the dialer's server checks), never a number.
 */
const mockApi = jest.fn();
let mockRole = "producer";
jest.mock("@/lib/session", () => ({ useSession: () => ({ api: mockApi, me: { role: mockRole, roles: [mockRole] } }) }));
const mockPush = jest.fn();
jest.mock("expo-router", () => ({ router: { push: (...a: unknown[]) => mockPush(...a), back: jest.fn() }, Stack: { Screen: () => null } }));
jest.mock("expo-clipboard", () => ({ setStringAsync: jest.fn(() => Promise.resolve(true)) }));
jest.mock("@/components/call-sheet", () => {
  const { createElement } = jest.requireActual("react");
  const { Text } = jest.requireActual("react-native");
  return { CallSheet: ({ leadId }: { leadId: string }) => createElement(Text, null, `call sheet for ${leadId}`) };
});

const CARRIER = "c0000000-0000-4000-8000-000000000001";
const said = "Read from AMAM-policies.xlsx, row 88 (file of Nov 14, 2026). Unchanged since the policy first arrived.";
const policy = (over: Partial<CarrierPolicy> = {}): CarrierPolicy => ({
  kind: "policy", title: "Maria Alvarez", carrierName: "American Amicable", product: "Senior Choice", policyNumber: "0119990312",
  health: { label: "Paid to Dec 3", tone: "good" }, statusRaw: "Active", premiumCents: 4120, premiumMode: "monthly", monthlyCents: 4120, faceCents: 1000000,
  issuedOn: "2026-03-02", effectiveDate: "2026-03-03", paidTo: "2026-12-03", monthsPaid: 9, inClawbackWindow: true, clawbackMonths: 12, behind: null,
  next: { label: "Next payment due", date: "2026-12-03", detail: "the paid-to date in the carrier's latest file" },
  draftDay: 3, agentName: "Jordan Reyes", agentCode: "AM123", file: { name: "AMAM-policies.xlsx", date: "2026-11-14", rowNumber: 88 },
  sources: { status: said, premium: said, face: said, issued: said, agent: said, paidTo: said },
  money: {
    available: true, advancedCents: 37080, advancedOn: "2026-03-14", earnedCents: 27810, atRiskCents: 9270, paidToDateCents: 64890,
    lines: [
      { id: "l1", label: "Advance", type: "advance", monthsAdvanced: 9, amountCents: 37080, date: "2026-03-14", fileName: "AMAM statement", upline: false, held: false },
      { id: "l2", label: "Chargeback", type: "chargeback", monthsAdvanced: null, amountCents: -4120, date: "2026-11-14", fileName: "AMAM statement", upline: false, held: true },
    ],
  },
  leadId: "lead-1", caseId: "case-1", beneficiary: "Luis Alvarez · child", draftsCleared: 3,
  expected: [
    { key: "y1", label: "As earned · months 10–12", startsOn: null, amountCents: 12360, kind: "as_earned" },
    { key: "y2", label: "Renewal · year 2", startsOn: "2027-03-03", amountCents: null, kind: "renewal" },
  ],
  split: { agentName: "Jordan Reyes", agentPctBp: 7500, agentCents: 27810, agencyPctBp: 2500, agencyCents: 9270 },
  ...over,
});
const answer = (p: CarrierPolicy, canOpenCase = true): PolicyAnswer => ({ ok: true, policy: p, role: "producer", readOnly: false, canOpenCase });

beforeEach(() => { mockApi.mockReset(); mockPush.mockReset(); mockRole = "producer"; });

test("the client is the title, with the figures and the commission as the web works them out", async () => {
  mockApi.mockResolvedValue(answer(policy()));
  await render(<PolicyScreen carrierId={CARRIER} policyNumber="0119990312" />);
  expect(await screen.findByText("Maria Alvarez")).toBeOnTheScreen();
  expect(mockApi).toHaveBeenCalledWith(`/api/app/policy-book?carrierId=${CARRIER}&policyNumber=0119990312`);
  expect(screen.getByText("Paid to Dec 3")).toBeOnTheScreen();
  expect(screen.getByLabelText("$41.20")).toBeOnTheScreen();
  expect(screen.getByLabelText("$10,000")).toBeOnTheScreen();
  expect(screen.getByText("2 Mar 2026")).toBeOnTheScreen();
  expect(screen.getByText("Month 9 of 12 chargeback window")).toBeOnTheScreen();
  expect(screen.getByText("Last 3 drafts cleared")).toBeOnTheScreen();
  expect(screen.getByText("Luis Alvarez · child")).toBeOnTheScreen();
  expect(screen.getByText("3 Dec")).toBeOnTheScreen();
  expect(screen.getByText("3rd of the month")).toBeOnTheScreen();
  expect(screen.getByText("American Amicable file · 14 Nov")).toBeOnTheScreen();
  expect(screen.getByText("$370.80 · Mar")).toBeOnTheScreen();
  expect(screen.getByText("$278.10")).toBeOnTheScreen();
  expect(screen.getByText("$92.70")).toBeOnTheScreen();
});

test("ⓘ says where the status came from, in the web's words", async () => {
  mockApi.mockResolvedValue(answer(policy()));
  const user = userEvent.setup();
  await render(<PolicyScreen carrierId={CARRIER} policyNumber="0119990312" />);
  await user.press(await screen.findByLabelText("Where status comes from"));
  expect(await screen.findByText("Where the status comes from")).toBeOnTheScreen();
  expect(screen.getByText(said)).toBeOnTheScreen();
});

test("Call goes through the call sheet for the policy's lead; Open the case opens the retention case", async () => {
  mockApi.mockResolvedValue(answer(policy()));
  const user = userEvent.setup();
  await render(<PolicyScreen carrierId={CARRIER} policyNumber="0119990312" />);
  await user.press(await screen.findByTestId("policy-call"));
  expect(await screen.findByText("call sheet for lead-1")).toBeOnTheScreen();
  await user.press(screen.getByTestId("policy-case"));
  expect(mockPush).toHaveBeenCalledWith({ pathname: "/retention/[id]", params: { id: "case-1" } });
});

test("a bookkeeper sees the policy but has no Call and no case (no client contact, no Retention)", async () => {
  mockRole = "bookkeeper";
  mockApi.mockResolvedValue(answer(policy({ caseId: null }), false));
  await render(<PolicyScreen carrierId={CARRIER} policyNumber="0119990312" />);
  expect(await screen.findByText("Maria Alvarez")).toBeOnTheScreen();
  expect(screen.queryByTestId("policy-call")).toBeNull();
  expect(screen.queryByTestId("policy-case")).toBeNull();
});

test("Call and Open the case are always drawn: no lead says why, no case opens a new one for this policy", async () => {
  mockApi.mockResolvedValue(answer(policy({ leadId: null, caseId: null })));
  const user = userEvent.setup();
  await render(<PolicyScreen carrierId={CARRIER} policyNumber="0119990312" />);
  await user.press(await screen.findByTestId("policy-call"));
  expect(await screen.findByText(/No lead is linked to this policy/)).toBeOnTheScreen();
  expect(screen.queryByText(/call sheet for/)).toBeNull();
  await user.press(screen.getByTestId("policy-case"));
  expect(await screen.findByText("New case")).toBeOnTheScreen();
  expect(screen.getByLabelText("Policy")).toHaveDisplayValue("Maria Alvarez · 0119990312 · American Amicable");
  expect(mockPush).not.toHaveBeenCalled();
});

test("the Commission card is read on the page; its lines open from the ••• menu", async () => {
  mockApi.mockResolvedValue(answer(policy()));
  const user = userEvent.setup();
  await render(<PolicyScreen carrierId={CARRIER} policyNumber="0119990312" />);
  await screen.findByText("Maria Alvarez");
  await user.press(screen.getByText("Commission"));
  expect(mockPush).not.toHaveBeenCalled();
  await user.press(screen.getByLabelText("More actions"));
  await user.press(await screen.findByText("Commission ledger"));
  // The sheet slides away first, then the action runs.
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith({ pathname: "/book/[carrierId]/[policyNumber]/ledger", params: { carrierId: CARRIER, policyNumber: "0119990312" } }));
});

test("while behind, the payments behind are said on the figure, not as the chip", async () => {
  mockApi.mockResolvedValue(answer(policy({ health: null, behind: "2 payments behind", next: null, paidTo: "2026-10-03" })));
  await render(<PolicyScreen carrierId={CARRIER} policyNumber="0119990312" />);
  expect(await screen.findByText("2 payments behind")).toBeOnTheScreen();
  expect(screen.getByText("Paid to")).toBeOnTheScreen();
  expect(screen.getByText("3 Oct")).toBeOnTheScreen();
});

test("a policy outside the producer's book says so", async () => {
  const { ApiError } = jest.requireActual("@/lib/api");
  mockApi.mockRejectedValue(new ApiError(404, { error: "This policy is not in your book." }));
  await render(<PolicyScreen carrierId={CARRIER} policyNumber="0119990312" />);
  expect(await screen.findByText("This policy is not in your book")).toBeOnTheScreen();
});

test("F2b lists each posted line with its cents, then the lines still to come, then the split", async () => {
  mockApi.mockResolvedValue(answer(policy()));
  await render(<LedgerScreen carrierId={CARRIER} policyNumber="0119990312" />);
  expect(await screen.findByText("Advance · 9 months")).toBeOnTheScreen();
  expect(screen.getByText("Maria Alvarez · 0119990312")).toBeOnTheScreen();
  expect(screen.getByLabelText("$648.90")).toBeOnTheScreen();
  expect(screen.getByText("Until month 12")).toBeOnTheScreen();
  expect(screen.getByText("American Amicable statement · 14 Mar")).toBeOnTheScreen();
  expect(screen.getByText("−$41.20")).toBeOnTheScreen();
  // No "Held" chip and no footer: the held line says so in its meta.
  expect(screen.queryByText("Held")).toBeNull();
  expect(screen.queryByText("Posting and corrections are on the computer.")).toBeNull();
  expect(screen.getByText("American Amicable statement · 14 Nov · held: its statement doesn’t add up")).toBeOnTheScreen();
  // Still to come: the rest of year one (Expected) and a renewal no rate prices yet.
  expect(screen.getByText("As earned · months 10–12")).toBeOnTheScreen();
  expect(screen.getByText("Expected")).toBeOnTheScreen();
  // Dated as drawn: advanced 9 months on 14 Mar, so month 10 comes with the 14 Dec statement.
  expect(screen.getByText("American Amicable statement · 14 Dec")).toBeOnTheScreen();
  expect(screen.getByText("$123.60")).toBeOnTheScreen();
  expect(screen.getByText("Renewal · year 2")).toBeOnTheScreen();
  expect(screen.getByText("Starts Mar 2027")).toBeOnTheScreen();
  expect(screen.getByText("—")).toBeOnTheScreen();
  // Split: the writing agent's share and the agency's override.
  expect(screen.getByText("Split")).toBeOnTheScreen();
  expect(screen.getByText("75% of advance")).toBeOnTheScreen();
  expect(screen.getByText("$278.10")).toBeOnTheScreen();
  expect(screen.getByText("Agency override")).toBeOnTheScreen();
  expect(screen.getByText("25%")).toBeOnTheScreen();
  expect(screen.getByText("$92.70")).toBeOnTheScreen();
});

test("F2b · a producer sees their own share; the agency's is not shown", async () => {
  mockApi.mockResolvedValue(answer(policy({ split: { agentName: "Jordan Reyes", agentPctBp: 7500, agentCents: 27810, agencyPctBp: 2500, agencyCents: null } })));
  await render(<LedgerScreen carrierId={CARRIER} policyNumber="0119990312" />);
  expect(await screen.findByText("Not shown")).toBeOnTheScreen();
  expect(screen.queryByText("$92.70")).toBeNull();
});
