import { render, screen, userEvent } from "@testing-library/react-native";

import SamePerson from "@/app/lead/same-person/[id]";

/**
 * Board D9: the two records side by side; "Same person" records them as one person through the
 * server (the web's Clean answer for a pair) and opens this lead; "Keep both" leaves them apart.
 */
const mockApi = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
jest.mock("@/lib/session", () => ({ useSession: () => ({ api: mockApi }) }));
jest.mock("expo-router", () => ({
  router: { push: jest.fn(), replace: (...a: unknown[]) => mockReplace(...a), back: () => mockBack() },
  useLocalSearchParams: () => ({ id: "new-1" }),
}));

const lead = (id: string, created: string, owner: string) => ({
  lead: { id, created_at: created, values: { first_name: "Earl", last_name: "Johnson", phone: "6145550127", date_of_birth: "1957-02-14", city: id === "new-1" ? "Columbus" : "Grove City", state: "OH" } },
  owner: { id: "o", name: owner }, partner: null, lineage: null, submitter: null,
  preflight: { status: "spoken_before", matches: id === "new-1" ? [{ leadId: "old-9", partnerName: null, outcome: null, matchedOn: ["phone", "dob"], sourceType: "lead" }] : [] },
});

beforeEach(() => {
  mockApi.mockReset(); mockReplace.mockReset(); mockBack.mockReset();
  mockApi.mockImplementation(async (path: string, init?: { method?: string; body?: unknown }) => {
    if (path === "/api/app/leads/new-1" && !init) return lead("new-1", new Date().toISOString(), "You");
    if (path === "/api/app/leads/old-9" && !init) return lead("old-9", "2026-10-02T12:00:00Z", "Sam Lee");
    if (path === "/api/app/leads/new-1/preflight" && init?.method === "POST") return { reviewId: "r1", linked: true };
    throw new Error(`unexpected ${init?.method ?? "GET"} ${path}`);
  });
});

test("Same person links the two through the server, then opens this lead", async () => {
  await render(<SamePerson />);
  expect(await screen.findByText("Same phone and date of birth. Place differs.")).toBeOnTheScreen();
  await userEvent.setup().press(screen.getByRole("button", { name: "Same person" }));
  const post = mockApi.mock.calls.find(([path, init]) => path === "/api/app/leads/new-1/preflight" && init?.method === "POST");
  expect(post?.[1].body).toEqual({ action: "same_person", other_lead_id: "old-9" });
  expect(mockReplace).toHaveBeenCalledWith("/lead/new-1");
});

test("Keep both writes nothing", async () => {
  await render(<SamePerson />);
  await userEvent.setup().press(await screen.findByRole("button", { name: "Keep both" }));
  expect(mockBack).toHaveBeenCalled();
  expect(mockApi.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
});
