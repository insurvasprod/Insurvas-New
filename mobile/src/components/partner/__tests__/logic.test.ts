import {
  ageFrom, breakdownText, formLayout, liveMeta, pipelineFilters, shortDay, soonWords, transferFacts,
  conversationRows, consentField, consentProblem, filterCounts, formFields, homeFigures, inFilter, leadChip, leadMeta, missingRequired,
  monthRange, nameMap, nextPayout, pageAllowed, readMark, sendMode, stateCode, submissionId, threadItems, totalUnread, withDefaults,
} from "../logic";
import type { ChatMessage, PartnerLeadRow, TemplateField } from "../types";

const row = (over: Partial<PartnerLeadRow> = {}): PartnerLeadRow => ({
  id: "l1", workItemId: "w1", customer: "Ida Collins", submittedAt: "2026-11-20T19:12:00Z", updatedAt: "2026-11-21T10:00:00Z", product: "Final expense",
  stageId: "s1", stageName: "Contacted", stageType: "open", disposition: null, outcome: null, submittedBy: { id: "u1", name: "Maya Santos" }, status: "claimed", lane: "claimed", ...over,
});

describe("which pages a partner gets (portalAccess.ts)", () => {
  it("statements and team are the partner admin's", () => {
    expect(pageAllowed("statements", { partnerType: "publisher", role: "partner_user", hasTeam: false })).toBe(false);
    expect(pageAllowed("statements", { partnerType: "publisher", role: "partner_admin", hasTeam: false })).toBe(true);
    expect(pageAllowed("team", { partnerType: "marketing", role: "partner_user", hasTeam: false })).toBe(false);
  });
  it("an affiliate gets links and no template form; team access only with a team", () => {
    expect(pageAllowed("links", { partnerType: "affiliate", role: "partner_admin", hasTeam: false })).toBe(true);
    expect(pageAllowed("submit", { partnerType: "affiliate", role: "partner_admin", hasTeam: false })).toBe(false);
    expect(pageAllowed("team", { partnerType: "affiliate", role: "partner_admin", hasTeam: false })).toBe(false);
    expect(pageAllowed("team", { partnerType: "affiliate", role: "partner_admin", hasTeam: true })).toBe(true);
    expect(pageAllowed("links", { partnerType: "publisher", role: "partner_admin", hasTeam: true })).toBe(false);
  });
  it("a call centre sends the template; marketing and affiliates the short referral", () => {
    expect(sendMode("publisher")).toBe("template");
    expect(sendMode("marketing")).toBe("referral");
    expect(sendMode("affiliate")).toBe("referral");
  });
});

describe("the home's figures", () => {
  it("counts accepted (anything the agency took) and sold, with the rise on last month", () => {
    const rows = [row(), row({ id: "l2", status: "unclaimed", lane: "new" }), row({ id: "l3", status: "completed", disposition: "sold", stageType: "won", lane: "converted" }), row({ id: "l4", status: "expired" })];
    const f = homeFigures(rows, 4, 3);
    expect(f).toMatchObject({ sent: 4, rise: 1, accepted: 2, acceptedPct: 50, sold: 1, per100: 25, complete: true });
  });
  it("says the page is partial when the total is larger than the rows", () => {
    expect(homeFigures([row()], 300, null)).toMatchObject({ complete: false, rise: null });
  });
  it("this month and the whole of last month", () => {
    expect(monthRange(new Date(2026, 10, 25))).toMatchObject({ from: "2026-11-01", prevFrom: "2026-10-01", prevTo: "2026-10-31", month: "November", prevMonth: "October" });
    expect(monthRange(new Date(2026, 0, 5))).toMatchObject({ prevFrom: "2025-12-01", prevTo: "2025-12-31" });
  });
});

