import { render, screen, userEvent } from "@testing-library/react-native";

import LeadPage, { LeadRecord } from "@/app/lead/[id]";
import { ApiError } from "@/lib/api";

/**
 * Board L6: the lead page in the tablet's right pane. Embedded, it has a Close button and no back
 * (the list is still on screen); as a route it keeps its back to Leads. The server answer is a 404
 * here so only the frame is under test.
 */
const mockApi = jest.fn();
const mockBack = jest.fn();
jest.mock("expo-router", () => ({
  router: { push: jest.fn(), back: () => mockBack() },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => ({ id: "l1" }),
}));
jest.mock("@/lib/session", () => ({ useSession: () => ({ api: mockApi, me: { role: "producer", user: { id: "u1" } } }) }));
jest.mock("@/lib/counts", () => ({ useCounts: () => ({ refresh: jest.fn(), nav: null }) }));

beforeEach(() => {
  mockApi.mockReset(); mockBack.mockReset();
  mockApi.mockRejectedValue(new ApiError(404, { error: "Not found" }));
});

it("embedded: Close instead of back, and it closes the pane", async () => {
  const close = jest.fn();
  await render(<LeadRecord id="l1" onClose={close} />);
  expect(await screen.findByText("This lead isn’t yours to open")).toBeTruthy();
  expect(mockApi).toHaveBeenCalledWith("/api/app/leads/l1");
  expect(screen.queryByText("Leads")).toBeNull();
  await userEvent.setup().press(screen.getByRole("button", { name: "Close the lead" }));
  expect(close).toHaveBeenCalled();
});

it("as a route: the id from the link, back to Leads, no Close", async () => {
  await render(<LeadPage />);
  expect(await screen.findByText("This lead isn’t yours to open")).toBeTruthy();
  expect(mockApi).toHaveBeenCalledWith("/api/app/leads/l1");
  expect(screen.queryByRole("button", { name: "Close the lead" })).toBeNull();
});
