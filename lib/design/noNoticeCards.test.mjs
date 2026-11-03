// Run with: npm test
//
// Owner 2026-11-02, twice:
//   1. "make it mandatory to never show this kind of cards, no matter what": the tinted, boxed notice
//      with a coloured left edge, a bold title and a paragraph under it;
//   2. then, of the one-line notice that replaced it: "not even like this, do not show anything; if
//      there is anything to show put it as an alert in the notification".
//
// So a notice never draws on the page. The shared <Callout> (components/app/settings/primitives.tsx)
// and <PageAlert> (components/ui/page-alert.tsx) raise it in the bell (components/ui/page-notices.tsx),
// where the top bar lists it first under Alerts and counts it on the badge. Only inside a dialog, where
// the bell is behind the overlay, does a Callout stay on screen, and then as one line, never a card.
// Hand-built tinted boxes elsewhere are counted down by the `hand-callout` ratchet in
// uiConsistency.test.mjs. Change this only with the owner's yes.
//
// DB-free and network-free: reads source text only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (path) => readFileSync(join(process.cwd(), path), "utf8").replace(/\r\n/g, "\n");
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

/** The Callout's own source: from its tone table to the end of the function. */
function calloutSource() {
  const source = code(read("components/app/settings/primitives.tsx"));
  const start = source.indexOf("const CALLOUT");
  const fn = source.indexOf("export function Callout", start);
  assert.ok(start > -1 && fn > -1, "the shared Callout is still in primitives.tsx");
  const end = source.indexOf("\n}\n", fn);
  return source.slice(start, end);
}

test("a Callout draws nothing on the page: it raises a bell notice", () => {
  const callout = calloutSource();
  assert.match(callout, /usePageNotice\(\{ tone, title, detail: children \}, !inline\)/, "the notice goes to the bell");
  assert.match(callout, /if \(!inline\) return null;/, "nothing is drawn outside a dialog");
});

test("inside a dialog the notice is one line, never a card", () => {
  const callout = calloutSource();
  assert.doesNotMatch(callout, /\brounded(?:-|\b)/, "no rounded corners");
  assert.doesNotMatch(callout, /\bborder(?:-|\b)/, "no border or coloured edge");
  assert.doesNotMatch(callout, /\bbg-|-surface\)/, "no tinted ground");
  assert.doesNotMatch(callout, /\b(?:p|px|py|pt|pb|pl|pr)-\d/, "no card padding");
  assert.doesNotMatch(callout, /\bshadow\b|shadow-/, "no shadow");
  assert.match(code(read("components/ui/dialog.tsx")), /<InlineNotices>\{children\}<\/InlineNotices>/, "only a dialog keeps its notice inline");
});

test("a PageAlert draws nothing either: it raises a bell notice", () => {
  const alert = code(read("components/ui/page-alert.tsx"));
  assert.match(alert, /usePageNotice\(/);
  assert.match(alert, /return null;/);
  assert.doesNotMatch(alert, /className=/, "it renders no element of its own");
});

test("the bell lists the page's notices first under Alerts and counts them", () => {
  const bar = code(read("components/app/app-top-bar.tsx"));
  assert.match(bar, /const pageNotices = usePageNotices\(\);/);
  assert.match(bar, /const alertCount = alerts\.length \+ pageNotices\.length;/);
  assert.match(bar, /pageNotices\.map\(\(notice\) =>/);
});

test("hand-built tinted notice boxes stay counted down", () => {
  assert.match(read("lib/design/uiConsistency.test.mjs"), /"hand-callout":/, "the hand-callout ratchet is still in place");
});
