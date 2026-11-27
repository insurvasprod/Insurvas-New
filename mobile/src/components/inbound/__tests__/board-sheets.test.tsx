import { render, screen, userEvent, waitFor } from "@testing-library/react-native";

import InboundTeam from "@/app/call/team";
import { CorrectSheet } from "../correct-sheet";
import { HandoffSheet } from "../handoff-sheet";
import { TransferDetails } from "../transfer-details";
import type { PanelField, VerificationPanel } from "../types";

/**
 * Boards C1b · Transfer details, C1c · Inbound team, C4b · Offer a handoff and C5 · Correct a field, as
 * drawn on 2026-11-26: every figure from the server's answer, nothing the server did not send.
 */
const mockApi = jest.fn();
jest.mock("@/lib/session", () => ({ useSession: () => ({ api: mockApi, me: { user: { id: "jr" }, role: "producer" } }) }));
jest.mock("expo-router", () => ({ router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true } }));

beforeEach(() => mockApi.mockReset());

test("C1b: three ticks, the duplicate named, and the partner's own words under its name", async () => {
  mockApi.mockImplementation(async (path: string) => {
    if (path.startsWith("/api/app/inbound/screening")) return { steps: [{ key: "tenant_dnc", label: "", state: "passed" }, { key: "dnc_registry", label: "", state: "passed" }, { key: "duplicate", label: "", state: "match" }], checked: true, summary: "", checkedAt: null, warning: null };
    if (path.startsWith("/api/app/inbound?")) return { items: [{ id: "w1", leadId: "l1", customer: "Walter Brooks", age: "66", state: "GA", partnerName: "Summit Media", productLine: "final_expense", waitSeconds: 21, status: "unclaimed", screeningOutcome: null, duplicateWarning: true, preflight: { status: "new_household" } }] };
    if (path.startsWith("/api/app/inbound/caller")) return { leadId: "l1", notes: [], calls: null, transfers: 1, consent: { provider: "summit", status: "pending", consentAt: null, capturedAt: null }, partnerNote: "Has a policy that lapses next month, wants to compare.", duplicate: { leadId: "l0", name: "Walter Brooks", phone: "4785550133", lastContact: { at: "2026-10-04T15:00:00Z", by: "Sam Lee" } } };
    throw new Error(`unexpected ${path}`);
  });
  await render(<TransferDetails item={{ id: "w1", customer: "Walter Brooks", age: "66", productLine: "final_expense", partnerName: "Summit Media", state: "GA", waitSeconds: 21 }} wait={21} readOnly={false} busy={false} onClaim={jest.fn()} onClose={jest.fn()} />);
  expect(await screen.findByText("Walter Brooks, (478) 555-0133, Contacted 4 Oct by Sam Lee")).toBeOnTheScreen();
  expect(screen.getByText("From Summit Media")).toBeOnTheScreen();
  expect(screen.getByText("“Has a policy that lapses next month, wants to compare.”")).toBeOnTheScreen();
  expect(screen.getAllByTestId(/^tick-/).map((t) => t.props.testID)).toEqual(["tick-dnc", "tick-consent", "tick-dup"]);
});

test("C1c: who is taking calls, longest waiting first, and no rotation the server does not have", async () => {
  mockApi.mockResolvedValue({
    ownStatus: "ready",
    onCalls: [{ id: "c", customer: "X", agentId: "ak", agentName: "Ava Kim", startedAt: new Date(Date.now() - 372_000).toISOString(), productLine: "final_expense", state: "GA", buffer: { userId: "lp", name: "Lena Park" } }],
    members: [
      { id: "jr", name: "Jordan Reyes", role: "producer", availability: "ready", away: false, lastSeenAt: null, statusChangedAt: new Date(Date.now() - 60_000).toISOString(), call: null, lastCall: null, supporting: false },
      { id: "sl", name: "Sam Lee", role: "producer", availability: "ready", away: false, lastSeenAt: null, statusChangedAt: new Date(Date.now() - 180_000).toISOString(), call: null, lastCall: null, supporting: false },
      { id: "lp", name: "Lena Park", role: "assistant", availability: "on_call", away: false, lastSeenAt: null, statusChangedAt: null, call: null, lastCall: null, supporting: true },
      { id: "nw", name: "Nia Watts", role: "producer", availability: "off", away: false, lastSeenAt: null, statusChangedAt: null, call: null, lastCall: null, supporting: false },
    ],
  });
  await render(<InboundTeam />);
  expect(await screen.findByText("Taking calls · 2")).toBeOnTheScreen();
  expect(screen.getByText("Not taking calls · 2")).toBeOnTheScreen();
  expect(screen.getByText("Jordan Reyes (you)")).toBeOnTheScreen();
  expect(screen.getByText("Verifying for Ava")).toBeOnTheScreen();
  expect(screen.getByText("Off today")).toBeOnTheScreen();
  expect(screen.queryByText("Next")).not.toBeOnTheScreen();
});

