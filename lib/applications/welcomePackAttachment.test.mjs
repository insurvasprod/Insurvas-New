import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");

test("3.20 the welcome-pack email carries the PDF itself, read from the tenant's own path", () => {
  const pack = read("lib/applications/welcomePack.ts");
  assert.match(pack, /async function packAttachment\(tenantId: string, row: PackRow, filename: string\)/);
  // Only a file under the tenant's own prefix is ever attached.
  assert.match(pack, /packAttachment[\s\S]*?row\.pdf_path\.startsWith\(`\$\{tenantId\}\/`\)[\s\S]*?storage\.from\(WELCOME_BUCKET\)\.download\(row\.pdf_path\)/);
  assert.match(pack, /contentType: "application\/pdf"/);
  // The send passes them, and a household email carries the spouse's pack too.
  assert.match(pack, /sendEmail\(\{[\s\S]*?attachments,\s*\}\)/);
  assert.match(pack, /otherClaimed && otherRow \? packAttachment\(actor\.tenantId, otherRow/);
});

test("the email transport hands attachments to the provider, and only when there are some", () => {
  const transport = read("lib/email/transport.ts");
  assert.match(transport, /attachments\?: \{ filename: string; content: Buffer \| Uint8Array; contentType: string \}\[\]/);
  assert.match(transport, /\.\.\.\(input\.attachments\?\.length \? \{ attachments: input\.attachments\.map/);
});

test("every verify script refuses to run against the production project", () => {
  const guard = read("scripts/lib/refuseProduction.mjs");
  assert.match(guard, /VERIFY_ALLOW_PRODUCTION !== "1"/);
  assert.match(guard, /process\.exit\(2\)/);
  const missing = readdirSync(new URL("../../scripts", import.meta.url))
    .filter((f) => /^verify-.*\.mjs$/.test(f))
    .filter((f) => !/^(#![^\n]*\r?\n)?import "\.\/lib\/refuseProduction\.mjs";/.test(read(`scripts/${f}`)));
  assert.deepEqual(missing, [], `verify scripts without the production guard as their first import: ${missing.join(", ")}`);
});
