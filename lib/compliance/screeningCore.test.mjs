// LA-1.5-5, -6, -8, -10, -11: the screening decision with injected fake vendors and a fake database.
// Nothing here disables, calls or reconfigures a real compliance vendor.
import test from "node:test";
import assert from "node:assert/strict";

const core = await import("./screeningCore.ts");
const {
  runScreening,
  rankScreeningOutcome,
  isKnownScreeningVersion,
  SCREENING_UNAVAILABLE_MESSAGE,
  SCREENING_TCPA_ALLOWANCE_MESSAGE,
  SCREENING_DNC_ALLOWANCE_MESSAGE,
  SCREENING_TENANT_DNC_MESSAGE,
} = core;

const PHONE = "4155550123";

function vendor(vendorId, vendorType, behaviour) {
  return {
    vendorId,
    vendorType,
    calls: 0,
    async check() {
      this.calls += 1;
      if (behaviour === "timeout") { const error = new Error("The operation was aborted due to timeout"); error.name = "TimeoutError"; throw error; }
      if (behaviour === "http") throw new Error("Vendor answered with HTTP 503");
      return { listed: behaviour === "listed", rawResponse: vendorType === "litigator_scrub" ? { hit: behaviour === "listed" } : { listed: behaviour === "listed" } };
    },
  };
}

/** A fake world: one tenant, a 24-hour cache keyed by phone, two meters and an audit trail. */
function world(options = {}) {
  const state = {
    tenantDnc: options.tenantDnc ?? false,
    existingLead: options.existingLead ?? false,
    cache: new Map(options.cache ?? []),
    rows: new Map(options.rows ?? []),
    litigator: options.litigator ?? [vendor("lit-primary", "litigator_scrub", "clear")],
    dnc: options.dnc ?? [vendor("dnc-primary", "dnc_scrub", "clear")],
    tcpaAllowed: options.tcpaAllowed ?? true,
    dncAllowed: options.dncAllowed ?? true,
    charges: new Map(),
    audits: [],
    providerCalls: [],
    released: 0,
    claims: 0,
  };
  const charge = (key) => state.charges.set(key, (state.charges.get(key) ?? 0) + 1);
  const deps = {
    providers: async (type) => (type === "litigator_scrub" ? state.litigator : state.dnc),
    recordProviderCall: async (entry) => { state.providerCalls.push(entry); },
    maskPhone: (digits) => `•••${digits.slice(-4)}`,
    clock: () => 0,
    tenantSuppressed: async () => state.tenantDnc,
    claim: async (digits) => {
      state.claims += 1;
      const cached = state.cache.get(digits);
      if (cached) return { state: "cached", result_id: cached, claim_token: null };
      return { state: "claimed", result_id: null, claim_token: `token-${state.claims}` };
    },
    loadCached: async (id) => state.rows.get(id) ?? null,
    release: async () => { state.released += 1; },
    checkTcpaCapacity: async () => ({ allowed: state.tcpaAllowed }),
    consumeDncCapacity: async (key) => { if (!state.dncAllowed) return { allowed: false }; charge(key); return { allowed: true }; },
    recordTcpaUsage: async (key) => { charge(key); },
    hasExistingLead: async () => state.existingLead,
    complete: async (params) => {
      const id = `result-${state.rows.size + 1}`;
      state.rows.set(id, { id, phone_digits: params.phoneDigits, outcome: params.outcome, vendor: params.vendor, raw_response: params.rawResponse, version: 1, checked_at: params.checkedAt });
      state.cache.set(params.phoneDigits, id);
      return id;
    },
    audit: async (entry) => { state.audits.push(entry); },
    now: () => new Date("2026-09-25T12:00:00Z"),
  };
  return { state, deps };
}

test("precedence is TCPA > DNC > internal DQ > clear", () => {
  assert.equal(rankScreeningOutcome({ tcpa: true, dnc: true, internalDq: true }), "tcpa_litigator");
  assert.equal(rankScreeningOutcome({ tcpa: false, dnc: true, internalDq: true }), "dnc");
  assert.equal(rankScreeningOutcome({ tcpa: false, dnc: false, internalDq: true }), "internal_dq");
  assert.equal(rankScreeningOutcome({ tcpa: false, dnc: false, internalDq: false }), "clear");
});

test("LA-1.5-5: a litigator on the tenant's own DNC list is blocked as TCPA and not shown as DNC", async () => {
  const { state, deps } = world({ tenantDnc: true, litigator: [vendor("lit", "litigator_scrub", "listed")] });
  const decision = await runScreening(deps, PHONE);
  assert.equal(decision.outcome, "tcpa_litigator");
  assert.equal(decision.allowed, false);
  assert.equal(decision.warning, null);
  assert.equal(state.audits.length, 1, "one screen, one audit row");
  assert.equal(state.audits[0].outcome, "tcpa_litigator");
  assert.equal(state.audits[0].rawResponse.tenant_do_not_call, true, "the tenant-list hit is still on the record");
});

