import { render, screen, userEvent } from "@testing-library/react-native";

import { AddLeadSheet } from "../add-lead";
import type { FormTemplate } from "../logic";

/**
 * Board D7: the form is the agency's template, validation is the server's, and a saved lead is
 * checked for an existing customer before it opens: a match goes to Same person? first.
 */
const mockApi = jest.fn();
const mockPush = jest.fn();
jest.mock("@/lib/session", () => ({ useSession: () => ({ api: mockApi }) }));
jest.mock("expo-router", () => ({ router: { push: (...a: unknown[]) => mockPush(...a), back: jest.fn() } }));

const template: FormTemplate = {
  product_name: "Final expense", product_code: "final_expense",
  fields: [
    { field_key: "first_name", label: "First name", type: "text", is_required: true, options: [], sort_order: 0 },
    { field_key: "phone", label: "Phone", type: "phone", is_required: true, options: [], sort_order: 1 },
    { field_key: "date_of_birth", label: "Date of birth", type: "date", is_required: false, options: [], sort_order: 2 },
  ],
  form_definition: { sections: [{ section_key: "p", label: "Person", sort_order: 0, fields: [
    { field_key: "first_name", is_required: true }, { field_key: "phone", is_required: true }, { field_key: "date_of_birth", is_required: false },
  ] }] },
};

beforeEach(() => { mockApi.mockReset(); mockPush.mockReset(); });

test("posts the typed answers, then a duplicate match opens Same person?", async () => {
  mockApi.mockImplementation(async (path: string, init?: { method?: string }) => {
    if (path === "/api/app/leads/draft") return init?.method ? { cleared: true } : { draft: null };
    if (path === "/api/app/leads" && init?.method === "POST") return { lead: { id: "new-1" } };
    if (path === "/api/app/leads/new-1/preflight") return { result: { status: "spoken_before", matches: [{ leadId: "old-9", partnerName: null, outcome: null, sourceType: "lead" }] } };
    throw new Error(`unexpected ${init?.method ?? "GET"} ${path}`);
  });
  const onCreated = jest.fn();
  const user = userEvent.setup();
  await render(<AddLeadSheet visible template={template} onClose={() => undefined} onCreated={onCreated} />);

  await user.type(screen.getByTestId("new-lead-first_name"), "Earl");
  await user.type(screen.getByTestId("new-lead-phone"), "6145550127");
  await user.type(screen.getByTestId("new-lead-date_of_birth"), "02/14/1957");
  await user.press(screen.getByTestId("add-lead-save"));

  const post = mockApi.mock.calls.find(([path, init]) => path === "/api/app/leads" && init?.method === "POST");
  expect(post?.[1].body).toEqual({ values: { first_name: "Earl", phone: "6145550127", date_of_birth: "1957-02-14" } });
  expect(onCreated).toHaveBeenCalled();
  expect(mockPush).toHaveBeenCalledWith("/lead/same-person/new-1");
});

test("a refusal is the server's own words, and nothing opens", async () => {
  const { ApiError } = jest.requireActual("@/lib/api");
  mockApi.mockImplementation(async (path: string, init?: { method?: string }) => {
    if (path === "/api/app/leads/draft") return { draft: null };
    if (path === "/api/app/leads" && init?.method === "POST") throw new ApiError(400, { error: "Phone is required" });
    throw new Error(`unexpected ${path}`);
  });
  const user = userEvent.setup();
  await render(<AddLeadSheet visible template={template} onClose={() => undefined} onCreated={() => undefined} />);
  await user.press(screen.getByTestId("add-lead-save"));
  expect(await screen.findByText("Phone is required")).toBeOnTheScreen();
  expect(mockPush).not.toHaveBeenCalled();
});

test("the duplicate check runs on the typed answers before saving: warning, then Open existing", async () => {
  mockApi.mockImplementation(async (path: string, init?: { method?: string }) => {
    if (path === "/api/app/leads/draft") return init?.method ? { cleared: true } : { draft: null };
    if (path === "/api/app/leads?check=1") return { status: "spoken_before", matches: [{ leadId: "old-9", openable: true, stageName: "Contacted", ownerName: "Sam Lee" }] };
    throw new Error(`unexpected ${init?.method ?? "GET"} ${path}`);
  });
  const onClose = jest.fn();
  const user = userEvent.setup();
  await render(<AddLeadSheet visible template={template} onClose={onClose} onCreated={() => undefined} />);
  await user.type(screen.getByTestId("new-lead-first_name"), "Earl");
  await user.type(screen.getByTestId("new-lead-phone"), "6145550127");
  await user.press(screen.getByTestId("add-lead-save"));

  expect(await screen.findByText("Earl, (614) 555-0127, is already a lead in Contacted (Sam Lee).")).toBeOnTheScreen();
  expect(mockApi.mock.calls.some(([path, init]) => path === "/api/app/leads" && init?.method === "POST")).toBe(false);
  await user.press(screen.getByRole("button", { name: "Open existing" }));
  expect(onClose).toHaveBeenCalled();
  expect(mockPush).toHaveBeenCalledWith("/lead/old-9");
});

test("Save lead after the warning saves anyway, then Same person? opens", async () => {
  mockApi.mockImplementation(async (path: string, init?: { method?: string }) => {
    if (path === "/api/app/leads/draft") return init?.method ? { cleared: true } : { draft: null };
    if (path === "/api/app/leads?check=1") return { status: "spoken_before", matches: [{ leadId: "old-9", openable: false, stageName: null, ownerName: null }] };
    if (path === "/api/app/leads" && init?.method === "POST") return { lead: { id: "new-1" } };
    if (path === "/api/app/leads/new-1/preflight") return { result: { status: "spoken_before", matches: [{ leadId: "old-9", partnerName: null, outcome: null, sourceType: "lead" }] } };
    throw new Error(`unexpected ${init?.method ?? "GET"} ${path}`);
  });
  const user = userEvent.setup();
  await render(<AddLeadSheet visible template={template} onClose={() => undefined} onCreated={() => undefined} />);
  await user.type(screen.getByTestId("new-lead-first_name"), "Earl");
  await user.press(screen.getByTestId("add-lead-save"));
  expect(await screen.findByText("Earl is already a lead.")).toBeOnTheScreen();
  expect(screen.queryByRole("button", { name: "Open existing" })).toBeNull();
  await user.press(screen.getByTestId("add-lead-save"));
  expect(mockPush).toHaveBeenCalledWith("/lead/same-person/new-1");
});
