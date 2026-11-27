import { callbackOpen, codeLabel, compactCount, displayName, leadName, phoneLabel } from "../format";
import { appHrefFor } from "../links";
import { callsPartsFor, tabsFor } from "../roles";

test("names in capitals from carrier files are shown in title case; others as stored", () => {
  expect(displayName("JOSHUA ANDERSON")).toBe("Joshua Anderson");
  expect(displayName("DWIGHT MCALLISTER")).toBe("Dwight McAllister");
  expect(displayName("MARY O'BRIEN-SMITH")).toBe("Mary O'Brien-Smith");
  expect(displayName("Laura Lopez")).toBe("Laura Lopez");
  expect(displayName("test1 test")).toBe("test1 test");
  expect(displayName("AM09232886")).toBe("AM09232886");
  expect(displayName(null)).toBeNull();
});

describe("tabs by role (board section 00, decision 7)", () => {
  test("producers and assistants get Home · Calls · Leads · Inbox · Menu", () => {
    for (const role of ["producer", "assistant"]) {
      expect(tabsFor(role)).toEqual(["index", "calls", "leads", "inbox", "menu"]);
    }
  });
  test("a setter has no Leads tab; the server refuses them the leads list", () => {
    expect(tabsFor("setter")).toEqual(["index", "calls", "inbox", "menu"]);
  });
  test("retention gets Cases and Book; the bookkeeper Money and Book", () => {
    expect(tabsFor("bookkeeper")).toEqual(["index", "moneytab", "policies", "inbox", "menu"]);
    expect(tabsFor("retention")).toEqual(["index", "ladder", "policies", "inbox", "menu"]);
  });
  test("release 3: owners get Team and Money, managers Team and Calls; a selling owner can keep the producer tabs", () => {
    for (const role of ["owner", "admin"]) {
      expect(tabsFor(role)).toEqual(["index", "teamtab", "moneytab", "inbox", "menu"]);
      expect(tabsFor(role, { producerTabs: true })).toEqual(["index", "calls", "leads", "inbox", "menu"]);
    }
    expect(tabsFor("manager")).toEqual(["index", "teamtab", "calls", "inbox", "menu"]);
  });
  test("release 3's money pages open their phone screens", () => {
    expect(appHrefFor("/app/my-pay")).toBe("/money/pay");
    expect(appHrefFor("/app/my-balance")).toBe("/money/balance");
    expect(appHrefFor("/app/accounting")).toBe("/money");
    expect(appHrefFor("/app/pnl")).toBe("/money/pnl");
    expect(appHrefFor("/app/discrepancies")).toBe("/money/pay-issues");
    expect(appHrefFor("/app/producer-statements/s1")).toBe("/money/statement/s1");
    expect(appHrefFor("/app/setup")).toBe("/setup");
  });
  test("release 2's web pages open their phone screens", () => {
    expect(appHrefFor("/app/pending")).toBe("/cases");
    expect(appHrefFor("/app/applications")).toBe("/application");
    expect(appHrefFor("/app/applications/3afad3ae-2c84-4bde-a6b5-1dabd5d4bc2d")).toBe("/cases/3afad3ae-2c84-4bde-a6b5-1dabd5d4bc2d");
    expect(appHrefFor("/app/deal-flow")).toBe("/deal-flow");
    expect(appHrefFor("/app/policies")).toBe("/book");
    expect(appHrefFor("/app/policies/carrier/c1/P123")).toBe("/book/c1/P123");
    expect(appHrefFor("/app/needs-you")).toBe("/book/sync");
    expect(appHrefFor("/app/retention")).toBe("/retention");
    expect(appHrefFor("/app/retention/3afad3ae-2c84-4bde-a6b5-1dabd5d4bc2d")).toBe("/retention/3afad3ae-2c84-4bde-a6b5-1dabd5d4bc2d");
    expect(appHrefFor("/app/servicing")).toBe("/retention/waiting");
    expect(appHrefFor("/app/reinstatement")).toBe("/retention/win-back");
    // Still on the computer.
    expect(appHrefFor("/app/retention-settings")).toBeNull();
    expect(appHrefFor("/app/ledger")).toBeNull();
  });
  test("Calls parts follow the server's gates", () => {
    expect(callsPartsFor("setter")).toEqual(["dialer"]);
    expect(callsPartsFor("assistant")).toEqual(["incoming", "callbacks"]);
    expect(callsPartsFor("producer")).toEqual(["incoming", "dialer", "callbacks"]);
  });
});

describe("web links become app screens", () => {
  test("a lead link opens the lead page", () => {
    expect(appHrefFor("/app/leads/3afad3ae-2c84-4bde-a6b5-1dabd5d4bc2d")).toBe("/lead/3afad3ae-2c84-4bde-a6b5-1dabd5d4bc2d");
  });
  test("transfers, the dialer and callbacks open the matching Calls part", () => {
    expect(appHrefFor("/app/inbound")).toBe("/calls?part=incoming");
    expect(appHrefFor("/app/dialer")).toBe("/calls?part=dialer");
    expect(appHrefFor("/app/callbacks")).toBe("/calls?part=callbacks");
  });
  test("anything outside /app/ is never followed", () => {
    expect(appHrefFor("https://evil.example/app/leads")).toBeNull();
    expect(appHrefFor("//evil.example")).toBeNull();
    expect(appHrefFor(null)).toBeNull();
  });
});

describe("formatting", () => {
  test("large counts fit a tile", () => {
    expect(compactCount(54)).toBe("54");
    expect(compactCount(12800)).toBe("12.8k");
    expect(compactCount(140000)).toBe("140k");
    expect(compactCount(1_400_000)).toBe("1.4M");
  });
  test("missed callbacks still need a call (the web counts them as due)", () => {
    expect(callbackOpen("missed")).toBe(true);
    expect(callbackOpen("scheduled")).toBe(true);
    expect(callbackOpen("completed")).toBe(false);
    expect(callbackOpen("cancelled")).toBe(false);
  });
  test("stored codes read as words", () => {
    expect(codeLabel("term_life")).toBe("Term life");
    expect(codeLabel(null)).toBeNull();
  });
  test("a lead's name comes from whichever fields the template has", () => {
    expect(leadName({ first_name: "Minnie", last_name: "Hargrove" })).toBe("Minnie Hargrove");
    expect(leadName({ full_name: "Linda Okafor" })).toBe("Linda Okafor");
    expect(leadName({})).toBe("Unnamed lead");
  });
  test("US phone numbers", () => {
    expect(phoneLabel("+13055552409")).toBe("(305) 555-2409");
    expect(phoneLabel(null)).toBeNull();
  });
});
