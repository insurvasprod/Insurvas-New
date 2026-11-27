import { act, render, screen } from "@testing-library/react-native";
import { AppState, Text } from "react-native";

import { PrivacyCover, useCovered } from "@/components/states/privacy-cover";
import { LoadState } from "@/components/states/states";
import { Button, Failed, Header } from "@/components/ui";
import { ApiError, rawRequest, resetUpdateRequired, updateRequiredNow } from "@/lib/api";
import { BarStateContext, NO_BAR_STATE, type BarState } from "@/lib/outbox-state";

/** Board section 13 (M3, M4, M6, M7, M8) and L4's bar mark, read from the server's codes. */
const bar = (b: Partial<BarState>) => ({ ...NO_BAR_STATE, ...b });
const noop = () => undefined;

describe("L4 · M6 · the bar's marks on every Header", () => {
  test("Offline with what waits, and Read only, come first in the bar; nothing without a session", async () => {
    await render(<BarStateContext.Provider value={bar({ offline: true, toSend: 3, readOnly: { code: "read_only", message: "x" } })}><Header title="Application" back="Linda" onBack={noop} large={false} /></BarStateContext.Provider>);
    expect(screen.getByTestId("bar-offline")).toHaveTextContent("Offline · 3 to send");
    expect(screen.getByTestId("bar-read-only")).toHaveTextContent("Read only");
  });

  test("Offline alone when nothing waits", async () => {
    await render(<BarStateContext.Provider value={bar({ offline: true })}><Header title="Leads" /></BarStateContext.Provider>);
    expect(screen.getByTestId("bar-offline")).toHaveTextContent(/^Offline$/);
    expect(screen.queryByTestId("bar-read-only")).toBeNull();
  });

  test("no provider: no marks", async () => {
    await render(<Header title="Leads" />);
    expect(screen.queryByTestId("bar-offline")).toBeNull();
  });
});

describe("M6 · write buttons are visible but disabled while the agency is read-only", () => {
  test("the gold start-work button and any write button; a plain button still works", async () => {
    await render(
      <BarStateContext.Provider value={bar({ readOnly: { code: "read_only", message: "Your account is paused." } })}>
        <Button testID="start" kind="gold" label="Start calling" onPress={noop} />
        <Button testID="save" label="Save" write onPress={noop} />
        <Button testID="retry" label="Try again" onPress={noop} />
      </BarStateContext.Provider>,
    );
    expect(screen.getByTestId("start")).toBeDisabled();
    expect(screen.getByTestId("save")).toBeDisabled();
    expect(screen.getByTestId("retry")).toBeEnabled();
  });

  test("an agency that can write: the gold button works", async () => {
    await render(<Button testID="start" kind="gold" label="Start calling" onPress={noop} />);
    expect(screen.getByTestId("start")).toBeEnabled();
  });
});

