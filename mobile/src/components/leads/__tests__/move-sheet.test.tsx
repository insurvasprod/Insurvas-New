import { render, screen, userEvent } from "@testing-library/react-native";

import { MoveSheet } from "../move-sheet";

/**
 * Board D6: a stage move is a disposition. The sheet reads the stage rules, names the outcome it will
 * record, and only then posts POST /api/app/leads/move with that outcome. A stage only a call can
 * reach is refused before anything is sent.
 */
const mockApi = jest.fn();
jest.mock("@/lib/session", () => ({ useSession: () => ({ api: mockApi }) }));

const LEAD = "3afad3ae-2c84-4bde-a6b5-1dabd5d4bc2d";
const context = { dispositionsByStage: {
  "s-quoted": [{ key: "quoted", label: "Quoted", nextAction: null, nextActionMinutes: null }],
  "s-callback": [{ key: "callback_scheduled", label: "Callback", nextAction: "callback", nextActionMinutes: null }],
} };

beforeEach(() => mockApi.mockReset());

test("records the outcome named like the stage, then the optional note", async () => {
  const calls: string[] = [];
  mockApi.mockImplementation(async (path: string, init?: { method?: string }) => {
    calls.push(`${init?.method ?? "GET"} ${path}`);
    if (path === "/api/app/leads/pipeline-context") return context;
    if (path === "/api/app/leads/move") return { moved: [{ lead_id: LEAD, from_stage_id: "s-int", to_stage_id: "s-quoted" }], failed: [] };
    if (path === `/api/app/leads/${LEAD}/notes`) return { note: { id: "n1" } };
    throw new Error(`unexpected ${path}`);
  });
  const onMoved = jest.fn();
  const user = userEvent.setup();
  await render(<MoveSheet visible leadId={LEAD} firstName="Linda" from={{ id: "s-int", name: "Interested" }} to={{ id: "s-quoted", name: "Quoted" }} source="lead_detail" onClose={() => undefined} onMoved={onMoved} />);

  expect(await screen.findByText("Recorded as the outcome “Quoted”, by you, now.")).toBeOnTheScreen();
  await user.type(screen.getByTestId("move-note"), "Sent by email");
  await user.press(screen.getByRole("button", { name: "Move to Quoted" }));

  expect(calls).toEqual(["GET /api/app/leads/pipeline-context", "POST /api/app/leads/move", `POST /api/app/leads/${LEAD}/notes`]);
  expect(mockApi.mock.calls[1][1].body).toEqual({ lead_ids: [LEAD], disposition_key: "quoted", source: "lead_detail" });
  expect(mockApi.mock.calls[2][1].body).toMatchObject({ body: "Sent by email", visibility: "internal" });
  expect(onMoved).toHaveBeenCalledWith("Linda moved from Interested to Quoted");
});

test("a stage only a call can reach is refused, and nothing is posted", async () => {
  mockApi.mockImplementation(async (path: string) => {
    if (path === "/api/app/leads/pipeline-context") return context;
    throw new Error(`unexpected ${path}`);
  });
  const user = userEvent.setup();
  await render(<MoveSheet visible leadId={LEAD} firstName="Linda" from={{ id: "s-int", name: "Interested" }} to={{ id: "s-callback", name: "Callback" }} source="board" onClose={() => undefined} onMoved={() => undefined} />);

  expect(await screen.findByText(/Only a call can move a lead to Callback/)).toBeOnTheScreen();
  await user.press(screen.getByRole("button", { name: "Move to Callback" }));
  expect(mockApi).toHaveBeenCalledTimes(1);
});

test("the server's refusal is shown in its own words", async () => {
  const { ApiError } = jest.requireActual("@/lib/api");
  mockApi.mockImplementation(async (path: string) => {
    if (path === "/api/app/leads/pipeline-context") return context;
    throw new ApiError(409, { error: "That outcome is retired.", code: "disposition_not_active" });
  });
  const onMoved = jest.fn();
  const user = userEvent.setup();
  await render(<MoveSheet visible leadId={LEAD} firstName="Linda" from={null} to={{ id: "s-quoted", name: "Quoted" }} source="board" onClose={() => undefined} onMoved={onMoved} />);
  await user.press(await screen.findByRole("button", { name: "Move to Quoted" }));
  expect(await screen.findByText("That outcome is retired.")).toBeOnTheScreen();
  expect(onMoved).not.toHaveBeenCalled();
});

test("a callback the move keeps is said; from the board the target chip picks another stage", async () => {
  mockApi.mockImplementation(async (path: string) => {
    if (path === "/api/app/leads/pipeline-context") return context;
    throw new Error(`unexpected ${path}`);
  });
  const inTwoDays = new Date(Date.now() + 2 * 86_400_000).toISOString();
  const user = userEvent.setup();
  await render(<MoveSheet visible leadId={LEAD} firstName="Linda" from={{ id: "s-int", name: "Interested" }} to={{ id: "s-callback", name: "Callback" }} source="board"
    stages={[{ id: "s-int", name: "Interested" }, { id: "s-quoted", name: "Quoted" }, { id: "s-callback", name: "Callback" }]}
    callback={{ at: inTwoDays, timezone: "UTC" }} pronoun="she" onClose={() => undefined} onMoved={() => undefined} />);

  expect(await screen.findByText(/Only a call can move a lead to Callback/)).toBeOnTheScreen();
  await user.press(screen.getByTestId("move-target"));
  await user.press(await screen.findByText("Quoted"));
  expect(await screen.findByText(/^Recorded as the outcome “Quoted”, by you, now\. Her callback on \w{3} stays\.$/)).toBeOnTheScreen();
  expect(screen.getByRole("button", { name: "Move to Quoted" })).toBeOnTheScreen();
});
