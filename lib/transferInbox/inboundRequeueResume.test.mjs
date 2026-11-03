/**
 * Behaviour of the inbound requeue / resume / language work (20260925709860) on the app side, run
 * against the real modules with the database client replaced by a recording fake.
 *
 *   LA-1.14-10  languageKey reads a language the way public.language_key does
 *   LA-1.14-7   the partner's Connected card is posted once per claim, a re-claim included
 *   LA-1.11-6   a resumed claim is reported, and audited
 *   LA-1.14-9   the release errors, CALL_ENDED included, map to clear messages
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire, registerHooks } from "node:module";

const root = process.cwd();
const ts = createRequire(join(root, "package.json"))("typescript");
const state = (globalThis.__requeue = { cardCalls: [], audits: [], rpc: {}, rpcCalls: [], tables: {} });

const stubs = {
  "server-only": "export {};",
  "@/lib/partnerChat/service": "export async function postPartnerSystemCard(input) { globalThis.__requeue.cardCalls.push(input); return { alreadyPosted: false, id: 'm1' }; }",
  "@/lib/audit/log": "export async function audit(entry) { globalThis.__requeue.audits.push(entry); }",
  "@/lib/supabase/service": `
    function builder(table) {
      const result = () => Promise.resolve(globalThis.__requeue.tables[table] ?? { data: null, error: null });
      const b = new Proxy({}, { get(_, key) {
        if (key === "then") return (ok, bad) => result().then(ok, bad);
        if (key === "maybeSingle" || key === "single") return () => result();
        return () => b;
      } });
      return b;
    }
    export function getSupabaseServiceClient() {
      return {
        from: (table) => builder(table),
        rpc: async (name, args) => { globalThis.__requeue.rpcCalls.push({ name, args }); return globalThis.__requeue.rpc[name] ?? { data: null, error: { message: "unexpected rpc " + name } }; },
      };
    }`,
};

registerHooks({
  resolve(specifier, context, next) {
    if (Object.hasOwn(stubs, specifier)) return { url: `stub:${specifier}`, shortCircuit: true };
    if (specifier.startsWith("@/")) throw new Error(`unstubbed import ${specifier}`);
    if (specifier.startsWith(".") && !/\.[cm]?[jt]s$/.test(specifier)) return next(`${specifier}.ts`, context);
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith("stub:")) return { format: "module", source: stubs[url.slice(5)], shortCircuit: true };
    if (url.startsWith("file:") && url.endsWith(".ts")) {
      const out = ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: false } });
      return { format: "module", source: out.outputText, shortCircuit: true };
    }
    return next(url, context);
  },
});

const load = (path) => import(pathToFileURL(join(root, ...path.split("/"))).href);
const request = new Request("http://localhost/api", { headers: { "user-agent": "node-test" } });

test("LA-1.14-10: languageKey reads a language the way public.language_key does", async () => {
  const { languageKey, languageName } = await load("lib/transferInbox/constants.ts");
  // The same cases 20260925709850 asserts in SQL.
  for (const [value, key] of [["Spanish", "spanish"], ["es", "spanish"], ["es-MX", "spanish"], ["ES_mx", "spanish"], ["English", "english"], ["en", "english"], ["Haitian Creole", "haitian creole"], ["fil", "fil"], ["", null], [null, null]]) {
    assert.equal(languageKey(value), key, `languageKey(${JSON.stringify(value)})`);
  }
  assert.equal(languageName("spanish"), "Spanish");
  assert.equal(languageName("es-MX"), "Spanish");
  assert.equal(languageName(null), "another language");
});

test("LA-1.14-9: the three confirmations are distinct, and ending buffer involvement says it is not an unassign", async () => {
  const { releaseConfirmation } = await load("lib/transferInbox/constants.ts");
  const unassign = releaseConfirmation("unassign", { customer: "Ada Stone" });
  const requeue = releaseConfirmation("requeue", { customer: "Ada Stone" });
  const end = releaseConfirmation("end_buffer", { customer: "Ada Stone", bufferName: "Bea", agentName: "Ray" });
  assert.equal(new Set([unassign, requeue, end]).size, 3);
  assert.match(unassign, /^Give Ada Stone back to the queue\?/);
  assert.match(requeue, /picks up the verification where it stopped/);
  assert.match(end, /^End Bea's involvement\? Ray keeps the call and the verification\. This does not unassign the transfer\.$/);
  assert.match(releaseConfirmation("end_buffer"), /^End the buffer's involvement\? The licensed agent keeps the call/);
});

test("LA-1.11-6: the claim toast says when the verification resumed", async () => {
  const { claimedMessage } = await load("lib/transferInbox/constants.ts");
  assert.equal(claimedMessage({ chatPosted: true }), "Transfer claimed and call opened");
  assert.equal(claimedMessage({ chatPosted: true, resumed: true }), "Transfer claimed; verification resumed where it stopped");
  assert.equal(claimedMessage({ chatPosted: false }), "Transfer claimed; partner update could not be posted");
  assert.match(claimedMessage({ chatPosted: false, resumed: true }), /verification resumed; partner update could not be posted/);
  assert.equal(claimedMessage(null), "Transfer claimed and call opened");
});

test("LA-1.14-7: a first claim keeps its card key; each re-claim after a requeue posts its own card", async () => {
  const { announceTransferClaim, claimCardKey, claimWasResumed } = await load("lib/transferInbox/service.ts");
  assert.equal(claimCardKey("w1", false, 0), "claim:w1");
  assert.equal(claimCardKey("w1", true, undefined), "buffer-claim:w1");
  assert.equal(claimCardKey("w1", false, 2), "claim:w1:requeue-2");
  assert.equal(claimWasResumed({ resumed_verification: true }), true);
  assert.equal(claimWasResumed({ resumed_verification: "yes" }), false);
  assert.equal(claimWasResumed(null), false);

  state.tables.lead_queue = { data: { partner_id: "p1", agent_leads: { values: { full_name: "Ada Stone" } } }, error: null };
  state.cardCalls.length = 0; state.audits.length = 0;
  await announceTransferClaim({ tenantId: "t1", userId: "u1", role: "producer", workItemId: "w1", claim: { active_call_id: "c1", verification_session_id: "s1" }, request });
  await announceTransferClaim({ tenantId: "t1", userId: "u2", role: "assistant", workItemId: "w1", claim: { active_call_id: "c2", verification_session_id: "s1", resumed_verification: true, requeue_count: 1 }, request });
  assert.deepEqual(state.cardCalls.map((call) => call.eventKey), ["claim:w1", "buffer-claim:w1:requeue-1"]);
  const claimed = state.audits.filter((entry) => entry.action === "tenant.transfer_claimed");
  assert.equal(claimed[0].metadata.resumedVerification, undefined, "a first claim is not marked resumed");
  assert.equal(claimed[1].metadata.resumedVerification, true);
  assert.equal(claimed[1].metadata.requeueCount, 1);
});

test("claim next explains a queue of callers the agent cannot talk to, by language", async () => {
  const { claimNextTransfer, ClaimNextError } = await load("lib/transferInbox/service.ts");
  state.rpc.claim_next_transfer = { data: null, error: { code: "P0001", message: "LANGUAGE_NOT_SPOKEN", details: "spanish" } };
  await assert.rejects(claimNextTransfer({ tenantId: "t1", userId: "u1", role: "producer" }), (error) => {
    assert.ok(error instanceof ClaimNextError);
    assert.equal(error.code, "language_not_spoken");
    assert.match(error.message, /asked for Spanish, which is not among your languages/);
    return true;
  });
  state.rpc.claim_next_transfer = { data: null, error: { code: "PGRST202", message: "Could not find the function" } };
  await assert.rejects(claimNextTransfer({ tenantId: "t1", userId: "u1", role: "producer" }), (error) => error.code === "schema_pending");
});

test("LA-1.10-8 / LA-1.14-9: release calls the right function and maps every refusal", async () => {
  const { releaseTransfer, TransferReleaseError, languageRefusal } = await load("lib/transferInbox/release.ts");
  state.rpcCalls.length = 0;
  state.rpc.return_transfer_to_queue = { data: { status: "unclaimed", requeue_count: 1 }, error: null };
  state.rpc.end_buffer_involvement = { data: { duplicate: false }, error: null };
  await releaseTransfer({ tenantId: "t1", userId: "u1", workItemId: "w1", action: "requeue" });
  await releaseTransfer({ tenantId: "t1", userId: "u1", workItemId: "w1", action: "end_buffer", acknowledgeLanguage: true });
  assert.deepEqual(state.rpcCalls.map((call) => [call.name, call.args.p_reason ?? call.args.p_acknowledge_language]), [["return_transfer_to_queue", "requeue"], ["end_buffer_involvement", true]]);

  const refused = async (message, details = null) => {
    state.rpc.end_buffer_involvement = { data: null, error: { code: "P0001", message, details } };
    try { await releaseTransfer({ tenantId: "t1", userId: "u1", workItemId: "w1", action: "end_buffer" }); } catch (error) { assert.ok(error instanceof TransferReleaseError); return error; }
    assert.fail(`${message} was not refused`);
  };
  assert.equal((await refused("CALL_ENDED")).code, "call_ended");
  assert.equal((await refused("BUFFER_OWNS_CALL")).code, "buffer_owns_call");
  const cover = await refused("LANGUAGE_COVER_REQUIRED", "spanish");
  assert.equal(cover.code, "language_cover_required");
  assert.equal(cover.detail, "spanish");
  assert.match(cover.message, /asked for Spanish/);
  state.rpc.end_buffer_involvement = { data: null, error: { code: "PGRST202", message: "Could not find the function" } };
  await assert.rejects(releaseTransfer({ tenantId: "t1", userId: "u1", workItemId: "w1", action: "end_buffer" }), (error) => error.code === "schema_pending" && error.status === 503);
  assert.match(languageRefusal("spanish"), /^This caller asked for Spanish, and Spanish is not among your languages\./);
});
