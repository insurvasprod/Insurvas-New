import { render, screen, userEvent } from "@testing-library/react-native";

import { CheckNumberScreen, ConsentScreen, LicencesScreen } from "../compliance-screens";
import { ComplaintScreen, ComplaintsScreen } from "../complaints-screens";
import { PartnerScreen } from "../partner-screen";
import { ProducerScreen } from "../producer-screen";
import { ActivityScreen, CallbacksKeptScreen, PartnerQualityScreen, RetentionScoreScreen, SalesScreen } from "../report-screens";
import { ReportsScreen } from "../reports-screen";
import { TeamTab } from "../team-tab";
import type { Complaint, ProducerScore } from "../types";
import { ApiError } from "@/lib/api";

/**
 * Board section 09 drawn from mocked answers of the routes each screen reads. Writes (reassign, log a reply, the
 * number check's POST) go only to the mocked api, never a server.
 */
const mockApi = jest.fn();
const mockPush = jest.fn();
let mockMe: { role: string; memberRole: string } = { role: "owner", memberRole: "owner" };
jest.mock("@/lib/session", () => ({ useSession: () => ({ api: mockApi, me: { ...mockMe, user: { id: "me", email: "me@x.test", name: "Dana Ellery" }, tenant: { id: "t", name: "E&F", status: "active", plan_code: null }, agencyTitle: null, roles: [mockMe.role] } }) }));
jest.mock("expo-router", () => ({ router: { push: (...a: unknown[]) => mockPush(...a), back: jest.fn() }, useLocalSearchParams: () => ({}) }));

/** A day `n` days from today on this machine's own calendar (the screens count days in local time). */
const localDay = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

beforeEach(() => { mockApi.mockReset(); mockPush.mockReset(); mockMe = { role: "owner", memberRole: "owner" }; });

const score = (over: Partial<ProducerScore>): ProducerScore => ({
  producerUserId: "u1", name: "Ava Kim", submitted: 21, issued: 11, placed: 9, placement: "82%", m4: { text: "61%" }, chargebackCents: 0, chargebacks: 0, issuedAnnualCents: 1_492_000, ...over,
});
const scores = { available: true, minSample: 10, rows: [score({}), score({ producerUserId: "u2", name: "TOM BAKER", issuedAnnualCents: 504_000, issued: 14, placement: "58%", chargebacks: 2, chargebackCents: -31_000 })] };

test("I1 · the owner's team ranks by issued premium, chargebacks as a chip; a row opens the producer", async () => {
  mockApi.mockResolvedValue(scores);
  const user = userEvent.setup();
  await render(<TeamTab />);
  expect(await screen.findByText("$14,920")).toBeOnTheScreen();
  expect(screen.getByText("$5,040")).toBeOnTheScreen();
  expect(screen.getByText("Tom Baker")).toBeOnTheScreen();
  expect(screen.getByText("2 chargebacks")).toBeOnTheScreen();
  expect(mockApi.mock.calls[0][0]).toMatch(/^\/api\/app\/agency\/scorecards\?from=\d{4}-\d{2}-01&to=/);
  await user.press(screen.getByRole("button", { name: "Ava Kim, $14,920" }));
  expect(mockPush).toHaveBeenCalledWith("/team/u1");
});

test("I1 · a manager sees the same list without money, ranked by policies issued", async () => {
  mockMe = { role: "producer", memberRole: "manager" };
  mockApi.mockResolvedValue(scores);
  await render(<TeamTab />);
  expect(await screen.findByText("14 issued")).toBeOnTheScreen();
  expect(screen.queryByText(/\$/)).not.toBeOnTheScreen();
  expect(screen.queryByText("Issued premium")).not.toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Invite a producer" })).not.toBeOnTheScreen();
});

test("I1 · the team chip picks a manager's team; On the phone now is always offered", async () => {
  mockApi.mockImplementation(async (path: string) => {
    if (path.startsWith("/api/app/agency/scorecards")) return scores;
    if (path === "/api/app/agency/producers") return { schemaPending: false, rows: [
      { id: "p1", userId: "u1", displayName: "Ava Kim", status: "active", role: "producer", hiredOn: null, managerProducerId: null },
      { id: "p2", userId: "u2", displayName: "Tom Baker", status: "active", role: "producer", hiredOn: null, managerProducerId: "p1" },
      { id: "p3", userId: "u3", displayName: "Nia Watts", status: "active", role: "producer", hiredOn: null, managerProducerId: null },
    ] };
    throw new ApiError(403, { error: "Not for you" });
  });
  const user = userEvent.setup();
  await render(<TeamTab />);
  expect(await screen.findByText("$14,920")).toBeOnTheScreen();
  expect(screen.getByTestId("team-on-phone")).toBeOnTheScreen();
  expect(screen.getByText("On the phone now")).toBeOnTheScreen();
  await user.press(screen.getByTestId("team-all"));
  await user.press(await screen.findByText("Ava’s team"));
  expect(await screen.findByText("Tom Baker")).toBeOnTheScreen();
  await user.press(screen.getByTestId("team-on-phone"));
  expect(await screen.findByText("No one is on a call")).toBeOnTheScreen();
  expect(screen.getByText("Who is on a call can’t be read right now.")).toBeOnTheScreen();
});

