import { render, screen, userEvent } from "@testing-library/react-native";

import { ScriptScreen, scriptFooter } from "../script-screen";

/**
 * Board C7d · the pencil saves a new version of the script as written (PUT /api/app/dialer/scripts),
 * for owners and producers; the footer names the version and who published it.
 */
const mockApi = jest.fn();
let mockRole = "producer";
jest.mock("@/lib/session", () => ({ useSession: () => ({ api: mockApi, me: { role: mockRole, user: { id: "u1", name: "Jordan Reyes" } } }) }));

const source = { sections: { opening: "Hi {{first_name}}, this is {{agent_name}}.", qualifying_questions: "Q", transition_to_quote: "T", close: "C" }, updatedBy: "Dana Ortiz", updatedAt: "2026-11-14T15:00:00Z" };
const script = { version: 12, sections: { opening: "Hi Harold, this is Jordan." }, id: "s1", campaignId: null, productCode: "term_life" };

beforeEach(() => { mockApi.mockReset(); mockRole = "producer"; });

test("the footer says the version and who updated it", () => {
  expect(scriptFooter(12, source)).toBe("Script v12 · updated by Dana 14 Nov");
  expect(scriptFooter(12, null)).toBe("Script v12");
  expect(scriptFooter(0, null)).toBe("The default script · your agency hasn’t published one");
});

test("the pencil edits the template, not this lead's words, and saves the next version", async () => {
  mockApi.mockResolvedValue({ script: { version: 13 } });
  const user = userEvent.setup();
  await render(<ScriptScreen leadId="lead-1" script={script} source={source} rebuttals={[]} onBack={() => undefined} />);
  expect(screen.getByText("Script v12 · updated by Dana 14 Nov")).toBeOnTheScreen();
  await user.press(screen.getByRole("button", { name: "Edit script" }));
  expect(screen.getByDisplayValue("Hi {{first_name}}, this is {{agent_name}}.")).toBeOnTheScreen();
  await user.press(screen.getByRole("button", { name: "Save new version" }));

  expect(mockApi).toHaveBeenCalledWith("/api/app/dialer/scripts", { method: "PUT", body: { campaign_id: null, product_code: "term_life", sections: source.sections } });
  expect(await screen.findByText("Saved as v13 · applies from your next lead")).toBeOnTheScreen();
});

test("a setter reads the script but has no pencil", async () => {
  mockRole = "setter";
  await render(<ScriptScreen leadId="lead-1" script={script} source={source} rebuttals={[]} onBack={() => undefined} />);
  expect(screen.queryByRole("button", { name: "Edit script" })).not.toBeOnTheScreen();
});
