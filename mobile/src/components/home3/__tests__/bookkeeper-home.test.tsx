import { render, screen, userEvent, within } from "@testing-library/react-native";

import { barLabels, waitingRows } from "../bookkeeper-logic";
import { HomeBookkeeper } from "../home-bookkeeper";

/**
 * Board B6 · the bookkeeper's Home, drawn from mocked answers of the routes it reads. Nothing is written: a tap only
 * moves to another screen.
 */
const mockApi = jest.fn();
const mockPush = jest.fn();
jest.mock("@/lib/session", () => ({
  useSession: () => ({ api: mockApi, me: { user: { id: "me", email: "kim@example.test", name: "Kim Books" }, tenant: { id: "t", name: "Ellery & Fields", status: "active", plan_code: null }, role: "bookkeeper", memberRole: "bookkeeper", agencyTitle: null, roles: ["bookkeeper"] } }),
}));
jest.mock("expo-router", () => ({ router: { push: (...a: unknown[]) => mockPush(...a), back: jest.fn() } }));

const NOW = new Date(2026, 10, 20, 15, 0, 0);
const DEPOSITS = "/api/app/accounting/bank?deposits=2026-11&today=2026-11-20";
beforeEach(() => {
  mockApi.mockReset();
  mockPush.mockReset();
  jest.spyOn(Date, "now").mockReturnValue(NOW.getTime());
});
afterEach(() => jest.restoreAllMocks());

const route = (answers: Record<string, unknown>) => async (path: string) => {
  if (path in answers) {
    const a = answers[path];
    if (a instanceof Error) throw a;
    return a;
  }
  throw new Error(`unexpected ${path}`);
};

const week = (from: string, to: string, dollars: number) => ({ from, to, cents: dollars * 100 });
const deposits = { deposits: { month: "2026-11", from: "2026-11-01", through: "2026-11-20", totalCents: 12_140_000, count: 9, weeks: [
  week("2026-11-01", "2026-11-01", 22_000), week("2026-11-02", "2026-11-08", 14_000), week("2026-11-09", "2026-11-15", 31_000),
  week("2026-11-16", "2026-11-20", 54_400),
] } };

test("B6 · four tiles, what waits on you and on others, then this month's deposits by week", async () => {
  mockApi.mockImplementation(route({
    "/api/app/accounting/steps?items=1": { counts: { todo: 3 }, items: [
      { key: "bill", group: "bills", what: "Vendor bill · Apex Leads", detail: "412 leads delivered · matches", amountCents: 1153600, since: null, yours: true, href: "/app/vendor-bills/1" },
      { key: "pay", group: "bank", what: "Bad math · Aflac", detail: "Statement 1 Nov", amountCents: 21400, tone: "bad", since: null, yours: true, href: "/app/bank/payments/9" },
      { key: "disp", group: "bills", what: "Bill disputed · Summit Media", detail: "INV-88", amountCents: 9000, since: null, yours: false, href: "/app/vendor-bills/2" },
    ] },
    "/api/app/carrier-files?missing=1": { ok: true, available: true, missing: [
      { id: "m", carrierId: "c", carrierName: "Corebridge", due: "2026-11-10", daysLate: 6 },
      { id: "n", carrierId: "r", carrierName: "RN", due: "2026-11-12", daysLate: 4 },
    ] },
    "/api/app/discrepancies": { ok: true, available: true, owed: { available: true, totalCents: 391200, count: 3 } },
    [DEPOSITS]: deposits,
  }));
  const user = userEvent.setup();
  await render(<HomeBookkeeper />);

  expect(await screen.findByText("Vendor bill · Apex Leads")).toBeOnTheScreen();
  expect(screen.getByText("Today")).toBeOnTheScreen();
  expect(screen.getByText("November books")).toBeOnTheScreen();
  // Tiles: count, then the money they hold.
  expect(screen.getByRole("button", { name: "To approve: 2" })).toBeOnTheScreen();
  expect(screen.getByText("$11,750 total")).toBeOnTheScreen();
  expect(within(screen.getByTestId("books-short")).getByText("$214")).toBeOnTheScreen();
  expect(await screen.findByText("Corebridge, RN")).toBeOnTheScreen();
  expect(within(screen.getByTestId("books-late")).getByText("2")).toBeOnTheScreen();
  // Pay issues in the money style: the "$" small beside the whole.
  expect(await screen.findByRole("button", { name: "Pay issues: $3,912" })).toBeOnTheScreen();
  expect(within(screen.getByTestId("books-owed")).getByText("3,912")).toBeOnTheScreen();

  // Waiting on you: yours first, then the bill that waits on the vendor.
  const rows = screen.getAllByTestId(/^books-todo-/).map((r) => r.props.testID);
  expect(rows).toEqual(["books-todo-bill", "books-todo-pay", "books-todo-disp"]);
  expect(screen.getByText("Waiting on the vendor · INV-88")).toBeOnTheScreen();

  // Cash this month: one bar a week, the axis as the board draws it, and the month's total.
  expect(await screen.findByText("Cash this month")).toBeOnTheScreen();
  expect(screen.getByTestId("books-cash-bars").props.accessibilityLabel).toBe("Week of Nov 1: $22,000, Week of Nov 2: $14,000, Week of Nov 9: $31,000, Week of Nov 16: $54,400");
  expect(screen.getByText("Deposited")).toBeOnTheScreen();
  expect(screen.getByTestId("books-deposited").props.accessibilityLabel).toBe("$121,400");

  // A web page with no phone screen opens the "works best on a computer" sheet.
  await user.press(screen.getByTestId("books-todo-bill"));
  expect(mockPush).toHaveBeenCalledWith(`/computer?path=${encodeURIComponent("/app/vendor-bills/1")}&title=${encodeURIComponent("Vendor bill · Apex Leads")}`);
  await user.press(screen.getByRole("button", { name: "To approve: 2" }));
  expect(mockPush).toHaveBeenCalledWith("/money");
});