test("I2 · the month against the producer's goal turns gold past 100%, with licences about to lapse", async () => {
  const soon = localDay(15);
  const month = localDay(0).slice(0, 8);
  mockApi.mockImplementation(async (path: string, init?: { method?: string }) => {
    if (init?.method === "POST") return { channel: { id: "ch1" } };
    if (path.startsWith("/api/app/agency/scorecards")) return { ...scores, issuedDays: { u1: [[`${month}19`, 800_000], [`${month}05`, 692_000]] } };
    if (path === "/api/app/agency/producers") return { schemaPending: false, rows: [{ id: "p1", userId: "u1", displayName: "Ava Kim", status: "active", role: "producer", hiredOn: "2025-03-02" }] };
    if (path === "/api/app/agency/producers/p1") return { id: "p1", userId: "u1", displayName: "Ava Kim", status: "active", hiredOn: "2025-03-02", email: "ava@x.test", phone: null, role: "producer", managerName: "Dana Ellery", isSelf: false };
    if (path === "/api/app/agency/producers/p1/carriers") return { schemaPending: false, rows: [{ carrierId: "c", carrierName: "Mutual of Omaha", appointments: [{ state: "TX", status: "appointed", expiresOn: null }, { state: "FL", status: "appointed", expiresOn: null }] }] };
    if (path.startsWith("/api/app/goals")) return { goal: { state: "set", target: 1_330_000 } };
    if (path === "/api/app/team") return { members: [{ id: "u1", name: "Ava Kim", role: "producer", status: "active", licensedStateExpiries: { TX: soon, FL: "2030-01-01" } }] };
    throw new Error(`unexpected ${path}`);
  });
  const user = userEvent.setup();
  await render(<ProducerScreen userId="u1" />);
  expect(await screen.findByText(/^Goal passed on 19 /)).toBeOnTheScreen();
  expect(mockApi.mock.calls[0][0]).toMatch(/&issued_days=1$/);
  expect(screen.getByLabelText("112%")).toBeOnTheScreen();
  expect(screen.getByText("$14,920 of $13,300 issued annual premium")).toBeOnTheScreen();
  expect(screen.getByText("Producer · reports to Dana Ellery · since Mar 2025")).toBeOnTheScreen();
  expect(screen.getByText("Texas licence")).toBeOnTheScreen();
  expect(screen.getByText("15 days")).toBeOnTheScreen();
  expect(screen.getByText("Mutual of Omaha")).toBeOnTheScreen();
  expect(mockApi).toHaveBeenCalledWith("/api/app/goals?kind=premium&for=user&user=u1");
  // The message button opens (or starts) a direct chat with him.
  await user.press(screen.getByRole("button", { name: "Message Ava Kim" }));
  expect(mockApi).toHaveBeenCalledWith("/api/app/partner-chat", { method: "POST", body: { action: "create_channel", channel_type: "direct", user_ids: ["u1"] } });
  expect(mockPush).toHaveBeenCalledWith("/chat/ch1");
});

test("I2 · the owner sees the goal ring even with no goal set", async () => {
  mockApi.mockImplementation(async (path: string) => (path.startsWith("/api/app/agency/scorecards") ? scores : path.startsWith("/api/app/goals") ? { goal: { state: "none" } } : path === "/api/app/agency/producers" ? { schemaPending: false, rows: [] } : null));
  await render(<ProducerScreen userId="u1" />);
  expect(await screen.findByText("No goal set this month")).toBeOnTheScreen();
  expect(screen.getByText("$14,920 issued annual premium · goals are set on the computer")).toBeOnTheScreen();
});

