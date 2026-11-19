/**
 * Docs task screenshots (owner 2026-11-16: "the steps that I need to take… with screenshots to help them out"). For
 * every task in lib/docs/tasks.ts that is not a Get set up step, opens its page, lights each step's control the way
 * the guide does (a ring and a coach card), photographs it at 1440×900 and records where to zoom.
 *
 * It never saves, sends, pays or publishes: a step's `then: "open"` click only opens a tab, sheet, menu or record,
 * and the steps that write are photographed with their button lit, never pressed. So it may run in an agency with
 * real-looking data (`--as <owner email>`), which the empty Docs Screenshots agency doesn't have.
 *
 *   node --env-file=.env.local scripts/docs-task-shots.mjs --as owner@example.test [--only pay-your-partners,…] [--base http://localhost:3002]
 *
 * Writes public/docs/shots/tasks/<slug>/<n>.jpg and lib/docs/taskShots.ts.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

const arg = (name) => { const at = process.argv.indexOf(name); return at > 0 ? process.argv[at + 1] : undefined; };
const AS = arg("--as") ?? "docs.shots@insurvas.test";
const BASE = arg("--base") ?? "http://localhost:3002";
const ONLY = arg("--only")?.split(",").filter(Boolean);
const ROOT = process.cwd();
// --settings (2026-11-17): the Settings walks (lib/docs/settingsWalks.ts) instead of the tasks. Each page keeps its own
// manifest, so several runs (one per group of pages) can go at once; lib/docs/settingsShots.ts is rebuilt from them all.
const SETTINGS = process.argv.includes("--settings");
const OUT = join(ROOT, "public", "docs", "shots", SETTINGS ? "settings" : "tasks");
const MANIFEST = join(OUT, "manifest.json");

const { DOC_TASKS } = await import("../lib/docs/tasks.ts");
const SOURCES = SETTINGS
  ? await (async () => {
    const { SETTINGS_WALKS } = await import("../lib/docs/settingsWalks.ts");
    const { SETTINGS_DOCS } = await import("../lib/docs/settingsDocs.ts");
    return SETTINGS_DOCS.filter((doc) => SETTINGS_WALKS[doc.slug]?.steps.length).map((doc) => ({ slug: doc.slug, open: { href: doc.href }, steps: SETTINGS_WALKS[doc.slug].steps }));
  })()
  : DOC_TASKS.filter((task) => !task.setupStep && task.steps?.length);

function chromePath() {
  const home = join(process.env.LOCALAPPDATA ?? "", "ms-playwright");
  const builds = existsSync(home) ? readdirSync(home).filter((name) => /^chromium-\d+$/.test(name)).sort().reverse() : [];
  for (const build of builds) { const exe = join(home, build, "chrome-win64", "chrome.exe"); if (existsSync(exe)) return exe; }
  throw new Error("No Chromium under %LOCALAPPDATA%/ms-playwright. Run: npx playwright install chromium");
}
const out = execFileSync(process.execPath, ["--env-file=.env.local", "scripts/mint-session.mjs", "tenant", "--email", AS, "--ttl", "120", "--js"], { cwd: ROOT, encoding: "utf8" });
const token = /insurvas_tenant_session=([^;"]+)/.exec(out)?.[1];
if (!token) throw new Error(`Could not mint a session for ${AS}`);

const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
await context.addCookies([{ name: "insurvas_tenant_session", value: token, domain: "localhost", path: "/", sameSite: "Lax" }]);
await context.addInitScript(() => {
  const hide = () => { const style = document.createElement("style"); style.textContent = "nextjs-portal{display:none!important}"; document.head.append(style); };
  if (document.head) hide(); else document.addEventListener("DOMContentLoaded", hide);
  // No guide, no daily toast, no setup bar in a task picture.
  try { sessionStorage.setItem("setup-guide-active", "null"); } catch { /* storage blocked */ }
});
const page = await context.newPage();
page.setDefaultTimeout(20_000);

