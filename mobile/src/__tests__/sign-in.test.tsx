import { render, screen, userEvent } from "@testing-library/react-native";

import SignIn from "@/app/sign-in";

/** Board A1: the web's sign-in; the server's own words come back on a refusal. */
const mockSignIn = jest.fn();
const mockPush = jest.fn();
jest.mock("@/lib/session", () => ({ useSession: () => ({ signIn: mockSignIn }) }));
jest.mock("expo-router", () => ({ router: { push: (...a: unknown[]) => mockPush(...a) } }));

beforeEach(() => { mockSignIn.mockReset(); mockPush.mockReset(); });

test("asks for both fields before calling the server", async () => {
  const user = userEvent.setup();
  await render(<SignIn />);
  await user.press(screen.getByRole("button", { name: "Sign in" }));
  expect(await screen.findByText("Enter your email and password.")).toBeOnTheScreen();
  expect(mockSignIn).not.toHaveBeenCalled();
});

test("goes to the code step when two-factor is on", async () => {
  mockSignIn.mockResolvedValue({ twoFactor: true });
  const user = userEvent.setup();
  await render(<SignIn />);
  await user.type(screen.getByPlaceholderText("you@agency.com"), "agent@agency.test");
  await user.type(screen.getByLabelText("Password"), "test-password");
  await user.press(screen.getByRole("button", { name: "Sign in" }));
  expect(mockSignIn).toHaveBeenCalledWith("agent@agency.test", "test-password", true);
  expect(mockPush).toHaveBeenCalledWith({ pathname: "/two-factor", params: { email: "agent@agency.test" } });
});

test("asks for the emailed link, then opens Check your email (board A6)", async () => {
  const api = jest.requireActual("@/lib/api");
  const send = jest.spyOn(api, "rawRequest").mockResolvedValue({ ok: true });
  const user = userEvent.setup();
  await render(<SignIn />);
  await user.type(screen.getByPlaceholderText("you@agency.com"), "agent@agency.test");
  await user.press(screen.getByRole("link", { name: "Email me a sign-in link" }));
  expect(send).toHaveBeenCalledWith("/api/app/auth/sign-in-link", { method: "POST", body: { email: "agent@agency.test", remember: true } });
  expect(mockPush).toHaveBeenCalledWith({ pathname: "/check-email", params: { email: "agent@agency.test", remember: "1" } });
  send.mockRestore();
});

test("shows the server's refusal as it was written", async () => {
  const { ApiError } = jest.requireActual("@/lib/api");
  mockSignIn.mockRejectedValue(new ApiError(401, { error: "Invalid email or password" }));
  const user = userEvent.setup();
  await render(<SignIn />);
  await user.type(screen.getByPlaceholderText("you@agency.com"), "agent@agency.test");
  await user.type(screen.getByLabelText("Password"), "wrong");
  await user.press(screen.getByRole("button", { name: "Sign in" }));
  expect(await screen.findByText("Invalid email or password")).toBeOnTheScreen();
});
