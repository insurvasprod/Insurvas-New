import { render, screen } from "@testing-library/react-native";

import { BookAppointment } from "../book-appointment";

/** Board C8b · "With": the producers licensed in the lead's state, read with ?lead_id= (2026-11-26). */
const mockApi = jest.fn();
jest.mock("@/lib/session", () => ({ useSession: () => ({ api: mockApi, me: { user: { id: "me" }, role: "setter" } }) }));

const context = (licensedStates: Record<string, string[]> | null, leadState: string | null) => ({
  agents: [{ userId: "ava", name: "Ava Kim", timezone: "America/New_York" }, { userId: "tom", name: "Tom Baker", timezone: "America/New_York" }],
  availability: [], blocks: [], policy: [], upcoming: [], licensedStates, leadState,
});

beforeEach(() => mockApi.mockReset());

test("With names who is licensed where the customer lives, and only them", async () => {
  mockApi.mockResolvedValue(context({ ava: ["GA"], tom: ["FL"] }, "GA"));
  await render(<BookAppointment leadId="l1" leadName="Linda Okafor" customerZone="America/New_York" onBooked={jest.fn()} />);
  expect(await screen.findByRole("button", { name: "With: Ava Kim · licensed in GA" })).toBeOnTheScreen();
  expect(mockApi).toHaveBeenCalledWith("/api/app/appointments?lead_id=l1");
});

test("nobody licensed there: said plainly, nothing to book", async () => {
  mockApi.mockResolvedValue(context({ ava: ["FL"], tom: ["FL"] }, "GA"));
  await render(<BookAppointment leadId="l1" leadName="Linda Okafor" customerZone="America/New_York" onBooked={jest.fn()} />);
  expect(await screen.findByText("No one who takes appointments is licensed in Georgia, so there’s no one to book this customer with.")).toBeOnTheScreen();
});

test("no licences recorded: everyone the server lists, by name alone", async () => {
  mockApi.mockResolvedValue(context(null, "GA"));
  await render(<BookAppointment leadId="l1" leadName="Linda Okafor" customerZone="America/New_York" onBooked={jest.fn()} />);
  expect(await screen.findByRole("button", { name: "With: Ava Kim" })).toBeOnTheScreen();
});
