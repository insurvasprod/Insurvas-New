// Run with: node --experimental-strip-types --test lib/dashboard/views/compliance.test.mjs
//
// The dashboard's Compliance view (owner 2026-11-06): the pure shaping behind its cards — screening per
// agency day, why numbers were blocked, consent on file, the dialing state, deadlines and recent events.
// The loader file is `server-only` and reads through "@/" modules; this test stands those in with stubs
// that export the same names (and throw if called), so only the pure functions run here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const HOOKS = `
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
let root = "";
export function initialize(data) { root = data.root; }
export async function resolve(specifier, context, next) {
  if (specifier === "server-only") return { url: "data:text/javascript,export{}", shortCircuit: true };
  if (specifier.startsWith("@/")) return { url: "stub:" + specifier.slice(2), shortCircuit: true };
  return next(specifier, context);
}
export async function load(url, context, next) {
  if (!url.startsWith("stub:")) return next(url, context);
  const base = path.join(root, url.slice(5));
  const file = [".ts", ".tsx", "/index.ts"].map((ext) => base + ext).find((candidate) => existsSync(candidate));
  const text = file ? readFileSync(file, "utf8") : "";
  const names = [...new Set([...text.matchAll(/export\\s+(?:async\\s+)?(?:function\\*?|const|let|class)\\s+([A-Za-z_$][\\w$]*)/g)].map((m) => m[1]))];
  const source = names.map((name) => "export const " + name + " = () => { throw new Error('stub: " + url + "'); };").join("\\n") || "export {};";
  return { format: "module", source, shortCircuit: true };
}
`;
register(`data:text/javascript,${encodeURIComponent(HOOKS)}`, { parentURL: pathToFileURL(ROOT + path.sep).href, data: { root: ROOT } });

const view = await import("./compliance.ts");
const { lastDays } = await import("../todayMath.ts");

const ZONE = "America/New_York";
// 6 Nov 2026, 15:00 in New York (20:00 UTC).
const NOW = Date.parse("2026-11-06T20:00:00Z");
const DAYS = lastDays(NOW, ZONE, 6);

test("screening is counted per agency day, blocked apart from clear, and today's blocked on its own", () => {
  const rows = [
    { ts: "2026-11-01T04:30:00Z", outcome: "clear" }, // 1 Nov, 00:30 in New York
    { ts: "2026-11-01T03:59:00Z", outcome: "dnc" }, // 31 Oct in New York: last month, not counted
    { ts: "2026-11-03T15:00:00Z", outcome: "dnc" },
    { ts: "2026-11-03T16:00:00Z", outcome: "tcpa_litigator" },
    { ts: "2026-11-06T14:00:00Z", outcome: "internal_dq" },
    { ts: "2026-11-06T15:00:00Z", outcome: "unavailable" }, // screened, not blocked
    { ts: "2026-11-06T21:00:00Z", outcome: "dnc" }, // after now: outside today's window
  ];
  const out = view.screeningByDay(rows, DAYS);
  assert.equal(DAYS[0].key, "2026-11-01");
  assert.equal(out.total, 5);
  assert.equal(out.totalBlocked, 3);
  assert.deepEqual(out.screened.map((point) => point.value), [1, 0, 2, 0, 0, 2]);
  assert.deepEqual(out.blocked.map((point) => point.value), [0, 0, 2, 0, 0, 1]);
  assert.equal(out.blockedToday, 1);
  assert.deepEqual(out.byReason, { dnc: 1, tcpa_litigator: 1, internal_dq: 1, invalid_phone: 0 });
});

test("the reasons are bars largest first, ties in a fixed order, every reason named", () => {
  const bars = view.reasonBars({ dnc: 2, tcpa_litigator: 5, internal_dq: 2, invalid_phone: 0 });
  assert.deepEqual(bars.map((bar) => bar.key), ["tcpa_litigator", "dnc", "internal_dq", "invalid_phone"]);
  assert.equal(bars[0].label, "Known TCPA litigator");
  assert.equal(bars[0].tone, "danger");
  assert.equal(bars[3].value, 0);
});

test("consent on file is the share of leads holding the words; no leads is no figure, not 0%", () => {
  const share = view.consentShare({ leads: 200, full: 150, noIp: 20, textMissing: 30 });
  assert.equal(share.withText, 170);
  assert.equal(share.withIp, 150);
  assert.equal(share.gaps, 30);
  assert.equal(share.pct, 85);
  assert.equal(share.tone, "warning");
  assert.equal(view.consentShare({ leads: 0, full: 0, noIp: 0, textMissing: 0 }).pct, null);
  assert.equal(view.consentShare({ leads: 10, full: 3, noIp: 0, textMissing: 7 }).tone, "danger");
});

test("safe to dial only when every DNC and litigator feed answers; otherwise it says what is failing", () => {
  const feed = (name, type, state) => ({ name, type, typeLabel: type === "dnc_scrub" ? "DNC" : type === "litigator_scrub" ? "Litigator" : "Phone", state });
  const fine = view.dialingState({ feeds: [feed("A", "dnc_scrub", "fresh"), feed("B", "litigator_scrub", "fresh"), feed("C", "phone_validation", "failing")], dialingBlocked: false, demo: false });
  assert.equal(fine.safe, true);
  assert.equal(fine.value, "Safe to dial");
  const failing = view.dialingState({ feeds: [feed("A", "dnc_scrub", "fresh"), feed("B", "litigator_scrub", "failing")], dialingBlocked: false, demo: false });
  assert.equal(failing.safe, false);
  assert.equal(failing.failing, 1);
  assert.match(failing.line, /B \(Litigator\)/);
  const none = view.dialingState({ feeds: [], dialingBlocked: true, demo: false });
  assert.equal(none.value, "Dialing blocked");
  assert.match(none.line, /No DNC feed/);
  assert.equal(view.dialingState({ feeds: [], dialingBlocked: false, demo: true }).safe, false);
  assert.match(view.dialingState({ feeds: [feed("A", "dnc_scrub", "no_calls")], dialingBlocked: false, demo: false }).line, /1 had no checks/);
});

test("deadlines read in calendar days, soonest first, an unset regulator deadline on top", () => {
  assert.equal(view.daysUntil("2026-11-09", NOW), 3);
  assert.equal(view.dueText(3), "In 3 days");
  assert.equal(view.dueText(0), "Today");
  assert.equal(view.dueText(-1), "1 day late");
  const rows = [
    { key: "b", what: "Licence", who: "Agency", due: "", dueAt: Date.parse("2026-11-20"), href: "/app/appointments" },
    { key: "a", what: "DOI complaint", who: "X", due: "Not set", dueAt: -Infinity, href: "/app/complaints/1" },
    { key: "c", what: "Hold", who: "Y", due: "", dueAt: Date.parse("2026-11-08"), href: "/app/deletion-requests/2" },
  ];
  assert.deepEqual(view.sortDeadlines(rows).map((row) => row.key), ["a", "c", "b"]);
  assert.equal(view.sortDeadlines(rows, 2).length, 2);
});

test("recent events merge newest first and drop an undated one", () => {
  const rows = [
    { key: "1", at: "2026-11-05T10:00:00Z", mark: "!", tone: "warning", title: "Complaint received", href: "/app/complaints/1" },
    { key: "2", at: "2026-11-06T10:00:00Z", mark: "✓", tone: "good", title: "Consent added", href: "/app/consent/2" },
    { key: "3", at: "", mark: "×", tone: "info", title: "Deletion request", href: "/app/deletion-requests/3" },
  ];
  assert.deepEqual(view.newestEvents(rows).map((row) => row.key), ["2", "1"]);
  assert.equal(view.whenText("2026-11-06T14:05:00Z", NOW, ZONE), "09:05");
  assert.equal(view.whenText("2026-11-03T14:05:00Z", NOW, ZONE), "3 Nov");
});

test("a number on the dashboard shows only its last four digits", () => {
  assert.equal(view.maskPhone("5551234567"), "ending 4567");
  assert.equal(view.maskPhone(null), "number withheld");
});
