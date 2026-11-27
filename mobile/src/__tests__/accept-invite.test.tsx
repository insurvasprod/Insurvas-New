import { render, screen, userEvent } from "@testing-library/react-native";

import AcceptInvite from "@/app/accept-invite";

/**
 * Board A5: the page shows the server's reading of the invite link; a new account chooses its password
 * (POST set-password) and is signed in with it; an existing account only accepts (POST accept-invite).
 */
const mockReplace = jest.fn();
const mockSignIn = jest.fn();
const mockBio = jest.fn();
let mockStatus = "signedOut";
jest.mock("expo-router", () => ({ router: { replace: (...a: unknown[]) => mockReplace(...a) }, useLocalSearchParams: () => ({ token: "t".repeat(40) }) }));
jest.mock("expo-web-browser", () => ({ openBrowserAsync: jest.fn() }));
jest.mock("@/lib/session", () => ({ useSession: () => ({ status: mockStatus, signIn: mockSignIn, setBiometricOn: mockBio }) }));

const invite = (over: Record<string, unknown> = {}) => ({ valid: true, email: "ava@agency.test", name: null, purpose: "invite", organization: "Ellery & Fields", role: "Producer", hasAccount: false, ...over });

let send: jest.SpyInstance;
beforeEach(() => {
  mockReplace.mockReset(); mockSignIn.mockReset(); mockBio.mockReset(); mockStatus = "signedOut";
  send = jest.spyOn(jest.requireActual("@/lib/api"), "rawRequest");
});
afterEach(() => send.mockRestore());

test("a new account sets its password, keeps the Face ID choice, then signs in", async () => {
  send.mockImplementation(async (path: string) => (path.startsWith("/api/app/auth/set-password?") ? invite() : { ok: true }));
  mockSignIn.mockResolvedValue({ done: true });
  const user = userEvent.setup();
  await render(<AcceptInvite />);
  expect(await screen.findByText("You’re invited to Ellery & Fields")).toBeOnTheScreen();
  await user.type(screen.getByLabelText("Create a password"), "short");
  await user.press(screen.getByRole("button", { name: "Join Ellery & Fields" }));
  expect(await screen.findByText("Password must be at least 12 characters")).toBeOnTheScreen();
  expect(mockSignIn).not.toHaveBeenCalled();

  await user.type(screen.getByLabelText("Create a password"), "-long-enough");
  await user.press(screen.getByRole("button", { name: "Join Ellery & Fields" }));
  expect(send).toHaveBeenCalledWith("/api/app/auth/set-password", { method: "POST", body: { token: "t".repeat(40), password: "short-long-enough" } });
  expect(mockBio).toHaveBeenCalledWith(true);
  expect(mockSignIn).toHaveBeenCalledWith("ava@agency.test", "short-long-enough", true);
});

test("an existing account only accepts, then signs in as usual", async () => {
  send.mockImplementation(async (path: string) => (path.startsWith("/api/app/auth/set-password?") ? invite({ hasAccount: true }) : { ok: true }));
  const user = userEvent.setup();
  await render(<AcceptInvite />);
  await user.press(await screen.findByRole("button", { name: "Join Ellery & Fields" }));
  expect(send).toHaveBeenCalledWith("/api/app/auth/accept-invite", { method: "POST", body: { token: "t".repeat(40) } });
  expect(mockSignIn).not.toHaveBeenCalled();
  expect(mockReplace).toHaveBeenCalledWith("/sign-in");
});

test("an expired link says so in the server's words", async () => {
  const { ApiError } = jest.requireActual("@/lib/api");
  send.mockRejectedValue(new ApiError(400, { error: "This invitation link is invalid or has expired" }));
  await render(<AcceptInvite />);
  expect(await screen.findByText("This invitation link is invalid or has expired")).toBeOnTheScreen();
});
