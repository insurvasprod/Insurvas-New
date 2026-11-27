import { callsPartsFor, tabsFor } from "../roles";

/**
 * Board B3 draws a setter's bar as Home · Dialer · Callbacks · Inbox · Menu. The server's callbacks routes
 * (app/api/app/callbacks/route.ts) and the web menu (lib/menu/definition.ts, sell.callbacks) admit owner,
 * producer and assistant only, so the app keeps a setter to the dialer until callbacks open to setters:
 * a tab the server refuses would only ever show an error.
 */
describe("setter tabs follow the server's gates", () => {
  test("the dialer tab (labelled Dialer in app-tabs.tsx), no Calls part the server refuses", () => {
    expect(tabsFor("setter")).toEqual(["index", "calls", "inbox", "menu"]);
    expect(callsPartsFor("setter")).toEqual(["dialer"]);
    expect(callsPartsFor("setter")).not.toContain("callbacks");
  });

  test("without outbound dialing on the plan a setter has no Calls tab at all", () => {
    expect(tabsFor("setter", { features: ["callback_calendar", "inbound_transfers"] })).toEqual(["index", "inbox", "menu"]);
    expect(tabsFor("setter", { features: ["outbound_dialing"] })).toEqual(["index", "calls", "inbox", "menu"]);
  });
});
