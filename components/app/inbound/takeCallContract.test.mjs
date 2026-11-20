import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

/**
 * Take this call opens the call page visibly (Basic walk 2026-11-20). Incoming calls and the call share the
 * `inbound` segment, so without a loading boundary of its own the old page stayed up, its button back to
 * "Take this call", until the call page had fully rendered: the click looked like it did nothing.
 */
const root = new URL("../../../", import.meta.url);
const read = (path) => readFileSync(new URL(path, root), "utf8");

test("the call segment has its own loading frame, on `call` so a ?phase= change never flashes it", () => {
  assert.ok(existsSync(new URL("app/app/(shell)/inbound/call/loading.tsx", root)), "app/app/(shell)/inbound/call/loading.tsx is missing");
  assert.ok(!existsSync(new URL("app/app/(shell)/inbound/call/[workItemId]/loading.tsx", root)), "a loading.tsx under [workItemId] would replace each call step with a skeleton");
  assert.match(read("app/app/(shell)/inbound/call/loading.tsx"), /InboundStepBar current=\{1\}/);
});

test("a successful claim keeps Taking… until the call page replaces Inbound", () => {
  const source = read("components/app/inbound/use-floor.ts");
  const claim = source.slice(source.indexOf("async function claim("), source.indexOf("async function sendNudge("));
  assert.ok(claim.length > 0, "claim() not found");
  const success = claim.slice(claim.indexOf("notify.arrive("));
  assert.match(success, /router\.push\(callHref\(workItemId\)\)/, "a taken caller opens the call page");
  assert.doesNotMatch(success, /setSaving\(null\)/, "clearing the busy state before the navigation lands makes the click look dead");
  // A network failure is said plainly and frees the button.
  assert.match(claim, /catch \{\s*setSaving\(null\);\s*notify\.fail\(/);
  // The front caller's call page is fetched ahead.
  assert.match(source, /router\.prefetch\(callHref\(front\)\)/);
});
