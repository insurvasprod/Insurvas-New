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
