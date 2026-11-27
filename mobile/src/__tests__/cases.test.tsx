import { render, screen, userEvent, within } from "@testing-library/react-native";

import PendingCases from "@/app/cases";
import CaseDetail from "@/app/cases/[caseId]";
import SendScan from "@/app/cases/[caseId]/scan";

/**
 * Board E5, E6, E6b. Pending cases reads GET /api/app/pending + /api/app/applications and opens a case;
 * the case reads its view and timeline and offers the camera on a document requirement; the scan
 * screen sends the pages in order, one multipart request a page, to the requirement. Writes never leave the test.
 */
const mockApi = jest.fn();
const mockRefresh = jest.fn();
const mockPush = jest.fn();
const mockBack = jest.fn();
const mockTake = jest.fn();
let mockParams: Record<string, string> = {};
jest.mock("expo-router", () => ({ router: { push: (...a: unknown[]) => mockPush(...a), back: () => mockBack() }, useLocalSearchParams: () => mockParams }));
jest.mock("@/lib/session", () => ({ useSession: () => ({ api: mockApi, refreshToken: mockRefresh, me: { role: "producer" } }) }));
jest.mock("expo-image-picker", () => ({}));
jest.mock("@/components/cases/capture", () => ({ ...jest.requireActual("@/components/cases/capture"), takePage: (...a: unknown[]) => mockTake(...a) }));

const pending = {
  requirements: [
    { id: "r1", applicationId: "a1", caseId: "c1", clientName: "George Patel", carrierName: "Corebridge", kind: "aps", description: "Dr. Amin, Savannah Heart", waitingOn: "client", status: "open", raisedAt: "2026-11-19", dueAt: null, daysOpen: 6, ageing: "amber" },
  ],
  counteroffers: [],
};
const applications = { applications: [
  { caseId: "c1", applicationId: "a1", leadId: "l1", clientName: "George Patel", carrierName: "Corebridge", productLabel: "SIWL", status: "pending_carrier", outcome: null, submittedAt: "2026-11-13T15:00:00Z", closedAt: null, updatedAt: "2026-11-19T15:00:00Z" },
  { caseId: "c2", applicationId: "a2", leadId: "l2", clientName: "Shirley Adams", carrierName: "Royal Neighbors", productLabel: null, status: "submitted", outcome: null, submittedAt: "2026-11-19T15:00:00Z", closedAt: null, updatedAt: "2026-11-19T15:00:00Z" },
] };
const caseView = {
  caseId: "c1", leadId: "l1", clientName: "George Patel", clientPhone: "9125550100",
  attempts: [{
    id: "a1", attemptNo: 1, status: "pending_carrier", outcome: null, carrierName: "Corebridge", productLabel: "SIWL", selectedQuoteId: "q1",
    quotes: [{ id: "q1", carrierName: "Corebridge", productLabel: "SIWL", faceAmountCents: 2_000_000, monthlyPremiumCents: 7140, status: "selected" }],
    requirements: [
      { id: "r1", applicationId: "a1", kind: "aps", description: "Dr. Amin, Savannah Heart", waitingOn: "client", status: "open", raisedAt: "2026-11-19", dueAt: null },
      { id: "r2", applicationId: "a1", kind: "phone_interview", description: "", waitingOn: "client", status: "open", raisedAt: "2026-11-19", dueAt: null },
    ],
    counteroffers: [], submissions: [{ id: "s1", carrierReference: "CB-4471902", policyNumber: null, submittedAt: "2026-11-13T15:00:00Z" }], payment: null, welcomePack: null,
  }],
};
const timeline = { events: [
  { id: "e1", at: "2026-11-19T15:00:00Z", title: "Corebridge asked for: Physician statement (APS)", by: "Jordan R.", detail: null, attemptNo: 1 },
  { id: "e2", at: "2026-11-13T15:00:00Z", title: "Submitted to Corebridge · CB-4471902", by: "Jordan R.", detail: null, attemptNo: 1 },
] };