describe("one chip per lead, in the partner's stage words", () => {
  it("tones by meaning", () => {
    expect(leadChip(row({ lane: "verification" }))).toEqual({ tone: "info", label: "On a call" });
    expect(leadChip(row({ stageType: "won", stageName: "Sold" }))).toEqual({ tone: "ok", label: "Sold" });
    expect(leadChip(row({ stageType: "lost", stageName: "Returned" }))).toEqual({ tone: "bad", label: "Returned" });
    expect(leadChip(row({ status: "unclaimed", stageName: "Needs review" }))).toEqual({ tone: "warn", label: "Needs review" });
  });
  it("says when it was sent and the coded outcome", () => {
    expect(leadMeta(row({ outcome: "wrong number" }), new Date("2026-11-25T12:00:00Z"))).toBe("Sent 20 Nov · wrong number");
  });
  it("filters by the partner's own stage types, counts from the server's stages", () => {
    expect(inFilter(row(), "open")).toBe(true);
    expect(inFilter(row({ stageType: "lost" }), "lost")).toBe(true);
    expect(inFilter(row({ stageType: "won" }), "open")).toBe(false);
    expect(filterCounts([{ stageType: "open", leadCount: 5, isArchived: false }, { stageType: "open", leadCount: 2, isArchived: false }, { stageType: "won", leadCount: 1, isArchived: false }], 9)).toEqual({ all: 9, open: 7, won: 1, lost: 0, returned: 0 });
  });
});

describe("statements", () => {
  it("what is owed next is the newest published, not paid", () => {
    const runs = [{ id: "a", periodStart: "2026-11-01", periodEnd: "2026-11-30", status: "published" as const, netCents: 431_000, paidOn: null, invoiceNumber: null }, { id: "b", periodStart: "2026-10-01", periodEnd: "2026-10-31", status: "paid" as const, netCents: 372_500, paidOn: "2026-11-05", invoiceNumber: null }];
    expect(nextPayout(runs)?.id).toBe("a");
    expect(nextPayout([runs[1]])).toBeNull();
  });
});