test("I2 · a manager's producer page has no goal ring and no money", async () => {
  mockMe = { role: "producer", memberRole: "manager" };
  mockApi.mockImplementation(async (path: string) => (path.startsWith("/api/app/agency/scorecards") ? scores : path === "/api/app/agency/producers" ? { schemaPending: false, rows: [] } : null));
  await render(<ProducerScreen userId="u2" />);
  expect(await screen.findByText("Chargebacks")).toBeOnTheScreen();
  expect(screen.getByText("2")).toBeOnTheScreen();
  expect(screen.queryByText(/\$/)).not.toBeOnTheScreen();
  expect(mockApi.mock.calls.some(([p]) => String(p).startsWith("/api/app/goals") || p === "/api/app/team")).toBe(false);
});

test("I3 · one card a report, each with its number; a report the route refuses is left out", async () => {
  mockApi.mockImplementation(async (path: string) => {
    if (path === "/api/app/persistency") return { ok: true, report: { policies: 120, overall: [{ month: 13, eligible: 50, alive: 42, rate: 0.84 }], byCohort: [
      { key: "2025-Q3", label: "Q3 2025", policies: 30, cells: [{ month: 13, eligible: 30, alive: 25, rate: 0.84 }] },
      { key: "2025-Q2", label: "Q2 2025", policies: 20, cells: [{ month: 13, eligible: 20, alive: 17, rate: 0.85 }] },
    ] } };
    if (path.startsWith("/api/app/reports/sales")) return { report: { totals: { submitted: 142 }, trend: { buckets: [{ submitted: 3 }, { submitted: 5 }] } } };
    if (path.startsWith("/api/app/activity")) throw new ApiError(403, { error: "Not for you" });
    if (path === "/api/app/scorecard?kind=retention") return { available: true, month: "2026-11", total: { key: "all", open: 3, saved: 23, lost: 18, closedNoSave: 0, unreachable: 2, rate: 23 / 41 }, reasons: [], people: [] };
    if (path.startsWith("/api/app/partner-quality")) return { summary: { sent: 1000, submitted: 96 }, previous_summary: { sent: 1000, submitted: 88 }, weeks: [], rows: [] };
    if (path.startsWith("/api/app/callbacks")) return { callbacks: [] };
    return null;
  });
  const user = userEvent.setup();
  await render(<ReportsScreen />);
  expect(await screen.findByText("142")).toBeOnTheScreen();
  // Saved of worked (open, saved, lost and closed without a save), as the scorecard's own Worked tile.
  expect(await screen.findByText("23 of 44")).toBeOnTheScreen();
  expect(screen.getByText("56% save rate")).toBeOnTheScreen();
  expect(await screen.findByText("9.6")).toBeOnTheScreen();
  expect(screen.queryByText("Team activity")).not.toBeOnTheScreen();
  expect(await screen.findByText("84%")).toBeOnTheScreen();
  expect(screen.getByText("Book scorecards")).toBeOnTheScreen();
  expect(screen.getByText("↓ 1 pts")).toBeOnTheScreen();
  expect(screen.queryByText("Callbacks kept")).not.toBeOnTheScreen();
  expect(screen.getByText("True CPA, Lead sources, Queue scoring, Hierarchy")).toBeOnTheScreen();
  expect(screen.getByText("Sold per 100 leads, all partners")).toBeOnTheScreen();
  await user.press(screen.getByRole("button", { name: /Sales performance/ }));
  expect(mockPush).toHaveBeenCalledWith("/reports/sales");
});

test("I3 · the calendar picks the period the sales card counts", async () => {
  mockApi.mockImplementation(async (path: string) => (path.startsWith("/api/app/reports/sales") ? { report: { totals: { submitted: 9 }, trend: { buckets: [] } } } : Promise.reject(new ApiError(403, { error: "no" }))));
  const user = userEvent.setup();
  await render(<ReportsScreen />);
  expect(await screen.findByText("Applications this month")).toBeOnTheScreen();
  await user.press(screen.getByRole("button", { name: /^Period:/ }));
  await user.press(await screen.findByText("This quarter"));
  expect(await screen.findByText("Applications this quarter")).toBeOnTheScreen();
});

const salesReport = (days: number) => ({ report: {
  totals: { submitted: 142, issued: { n: 96, d: 142 } }, funnel: { quoted: 402, applied: { n: 142, d: 402 }, submitted: { n: 140, d: 142 }, issued: { n: 96, d: 140 } },
  declines: { total: 9, rows: [{ key: "reason:heart", label: "Heart history in 2 years", total: 5 }, { key: "reason:rx", label: "Prescription check", total: 4 }] },
  timing: { all: { submitToIssueDays: { value: days, n: 96 } } }, trend: { grain: "day", buckets: [] },
  options: { carriers: [{ id: "c1", name: "Mutual of Omaha" }], products: [], producers: [] },
} });

