/**
 * LA-1.16-6: a chat outage never blocks a claim, a handoff or a disposition.
 *
 * Claim and handoff are proven by running the real services with the chat writer replaced by one
 * that fails (an injected outage), and the database client by a fake that records what happened.
 * Disposition posts its partner card inside complete_disposition, so it is proven on the SQL: the
 * card insert sits in its own exception block and the completed call is returned either way.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire, registerHooks } from "node:module";

const root = process.cwd();
const ts = createRequire(join(root, "package.json"))("typescript");
const state = (globalThis.__chatOutage = { cardCalls: [], audits: [], rpc: {}, tables: {}, failChat: "reject" });

const stubs = {
  "server-only": "export {};",
  "@/lib/partnerChat/service": `export async function postPartnerSystemCard(input) {
    globalThis.__chatOutage.cardCalls.push(input);
    if (globalThis.__chatOutage.failChat === "reject") throw new Error("injected chat outage: partner_messages unavailable");
    return { alreadyPosted: false, id: "m1" };
  }`,
  "@/lib/audit/log": "export async function audit(entry) { globalThis.__chatOutage.audits.push(entry); }",
  "@/lib/request/clientInfo": "export function getClientIp() { return '127.0.0.1'; }",
  "@/lib/agentAlerts/service": "export async function notifyAgentUser() {}",
  "@/lib/supabase/service": `
    function builder(table) {
      const result = () => Promise.resolve(globalThis.__chatOutage.tables[table] ?? { data: null, error: null });
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
        rpc: async (name) => globalThis.__chatOutage.rpc[name] ?? { data: null, error: { message: "unexpected rpc " + name } },
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
    // The services use TypeScript parameter properties, which strip-only mode refuses: transpile.
    if (url.startsWith("file:") && url.endsWith(".ts")) {
      const source = readFileSync(fileURLToPath(url), "utf8");
      const out = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, verbatimModuleSyntax: false } });
      return { format: "module", source: out.outputText, shortCircuit: true };
    }
    return next(url, context);
  },
});

const request = new Request("http://localhost/api", { headers: { "user-agent": "node-test" } });
const unhandled = [];
process.on("unhandledRejection", (reason) => unhandled.push(reason));

test("claim: the chat writer fails, the claim still returns and is audited with chatPosted:false", async () => {
  const { announceTransferClaim } = await import(pathToFileURL(join(root, "lib", "transferInbox", "service.ts")).href);
  state.cardCalls.length = 0; state.audits.length = 0; state.failChat = "reject";
  state.tables.lead_queue = { data: { partner_id: "p1", agent_leads: { values: { first_name: "Ada", last_name: "Stone" } } }, error: null };
  const result = await announceTransferClaim({ tenantId: "t1", userId: "u1", role: "producer", workItemId: "w1", claim: { active_call_id: "c1" }, request });
  assert.deepEqual(result, { chatPosted: false });
  assert.equal(state.cardCalls.length, 1, "the card was attempted");
  assert.deepEqual(state.audits.map((entry) => entry.action), ["tenant.transfer_claim_chat_failed", "tenant.transfer_claimed"]);
  assert.equal(state.audits[1].metadata.chatPosted, false);
});

test("claim: with chat healthy the same path reports chatPosted:true", async () => {
  const { announceTransferClaim } = await import(pathToFileURL(join(root, "lib", "transferInbox", "service.ts")).href);
  state.cardCalls.length = 0; state.audits.length = 0; state.failChat = "none";
  const result = await announceTransferClaim({ tenantId: "t1", userId: "u1", role: "assistant", workItemId: "w1", claim: {}, request });
  assert.deepEqual(result, { chatPosted: true });
  assert.equal(state.cardCalls[0].eventKey, "buffer-claim:w1");
});

test("handoff: accepting a handoff returns the RPC result although the partner card fails", async () => {
  const { acceptBufferHandoff } = await import(pathToFileURL(join(root, "lib", "bufferHandoff", "service.ts")).href);
  state.cardCalls.length = 0; state.failChat = "reject";
  state.rpc.accept_buffer_handoff = { data: { handoff_id: "h1", work_item_id: "w1", status: "la_active" }, error: null };
  state.tables.lead_queue = { data: { partner_id: "p1" }, error: null };
  const result = await acceptBufferHandoff({ tenantId: "t1", handoffId: "h1", licensedAgentId: "u2", request });
  assert.deepEqual(result, { handoff_id: "h1", work_item_id: "w1", status: "la_active" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(state.cardCalls.length, 1, "the transferred card was attempted");
  assert.equal(state.cardCalls[0].cardType, "transferred");
  assert.equal(unhandled.length, 0, "the failed card is caught, not left as an unhandled rejection");
});

test("disposition: the partner card insert is isolated inside complete_disposition", () => {
  const latest = readFileSync(join(root, "supabase", "migrations", "20260917131500_la_1_close_verification_on_disposition.sql"), "utf8");
  const fn = latest.slice(latest.indexOf("create or replace function public.complete_disposition"));
  const insert = fn.indexOf("insert into public.partner_messages");
  assert.ok(insert > 0, "the latest definition still posts the outcome card");
  const block = fn.slice(fn.lastIndexOf("begin", insert), fn.indexOf("end;", insert) + 4);
  assert.match(fn.slice(insert, insert + 2500), /exception\s+when\s+others\s+then\s+v_partner_card_error\s*:=\s*sqlerrm/i, "a failed insert is caught in its own block");
  assert.match(block, /begin/i);
  assert.match(fn, /'partner_card_posted',\s*v_partner_card_error is null/i, "the call still completes and reports whether the card posted");
});