/** A Playwright locator from a step's `find`: `guide:x` → [data-guide="x"], `text:Run payouts` → button or link by name, else CSS. */
function locate(find) {
  if (find.startsWith("guide:")) return page.locator(`[data-guide="${find.slice(6)}"]`).filter({ visible: true }).first();
  if (find.startsWith("text:")) {
    const name = find.slice(5);
    return page.getByRole("button", { name, exact: false }).or(page.getByRole("link", { name, exact: false })).or(page.getByRole("tab", { name, exact: false })).filter({ visible: true }).first();
  }
  if (find.startsWith("label:")) return page.getByLabel(find.slice(6)).filter({ visible: true }).first();
  return page.locator(find).filter({ visible: true }).first();
}

/** The guide's look, drawn by hand: a dim with a hole, a ring round the control and a coach card beside it. */
async function light(box, index, total, say) {
  await page.evaluate(({ box, index, total, say }) => {
    document.getElementById("docs-shot-light")?.remove();
    const pad = 6;
    const root = document.createElement("div");
    root.id = "docs-shot-light";
    root.style.cssText = "position:fixed;inset:0;z-index:2147483000;pointer-events:none";
    const r = { x: box.x - pad, y: box.y - pad, w: box.width + pad * 2, h: box.height + pad * 2 };
    const dim = document.createElement("div");
    dim.style.cssText = `position:fixed;inset:0;background:rgba(3,7,6,.55);clip-path:path(evenodd,"M0 0H${innerWidth}V${innerHeight}H0Z M${r.x} ${r.y}h${r.w}v${r.h}h${-r.w}Z")`;
    const ring = document.createElement("div");
    ring.setAttribute("data-docs-lit", "");
    ring.style.cssText = `position:fixed;left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;border-radius:10px;box-shadow:0 0 0 2px #07d6a0`;
    const coach = document.createElement("div");
    coach.setAttribute("data-docs-coach", "");
    const width = 300;
    const below = r.y + r.h + 12 + 110 < innerHeight;
    const left = Math.min(Math.max(r.x, 12), innerWidth - width - 12);
    coach.style.cssText = `position:fixed;left:${left}px;${below ? `top:${r.y + r.h + 12}px` : `top:${Math.max(r.y - 12 - 96, 12)}px`};width:${width}px;padding:12px 14px;border-radius:12px;background:#0d1714;border:1px solid #07d6a0;color:#f2f7f5;font:14px/1.4 Inter,system-ui,sans-serif;box-shadow:0 24px 64px rgba(0,0,0,.6)`;
    coach.innerHTML = `<div style="font-size:12px;color:#93a69f;margin-bottom:4px">${index} of ${total}</div><div style="font-weight:600"></div>`;
    coach.lastChild.textContent = say;
    root.append(dim, ring, coach);
    document.body.append(root);
  }, { box, index, total, say });
}

async function focusBox() {
  const boxes = [];
  for (const selector of ["[data-docs-lit]", "[data-docs-coach]"]) { const b = await page.locator(selector).boundingBox().catch(() => null); if (b) boxes.push(b); }
  if (!boxes.length) return undefined;
  const left = Math.min(...boxes.map((b) => b.x)) - 60, top = Math.min(...boxes.map((b) => b.y)) - 60;
  const right = Math.max(...boxes.map((b) => b.x + b.width)) + 60, bottom = Math.max(...boxes.map((b) => b.y + b.height)) + 60;
  let w = Math.max(right - left, 720), h = Math.max(bottom - top, 450);
  if (w / h > 1.6) h = w / 1.6; else w = h * 1.6;
  w = Math.min(w, 1440); h = Math.min(h, 900);
  if (w >= 1300) return undefined;
  const x = Math.min(Math.max((left + right) / 2 - w / 2, 0), 1440 - w), y = Math.min(Math.max((top + bottom) / 2 - h / 2, 0), 900 - h);
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}