test("I4 · from lead to policy, each bar opening its list; days to issue by month; a decline reason opens its applications", async () => {
  mockApi.mockImplementation(async (path: string) => {
    if (path.includes("days_by_month=7")) return { months: ["May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov"].map((label, i) => ({ key: `m${i}`, label, submitToIssueDays: { value: 14 - i / 2, n: 10 } })) };
    if (path.startsWith("/api/app/true-cpa")) return { totals: { leads_received: 4212, contacted_leads: 1604, quoted_leads: 402, applied_leads: 142, applications: 150, issued_policies: 96 } };
    if (path.startsWith("/api/app/reports/sales")) return salesReport(path.includes(`from=${localDay(0).slice(0, 8)}01`) ? 11.4 : 13.5);
    throw new Error(`unexpected ${path}`);
  });
  const user = userEvent.setup();
  await render(<SalesScreen />);
  expect(await screen.findByText(/^From lead to policy · /)).toBeOnTheScreen();
  expect(screen.getByLabelText("Contacted: 1604, 38%")).toBeOnTheScreen();
  expect(screen.getByLabelText("Issued: 96, 2.3%")).toBeOnTheScreen();
  expect(screen.getByTestId("days-by-month")).toBeOnTheScreen();
  expect(screen.getByText("↓ 2.1 days")).toBeOnTheScreen();
  expect(screen.getByText("Why carriers declined · 9")).toBeOnTheScreen();
  await user.press(screen.getByTestId("funnel-contacted"));
  expect(mockPush.mock.calls[0][0]).toMatch(/^\/reports\/funnel\?stage=contacted&from=\d{4}-\d{2}-01&to=\d{4}-\d{2}-\d{2}&title=Contacted$/);
  await user.press(screen.getByRole("button", { name: /Heart history in 2 years/ }));
  expect(mockPush.mock.calls[1][0]).toMatch(/^\/reports\/declines\?key=reason%3Aheart&from=/);
});

test("I4 · without the lead scorecard the funnel starts at the quote", async () => {
  mockApi.mockImplementation(async (path: string) => {
    if (path.startsWith("/api/app/true-cpa")) throw new ApiError(403, { error: "True CPA is not for a narrowed session" });
    if (path.includes("days_by_month")) return { months: [] };
    return salesReport(11.4);
  });
  await render(<SalesScreen />);
  expect(await screen.findByText(/^From quote to policy · /)).toBeOnTheScreen();
  expect(screen.getByLabelText("Applied: 142, 35.3%")).toBeOnTheScreen();
  expect(screen.queryByTestId("funnel-applied")).not.toBeOnTheScreen();
});

test("I4 · the sliders filter the report by carrier", async () => {
  mockApi.mockImplementation(async (path: string) => (path.startsWith("/api/app/true-cpa") ? { totals: { leads_received: 0, contacted_leads: 0, quoted_leads: 0, applied_leads: 0, applications: 0, issued_policies: 0 } } : path.includes("days_by_month") ? { months: [] } : salesReport(11.4)));
  const user = userEvent.setup();
  await render(<SalesScreen />);
  expect(await screen.findByText("Why carriers declined · 9")).toBeOnTheScreen();
  await user.press(screen.getByRole("button", { name: "Filter the report" }));
  await user.press(await screen.findByTestId("filter-carrier"));
  await user.press(await screen.findByText("Mutual of Omaha"));
  await user.press(await screen.findByRole("button", { name: "Show the report" }));
  expect(mockApi.mock.calls.some(([p]) => String(p).startsWith("/api/app/reports/sales?from=") && String(p).endsWith("&carrier=c1"))).toBe(true);
});

test("I4b · per person dials, contacts and applications; a setter's row is labelled and counts appointments set", async () => {
  const answer = { scorecard: [
    { agent_user_id: "a", agent_name: "Ava Kim", served: 150, clicked: 142, contact_rate_percent: 21.8, callbacks_booked: 0, appointments_booked: 0, applications_started: 5, applications_submitted: 4 },
    { agent_user_id: "b", agent_name: "Lena Park", served: 100, clicked: 96, contact_rate_percent: 21.9, callbacks_booked: 0, appointments_booked: 4, applications_started: 0, applications_submitted: 0 },
  ] };
  mockApi.mockImplementation(async (path: string) => (path === "/api/app/team" ? { members: [{ id: "b", name: "Lena Park", role: "setter", status: "active" }] } : answer));
  await render(<ActivityScreen />);
  expect(await screen.findByText("238")).toBeOnTheScreen();
  expect(screen.getByText("142 dials · 31 contacts · 4 apps")).toBeOnTheScreen();
  expect(await screen.findByText("Lena Park (setter)")).toBeOnTheScreen();
  expect(screen.getByText("96 dials · 21 contacts · 4 set")).toBeOnTheScreen();
  expect(mockApi.mock.calls[0][0]).toMatch(/^\/api\/app\/activity\?from=/);
});

