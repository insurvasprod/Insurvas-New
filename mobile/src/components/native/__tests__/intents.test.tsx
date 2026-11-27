import { Pressable, Text } from "react-native";
import { render, screen, userEvent } from "@testing-library/react-native";

import { ICON_SHORTCUTS, INTENTS, intentUrl, quickActionItems, resolveIntentPath, useIntentOpen, VOICE_SHORTCUTS } from "@/components/native/intents";
import { redirectSystemPath } from "@/app/+native-intent";

/**
 * Boards L3 and L5. Every shortcut is an insurvas:// link; the router hook turns it into the screen it
 * means and lets every other link through untouched. Nothing here writes to the server.
 */
let mockParams: Record<string, string> = {};
jest.mock("expo-router", () => ({ useLocalSearchParams: () => mockParams }));

describe("resolveIntentPath", () => {
  it("opens the right screen for each shortcut", () => {
    expect(resolveIntentPath("insurvas://serve-next")).toBe("/calls?part=dialer");
    expect(resolveIntentPath("insurvas://next-callback")).toBe("/calls?part=callbacks");
    expect(resolveIntentPath("insurvas://add-lead", 42)).toBe("/leads?add=42");
    expect(resolveIntentPath("insurvas://check-number")).toBe("/compliance/check-number");
    expect(resolveIntentPath("insurvas://search")).toBe("/search");
  });

  it("reads the link however the system hands it over", () => {
    for (const path of ["insurvas:///serve-next", "/serve-next", "serve-next", "INSURVAS://Serve-Next", "insurvas://serve-next/", "exp://192.168.1.4:8081/--/serve-next", "insurvas://serve-next#x"]) {
      expect(resolveIntentPath(path)).toBe("/calls?part=dialer");
    }
  });

  it("answers a spoken \"What's my next callback?\" on the answer card (board L5); the plain link still opens the list", () => {
    expect(resolveIntentPath("insurvas://next-callback?ask=1", 9)).toBe("/ask?q=next-callback&n=9");
    expect(resolveIntentPath("insurvas://open?feature=my%20next%20callback", 4)).toBe("/ask?q=next-callback&n=4");
    expect(resolveIntentPath("insurvas://next-callback", 9)).toBe("/calls?part=callbacks");
  });

  it("carries a heard number to Check a number as digits only", () => {
    expect(resolveIntentPath("insurvas://check-number?number=(713)%20555-0144")).toBe("/compliance/check-number?number=7135550144");
    expect(resolveIntentPath("insurvas://check-number?number=call%20mom")).toBe("/compliance/check-number");
  });

  it("is null for every link that isn't a shortcut", () => {
    for (const path of ["insurvas://lead/abc", "/lead/abc", "/calls?part=dialer", "https://insurvas.com/serve-next", "insurvas://", "", "/"]) {
      expect(resolveIntentPath(path)).toBeNull();
    }
  });

  it("gives each Add a lead a fresh nonce, so a second tap reopens the sheet", () => {
    expect(resolveIntentPath("insurvas://add-lead", 1)).not.toBe(resolveIntentPath("insurvas://add-lead", 2));
  });
});

describe("+native-intent", () => {
  it("rewrites shortcuts and passes other links through", () => {
    expect(redirectSystemPath({ path: "insurvas://search", initial: true })).toBe("/search");
    expect(redirectSystemPath({ path: "insurvas://lead/abc", initial: false })).toBe("insurvas://lead/abc");
  });
});

describe("shortcut lists", () => {
  it("are the board's four, in its order", () => {
    expect(ICON_SHORTCUTS.map((id) => INTENTS[id].title)).toEqual(["Serve next lead", "Add a lead", "Check a number", "Search"]);
    expect(VOICE_SHORTCUTS.map((id) => INTENTS[id].title)).toEqual(["Serve next lead", "What’s my next callback?", "Add a lead", "Check a number"]);
    expect(intentUrl("serve-next")).toBe("insurvas://serve-next");
  });

  it("gives a producer, or an owner on the producer tabs, all four icon shortcuts, routed to app paths", () => {
    expect(quickActionItems("owner", 7, { producerTabs: true }).map((i) => i.id)).toEqual(["serve-next", "add-lead", "check-number", "search"]);
    const items = quickActionItems("producer", 7);
    expect(items.map((i) => i.id)).toEqual(["serve-next", "add-lead", "check-number", "search"]);
    expect(items[0]).toEqual({ id: "serve-next", title: "Serve next lead", icon: "symbol:phone.arrow.up.right", params: { href: "/calls?part=dialer" } });
    expect(items[1].params.href).toBe("/leads?add=7");
  });

  it("leaves out what the role can't use", () => {
    expect(quickActionItems("setter").map((i) => i.id)).not.toContain("add-lead");
    // An owner on Team · Money has no Calls or Leads tab for those two to open.
    expect(quickActionItems("owner").map((i) => i.id)).toEqual(["check-number", "search"]);
    expect(quickActionItems(null).map((i) => i.id)).toEqual([]);
  });

  it("offers Check a number only where /api/app/dial/preflight answers: owner or producer, plan with dialing", () => {
    expect(quickActionItems("setter").map((i) => i.id)).not.toContain("check-number");
    expect(quickActionItems("assistant").map((i) => i.id)).not.toContain("check-number");
    expect(quickActionItems("producer", 7, { features: ["inbound_transfers"] }).map((i) => i.id)).not.toContain("check-number");
    expect(quickActionItems("producer", 7, { features: ["outbound_dialing"] }).map((i) => i.id)).toContain("check-number");
  });
});

describe("useIntentOpen", () => {
  function Screen() {
    const add = useIntentOpen("add");
    return add.open ? <Pressable accessibilityRole="button" accessibilityLabel="Close sheet" onPress={add.done}><Text>Sheet open</Text></Pressable> : <Text>Sheet closed</Text>;
  }

  it("opens once per link and stays closed after done", async () => {
    mockParams = {};
    const view = await render(<Screen />);
    expect(screen.getByText("Sheet closed")).toBeTruthy();

    mockParams = { add: "1" };
    await view.rerender(<Screen />);
    expect(screen.getByText("Sheet open")).toBeTruthy();
    await userEvent.setup().press(screen.getByRole("button", { name: "Close sheet" }));
    expect(screen.getByText("Sheet closed")).toBeTruthy();

    // The next shortcut is a new nonce: it opens again.
    mockParams = { add: "2" };
    await view.rerender(<Screen />);
    expect(screen.getByText("Sheet open")).toBeTruthy();
  });
});
