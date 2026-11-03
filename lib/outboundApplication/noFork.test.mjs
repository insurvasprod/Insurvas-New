// Run with: npm test
//
// LA-2.14 acceptance criterion 1 names its own artifact:
//
//   "The verification panel is the same component as inbound, with no outbound-specific fork"
//
// This is that test. The task's own rule is blunt about why it exists:
//
//   "Do not build a second application flow. The verification panel, the field definitions, the
//    dispositions and the deal-flow write all exist in Module 1. This task is the ENTRY POINT, not
//    a parallel implementation."
//
// A comment saying "same component" is worth nothing six months from now, when somebody adds an
// `isOutbound` flag to make one screen behave slightly differently and the two flows begin their
// long slow drift apart. So this asserts it structurally: one implementation module, both routes
// importing from it, and identical arguments at the call site.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const INBOUND = join(ROOT, "app", "api", "app", "inbound", "verification", "route.ts");
const OUTBOUND = join(ROOT, "app", "api", "app", "outbound", "application", "route.ts");

const read = (path) => readFileSync(path, "utf8");

/** Every argument list passed to `name(...)` in a source, normalised for whitespace. */
function callArguments(source, name) {
  const calls = [];
  const pattern = new RegExp(`\\b${name}\\s*\\(`, "g");
  let match;
  while ((match = pattern.exec(source)) !== null) {
    let depth = 1;
    let i = match.index + match[0].length;
    const start = i;
    while (i < source.length && depth > 0) {
      if (source[i] === "(") depth += 1;
      else if (source[i] === ")") depth -= 1;
      i += 1;
    }
    calls.push(source.slice(start, i - 1).replace(/\s+/g, " ").trim());
  }
  return calls;
}

test("both entry points exist, and the outbound one is a route rather than a copy of the flow", () => {
  assert.ok(existsSync(INBOUND), "the inbound verification route is missing");
  assert.ok(existsSync(OUTBOUND), "the outbound application route is missing");
});

test("there is exactly one implementation of the verification panel", () => {
  // A second module exporting getVerificationPanel is the fork this criterion forbids, whatever it
  // is called.
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".next" || entry.name === ".git") continue;
        walk(path);
      } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
        const source = readFileSync(path, "utf8");
        if (/export\s+async\s+function\s+getVerificationPanel\b/.test(source)) found.push(path);
      }
    }
  };
  walk(join(ROOT, "lib"));

  assert.equal(
    found.length,
    1,
    `expected one getVerificationPanel implementation, found ${found.length}: ${found.join(", ")}`,
  );
  assert.ok(found[0].includes(join("lib", "verification", "service.ts")), `unexpected location: ${found[0]}`);
});

test("the outbound route imports the panel rather than implementing one", () => {
  const source = read(OUTBOUND);
  assert.match(
    source,
    /import \{[^}]*getVerificationPanel[^}]*\} from "@\/lib\/verification\/service"/,
    "the outbound route must import the shared verification service",
  );
  assert.match(
    source,
    /import \{[^}]*updateVerificationField[^}]*\} from "@\/lib\/verification\/service"/,
    "the outbound route must use the shared field update",
  );

  // Whatever the outbound route does, it must not be reading or writing verification state itself.
  for (const table of ["verification_fields", "tenant_verification_sessions"]) {
    assert.ok(
      !source.includes(table),
      `the outbound route touches ${table} directly, which is a second implementation of the flow`,
    );
  }
});

test("both routes call the panel with identical arguments", () => {
  // The subtle fork is not a copied file. It is one extra argument.
  const inbound = callArguments(read(INBOUND), "getVerificationPanel");
  const outbound = callArguments(read(OUTBOUND), "getVerificationPanel");

  assert.ok(inbound.length > 0, "the inbound route no longer calls getVerificationPanel");
  assert.ok(outbound.length > 0, "the outbound route no longer calls getVerificationPanel");

  const shape = (args) => args.replace(/parsed\.data(\.\w+)?/g, "<workItemId>").replace(/\bworkItemId\b/g, "<workItemId>");
  const inboundShapes = new Set(inbound.map(shape));
  for (const call of outbound) {
    assert.ok(
      inboundShapes.has(shape(call)),
      `the outbound panel call differs from every inbound one:\n  outbound: ${shape(call)}\n  inbound:  ${[...inboundShapes].join(" | ")}`,
    );
  }
});

test("the verification service takes no outbound-specific parameter", () => {
  // If the fork ever happens, it will almost certainly arrive as a flag on the shared function
  // rather than as a new file — which the tests above would not catch.
  const source = read(join(ROOT, "lib", "verification", "service.ts"));
  for (const smell of ["isOutbound", "is_outbound", "outbound:", "source === \"outbound\"", "mode === \"outbound\""]) {
    assert.ok(
      !source.includes(smell),
      `lib/verification/service.ts branches on ${smell}, which is the fork this criterion forbids`,
    );
  }
});

test("a setter cannot reach the application route", () => {
  // LA-2.12: "Cannot: Sell, quote, or submit an application." Stated at the route here, and
  // enforced again inside start_application_from_lead, which is the one that matters.
  const source = read(OUTBOUND);
  const roles = /const APPLICATION_ROLES = \[([^\]]*)\]/.exec(source);
  assert.ok(roles, "APPLICATION_ROLES is not statically readable");
  assert.ok(!roles[1].includes("setter"), "the outbound application route admits a setter");
});
