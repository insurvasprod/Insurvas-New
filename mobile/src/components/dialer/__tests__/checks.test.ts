import { bothClocks, complianceChecks, headTicks, minuteLabel, ordinal, windowChip, type CheckPanel } from "../checks";

/**
 * Board C7b: the checks are worded from the dialer panel only. A list hit is a red cross, a list the
 * server did not read is never shown as passed, and every time carries the customer's clock and ours.
 */
const NOW = new Date("2026-11-24T19:12:00Z"); // 1:12 pm in Houston, 2:12 pm in New York
const base = (over: Partial<CheckPanel> = {}): CheckPanel => ({
  lead: { state: "TX", city: "Houston", attemptsMade: 2, attemptCeiling: 6 },
  window: { allowed: true, startMinute: 480, endMinute: 1260, zone: "America/Chicago", reason: "open" },
  eligibility: {
    allowed: true, reason: "ready", message: "", checkedAt: "2026-11-24T19:11:00Z", timezone: "America/Chicago", dncCheck: "clear",
    suppression: "clear", suppressionHits: [], licence: { status: "live", state: "TX", expiresAt: "2027-03-31", message: null }, dncExemption: null,
  },
  consent: { hasCertificate: true, provider: "web_form", status: "captured", capturedAt: "2026-11-18T21:42:00Z", consentTimestamp: "2026-11-18T21:42:00Z" },
  ...over,
});
const byKey = (panel: CheckPanel) => Object.fromEntries(complianceChecks(panel, NOW, "America/New_York").map((c) => [c.key, c]));

test("a clean number reads as the board draws it, with both clocks", () => {
  const c = byKey(base());
  expect(c.consent).toMatchObject({ state: "ok", title: "Written consent" });
  expect(c.consent.detail).toBe("Web form · 18 Nov 3:42 pm (4:42 pm yours) · certificate on file");
  expect(c.federal_dnc).toMatchObject({ state: "ok", title: "National Do Not Call list", detail: "Not listed · checked today 1:11 pm (2:11 pm yours)" });
  expect(c.state_dnc.title).toBe("Texas Do Not Call list");
  expect(c.tcpa_litigator).toMatchObject({ state: "ok", title: "Known litigator list", detail: "Not listed" });
  expect(c.internal).toMatchObject({ state: "ok", detail: "Not listed" });
  expect(c.window).toMatchObject({ state: "ok", detail: "1:12 pm (2:12 pm yours) in Houston · allowed 8 am – 9 pm" });
  // A live licence is not one of the board's rows; it is listed only when it refuses.
  expect(c.licence).toBeUndefined();
  expect(c.attempts).toMatchObject({ state: "ok", detail: "3rd call · limit 6" });
  // No client answer from an older server: the row is left out rather than guessed.
  expect(c.client).toBeUndefined();
});

test("not already a client: clear, a match, or not checked (never guessed)", () => {
  expect(byKey(base({ client: { status: "clear", basis: null } })).client).toMatchObject({ state: "ok", title: "Not already a client", detail: "No policy on phone or date of birth" });
  expect(byKey(base({ client: { status: "client", basis: "phone" } })).client).toMatchObject({ state: "bad", detail: "Has a policy with your agency · matched on phone" });
  expect(byKey(base({ client: { status: "unknown", basis: null } })).client).toMatchObject({ state: "open", detail: "Could not be checked" });
  // The board's order: consent, the four lists, the window, attempts, then the client check last.
  expect(complianceChecks(base({ client: { status: "clear", basis: null } }), NOW, "America/New_York").map((c) => c.key))
    .toEqual(["consent", "federal_dnc", "state_dnc", "tcpa_litigator", "internal", "window", "attempts", "client"]);
});

