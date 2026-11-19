// Run with: npm test
//
// Docs (owner 2026-11-13): every page reads exactly step by step, never as paragraphs, and every step names what to
// do. DB-free: the content module only.

import { test } from "node:test";
import assert from "node:assert/strict";

import { allDocPages } from "./content.ts";
import { isSetupStepKey } from "../dashboard/checklist.ts";

test("every page outside Set up Insurvas has ordered steps", () => {
  for (const page of allDocPages().filter((item) => item.chapter !== "setup")) {
    assert.ok(page.steps && page.steps.length >= 2, `${page.slug} has steps`);
    for (const step of page.steps) assert.ok(step.title && step.detail, `${page.slug}: "${step.title}" says what to do`);
  }
});

test("a step Insurvas ticks names a real setup step, and slugs are unique", () => {
  const pages = allDocPages();
  assert.equal(new Set(pages.map((page) => page.slug)).size, pages.length);
  for (const page of pages) {
    for (const step of page.steps ?? []) {
      if (step.doneWhen && step.doneWhen !== "ready") assert.ok(isSetupStepKey(step.doneWhen), `${page.slug}: ${step.doneWhen}`);
      if (step.action?.step) assert.ok(isSetupStepKey(step.action.step), `${page.slug}: ${step.action.step}`);
    }
  }
});

test("Docs setup pictures (2026-11-16): every listed screenshot is a file, in move order, one per move at most", async () => {
  const { DOC_SHOTS } = await import("./shots.ts");
  const { guideMovesFor } = await import("../dashboard/guideMoves.ts");
  const { existsSync } = await import("node:fs");
  const { join } = await import("node:path");
  for (const [key, shots] of Object.entries(DOC_SHOTS)) {
    const moves = guideMovesFor({ key, instruction: "" });
    assert.ok(shots.length <= moves.length, `${key}: no more pictures than moves`);
    shots.forEach((shot, at) => {
      if (!shot) return;
      assert.ok(existsSync(join(process.cwd(), "public", shot.src)), `${key}: ${shot.src} exists`);
      assert.equal(shot.alt, moves[at].say, `${key}: picture ${at + 1} is of move ${at + 1}`);
    });
  }
  for (const key of ["carriers", "states", "lead-sources", "products", "campaign", "import", "calling-windows", "statement"]) {
    assert.ok((DOC_SHOTS[key] ?? []).some(Boolean), `${key}: Ready to sell steps have real pictures`);
  }
});

// Docs R6 (owner 2026-11-16): Docs is "how do I do this in Insurvas", module by module, each task on real screens.
test("every Docs task belongs to a module, has steps, and needs only real tasks", async () => {
  const { DOC_MODULES } = await import("./modules.ts");
  const { DOC_TASKS } = await import("./tasks.ts");
  const { setupStepDefinitions } = await import("../dashboard/checklist.ts");
  const modules = new Set(DOC_MODULES.map((module) => module.key));
  const slugs = DOC_TASKS.map((task) => task.slug);
  const setupKeys = new Set(setupStepDefinitions().map((step) => step.key));
  assert.equal(new Set(slugs).size, slugs.length, "task slugs are unique");
  const reference = allDocPages().filter((page) => page.chapter !== "setup").map((page) => page.slug);
  assert.deepEqual(reference.filter((slug) => slugs.includes(slug)), [], "a task never shares a reference page's address");
  for (const task of DOC_TASKS) {
    assert.ok(modules.has(task.module), `${task.slug}: module ${task.module}`);
    if (task.setupStep) assert.ok(setupKeys.has(task.setupStep), `${task.slug}: setup step ${task.setupStep}`);
    else assert.ok(task.steps && task.steps.length > 0 && task.why, `${task.slug}: steps and why`);
    for (const need of task.needs ?? []) assert.ok(slugs.includes(need), `${task.slug} needs ${need}`);
    assert.ok(task.whenDone, `${task.slug}: says when it's done`);
  }
  for (const entry of DOC_MODULES) {
    assert.ok(DOC_TASKS.some((task) => task.module === entry.key), `${entry.key} has at least one task`);
    assert.ok(entry.how.length >= 3 && entry.why.length > 0 && entry.forYou.length > 0, `${entry.key}: how, why and for you`);
  }
});

test("a task step's screenshot click only ever opens something, never saves", async () => {
  const { DOC_TASKS } = await import("./tasks.ts");
  // The capture script presses `then: "open"` controls for real; a save, send, pay or publish must never be one.
  const writes = /\b(save|send|publish|pay|paid|confirm|approve|delete|import|run|book|log|merge|submit|record|scrub|create|start)\b/i;
  // Buttons that only open their form (the write is the form's own "Log request" / "Run report", never pressed).
  const opensAForm = new Set(["Log a request", "Run a report"]);
  for (const task of DOC_TASKS) {
    for (const step of task.steps ?? []) {
      if (step.then !== "open") continue;
      const label = step.find?.startsWith("text:") ? step.find.slice(5) : "";
      assert.ok(opensAForm.has(label) || !writes.test(label), `${task.slug}: "${label}" looks like a write, so the script must not press it`);
    }
  }
});

