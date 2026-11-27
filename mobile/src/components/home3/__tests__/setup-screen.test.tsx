import { render, screen, userEvent } from "@testing-library/react-native";

import { inviteMeta, setupRows } from "../setup-logic";
import { SetupScreen } from "../setup-screen";
import type { SetupStep } from "../types";

/**
 * Board B9 · Get set up, drawn from a mocked GET /api/app/setup?phone=1 (the web's checklist plus the phone's facts:
 * the plan's room for people and the agency's licence count) and this phone's notification permission.
 */
const mockApi = jest.fn();
const mockPush = jest.fn();
const mockGranted = jest.fn(async () => ({ granted: true }));
jest.mock("@/lib/session", () => ({ useSession: () => ({ api: mockApi }) }));
jest.mock("expo-router", () => ({ router: { push: (...a: unknown[]) => mockPush(...a), back: jest.fn() } }));
jest.mock("expo-notifications", () => ({ getPermissionsAsync: () => mockGranted() }));
// The Team tab is open to an owner, so the web's invite page maps to it (lib/links.ts).
jest.mock("@/lib/nav", () => ({ currentTabs: () => ["index", "teamtab", "moneytab", "inbox", "menu"] }));

beforeEach(() => { mockApi.mockReset(); mockPush.mockReset(); mockGranted.mockReset(); mockGranted.mockResolvedValue({ granted: true }); });

const step = (key: string, label: string, complete: boolean, extra: Partial<SetupStep> = {}): SetupStep => ({ key, label, path: `/app/${key}`, action: "", why: "", complete, ...extra });
const steps = [
  step("account", "Create your agency", true), step("carriers", "Pick your carriers", true), step("outcomes", "Set your pipelines", true),
  step("disclosures", "Read the disclosures", true), step("team", "Invite your team", false, { minutes: 2 }),
  step("import", "Import your first lead list", false), step("statement", "Upload a carrier statement", false),
  step("queue-sla", "Set how fast transfers must be claimed", false, { optional: true }),
];
const answer = (phone: unknown = { seatsLeft: 3, licences: { count: 0 } }) => ({ audience: "owner", next: null, checklist: { complete: false, completed: 4, skipped: 0, total: 8, steps }, phone });

test("B9 · as drawn: 5 of 9 counting alerts and licences, Done, then Next with the phone's steps first", async () => {
  mockApi.mockResolvedValue(answer());
  const user = userEvent.setup();
  await render(<SetupScreen />);

  expect(await screen.findByLabelText("5 of 9 done")).toBeOnTheScreen();
  expect(mockApi).toHaveBeenCalledWith("/api/app/setup?phone=1");
  expect(screen.getByText("Done")).toBeOnTheScreen();
  expect(screen.getByText("Turn on alerts")).toBeOnTheScreen();
  expect(screen.getByText("Read the disclosures")).toBeOnTheScreen();
  expect(screen.getByText("3 people · takes a minute")).toBeOnTheScreen();
  expect(screen.getByText("Add your licences")).toBeOnTheScreen();
  expect(screen.getByText("Photo of each licence works")).toBeOnTheScreen();
  expect(screen.getAllByLabelText("Opens on a computer")).toHaveLength(2);
  // No "Fine-tune later" group: the board draws none, and optional steps are not counted.
  expect(screen.queryByText("Fine-tune later")).not.toBeOnTheScreen();
  expect(screen.queryByText("Set how fast transfers must be claimed")).not.toBeOnTheScreen();

  // Next's order: Invite your team, Add your licences, then the computer's steps.
  const order = ["setup-team", "setup-licences", "setup-import", "setup-statement"].map((id) => screen.getByTestId(id));
  expect(order).toHaveLength(4);
  await user.press(screen.getByTestId("setup-team"));
  expect(mockPush).toHaveBeenLastCalledWith("/teamtab");
  await user.press(screen.getByTestId("setup-licences"));
  expect(mockPush).toHaveBeenLastCalledWith("/compliance/licences");
  await user.press(screen.getByTestId("setup-import"));
  expect(mockPush).toHaveBeenLastCalledWith(`/computer?path=${encodeURIComponent("/app/import")}&title=${encodeURIComponent("Import your first lead list")}`);
});

test("B9 · alerts off are the first thing to do here; a saved licence is done", async () => {
  mockGranted.mockResolvedValue({ granted: false });
  mockApi.mockResolvedValue(answer({ seatsLeft: null, licences: { count: 2 } }));
  const user = userEvent.setup();
  await render(<SetupScreen />);

  expect(await screen.findByTestId("setup-alerts")).toBeOnTheScreen();
  expect(screen.getByLabelText("5 of 9 done")).toBeOnTheScreen();
  expect(screen.getByText("Add your licences")).toBeOnTheScreen();
  expect(screen.queryByTestId("setup-licences")).not.toBeOnTheScreen();
  expect(screen.getByText("Takes a minute")).toBeOnTheScreen();
  await user.press(screen.getByTestId("setup-alerts"));
  expect(mockPush).toHaveBeenLastCalledWith("/notifications");
});

test("B9 rules · the count, and the invite line from the plan's room", () => {
  const rows = setupRows(steps, null, undefined);
  // Alerts unknown and no licence fact: neither drawn nor counted.
  expect(rows.label).toBe("4 of 7 done");
  expect(rows.next.map((r) => (r.kind === "step" ? r.step.key : r.kind))).toEqual(["team", "import", "statement"]);
  expect(inviteMeta(1)).toBe("1 person · takes a minute");
  expect(inviteMeta(0)).toBe("No seats left on your plan");
});
