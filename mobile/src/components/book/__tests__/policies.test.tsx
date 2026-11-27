import { render, screen, userEvent, waitFor } from "@testing-library/react-native";

import { PoliciesScreen } from "../policies";
import type { BookPage, BookRow } from "../types";

/**
 * Board F1: the web's book, cut by the board's chips and searched on the server (name, policy number or phone).
 * The list never carries a client's contact detail, and each row opens the phone's policy page.
 */
const mockApi = jest.fn();
jest.mock("@/lib/session", () => ({ useSession: () => ({ api: mockApi }) }));
const mockPush = jest.fn();
jest.mock("expo-router", () => ({ router: { push: (...a: unknown[]) => mockPush(...a), back: jest.fn() } }));

const row = (over: Partial<BookRow> = {}): BookRow => ({
  carrierId: "c0000000-0000-4000-8000-000000000001", carrierName: "American Amicable", policyNumber: "0119990312", clientName: "Maria Alvarez",
  premiumCents: 4120, premiumMode: "monthly", health: { label: "Paid to Dec 3", tone: "good" }, opens: "policy", webPath: null, ...over,
});
const page = (rows: BookRow[], over: Partial<BookPage> = {}): BookPage => ({
  ok: true, rows, counts: { all: 3, inforce: 2, pending: 1, lapsed: 0, chargedback: 1, behind: 1 }, total: rows.length, offset: 0, next: null, available: true, moneyOk: true, scoped: false, ...over,
});

beforeEach(() => { mockApi.mockReset(); mockPush.mockReset(); });

test("shows the in-force book with the web's health chip, and no contact detail", async () => {
  mockApi.mockResolvedValue(page([row(), row({ policyNumber: "MO-87004213", carrierName: "Mutual of Omaha", clientName: "Ruth Alva", premiumCents: 3890, health: { label: "1 payment behind", tone: "warning" } })]));
  await render(<PoliciesScreen />);
  expect(await screen.findByText("Maria Alvarez")).toBeOnTheScreen();
  expect(mockApi).toHaveBeenCalledWith("/api/app/policy-book?chip=inforce");
  expect(screen.getByText("1 payment behind")).toBeOnTheScreen();
  // The mode is said on the first row only, as drawn.
  expect(screen.getByText(/American Amicable · \$41\.20\/mo/)).toBeOnTheScreen();
  expect(screen.getByText(/Mutual of Omaha · \$38\.90$/)).toBeOnTheScreen();
  // The board's four chips, with the server's counts.
  expect(screen.getByText("Pending")).toBeOnTheScreen();
  expect(screen.getByText("Charged back")).toBeOnTheScreen();
  expect(screen.queryByText("Behind")).toBeNull();
  expect(screen.queryByText(/\(\d{3}\)|@/)).toBeNull();
});

test("searching asks the server (name, policy number or phone) and a row opens its policy", async () => {
  mockApi.mockResolvedValue(page([row()]));
  const user = userEvent.setup();
  await render(<PoliciesScreen />);
  await screen.findByText("Maria Alvarez");
  await user.type(screen.getByTestId("book-search"), "5550142");
  await waitFor(() => expect(mockApi).toHaveBeenCalledWith("/api/app/policy-book?q=5550142&chip=inforce"), { timeout: 2000 });
  await user.press(screen.getByTestId("book-row-0119990312"));
  expect(mockPush).toHaveBeenCalledWith({ pathname: "/book/[carrierId]/[policyNumber]", params: { carrierId: "c0000000-0000-4000-8000-000000000001", policyNumber: "0119990312" } });
});

test("tapping the chosen chip again shows every policy", async () => {
  mockApi.mockResolvedValue(page([row()]));
  const user = userEvent.setup();
  await render(<PoliciesScreen />);
  await screen.findByText("Maria Alvarez");
  await user.press(screen.getByText("In force"));
  await waitFor(() => expect(mockApi).toHaveBeenLastCalledWith("/api/app/policy-book?"));
});

test("the sliders action picks a chip, or every policy", async () => {
  mockApi.mockResolvedValue(page([row()]));
  const user = userEvent.setup();
  await render(<PoliciesScreen />);
  await screen.findByText("Maria Alvarez");
  await user.press(screen.getByLabelText("Show"));
  await user.press(await screen.findByText("Charged back · 1"));
  await waitFor(() => expect(mockApi).toHaveBeenLastCalledWith("/api/app/policy-book?chip=chargedback"));
});

test("a policy entered by hand opens on the computer", async () => {
  mockApi.mockResolvedValue(page([row({ carrierId: "hand:aetna", opens: "computer", webPath: "/app/policies/abc" })]));
  const user = userEvent.setup();
  await render(<PoliciesScreen />);
  await user.press(await screen.findByTestId("book-row-0119990312"));
  expect(mockPush).toHaveBeenCalledWith(expect.objectContaining({ pathname: "/computer", params: expect.objectContaining({ path: "/app/policies/abc" }) }));
});

test("more pages load under the first", async () => {
  mockApi.mockImplementation(async (path: string) => (path.includes("offset=60")
    ? page([row({ policyNumber: "TA-61200442", clientName: "Vernon Hayes" })], { offset: 60, next: null, total: 61 })
    : page([row()], { next: 60, total: 61 })));
  const user = userEvent.setup();
  await render(<PoliciesScreen />);
  await user.press(await screen.findByTestId("book-more"));
  expect(await screen.findByText("Vernon Hayes")).toBeOnTheScreen();
  expect(screen.getByText("Maria Alvarez")).toBeOnTheScreen();
});

test("a failed read says so with the server's words", async () => {
  mockApi.mockRejectedValue(new Error("The book could not be loaded"));
  await render(<PoliciesScreen />);
  expect(await screen.findByText("The book could not be loaded")).toBeOnTheScreen();
});
