import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../../components/app/lead-workspace.tsx", import.meta.url), "utf8");

test("LA-1 lead workspace handles draft cancellation and lead-submit failures safely", () => {
  assert.match(source, /if \(cancelled\) return;/);
  assert.match(source, /Draft could not be loaded; starting a new draft/);
  assert.match(source, /catch \{\s*toast\.error\("Could not create lead\. Check your connection and try again\."\);/);
  assert.match(source, /finally \{\s*setSaving\(false\);/);
});