test("Settings docs (owner 2026-11-17): every page has its parts and every setting says what it does", async () => {
  const { SETTINGS_DOCS, SETTINGS_DOC_GROUPS, settingsDoc } = await import("./settingsDocs.ts");
  const { SETTINGS_SECTIONS } = await import("../settings/sections.ts");
  const ids = new Set(SETTINGS_SECTIONS.map((section) => section.id));
  assert.ok(SETTINGS_DOCS.length >= 10, "Settings is documented page by page");
  assert.equal(new Set(SETTINGS_DOCS.map((page) => page.slug)).size, SETTINGS_DOCS.length, "slugs are unique");
  for (const page of SETTINGS_DOCS) {
    assert.ok(ids.has(page.id), `${page.slug}: names a real Settings section (${page.id})`);
    assert.ok(SETTINGS_DOC_GROUPS.includes(page.group), `${page.slug}: group ${page.group}`);
    assert.ok(page.why && page.who && page.href.startsWith("/app/"), `${page.slug}: why, who and where`);
    assert.ok(page.parts.length > 0, `${page.slug}: has parts`);
    assert.equal(settingsDoc(page.slug), page);
    for (const part of page.parts) for (const field of part.fields) assert.ok(field.label && field.what, `${page.slug} › ${part.title}: "${field.label}" says what it does`);
  }
});

test("Settings walks (owner 2026-11-17): every Settings page is walked step by step, and a clicked step only opens", async () => {
  const { SETTINGS_DOCS } = await import("./settingsDocs.ts");
  const { SETTINGS_WALKS } = await import("./settingsWalks.ts");
  const writes = /\b(save|send|publish|pay|paid|confirm|approve|delete|import|run|book|log|merge|submit|record|scrub|create|start)\b/i;
  const slugs = new Set(SETTINGS_DOCS.map((page) => page.slug));
  for (const slug of Object.keys(SETTINGS_WALKS)) assert.ok(slugs.has(slug), `walk ${slug} names a Settings doc`);
  for (const page of SETTINGS_DOCS) {
    const walk = SETTINGS_WALKS[page.slug];
    assert.ok(walk && walk.steps.length >= 3 && walk.outcome && walk.minutes > 0, `${page.slug} has a walk`);
    for (const step of walk.steps) {
      assert.ok(step.say && step.detail, `${page.slug}: "${step.say}" says what and why`);
      if (step.then !== "open") continue;
      const label = step.find?.startsWith("text:") ? step.find.slice(5) : "";
      assert.ok(!writes.test(label), `${page.slug}: "${label}" looks like a write, so the script must not press it`);
    }
  }
});

test("the small Settings index matches the Settings docs, and every Docs step knows where it happens", async () => {
  const { SETTINGS_DOCS, SETTINGS_DOC_GROUPS: groups } = await import("./settingsDocs.ts");
  const { SETTINGS_INDEX, SETTINGS_DOC_GROUPS } = await import("./settingsIndex.ts");
  assert.deepEqual(SETTINGS_INDEX, SETTINGS_DOCS.map(({ slug, title, group, href }) => ({ slug, title, group, href })), "re-run the index generator after editing settingsDocs.ts");
  assert.deepEqual(SETTINGS_DOC_GROUPS, groups);
  const { docWhere, docWheres } = await import("./where.ts");
  for (const page of SETTINGS_DOCS) assert.deepEqual(docWhere(page.href)?.trail, ["Settings", page.group, page.title], page.slug);
  const { DOC_TASKS } = await import("./tasks.ts");
  for (const task of DOC_TASKS) assert.ok(docWheres(task.open.href, [undefined], task.open.label)[0], `${task.slug}: says how to reach ${task.open.href}`);
});

test("a Settings page's done circle follows real Get set up steps", async () => {
  const { readFileSync } = await import("node:fs");
  const { setupStepDefinitions } = await import("../dashboard/checklist.ts");
  const { SETTINGS_INDEX } = await import("./settingsIndex.ts");
  const keys = new Set(setupStepDefinitions().map((step) => step.key));
  const block = /SETTINGS_SETUP_STEPS[^=]*=\s*\{([\s\S]*?)\n\};/.exec(readFileSync(new URL("./state.ts", import.meta.url), "utf8"))[1];
  for (const [, slug, list] of block.matchAll(/"?([\w-]+)"?:\s*\[([^\]]*)\]/g)) {
    assert.ok(SETTINGS_INDEX.some((page) => page.slug === slug), `${slug} is a Settings doc`);
    for (const [, key] of list.matchAll(/"([^"]+)"/g)) assert.ok(keys.has(key), `${slug}: ${key} is a Get set up step`);
  }
});

test("every page in the menu links its (i) to a module guide (owner 2026-11-17)", async () => {
  const { docModuleForPath } = await import("./moduleRoutes.ts");
  const { DOC_MODULES } = await import("./modules.ts");
  const { allMenuItems } = await import("../menu/definition.ts");
  const guides = new Set(DOC_MODULES.map((entry) => entry.key));
  const missing = allMenuItems().filter((item) => !docModuleForPath(item.path) || !guides.has(docModuleForPath(item.path)));
  assert.deepEqual(missing.map((item) => item.path), []);
  assert.equal(docModuleForPath("/app/payouts/rulebook/abc"), "commissions", "a record page under a module's page");
  assert.equal(docModuleForPath("/app/inbound/team"), "today");
  assert.equal(docModuleForPath("/app/docs/pay-partners"), null, "Docs itself links nowhere");
});