beforeEach(() => {
  mockApi.mockReset(); mockRefresh.mockReset(); mockPush.mockReset(); mockBack.mockReset(); mockTake.mockReset(); mockParams = {};
  mockApi.mockImplementation(async (path: string) => {
    if (path === "/api/app/pending") return pending;
    if (path === "/api/app/applications") return applications;
    if (path === "/api/app/applications/cases/c1") return caseView;
    if (path === "/api/app/applications/cases/c1/timeline") return timeline;
    throw new Error(`unexpected ${path}`);
  });
});

test("E5: needs you first, then what moves at the carrier; a row opens its case on that requirement", async () => {
  const user = userEvent.setup();
  await render(<PendingCases />);
  const row = await screen.findByTestId("case-row-req-r1");
  expect(within(row).getByText("Needs a doc")).toBeOnTheScreen();
  expect(screen.getByText("Moving at the carrier")).toBeOnTheScreen();
  // George needs a doc, so only Shirley is "at the carrier".
  expect(screen.getByTestId("case-row-app-a2")).toBeOnTheScreen();
  expect(screen.queryByTestId("case-row-app-a1")).toBeNull();
  await user.press(row);
  expect(mockPush).toHaveBeenCalledWith({ pathname: "/cases/[caseId]", params: { caseId: "c1", requirement: "r1" } });

  await user.press(screen.getByRole("tab", { name: /At carrier/ }));
  expect(screen.queryByTestId("case-row-req-r1")).toBeNull();
  expect(screen.getByTestId("case-row-app-a2")).toBeOnTheScreen();
});

test("E6: the requirement, where it is, what is still to come; the camera's page opens the send screen", async () => {
  mockParams = { caseId: "c1", requirement: "r1" };
  mockTake.mockResolvedValue({ uri: "file:///p1.jpg", name: "p1.jpg", type: "image/jpeg" });
  const user = userEvent.setup();
  await render(<CaseDetail />);
  expect(await screen.findByText("Doctor’s records (APS)")).toBeOnTheScreen();
  // The premium keeps its cents (board E6 "$71.40/mo").
  expect(screen.getByText(/Corebridge SIWL · \$20,000 · \$71\.40\/mo/)).toBeOnTheScreen();
  // The reference, in mono under the name (no longer repeated under Still to come).
  expect(screen.getAllByText("CB-4471902")).toHaveLength(1);
  expect(screen.getByText("Corebridge asked for: Physician statement (APS)")).toBeOnTheScreen();
  // Still to come, as the board names it: the phone interview the carrier asked for, then policy delivery.
  expect(screen.getByText("Not done yet")).toBeOnTheScreen();
  expect(screen.getByText("Policy delivery")).toBeOnTheScreen();
  expect(screen.getByText("After issue")).toBeOnTheScreen();
  // A phone interview cannot be scanned: no camera on that card, only the call.
  expect(screen.queryByTestId("scan-r2")).toBeNull();
  expect(screen.getByTestId("call-r2")).toBeOnTheScreen();

  await user.press(screen.getByTestId("scan-r1"));
  expect(mockPush).toHaveBeenCalledWith({ pathname: "/cases/[caseId]/scan", params: { caseId: "c1", attempt: "a1", requirement: "r1", page: "file:///p1.jpg", name: "p1.jpg", type: "image/jpeg" } });
});