test("I4c · this month's counts, the save rate by reason and by person", async () => {
  mockApi.mockResolvedValue({ available: true, month: "2026-11", total: { key: "all", open: 3, saved: 23, lost: 9, closedNoSave: 6, unreachable: 8, rate: 23 / 32 },
    reasons: [{ key: "bounced_draft", label: "Draft bounced", open: 1, saved: 4, lost: 2, closedNoSave: 0, unreachable: 0, rate: null }],
    people: [{ key: "r", name: "Rosa Cruz", open: 1, saved: 14, lost: 9, closedNoSave: 0, unreachable: 0, rate: 0.61 }] });
  await render(<RetentionScoreScreen />);
  expect(await screen.findByText("41")).toBeOnTheScreen();
  expect(screen.getByText("72% save rate")).toBeOnTheScreen();
  expect(screen.getByText("80% contact rate")).toBeOnTheScreen();
  expect(screen.getByText("This month")).toBeOnTheScreen();
  expect(screen.getByText("Save rate by reason")).toBeOnTheScreen();
  expect(screen.getByText("Draft bounced")).toBeOnTheScreen();
  expect(screen.getByText("4 of 6 saved")).toBeOnTheScreen();
  expect(screen.getByText("61%")).toBeOnTheScreen();
  expect(mockApi).toHaveBeenCalledWith("/api/app/scorecard?kind=retention");
  expect(screen.queryByText(/\$/)).not.toBeOnTheScreen();
});

test("I4c · a retention rep, kept to the ladder's routes, reads the ladder's own scorecard by step", async () => {
  mockMe = { role: "retention", memberRole: "retention" };
  mockApi.mockImplementation(async (path: string) => {
    if (path === "/api/app/scorecard?kind=retention") throw new ApiError(403, { error: "Not for you" });
    return { available: true, days: 90, total: { key: "all", open: 1, saved: 2, lost: 1, closedNoSave: 0, unreachable: 0, rate: null },
      steps: [{ key: "payment_problem", label: "Payment problem", open: 1, saved: 2, lost: 1, closedNoSave: 0, unreachable: 0, rate: null }], people: [] };
  });
  await render(<RetentionScoreScreen />);
  expect(await screen.findByText("Last 90 days")).toBeOnTheScreen();
  expect(screen.getByText("Save rate by step")).toBeOnTheScreen();
  expect(mockApi).toHaveBeenCalledWith("/api/app/retention/cases?scorecard=90");
});

test("I4d · a missed callback this week opens its lead", async () => {
  const at = new Date();
  mockApi.mockResolvedValue({ callbacks: [{ id: "c1", leadId: "lead-1", customerName: "Opal Simms", scheduledAtUtc: new Date(at.getTime() - 2 * 3_600_000).toISOString(), assignedTo: "t", assigneeName: "Tom Baker", status: "missed", completedVia: null, missedAt: at.toISOString() }] });
  const user = userEvent.setup();
  await render(<CallbacksKeptScreen />);
  expect(await screen.findByText("Missed this week · 1")).toBeOnTheScreen();
  await user.press(screen.getByRole("button", { name: /Opal Simms/ }));
  expect(mockPush).toHaveBeenCalledWith("/lead/lead-1");
  expect(screen.queryByText("This week against the seven before")).not.toBeOnTheScreen();
});

test("I4d · with no callbacks booked, an empty state instead of an empty chart", async () => {
  mockApi.mockResolvedValue({ callbacks: [] });
  await render(<CallbacksKeptScreen />);
  expect(await screen.findByText("No callbacks yet")).toBeOnTheScreen();
  expect(screen.queryByText(/Missed this week/)).not.toBeOnTheScreen();
});