describe("consent is proof, never a tick", () => {
  it("a certificate must look like one; a verbal names its recording", () => {
    expect(consentProblem("certificate", "")).toMatch(/Paste/);
    expect(consentProblem("certificate", "yes")).toMatch(/doesn’t look/);
    expect(consentProblem("certificate", "https://cert.trustedform.com/7f3c0a1b2c3d4e5f60718293a4b5c6d7e8f9a19e")).toBeNull();
    expect(consentProblem("certificate", "7f3c0a1b2c3d4e5f60718293a4b5c6d7e8f9a19e")).toBeNull();
    expect(consentProblem("certificate", "A1B2C3D4-E5F6-1234-ABCD-1234567890AB")).toBeNull();
    expect(consentProblem("verbal", "")).toMatch(/recording/);
    expect(consentProblem("verbal", "REC-20261120-0182")).toBeNull();
  });
  it("files the proof in the template's own consent field and keeps it out of the questions", () => {
    const fields: TemplateField[] = [
      { field_key: "first_name", label: "First name", type: "text", is_required: true, options: [], sort_order: 1 },
      { field_key: "xxTrustedFormCertUrl", label: "TrustedForm", type: "text", is_required: false, options: [], sort_order: 0 },
      { field_key: "note", label: "Note for the agent", type: "long_text", is_required: false, options: [], sort_order: 2 },
    ];
    expect(consentField(fields)?.field_key).toBe("xxTrustedFormCertUrl");
    expect(formFields(fields).map((f) => f.field_key)).toEqual(["first_name", "note"]);
    expect(missingRequired(formFields(fields), { first_name: " " }).map((f) => f.field_key)).toEqual(["first_name"]);
  });
  it("a yes/no question is answered 'no' until switched on", () => {
    const fields: TemplateField[] = [{ field_key: "tobacco", label: "Tobacco", type: "boolean", is_required: true, options: [], sort_order: 0 }];
    expect(missingRequired(fields, {})).toEqual([]);
    expect(withDefaults(fields, {})).toEqual({ tobacco: false });
    expect(withDefaults(fields, { tobacco: true })).toEqual({ tobacco: true });
  });
  it("every submission has a retry key the server accepts", () => {
    expect(submissionId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it("reads a state by code or name", () => {
    expect(stateCode("al")).toBe("AL");
    expect(stateCode("Alabama")).toBe("AL");
    expect(stateCode("Narnia")).toBeNull();
  });
});

describe("chat", () => {
  const msg = (over: Partial<ChatMessage>): ChatMessage => ({ id: "m", channelId: "c", workItemId: null, message: "", messageKind: "text", cardType: null, cardPayload: {}, createdBy: null, createdAt: "2026-11-25T19:09:00Z", attachments: [], ...over });
  const names = nameMap({ partnerUsers: [{ user_id: "maya", users: { name: "Maya Santos", email: null } }], tenantUsers: [{ user_id: "me", users: { name: "Jordan Lee", email: null } }] });
  const messages = [
    msg({ id: "1", createdBy: "maya", message: "Transferring Dolores King now, 71, Jacksonville." }),
    msg({ id: "2", createdBy: "maya", messageKind: "system_card", cardType: "new_lead", workItemId: "w9", cardPayload: { customer: "Dolores King", product: "Final Expense", state: "FL" }, createdAt: "2026-11-25T19:10:00Z" }),
    msg({ id: "3", createdBy: "me", message: "Got her, on the call now.", createdAt: "2026-11-25T19:12:00Z" }),
  ];
  it("draws theirs left with who and when, mine right, and a lead as a record card", () => {
    const items = threadItems(messages, "me", names, { otherSide: "Apex Leads", now: new Date("2026-11-25T20:00:00Z") });
    expect(items[0].kind).toBe("day");
    expect(items[1]).toMatchObject({ kind: "bubble", mine: false });
    expect((items[1] as { meta: string }).meta).toMatch(/^Maya · /);
    expect(items[2]).toMatchObject({ kind: "card", customer: "Dolores King", facts: "Final Expense · FL", workItemId: "w9" });
    expect((items[2] as { meta: string }).meta).toMatch(/^Maya · Apex Leads · /);
    expect(items[3]).toMatchObject({ kind: "bubble", mine: true, meta: null });
  });
  it("says read only once the other side read past my last message", () => {
    expect(readMark(messages, "me", "2026-11-25T19:11:00Z")).toBeNull();
    expect(readMark(messages, "me", "2026-11-25T19:12:30Z")).toMatch(/^Read /);
  });
  it("lists conversations newest first with unread counts", () => {
    const channels = [
      { channel: { id: "a", name: "Ellery & Fields · billing", channel_type: "group" as const, status: "active" as const }, messages: [msg({ id: "x", createdBy: "me", message: "Thanks", createdAt: "2026-11-20T10:00:00Z" })], unreadCount: 0 },
      { channel: { id: "b", name: "Ellery & Fields", channel_type: "partner" as const, status: "active" as const }, messages, unreadCount: 2 },
      { channel: { id: "c", name: "Old", channel_type: "group" as const, status: "archived" as const }, messages: [], unreadCount: 5 },
    ];
    const rows = conversationRows(channels, "maya", names);
    expect(rows.map((r) => r.id)).toEqual(["b", "a"]);
    expect(rows[0].preview).toBe("Jordan: Got her, on the call now.");
    expect(rows[1].preview).toBe("Jordan: Thanks");
    expect(totalUnread(channels)).toBe(2);
  });
});

describe("board K · the live line, Returned, payouts and the form layout", () => {
  const at = (h: number, m: number, d = 27) => new Date(2026, 10, d, h, m).toISOString();
  const now = new Date(2026, 10, 27, 15, 0);
  it("a lead on a call names the agent by first name and the claim time", () => {
    const r = row({ lane: "verification", live: { claimedBy: "Jordan", claimedAt: at(14, 9), callbackAt: null } });
    expect(liveMeta(r, "home", now)).toBe("Transferred 2:09 pm · Jordan took it");
    expect(liveMeta(r, "pipeline", now)).toBe("On a call with Jordan · 2:09 pm");
  });
  it("callback, applied, waiting and an outcome each read as the board writes them", () => {
    expect(liveMeta(row({ live: { claimedBy: null, claimedAt: null, callbackAt: at(10, 0, 28) } }), "pipeline", now)).toBe("Callback tomorrow");
    expect(liveMeta(row({ disposition: "application_submitted" }), "pipeline", now)).toBe("Applied · at the carrier");
    expect(liveMeta(row({ status: "unclaimed", submittedAt: at(9, 0) }), "home", now)).toBe("Sent today · agency is reviewing");
    expect(liveMeta(row({ status: "unclaimed" }), "pipeline", now)).toBe("Agency is reviewing");
    expect(liveMeta(row({ stageType: "lost", stageName: "Returned", outcome: "Wrong number", status: "completed", lane: "closed", submittedAt: at(9, 0, 20) }), "home", now)).toBe("Sent 20 Nov · returned: wrong number");
    expect(liveMeta(row({ outcome: "Interested" }), "pipeline", now)).toBe("Contacted · interested");
  });
  it("a day in the coming week is its weekday", () => {
    expect(soonWords(at(10, 0, 28), now)).toBe("tomorrow");
    expect(soonWords(at(10, 0, 30), now)).toBe("Mon");
    expect(soonWords(at(10, 0, 9), now)).toBe("9 Nov");
  });
  it("Returned is offered only when the partner's own pipeline has that stage, and Not sold leaves it out", () => {
    const stages = [{ stageType: "lost", name: "Returned", leadCount: 24, isArchived: false }, { stageType: "lost", name: "Not interested", leadCount: 100, isArchived: false }];
    expect(pipelineFilters(stages).map((f) => f.key)).toContain("returned");
    expect(pipelineFilters([{ stageType: "lost", name: "Not interested" }]).map((f) => f.key)).not.toContain("returned");
    expect(filterCounts(stages, 124)).toMatchObject({ lost: 100, returned: 24 });
    expect(inFilter(row({ stageType: "lost", stageName: "Returned" }), "returned")).toBe(true);
    expect(inFilter(row({ stageType: "lost", stageName: "Returned" }), "lost")).toBe(false);
  });
  it("the payout breakdown and day", () => {
    expect(breakdownText([{ itemType: "sale", count: 41, rateCents: 9500 }, { itemType: "transfer", count: 12, rateCents: 3500 }])).toBe("41 sold leads × $95 + 12 transfers × $35");
    expect(breakdownText([{ itemType: "transfer", count: 1, rateCents: 3550 }])).toBe("1 transfer × $35.50");
    expect(breakdownText([])).toBeNull();
    expect(shortDay("2026-12-05")).toBe("5 Dec");
  });
  it("the transfer card's age · state · product from the answers", () => {
    expect(ageFrom("1955-04-09", new Date(2026, 10, 27))).toBe(71);
    expect(ageFrom("12/30/1956", new Date(2026, 10, 27))).toBe(69);
    expect(ageFrom("soon")).toBeNull();
    expect(transferFacts({ date_of_birth: "1956-04-09", state: "Alabama" }, "Final expense")).toMatch(/^\d+ · AL · final expense$/);
    expect(transferFacts({}, "Final expense")).toBe("final expense");
  });
  it("lays the form out as the board: First | Last, Phone, Date of birth | State, the rest, a note last", () => {
    const f = (field_key: string, type: TemplateField["type"] = "text", sort_order = 0): TemplateField => ({ field_key, label: field_key, type, is_required: false, options: [], sort_order });
    const layout = formLayout([f("agent_note", "long_text"), f("first_name"), f("coverage"), f("state"), f("last_name"), f("phone", "phone"), f("date_of_birth", "date")]);
    expect(layout.top.map((r) => (r.kind === "pair" ? `${r.left.field_key}|${r.right.field_key}` : r.field.field_key))).toEqual(["first_name|last_name", "phone", "date_of_birth|state"]);
    expect(layout.rest.map((r) => (r.kind === "one" ? r.field.field_key : ""))).toEqual(["coverage"]);
    expect(layout.notes.map((r) => (r.kind === "one" ? r.field.field_key : ""))).toEqual(["agent_note"]);
  });
});