test("C4b: the agents licensed in the caller's state, under the qualifier", async () => {
  mockApi.mockImplementation(async (path: string) => {
    if (path.startsWith("/api/app/inbound/handoff")) return { canOffer: true, licensedAgents: [{ id: "ak", name: "Ava Kim", role: "producer" }, { id: "jr", name: "Jordan Reyes", role: "producer" }, { id: "tb", name: "Tom Baker", role: "producer" }], licensedStates: { ak: ["GA"], jr: ["GA"], tb: ["FL"] } };
    if (path === "/api/app/agent-floor") return { ownStatus: "ready", onCalls: [], members: [{ id: "jr", name: "Jordan Reyes", role: "producer", availability: "ready", away: false, lastSeenAt: null, statusChangedAt: null, call: null, lastCall: null, supporting: false }] };
    throw new Error(`unexpected ${path}`);
  });
  await render(<HandoffSheet customer="Nora Bell" workItemId="w1" leadId="l1" checked={9} total={12} state="GA" productLine="final_expense" onClose={jest.fn()} onOffered={jest.fn()} />);
  expect(await screen.findByText("Licensed in Georgia for final expense, ready now")).toBeOnTheScreen();
  expect(screen.getByText("Jordan Reyes")).toBeOnTheScreen();
  expect(screen.queryByText("Tom Baker")).not.toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Offer to Jordan" })).toBeOnTheScreen();
  expect(screen.getByText("Jordan sees 9 of 12 checks done before accepting.")).toBeOnTheScreen();
});

test("C5: the beneficiary is corrected as one — name, relationship (a dropdown) and share — each part saved", async () => {
  const user = userEvent.setup();
  const f = (field_key: string, label: string, type: PanelField["type"] = "text", options: string[] = []): PanelField => ({ field_key, label, type, options, is_required: true, is_visible: true, state: "outstanding", old_value: null, new_value: null, confirmed_at: null });
  const panel: VerificationPanel = {
    session: { id: "s", progress_percentage: 0, completed_at: null, started_at: "2026-11-24T14:00:00Z" },
    workItem: { id: "w1", leadId: "l1", productLine: "final_expense" },
    lead: { id: "l1", values: { beneficiary: "Karen King", beneficiary_relationship: "Daughter", beneficiary_share: "100" } },
    template: { product_name: "Final expense" },
    sections: [{ section_key: "b", label: "B", sort_order: 1, fields: [f("beneficiary", "Full name"), f("beneficiary_relationship", "Relationship", "single_select", ["Daughter", "Son", "Spouse"]), f("beneficiary_share", "Share")] }],
    requiredCount: 3, visibleCount: 3, sensitiveKeys: [],
  };
  mockApi.mockResolvedValue({ panel });
  const onSaved = jest.fn();
  await render(<CorrectSheet field={panel.sections[0].fields[0]} panel={panel} workItemId="w1" onClose={jest.fn()} onSaved={onSaved} />);
  expect(screen.getByText("Correct the beneficiary")).toBeOnTheScreen();
  expect(screen.getByText("Karen King · Daughter · 100")).toBeOnTheScreen();
  await user.clear(screen.getByTestId("correct-input-beneficiary"));
  await user.type(screen.getByTestId("correct-input-beneficiary"), "Karen L. Whitaker");
  await user.press(screen.getByRole("button", { name: "Relationship: Daughter" }));
  await user.press(screen.getByTestId("correct-option-Son"));
  await user.press(screen.getByRole("button", { name: "Save correction" }));
  await waitFor(() => expect(onSaved).toHaveBeenCalled());
  // Only the parts that changed, in template order; the share was left alone.
  expect(mockApi.mock.calls.map(([, i]) => i.body)).toEqual([
    { work_item_id: "w1", field_key: "beneficiary", state: "corrected", value: "Karen L. Whitaker" },
    { work_item_id: "w1", field_key: "beneficiary_relationship", state: "corrected", value: "Son" },
  ]);
});