describe("M3 · M4 · M6 from the server's code, never its words", () => {
  test("M4: the module the server named, who can add it and what stays open — no prices, no buy button", async () => {
    const e = new ApiError(403, { error: "Your plan doesn't include this feature", code: "feature_not_entitled", feature: "chargeback_radar" });
    expect(e.message).toBe("Retention isn’t in your agency’s plan");
    await render(<Failed what="your retention cases" message={e.message} onRetry={noop} />);
    expect(screen.getByText("Retention isn’t in your agency’s plan")).toBeOnTheScreen();
    expect(screen.getByText("Your agency owner can add it from Plan and billing on the web. Your book and policies stay open as before.")).toBeOnTheScreen();
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("M4 for the owner says they can add it", async () => {
    const e = new ApiError(403, { code: "feature_not_entitled", feature: "chargeback_radar" });
    await render(<BarStateContext.Provider value={bar({ role: "owner" })}><Failed message={e.message} onRetry={noop} /></BarStateContext.Provider>);
    expect(screen.getByText(/^You can add it from Plan and billing on the web\./)).toBeOnTheScreen();
  });

  test("the plan's words without the code are a plain failure (text is never matched)", async () => {
    await render(<Failed what="this" message="Your plan doesn't include this feature (typed by a screen)" onRetry={noop} />);
    expect(screen.getByText("We couldn’t load this")).toBeOnTheScreen();
  });

  test("M6: a read-only agency says why, in the server's words, and who fixes it", async () => {
    const e = new ApiError(403, { error: "Your account is paused. You can still view your book of business, but not make changes.", code: "read_only", status: "paused" });
    await render(<Failed message={e.message} onRetry={noop} />);
    expect(screen.getByText("Your agency’s account is paused")).toBeOnTheScreen();
    expect(screen.getByText("Your account is paused. You can still view your book of business, but not make changes. Your agency owner can fix it on the web.")).toBeOnTheScreen();
  });

  test("M3: no answer says what failed and what still holds, with Try again", async () => {
    const e = new ApiError(0, {});
    await render(<Failed what="your leads" message={e.message} onRetry={noop} />);
    expect(screen.getByText("We couldn’t load your leads")).toBeOnTheScreen();
    expect(screen.getByText(/^The connection dropped while loading\. Notes, call outcomes and answers you save here wait on this phone/)).toBeOnTheScreen();
    expect(screen.getByTestId("state-retry")).toBeOnTheScreen();
  });

  test("LoadState reads the code too, and names the module the server named", async () => {
    const e = new ApiError(403, { code: "feature_not_entitled", feature: "chargeback_radar" });
    await render(<LoadState loading={false} hasData={false} error={e.message} errorCode={{ status: 403, code: "feature_not_entitled" }} onRetry={noop} what="the save queue" />);
    expect(screen.getByText("Retention isn’t in your agency’s plan")).toBeOnTheScreen();
  });
});

describe("M8 · any request the server refuses as too old raises Update needed", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; resetUpdateRequired(); });

  test("426 / app_update_required from rawRequest (the agency's and the partner's alike)", async () => {
    globalThis.fetch = jest.fn(async () => ({ ok: false, status: 426, json: async () => ({ error: "Update Insurvas to keep going.", code: "app_update_required" }) })) as unknown as typeof fetch;
    expect(updateRequiredNow()).toBe(false);
    await expect(rawRequest("/api/partner/me")).rejects.toMatchObject({ status: 426, code: "app_update_required" });
    expect(updateRequiredNow()).toBe(true);
  });

  test("an ordinary refusal does not", async () => {
    globalThis.fetch = jest.fn(async () => ({ ok: false, status: 403, json: async () => ({ code: "role_not_allowed" }) })) as unknown as typeof fetch;
    await expect(rawRequest("/api/app/me")).rejects.toBeTruthy();
    expect(updateRequiredNow()).toBe(false);
  });
});

describe("M7 · the app switcher never shows client data", () => {
  function Probe() {
    return useCovered() ? <PrivacyCover /> : <Text>Robert Chen · 11:30</Text>;
  }

  test("leaving the app draws the plain cover over everything; coming back lifts it", async () => {
    const handlers: Record<string, (s?: string) => void> = {};
    const spy = jest.spyOn(AppState, "addEventListener").mockImplementation(((type: string, fn: (s?: string) => void) => { handlers[type] = fn; return { remove: noop }; }) as unknown as typeof AppState.addEventListener);
    await render(<Probe />);
    expect(screen.getByText("Robert Chen · 11:30")).toBeOnTheScreen();
    await act(async () => { handlers.change("inactive"); });
    // Hidden from screen readers (it is only for the snapshot), so the query includes hidden elements.
    expect(screen.getByTestId("privacy-cover", { includeHiddenElements: true })).toBeOnTheScreen();
    expect(screen.queryByText("Robert Chen · 11:30")).toBeNull();
    await act(async () => { handlers.change("active"); });
    expect(screen.getByText("Robert Chen · 11:30")).toBeOnTheScreen();
    spy.mockRestore();
  });
});