test("I4e · partners best first, sold per 100, never spend; every partner opens its page", async () => {
  mockMe = { role: "producer", memberRole: "producer" };
  mockApi.mockResolvedValue({ rows: [
    { partner_id: "apex", partner_name: "Apex Leads", sent: 412, worked: 300, submitted: 41, disqualified: 0, disqualification_rate: 0, previous: { sent: 0, submitted: 0 } },
    { partner_id: "bright", partner_name: "Bright Path Referrals", sent: 62, worked: 50, submitted: 9, disqualified: 2, disqualification_rate: 3, previous: { sent: 0, submitted: 0 } },
  ], summary: { sent: 0, submitted: 0 }, previous_summary: { sent: 0, submitted: 0 }, weeks: [] });
  const user = userEvent.setup();
  await render(<PartnerQualityScreen />);
  expect(await screen.findByText("14.5")).toBeOnTheScreen();
  expect(screen.getByText("Best")).toBeOnTheScreen();
  expect(screen.getByText(/^Sold per 100 leads · /)).toBeOnTheScreen();
  expect(screen.getByText("62 leads · 2 disqualified")).toBeOnTheScreen();
  await user.press(screen.getByRole("button", { name: /Apex Leads/ }));
  expect(mockPush).toHaveBeenCalledWith("/team/partner/apex");
});

test("I5 · a refused number shows every check the server ran, and nothing dials", async () => {
  mockApi.mockRejectedValue(new ApiError(422, { error: "This number is on a DNC list. Dialing is blocked.", code: "dnc_listed", state: "FL", checks: [
    { key: "dnc", label: "National Do Not Call list", result: "Listed", tone: "error", source: "DNC vendor", age: "live", refuses: true },
    { key: "litigator", label: "Known litigator list", result: "Clear", tone: "success", source: "Litigator list", age: "live", refuses: false },
  ] }));
  const user = userEvent.setup();
  await render(<CheckNumberScreen />);
  await user.type(screen.getByLabelText("Phone number"), "8135550199");
  await user.press(screen.getByRole("button", { name: "Check this number" }));
  expect(await screen.findByText("Don’t call this number")).toBeOnTheScreen();
  expect(screen.getByText("Blocked")).toBeOnTheScreen();
  expect(screen.getByLabelText("National Do Not Call list: Listed · DNC vendor")).toBeOnTheScreen();
  expect(mockApi).toHaveBeenCalledWith("/api/app/dial/preflight", { method: "POST", body: { phone: "8135550199" } });
  await user.press(screen.getByRole("button", { name: "Check another" }));
  expect(screen.queryByText("Don’t call this number")).not.toBeOnTheScreen();
});

test("I5b · the certificate behind a number: given, where, IP and the certificate id", async () => {
  mockApi.mockResolvedValue({ hasMore: false, artefacts: [
    { id: "a", leadId: "l", leadName: "Harold Nguyen", leadPhone: "7135550144", provider: "trustedform", certificateId: "9a1f00000000000022c0", status: "claimed", capturedAt: "2026-11-18T21:42:00Z", claimedAt: null, consentTimestamp: null, ip: "73.14.208.91", sourceUrl: "summitquotes.com/term", landingPage: null, vendorName: null,
      consentText: "By clicking Get my quote, I agree that Ellery & Fields may call me.", claimClosesAt: null },
    { id: "b", leadId: "l2", leadName: "Mae Thompson", leadPhone: null, provider: "trustedform", certificateId: null, status: "pending", capturedAt: "2026-11-18T21:42:00Z", claimedAt: null, consentTimestamp: null, ip: null, sourceUrl: null, landingPage: null, vendorName: null,
      consentText: null, claimClosesAt: "2020-01-04T00:00:00Z" },
  ] });
  const user = userEvent.setup();
  await render(<ConsentScreen />);
  expect(await screen.findByText("Consent on file")).toBeOnTheScreen();
  expect(screen.getByText("(713) 555-0144")).toBeOnTheScreen();
  expect(screen.getByText("9a1f…22c0")).toBeOnTheScreen();
  expect(screen.getByText("“By clicking Get my quote, I agree that Ellery & Fields may call me.”")).toBeOnTheScreen();
  expect(screen.queryByTestId("consent-words-b")).not.toBeOnTheScreen();
  expect(screen.getByText("Expired 4 Jan 2020")).toBeOnTheScreen();
  await user.type(screen.getByLabelText("Phone number or name"), "713");
  expect(mockApi).toHaveBeenLastCalledWith("/api/app/consent?words=1&limit=20&search=713");
});

const complaint = (over: Partial<Complaint>): Complaint => ({
  id: "c1", channel: "doi", regulatorState: "TX", receivedAt: new Date(Date.now() - 4 * 86_400_000).toISOString(), receivedVia: "email", complainantName: "Vernon Hayes", phoneDigits: null, policyNumber: "TA-61200442",
  category: "billing", summary: "Says he was charged after cancelling", responseDueAt: new Date(Date.now() + 2 * 86_400_000).toISOString(), respondedAt: null, responseText: null, status: "investigating",
  owner: { id: "tb", name: "Tom Baker" }, dncAddedAt: null, resolvedAt: null, notes: null, aboutAgent: null, countdown: { tone: "red", daysLeft: 2, label: "2 days left" }, ...over,
});