const readShots = () => {
  if (!SETTINGS) return existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : {};
  const all = {};
  for (const slug of existsSync(OUT) ? readdirSync(OUT) : []) { const file = join(OUT, slug, "manifest.json"); if (existsSync(file)) all[slug] = JSON.parse(readFileSync(file, "utf8")); }
  return all;
};
const manifest = readShots();
// A run resumes: tasks already in the manifest are kept unless named in --only or --all is passed.
const ALL = process.argv.includes("--all");
const tasks = SOURCES.filter((task) => (ONLY ? ONLY.includes(task.slug) : ALL || !manifest[task.slug]));
for (const task of tasks) {
 try {
  const shots = [];
  let at = null;
  for (const [index, step] of task.steps.entries()) {
    const route = step.at ?? (index === 0 ? task.open.href : null);
    if (route && route !== at) { await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 120_000 }); at = route; await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined); await page.waitForTimeout(800); }
    let box = null;
    if (step.find) {
      const target = locate(step.find);
      try { await target.waitFor({ timeout: 12_000 }); await target.scrollIntoViewIfNeeded(); box = await target.boundingBox(); }
      catch { console.log(`  ${task.slug}:${index + 1} · couldn't find ${step.find} on ${page.url()}`); }
    }
    if (box) await light(box, index + 1, task.steps.length, step.say);
    await page.waitForTimeout(400);
    const dir = join(OUT, task.slug);
    mkdirSync(dir, { recursive: true });
    await page.screenshot({ path: join(dir, `${index + 1}.jpg`), type: "jpeg", quality: 82 });
    const focus = box ? await focusBox() : undefined;
    shots.push({ src: `/docs/shots/${SETTINGS ? "settings" : "tasks"}/${task.slug}/${index + 1}.jpg`, width: 1440, height: 900, alt: step.say, ...(focus ? { focus } : {}), ...(box ? {} : { unlit: true }) });
    await page.evaluate(() => document.getElementById("docs-shot-light")?.remove());
    console.log(`shot ${task.slug}:${index + 1}${box ? "" : " (nothing lit)"} · ${step.say}`);
    if (step.then === "open" && step.find && box) {
      const before = page.url();
      await locate(step.find).click().catch((error) => console.log(`  couldn't open: ${error.message.split("\n")[0]}`));
      // A client-side route change: wait for the address to move before reading it as the next step's page.
      await page.waitForURL((url) => url.toString() !== before, { timeout: 8_000 }).catch(() => undefined);
      await page.waitForLoadState("networkidle", { timeout: 6_000 }).catch(() => undefined);
      await page.waitForTimeout(900);
      at = new URL(page.url()).pathname + new URL(page.url()).search;
    }
  }
  manifest[task.slug] = shots;
  mkdirSync(OUT, { recursive: true });
  if (SETTINGS) writeFileSync(join(OUT, task.slug, "manifest.json"), `${JSON.stringify(shots, null, 2)}\n`);
  else writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
 } catch (error) {
  console.log(`skip ${task.slug}: ${error.message.split("\n")[0]}`);
 }
}

const body = Object.entries(SETTINGS ? readShots() : manifest).map(([slug, shots]) => `  ${JSON.stringify(slug)}: [\n${shots.map((s) => `    ${JSON.stringify(s)},`).join("\n")}\n  ],`).join("\n");
writeFileSync(join(ROOT, "lib", "docs", SETTINGS ? "settingsShots.ts" : "taskShots.ts"), `/**
 * Real screenshots of each ${SETTINGS ? "Settings walk" : "Docs task"}'s steps (owner 2026-11-16). Generated by scripts/docs-task-shots.mjs; do not
 * edit by hand. \`unlit\` marks a step whose control wasn't found, photographed as the page stands.
 */
import type { DocShot } from "./shots.ts";

export const ${SETTINGS ? "SETTINGS_SHOTS" : "TASK_SHOTS"}: Record<string, readonly (DocShot & { unlit?: boolean })[]> = {
${body}
};
`);
await browser.close();
console.log(`Wrote ${tasks.length} ${SETTINGS ? "settings pages to lib/docs/settingsShots.ts" : "tasks to lib/docs/taskShots.ts"}`);