describe("E6b", () => {
  let fetchSpy: jest.SpyInstance;
  let append: jest.SpyInstance;
  const ok = { ok: true, status: 201, json: async () => ({ stored: 1 }) } as Response;
  /** The appends of each request, a file read as its uri (Node's FormData turns React Native's {uri, name, type} into text). */
  const appendsPer = (n: number) => {
    const all = append.mock.calls.map(([k, v]) => [k, typeof v === "object" ? (v as { uri: string }).uri : v]);
    const out: unknown[][][] = [];
    for (const a of all) { if (a[0] === "file") out.push([]); out[out.length - 1].push(a); }
    expect(out).toHaveLength(n);
    return out;
  };
  beforeEach(() => {
    mockParams = { caseId: "c1", attempt: "a1", requirement: "r1", page: "file:///p1.jpg", name: "p1.jpg", type: "image/jpeg" };
    mockRefresh.mockResolvedValue("app-token");
    fetchSpy = jest.spyOn(globalThis, "fetch");
    append = jest.spyOn(FormData.prototype, "append");
  });
  afterEach(() => { fetchSpy.mockRestore(); append.mockRestore(); });

  test("pages in order go one a request to the requirement, the note with the last, each with the app's Bearer token", async () => {
    mockTake.mockResolvedValue({ uri: "file:///p2.jpg", name: "p2.jpg", type: "image/jpeg" });
    fetchSpy.mockResolvedValue(ok);
    const user = userEvent.setup();
    await render(<SendScan />);
    expect(await screen.findByText("Corebridge · requirement APS · CB-4471902")).toBeOnTheScreen();
    await user.press(screen.getByTestId("add-page"));
    expect(await screen.findByTestId("page-2")).toBeOnTheScreen();
    await user.type(screen.getByTestId("scan-note"), "Records from 2023–2026");
    await user.press(screen.getByRole("button", { name: "Send 2 pages to Corebridge" }));

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    for (const [url, init] of fetchSpy.mock.calls as [string, RequestInit & { headers: Record<string, string> }][]) {
      expect(url).toMatch(/\/api\/app\/applications\/attempts\/a1\/requirements\/r1\/documents$/);
      expect(init.method).toBe("POST");
      expect(init.headers.authorization).toBe("Bearer app-token");
    }
    expect(appendsPer(2)).toEqual([
      [["file", "file:///p1.jpg"], ["page", "1"], ["pages", "2"]],
      [["file", "file:///p2.jpg"], ["page", "2"], ["pages", "2"], ["note", "Records from 2023–2026"]],
    ]);
    expect(mockBack).toHaveBeenCalled();
  });

  test("a refusal is said in the server's words and the pages stay", async () => {
    fetchSpy.mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: "That requirement is already closed.", code: "REQUIREMENT_CLOSED" }) } as unknown as Response);
    const user = userEvent.setup();
    await render(<SendScan />);
    await user.press(await screen.findByRole("button", { name: "Send 1 page to Corebridge" }));
    expect(await screen.findByText("That requirement is already closed.")).toBeOnTheScreen();
    expect(screen.getByTestId("page-1")).toBeOnTheScreen();
    expect(mockBack).not.toHaveBeenCalled();
  });

  test("a dropped signal mid-send keeps the pages; the retry sends only the pages the server doesn't have", async () => {
    mockTake.mockResolvedValue({ uri: "file:///p2.jpg", name: "p2.jpg", type: "image/jpeg" });
    fetchSpy.mockResolvedValueOnce(ok).mockRejectedValueOnce(new TypeError("Network request failed"));
    const user = userEvent.setup();
    await render(<SendScan />);
    await user.press(await screen.findByTestId("add-page"));
    await screen.findByTestId("page-2");
    await user.press(screen.getByRole("button", { name: "Send 2 pages to Corebridge" }));
    expect(await screen.findByText("No connection. Check your signal and try again.")).toBeOnTheScreen();
    expect(mockBack).not.toHaveBeenCalled();
    fetchSpy.mockResolvedValue(ok);
    append.mockClear();
    await user.press(screen.getByRole("button", { name: "Send 2 pages to Corebridge" }));
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(appendsPer(1)).toEqual([[["file", "file:///p2.jpg"], ["page", "2"], ["pages", "2"]]]);
    expect(mockBack).toHaveBeenCalled();
  });
});