test("B6 · zero is a figure: the four tiles stay, and nothing waiting is one quiet row, not an empty block", async () => {
  mockApi.mockImplementation(route({
    "/api/app/accounting/steps?items=1": { counts: { todo: 0 }, items: [] },
    "/api/app/carrier-files?missing=1": { ok: true, available: true, missing: [] },
    "/api/app/discrepancies": { ok: true, available: true, owed: { available: true, totalCents: 0, count: 0 } },
    [DEPOSITS]: { deposits: { ...deposits.deposits, totalCents: 0, count: 0, weeks: deposits.deposits.weeks.map((w) => ({ ...w, cents: 0 })) } },
  }));
  await render(<HomeBookkeeper />);

  expect(await screen.findByText("Nothing waiting on you")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "To approve: 0" })).toBeOnTheScreen();
  expect(screen.getByText("$0 total")).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Deposits short: 0" })).toBeOnTheScreen();
  expect(await screen.findByRole("button", { name: "Statements late: 0" })).toBeOnTheScreen();
  expect(await screen.findByRole("button", { name: "Pay issues: $0" })).toBeOnTheScreen();
  expect((await screen.findByTestId("books-deposited")).props.accessibilityLabel).toBe("$0");
});

test("B6 · a read that fails keeps its tile with a dash; the deposits card keeps its place", async () => {
  mockApi.mockImplementation(route({
    "/api/app/accounting/steps?items=1": { counts: { todo: 0 }, items: [] },
    "/api/app/carrier-files?missing=1": new Error("no"),
    "/api/app/discrepancies": new Error("no"),
    [DEPOSITS]: new Error("no"),
  }));
  await render(<HomeBookkeeper />);

  expect(await screen.findByText("Nothing waiting on you")).toBeOnTheScreen();
  expect(await screen.findByRole("button", { name: "Statements late: —" })).toBeOnTheScreen();
  expect(await screen.findByRole("button", { name: "Pay issues: unknown" })).toBeOnTheScreen();
  expect(screen.getByText("Deposited")).toBeOnTheScreen();
  expect(screen.queryByTestId("books-cash-bars")).not.toBeOnTheScreen();
});

test("the board's axis: the first, every other one, and always the last", () => {
  const w = (from: string) => ({ from, to: from, cents: 0 });
  expect(barLabels(["2026-11-03", "2026-11-06", "2026-11-10", "2026-11-13", "2026-11-17", "2026-11-20"].map(w))).toEqual(["Nov 3", "", "Nov 10", "", "Nov 17", "Nov 20"]);
  expect(barLabels(["2026-11-01", "2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23"].map(w))).toEqual(["Nov 1", "", "Nov 9", "", "Nov 23"]);
});

test("rows waiting on someone else come after yours", () => {
  const item = (key: string, yours: boolean) => ({ key, group: "bills" as const, what: key, detail: "", amountCents: null, since: null, yours, href: "/" });
  expect(waitingRows([item("a", false), item("b", true)]).map((r) => [r.item.key, r.meta])).toEqual([["b", ""], ["a", "Waiting on the vendor"]]);
});