test("I6 · open complaints with their countdown, soonest first; a row opens it", async () => {
  mockApi.mockResolvedValue({ complaints: [complaint({ id: "late", complainantName: null, phoneDigits: "8135550199", countdown: { tone: "calm", daysLeft: 12, label: "" } }), complaint({}),
    complaint({ id: "done", complainantName: "Mae Thompson", summary: "Draft date changed", status: "resolved", resolvedAt: "2026-11-14T10:00:00Z", countdown: { tone: "none", daysLeft: null, label: "" } })] });
  const user = userEvent.setup();
  await render(<ComplaintsScreen />);
  expect(await screen.findByText("2 days left")).toBeOnTheScreen();
  expect(screen.getByText("12 days left")).toBeOnTheScreen();
  expect(screen.getByText("(813) 555-0199")).toBeOnTheScreen();
  expect(screen.getByText(/^Draft date changed · closed 14 Nov/)).toBeOnTheScreen();
  await user.press(screen.getByTestId("complaint-c1"));
  expect(mockPush).toHaveBeenCalledWith("/compliance/complaints/c1");
});

test("I6b · reassign and log a reply go through the record's own PATCH", async () => {
  const team = [{ id: "tb", name: "Tom Baker", role: "producer" }, { id: "sl", name: "Sam Lee", role: "producer" }];
  mockApi.mockImplementation(async (path: string, init?: { method?: string; body?: Record<string, unknown> }) => {
    if (!init) return { complaint: complaint({}), team };
    if (init.body?.owner_user_id) return { complaint: complaint({ owner: { id: "sl", name: "Sam Lee" } }) };
    return { complaint: complaint({ status: "responded", respondedAt: new Date().toISOString(), responseText: String(init.body?.response_text) }) };
  });
  const user = userEvent.setup();
  await render(<ComplaintScreen id="c1" />);
  expect(await screen.findByText("Vernon Hayes")).toBeOnTheScreen();
  expect(screen.getByLabelText("2d")).toBeOnTheScreen();

  await user.press(screen.getByRole("button", { name: "Reassign" }));
  await user.press(await screen.findByRole("button", { name: "Sam Lee" }));
  expect(await screen.findByText("Owned by Sam Lee")).toBeOnTheScreen();
  expect(mockApi).toHaveBeenCalledWith("/api/app/compliance/complaints/c1", { method: "PATCH", body: { owner_user_id: "sl" } });

  await user.press(screen.getByRole("button", { name: "Log a reply" }));
  await user.type(screen.getByLabelText("The reply"), "Refund asked from carrier");
  await user.press(screen.getByRole("button", { name: "Save the reply" }));
  const [, init] = mockApi.mock.calls[mockApi.mock.calls.length - 1];
  expect(init.method).toBe("PATCH");
  expect(init.body).toMatchObject({ response_text: "Refund asked from carrier", status: "responded" });
  expect(typeof init.body.responded_at).toBe("string");
  // The toast, and the reply's line in the log.
  expect(await screen.findAllByText("Reply logged")).toHaveLength(2);
  expect(screen.getByText(/Refund asked from carrier/)).toBeOnTheScreen();
});

test("I6b · the carrier in the sub-line, and the log from the complaint's history", async () => {
  mockApi.mockResolvedValue({ complaint: complaint({}), team: [], carrierName: "Transamerica", history: [
    { at: "2026-11-20T15:00:00Z", by: "Dana Ellery", action: "opened", fields: [] },
    { at: "2026-11-21T15:00:00Z", by: "Dana Ellery", action: "updated", fields: ["owner_user_id"] },
  ] });
  await render(<ComplaintScreen id="c1" />);
  expect(await screen.findByText(/^By email · received .* · Transamerica TA-61200442$/)).toBeOnTheScreen();
  expect(screen.getByText("What they said")).toBeOnTheScreen();
  expect(screen.getByText("Reassigned")).toBeOnTheScreen();
  expect(screen.getByText("Dana · 21 Nov")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "More" })).toBeOnTheScreen();
});