test("LA-1.5-5: a clear number on the tenant's list warns DNC, meters once and replays from cache without a second charge", async () => {
  const { state, deps } = world({ tenantDnc: true });
  const first = await runScreening(deps, PHONE);
  assert.equal(first.outcome, "dnc");
  assert.equal(first.allowed, true);
  assert.deepEqual(first.warning, { code: "dnc", message: SCREENING_TENANT_DNC_MESSAGE });
  assert.equal(state.audits[0].vendor, "tenant_suppression");
  assert.equal(state.litigator[0].calls, 1, "the litigator list ran even though the tenant list hit");
  const chargesAfterFirst = [...state.charges.values()].reduce((a, b) => a + b, 0);
  assert.equal(chargesAfterFirst, 2, "one TCPA check and one DNC lookup");

  const second = await runScreening(deps, PHONE);
  assert.equal(second.outcome, "dnc");
  assert.equal(second.cached, true);
  assert.equal(state.litigator[0].calls, 1, "no second vendor call inside the TTL");
  assert.equal([...state.charges.values()].reduce((a, b) => a + b, 0), 2, "no second charge inside the TTL");
  assert.ok([...state.charges.values()].every((count) => count === 1), "every idempotency key charged once");
});

test("LA-1.5-5: the tenant's DNC list outranks an internal DQ", async () => {
  const { deps } = world({ tenantDnc: true, existingLead: true });
  const decision = await runScreening(deps, PHONE);
  assert.equal(decision.outcome, "dnc");
  assert.equal(decision.warning.code, "dnc");
});

test("LA-1.5-4: an internal DQ is read fresh, not hidden by a cached clear result", async () => {
  const { state, deps } = world();
  assert.equal((await runScreening(deps, PHONE)).outcome, "clear");
  state.existingLead = true;
  const again = await runScreening(deps, PHONE);
  assert.equal(again.cached, true);
  assert.equal(again.outcome, "internal_dq");
  assert.equal(again.warning.code, "internal_dq");
});

test("LA-1.5-8: a failing primary falls back to the secondary, and the fallback is logged", async () => {
  const primary = vendor("lit-primary", "litigator_scrub", "timeout");
  const secondary = vendor("lit-secondary", "litigator_scrub", "listed");
  const { state, deps } = world({ litigator: [primary, secondary] });
  const decision = await runScreening(deps, PHONE);
  assert.equal(primary.calls, 1);
  assert.equal(secondary.calls, 1);
  assert.equal(decision.outcome, "tcpa_litigator", "the secondary's answer is the decision");
  const fallback = state.providerCalls.filter((call) => call.method === "fallback");
  assert.equal(fallback.length, 1);
  assert.deepEqual(fallback[0].request, { fromVendorId: "lit-primary", toVendorId: "lit-secondary", vendorType: "litigator_scrub" });
  assert.equal(state.providerCalls.find((call) => call.provider === "compliance_vendor:lit-primary" && call.method === "litigator_scrub").status, "timeout");
  assert.match(state.audits[0].vendor, /litigator:lit-secondary/);
});

test("LA-1.5-6: when every vendor fails the screen blocks with the exact copy and caches nothing", async () => {
  const { state, deps } = world({ dnc: [vendor("dnc-a", "dnc_scrub", "http"), vendor("dnc-b", "dnc_scrub", "timeout")] });
  const decision = await runScreening(deps, PHONE);
  assert.equal(decision.outcome, "unavailable");
  assert.equal(decision.allowed, false);
  assert.equal(decision.message, "Screening could not be completed. Do not treat this number as safe.");
  assert.equal(decision.message, SCREENING_UNAVAILABLE_MESSAGE);
  assert.equal(state.cache.size, 0, "an incomplete screen is never cached");
  assert.equal(state.released, 1, "the claim is released for the next attempt");
  assert.equal(state.audits[0].outcome, "unavailable");
});

test("LA-1.5-6: a tenant-DNC number is not waved through when the litigator vendor is down", async () => {
  const { deps } = world({ tenantDnc: true, litigator: [vendor("lit", "litigator_scrub", "timeout")] });
  const decision = await runScreening(deps, PHONE);
  assert.equal(decision.outcome, "unavailable");
  assert.equal(decision.allowed, false);
});

test("LA-1.5-11: an exhausted allowance gets its own message and calls no vendor", async () => {
  const tcpa = world({ tcpaAllowed: false });
  const blocked = await runScreening(tcpa.deps, PHONE);
  assert.equal(blocked.outcome, "unavailable");
  assert.equal(blocked.message, SCREENING_TCPA_ALLOWANCE_MESSAGE);
  assert.equal(tcpa.state.litigator[0].calls, 0);
  assert.equal(tcpa.state.charges.size, 0);

  const dnc = world({ dncAllowed: false });
  const dncBlocked = await runScreening(dnc.deps, PHONE);
  assert.equal(dncBlocked.message, SCREENING_DNC_ALLOWANCE_MESSAGE);
  assert.equal(dnc.state.dnc[0].calls, 0);
});

test("LA-1.5-10: a cached result with an unknown version is refused, not replayed", async () => {
  const { state, deps } = world({
    cache: [[PHONE, "old"]],
    rows: [["old", { id: "old", phone_digits: PHONE, outcome: "clear", vendor: "x", raw_response: {}, version: 99, checked_at: "2026-09-25T00:00:00Z" }]],
  });
  const decision = await runScreening(deps, PHONE);
  assert.equal(decision.outcome, "unavailable");
  assert.equal(decision.allowed, false);
  assert.equal(state.audits[0].rawResponse.error, "unknown_screening_version");
  assert.equal(isKnownScreeningVersion(1), true);
  assert.equal(isKnownScreeningVersion(99), false);
  assert.equal(isKnownScreeningVersion(null), false);
});

test("an audit that cannot be written fails the screen closed", async () => {
  const { deps } = world();
  deps.audit = async () => { throw new Error("audit down"); };
  const decision = await runScreening(deps, PHONE);
  assert.equal(decision.allowed, false);
  assert.equal(decision.outcome, "unavailable");
});