test("a list hit is refused; a DNC exemption clears federal and state only", () => {
  const hits = [{ listType: "federal_dnc", reason: "", addedAt: null }, { listType: "tcpa_litigator", reason: "", addedAt: null }];
  const listed = byKey(base({ eligibility: { ...base().eligibility!, allowed: false, reason: "list_suppressed", suppressionHits: hits } }));
  expect(listed.federal_dnc).toMatchObject({ state: "bad", detail: "Listed" });
  expect(listed.tcpa_litigator.state).toBe("bad");
  const exempt = byKey(base({ eligibility: { ...base().eligibility!, suppressionHits: hits, dncExemption: { basis: "written_consent", expiresAt: null, certificateUrl: null } } }));
  expect(exempt.federal_dnc.state).toBe("ok");
  expect(exempt.federal_dnc.detail).toMatch(/cleared by a DNC exemption \(written consent\)/);
  expect(exempt.tcpa_litigator.state).toBe("bad");
});

test("lists the server could not read one by one are never shown as passed", () => {
  const c = byKey(base({ eligibility: { ...base().eligibility!, suppressionHits: null, suppression: "unavailable" } }));
  expect(c.federal_dnc).toMatchObject({ state: "open", detail: "Checked when you call" });
  expect(c.internal).toMatchObject({ state: "bad", detail: "Could not be checked" });
});

test("a closed window, no consent and a missing licence say so", () => {
  const c = byKey(base({ window: { allowed: false, startMinute: 480, endMinute: 1260, zone: "America/Chicago", reason: "before_open" }, consent: null, eligibility: { ...base().eligibility!, licence: { status: "refused", state: "TX", expiresAt: null, message: null } } }));
  expect(c.window.state).toBe("bad");
  expect(c.consent).toMatchObject({ state: "open", detail: "No consent certificate on file" });
  expect(c.licence).toMatchObject({ state: "bad", detail: "Not licensed in Texas" });
});

test("helpers", () => {
  expect(minuteLabel(480)).toBe("8 am");
  expect(minuteLabel(1290)).toBe("9:30 pm");
  expect(minuteLabel(720)).toBe("12 pm");
  expect(ordinal(1)).toBe("1st");
  expect(ordinal(12)).toBe("12th");
  expect(ordinal(23)).toBe("23rd");
  expect(bothClocks(NOW, "America/New_York", "America/New_York")).toBe("2:12 pm");
  expect(bothClocks(NOW, null, "America/New_York")).toBe("2:12 pm");
});

describe("board C7 · the ticks on the current lead", () => {
  const ticks = (panel: CheckPanel) => headTicks(complianceChecks(panel, NOW, "America/New_York")).map((t) => `${t.state}:${t.label}`);

  test("a clean number shows the board's five green ticks", () => {
    expect(ticks(base({ client: { status: "clear", basis: null } }))).toEqual(["ok:Consent", "ok:DNC clear", "ok:Not suppressed", "ok:In window", "ok:Not a client"]);
    expect(ticks(base({ client: { status: "client", basis: "phone" } }))).toContain("bad:Already a client");
  });

  test("a listed number, a closed window and a missing licence are never shown as passed", () => {
    const panel = base({
      window: { allowed: false, startMinute: 480, endMinute: 1260, zone: "America/Chicago", reason: "outside" },
      eligibility: { ...base().eligibility!, suppressionHits: [{ listType: "federal_dnc", reason: "", addedAt: null }], licence: { status: "refused", state: "TX", expiresAt: null, message: null } },
      consent: { hasCertificate: false, provider: null, status: null, capturedAt: null, consentTimestamp: null },
    });
    expect(ticks(panel)).toEqual(["open:No consent on file", "bad:On a DNC list", "ok:Not suppressed", "bad:Outside the window", "bad:Not licensed here"]);
  });

  test("lists the server reads only at the click say so", () => {
    expect(ticks(base({ eligibility: null }))).toContain("open:Lists checked at the call");
  });

  test("the window chip says until when, or when it opens", () => {
    expect(windowChip(base().window, "CT")).toEqual({ tone: "ok", label: "Open till 9 pm CT" });
    expect(windowChip({ allowed: false, startMinute: 480, endMinute: 1260, zone: "America/Chicago", reason: null }, "CT")).toEqual({ tone: "warn", label: "Opens 8 am CT" });
    expect(windowChip(null, null)).toBeNull();
  });
});
