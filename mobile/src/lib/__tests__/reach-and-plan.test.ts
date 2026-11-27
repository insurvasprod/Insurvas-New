import { groupsFor } from "@/components/menu/pages";
import { resolveIntentPath } from "@/components/native/intents";
import { appHrefFor, reachable } from "@/lib/links";
import { callsPartsFor, tabsFor } from "@/lib/roles";

/**
 * 2026-11-26: an owner on Team · Money tapped Calendar, Callbacks and the like and landed back on Home: the links
 * went to the Calls tab, which that bar hides. Every link now lands on a screen the person's bar can open.
 */
const OWNER = tabsFor("owner");
const PRODUCER = tabsFor("producer");

describe("links land on a screen the tab bar can open", () => {
  it("sends an owner on Team · Money to the pushed Calls and Leads", () => {
    expect(appHrefFor("/app/dialer", OWNER)).toBe("/calls-page?part=dialer");
    expect(appHrefFor("/app/callbacks", OWNER)).toBe("/calls-page?part=callbacks");
    expect(appHrefFor("/app/inbound", OWNER)).toBe("/calls-page?part=incoming");
    expect(appHrefFor("/app/leads", OWNER)).toBe("/leads-page");
    expect(appHrefFor("/app/leads/3f8a6e2c-1111-4222-8333-944455556666", OWNER)).toBe("/lead/3f8a6e2c-1111-4222-8333-944455556666");
  });

  it("keeps a producer on their own tabs", () => {
    expect(appHrefFor("/app/dialer", PRODUCER)).toBe("/calls?part=dialer");
    expect(appHrefFor("/app/leads", PRODUCER)).toBe("/leads");
  });

  it("opens the Calendar as its month screen for everyone", () => {
    expect(appHrefFor("/app/calendar", OWNER)).toBe("/calendar");
    expect(appHrefFor("/app/calendar", PRODUCER)).toBe("/calendar");
  });

  it("gives a manager the Calls tab but the pushed Leads", () => {
    const manager = tabsFor("manager");
    expect(reachable("/calls?part=callbacks", manager)).toBe("/calls?part=callbacks");
    expect(reachable("/leads", manager)).toBe("/leads-page");
  });

  it("leaves links alone when the tabs are not known yet", () => {
    expect(reachable("/calls?part=dialer", null)).toBe("/calls?part=dialer");
    expect(appHrefFor("/app/dialer")).toBe("/calls?part=dialer");
  });

  it("routes a shortcut through the same check", () => {
    expect(resolveIntentPath("insurvas://serve-next", 1, OWNER)).toBe("/calls-page?part=dialer");
    expect(resolveIntentPath("insurvas://add-lead", 7, OWNER)).toBe("/leads-page?add=7");
    expect(resolveIntentPath("insurvas://serve-next", 1, PRODUCER)).toBe("/calls?part=dialer");
  });
});

describe("the menu gives an owner the Calls and Leads rows", () => {
  const keys = (gs: ReturnType<typeof groupsFor>) => gs.flatMap((g) => g.pages.map((p) => p.key));

  it("adds Dialer, Callbacks, Incoming and Leads when they are not tabs", () => {
    const k = keys(groupsFor(["owner"], { tabs: OWNER }));
    expect(k).toEqual(expect.arrayContaining(["leads.dialer", "sell.callbacks", "leads.inbound", "leads.workspace", "sell.calendar"]));
  });

  it("leaves them out when they are tabs", () => {
    const k = keys(groupsFor(["owner"], { tabs: tabsFor("owner", { producerTabs: true }) }));
    expect(k).not.toContain("leads.dialer");
    expect(k).not.toContain("leads.workspace");
  });

  it("never gives them to a bookkeeper", () => {
    expect(keys(groupsFor(["bookkeeper"], { tabs: tabsFor("bookkeeper") }))).not.toContain("leads.dialer");
  });
});