test("I7 · your own licences, appointments by carrier, and for the owner the team's renewals and the agency's licences", async () => {
  const soon = localDay(10);
  mockApi.mockImplementation(async (path: string) => {
    if (path === "/api/app/team") return { members: [{ id: "u9", name: "Sam Lee", role: "producer", status: "active", licensedStateExpiries: { GA: soon } }] };
    if (path === "/api/app/appointment-vault?mine=1") return { carriers: [{ id: "m", name: "Mutual of Omaha" }], licenses: [{ id: "1", state: "TX", expires_at: "2031-01-01", licence_type: "resident" }], appointments: [{ id: "a", carrier_id: "m", state: "TX", status: "active", effective_from: "2026-01-01" }], mine: [{ state: "FL", expiresOn: soon }] };
    throw new Error(`unexpected ${path}`);
  });
  await render(<LicencesScreen />);
  expect(await screen.findByText("Florida")).toBeOnTheScreen();
  expect(screen.getAllByText("10 days")).toHaveLength(2);
  expect(screen.getByText("Mutual of Omaha")).toBeOnTheScreen();
  expect(screen.getByText("Sam Lee")).toBeOnTheScreen();
  expect(screen.getByText("Agency licences")).toBeOnTheScreen();
  expect(screen.getByText("Texas")).toBeOnTheScreen();
});

test("I7 · a producer sees only their own licences, and no Add", async () => {
  mockMe = { role: "producer", memberRole: "producer" };
  mockApi.mockResolvedValue({ carriers: [], licenses: [{ id: "1", state: "TX", expires_at: "2031-01-01" }], appointments: [], mine: [{ state: "GA", expiresOn: null }] });
  await render(<LicencesScreen />);
  expect(await screen.findByText("Georgia")).toBeOnTheScreen();
  expect(screen.queryByText("Texas")).not.toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Add a licence" })).not.toBeOnTheScreen();
  expect(mockApi.mock.calls.some(([p]) => p === "/api/app/team")).toBe(false);
});

const partnerList = { partners: [{ id: "apex", name: "Apex Leads", partner_type: "publisher", status: "active", created_at: "2026-02-03T00:00:00Z", lead_volume_this_month: 412, transfers_this_month: 30, active_term: { payout_model: "per_sale", rate_cents: 9500, rate_pct_bp: null, effective_from: "2026-02-03" } }],
  directoryUsers: [{ user_id: "m", name: "Maya Santos", email: "m@x.test", role: "partner_admin", status: "active", partner_id: "apex" }, { user_id: "o", name: "Other", email: "o@x.test", role: "partner_user", status: "active", partner_id: "other" }] };
const apexQuality = { rows: [{ partner_id: "apex", partner_name: "Apex Leads", partner_type: "publisher", sent: 412, worked: 300, submitted: 41, disqualified: 0, disqualification_rate: 0, previous: { sent: 0, submitted: 0 } }] };

test("I8 · a partner's month, what is owed and when, their deal and people; the chat opens their thread", async () => {
  const due = localDay(8);
  mockApi.mockImplementation(async (path: string) => {
    if (path === "/api/app/partners") return partnerList;
    if (path === "/api/app/partners/apex") return { owedCents: 431_500, dueOn: due, term: { payout_model: "per_submitted_application", rate_cents: 9500, rate_pct_bp: null, effective_from: "2026-02-03" }, threadId: "th1" };
    return apexQuality;
  });
  const user = userEvent.setup();
  await render(<PartnerScreen id="apex" />);
  expect(await screen.findByText("Per submitted application")).toBeOnTheScreen();
  expect(screen.getByText("$95")).toBeOnTheScreen();
  expect(screen.getByText("Sold")).toBeOnTheScreen();
  expect(screen.getByText("10.0 per 100")).toBeOnTheScreen();
  expect(screen.getByText("$4,315")).toBeOnTheScreen();
  expect(screen.getByText(/^Due /)).toBeOnTheScreen();
  expect(screen.getByText("Publisher · since Feb 2026")).toBeOnTheScreen();
  expect(screen.getByText("Maya Santos")).toBeOnTheScreen();
  expect(screen.queryByText("Other")).not.toBeOnTheScreen();
  await user.press(screen.getByRole("button", { name: "Chat with Apex Leads" }));
  expect(mockPush).toHaveBeenCalledWith("/chat/th1");
});

test("I8 · who may not read partner records sees the quality figures only", async () => {
  mockMe = { role: "producer", memberRole: "producer" };
  mockApi.mockImplementation(async (path: string) => (path.startsWith("/api/app/partners") ? Promise.reject(new ApiError(403, { error: "Not for you" })) : apexQuality));
  await render(<PartnerScreen id="apex" />);
  expect(await screen.findByText("10.0 per 100")).toBeOnTheScreen();
  expect(screen.getByText("Publisher")).toBeOnTheScreen();
  expect(screen.queryByText("Owed")).not.toBeOnTheScreen();
  expect(screen.queryByText("Deal")).not.toBeOnTheScreen();
});