describe("the plan's features", () => {
  // Ledger: the book and the money, no CRM (no lead_import, no dialing).
  const LEDGER = ["book_of_business", "commission_ledger", "statement_ingestion", "profit_and_loss", "chargeback_radar"];

  it("hides the menu pages the plan does not include", () => {
    const k = groupsFor(["owner"], { features: LEDGER, tabs: tabsFor("owner", { features: LEDGER }) }).flatMap((g) => g.pages.map((p) => p.key));
    expect(k).toContain("book.policies");
    expect(k).not.toContain("sell.calendar");
    expect(k).not.toContain("leads.lists");
    expect(k).not.toContain("leads.dialer");
    expect(k).toContain("insight.reports");
  });

  it("drops the Calls and Leads tabs a plan without them would bounce", () => {
    expect(tabsFor("producer", { features: LEDGER })).toEqual(["index", "inbox", "menu"]);
    expect(tabsFor("retention", { features: LEDGER })).toEqual(["index", "ladder", "policies", "inbox", "menu"]);
  });

  it("narrows Calls to the parts the plan has", () => {
    expect(callsPartsFor("producer", ["outbound_dialing"])).toEqual(["dialer"]);
    expect(callsPartsFor("producer", null)).toEqual(["incoming", "dialer", "callbacks"]);
  });

  it("hides nothing when the plan is unknown", () => {
    expect(tabsFor("producer", { features: null })).toEqual(["index", "calls", "leads", "inbox", "menu"]);
  });
});

describe("the server's own menu keys decide the rows", () => {
  const keys = (gs: ReturnType<typeof groupsFor>) => gs.flatMap((g) => g.pages.map((p) => p.key));
  // GET /api/app/me for an assistant inside an agency (2026-11-26 walk): no Consent locker, no Check a number.
  const ASSISTANT = ["home.dashboard", "leads.floor", "leads.inbound", "sell.callbacks", "sell.calendar", "leads.workspace", "insight.callbacks", "settings.root"];

  it("drops a page the server refuses this person, even when the role list allows it", () => {
    const k = keys(groupsFor(["assistant"], { tabs: tabsFor("assistant"), menuKeys: ASSISTANT }));
    expect(k).not.toContain("compliance.consent");
    expect(k).not.toContain("compliance.tcpa");
    expect(k).toEqual(expect.arrayContaining(["sell.calendar", "insight.callbacks", "insight.reports"]));
  });

  it("keeps the phone's own rows that have no web key", () => {
    expect(keys(groupsFor(["owner"], { tabs: OWNER, menuKeys: ["sell.calendar"] }))).toEqual(expect.arrayContaining(["setup", "insight.reports", "sell.calendar"]));
  });

  it("falls back to roles and plan when the server sends no keys", () => {
    expect(keys(groupsFor(["producer"], { tabs: PRODUCER, menuKeys: null }))).toContain("compliance.consent");
  });
});

describe("a solo owner gets the tabs of their own work (owner 2026-11-26)", () => {
  const BASIC = ["lead_import", "outbound_dialing", "inbound_transfers", "callback_calendar", "book_of_business"];
  const LEDGER = ["book_of_business", "commission_ledger", "statement_ingestion", "discrepancy_report"];

  it("gives a solo owner on a plan that sells Calls and Leads, not Team and Money", () => {
    expect(tabsFor("owner", { solo: true, features: BASIC })).toEqual(["index", "calls", "leads", "inbox", "menu"]);
  });

  it("gives a solo owner on a book-only plan Money and Book", () => {
    expect(tabsFor("owner", { solo: true, features: LEDGER })).toEqual(["index", "moneytab", "policies", "inbox", "menu"]);
  });

  it("keeps an agency owner on Team and Money", () => {
    expect(tabsFor("owner", { solo: false, features: BASIC })).toEqual(["index", "teamtab", "moneytab", "inbox", "menu"]);
  });

  it("lets a solo owner's links reach the Calls tab directly", () => {
    expect(appHrefFor("/app/dialer", tabsFor("owner", { solo: true, features: BASIC }))).toBe("/calls?part=dialer");
  });
});

test("Menu: Check a number follows the preflight route's gate even when the web menu lists it", () => {
  const keys = (gs: ReturnType<typeof groupsFor>) => gs.flatMap((g) => g.pages.map((p) => p.key));
  const menuKeys = ["compliance.tcpa"];
  expect(keys(groupsFor(["setter"], { menuKeys, baseRole: "setter" }))).not.toContain("compliance.tcpa");
  expect(keys(groupsFor(["assistant"], { menuKeys, baseRole: "assistant" }))).not.toContain("compliance.tcpa");
  expect(keys(groupsFor(["producer", "manager"], { menuKeys, baseRole: "producer", features: ["tcpa_checker"] }))).not.toContain("compliance.tcpa");
  expect(keys(groupsFor(["producer", "manager"], { menuKeys, baseRole: "producer", features: ["tcpa_checker", "outbound_dialing"] }))).toContain("compliance.tcpa");
});
