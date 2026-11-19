/**
 * Docs screenshots (owner 2026-11-16): walks Ready to sell with the real guide in the "Docs Screenshots" agency and
 * photographs every move, so each Docs setup page shows what to click, step by step, on the real screens.
 *
 * It does every click for real (carriers, states, a publisher, a vendor and campaign, a lead import, calling
 * hours, a statement), so it only ever runs in the one agency made for it, and refuses any other. It doubles as the
 * end-to-end check of the guide: after each step the guide must open the next one by itself.
 *
 *   node --env-file=.env.local scripts/docs-shots.mjs                      # against the dev server on :3002
 *   node --env-file=.env.local scripts/docs-shots.mjs --base http://localhost:3000
 *
 * Writes public/docs/shots/<step>/<n>.jpg and lib/docs/shots.ts (the manifest the Docs pages read). Re-run after
 * scripts/docs-shots-reset.mjs when a screen changes.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

const TENANT_ID = "2f20eabf-15f7-41bf-b4d4-d9f4d09d522c";
const OWNER_EMAIL = "docs.shots@insurvas.test";
const arg = (name) => { const at = process.argv.indexOf(name); return at > 0 ? process.argv[at + 1] : undefined; };
const BASE = arg("--base") ?? "http://localhost:3002";
const ROOT = process.cwd();
const OUT = join(ROOT, "public", "docs", "shots");

function chromePath() {
  const home = join(process.env.LOCALAPPDATA ?? "", "ms-playwright");
  const builds = existsSync(home) ? readdirSync(home).filter((name) => /^chromium-\d+$/.test(name)).sort().reverse() : [];
  for (const build of builds) {
    const exe = join(home, build, "chrome-win64", "chrome.exe");
    if (existsSync(exe)) return exe;
  }
  throw new Error("No Chromium under %LOCALAPPDATA%/ms-playwright. Run: npx playwright install chromium");
}

// `--as <email>` photographs single steps (`--steps`) in another agency: those only open sheets and menus, never
// save, send or hand out, so a team-only step can be shown from an agency plan. The Ready to sell run never takes it.
const AS = arg("--as");
if (AS && !arg("--steps")) throw new Error("--as only works with --steps (the Ready to sell run clicks for real)");

function mintToken() {
  const out = execFileSync(process.execPath, ["--env-file=.env.local", "scripts/mint-session.mjs", "tenant", "--email", AS ?? OWNER_EMAIL, "--ttl", "120", "--js"], { cwd: ROOT, encoding: "utf8" });
  const token = /insurvas_tenant_session=([^;"]+)/.exec(out)?.[1];
  if (!token) throw new Error("Could not mint a session for the Docs Screenshots owner");
  const tenant = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8")).tenantId;
  if (tenant !== TENANT_ID && !AS) throw new Error(`Refusing: the session is for tenant ${tenant}, not the Docs Screenshots agency`);
  return token;
}

const browser = await chromium.launch({ executablePath: chromePath(), headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark", acceptDownloads: false });
await context.addCookies([{ name: "insurvas_tenant_session", value: mintToken(), domain: "localhost", path: "/", sameSite: "Lax" }]);
// The Next.js dev badge is not part of the product: never in a picture.
await context.addInitScript(() => {
  const hide = () => { const style = document.createElement("style"); style.textContent = "nextjs-portal{display:none!important}"; document.head.append(style); };
  if (document.head) hide(); else document.addEventListener("DOMContentLoaded", hide);
});
const page = await context.newPage();
page.setDefaultTimeout(30_000);
page.setDefaultNavigationTimeout(120_000); // a dev server compiling a page for the first time

const g = (name) => page.locator(`[data-guide="${name}"]`).filter({ visible: true }).first();
const coachButton = (label) => page.locator("[data-setup-coach] button").filter({ hasText: label }).first();
const confirm = () => coachButton(/Looks right|Done/i).click();
const choose = async (target, file) => {
  const chooser = page.waitForEvent("filechooser");
  await g(target).click();
  await (await chooser).setFiles(join(ROOT, "scripts", "fixtures", file));
};
const today = new Date();
const iso = (date) => date.toISOString().slice(0, 10);

/** What must be on screen before a move is photographed, beyond its lit control (the statement's own page). */
const BEFORE_SHOT = {
  "statement:4": () => page.waitForURL(/\/app\/statements\/[^/?#]+/, { timeout: 60_000 }),
};

/** What the person does on each move, by `<step>:<move>`. Unlisted moves are only photographed and waited out. */
const ACTS = {
  "carriers:0": async () => {
    // Real carriers by name: the library also holds QA test carriers, which must never be in a Docs picture.
    for (const name of ["Mutual of Omaha", "Americo", "Transamerica"]) {
      await g("carriers-setup-list").locator("button[role=checkbox][aria-checked=false]", { hasText: name }).click();
      await page.waitForTimeout(700);
    }
  },
  "carriers:1": confirm,
  "states:0": () => g("carriers-setup-next").click(),
  "states:1": () => g("states-setup-list").locator('button[aria-label^="Texas"]').click(),
  "states:2": async () => {
    for (const state of ["Texas", "Florida", "Georgia"]) {
      await g("states-setup-list").locator(`button[aria-label^="${state}"]`).click();
      const all = g("states-setup-carriers").getByRole("button", { name: "Tick all" });
      if (await all.count()) await all.click();
      await page.waitForTimeout(900);
    }
    await confirm();
  },
  "states:3": () => g("states-setup-finish").click(),
  "lead-sources:0": () => g("publisher-add").click(),
  "lead-sources:1": async () => { await page.locator("#partner-name").fill("Northwind Leads"); await g("publisher-submit").click(); },
  "lead-sources:2": () => g("publisher-done").click(),
  // The menu opens on press and locks the page before the click lands: press it as a person does.
  "products:0": async () => {
    const off = g("products-list").locator('[role="switch"][aria-checked="false"]');
    for (let i = 0; i < 2 && (await off.count()); i += 1) { await off.first().click(); await page.waitForTimeout(900); }
  },
  "products:1": confirm,
  "campaign:0": () => g("campaign-vendor-picker").click({ force: true }),
  "campaign:1": () => g("campaign-vendor-add").click(),
  "campaign:2": async () => { await page.locator('[role="dialog"][data-state="open"] input, aside[data-slot="detail-panel"] input').first().fill("Northwind Leads"); await g("vendor-create").click(); },
  "campaign:3": () => g("campaign-new").click(),
  "campaign:4": async () => { await page.locator("#campaign-name").fill("Northwind · November"); await g("campaign-create").click(); },
  "import:0": async () => { await g("lead-import-campaign").focus(); await g("lead-import-campaign").selectOption({ index: 1 }); await page.keyboard.press("Tab"); },
  "import:1": () => choose("lead-import-upload", "docs-leads.csv"),
  "import:2": () => g("lead-import-columns-ok").click(),
  "import:3": () => g("lead-import-continue").click(),
  "import:4": () => g("import-review-commit").click(),
  "calling-windows:0": confirm,
  "calling-windows:1": () => g("calling-windows-save").click(),
  "statement:0": async () => {
    await choose("statement-file", "docs-statement.csv");
    await page.locator("#statement-carrier").selectOption({ index: 1 });
    await page.locator("#statement-start").fill(iso(new Date(today.getFullYear(), today.getMonth() - 1, 1)));
    await page.locator("#statement-end").fill(iso(new Date(today.getFullYear(), today.getMonth(), 0)));
  },
  "statement:1": () => g("statement-next").click(),
  "statement:2": () => g("statement-preview").click(),
  "statement:3": () => g("statement-import").click(),
};

// Merged with earlier runs (public/docs/shots/manifest.json), so a run resumed mid-way keeps the steps already shot.
const MANIFEST = join(OUT, "manifest.json");
const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : {};
const shot = new Set();
const where = async () => {
  const head = page.locator("[data-guide-move]").first();
  if (!(await head.count())) return null;
  return { key: await head.getAttribute("data-guide-step"), move: Number(await head.getAttribute("data-guide-move")), say: (await page.locator("[data-setup-coach] p.font-semibold").first().textContent().catch(() => "")) ?? "" };
};

/**
 * Where to zoom in: the lit control and its coach together, padded, at least half the screen and in the screen's
 * own 16:10 shape, so Docs can open each picture on the part that matters (owner 2026-11-16: "way better").
 */
const focusBox = async () => {
  const boxes = [];
  for (const selector of ['[data-setup-coach][role="dialog"]', "[data-guide-lit]"]) {
    const box = await page.locator(selector).filter({ visible: true }).first().boundingBox().catch(() => null);
    if (box && box.width > 0) boxes.push(box);
  }
  if (boxes.length === 0) return undefined;
  const left = Math.min(...boxes.map((b) => b.x)) - 60, top = Math.min(...boxes.map((b) => b.y)) - 60;
  const right = Math.max(...boxes.map((b) => b.x + b.width)) + 60, bottom = Math.max(...boxes.map((b) => b.y + b.height)) + 60;
  let w = Math.max(right - left, 720), h = Math.max(bottom - top, 450);
  if (w / h > 1.6) h = w / 1.6; else w = h * 1.6;
  w = Math.min(w, 1440); h = Math.min(h, 900);
  if (w >= 1300) return undefined; // nearly the whole screen: no zoom worth having
  const x = Math.min(Math.max((left + right) / 2 - w / 2, 0), 1440 - w), y = Math.min(Math.max((top + bottom) / 2 - h / 2, 0), 900 - h);
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
};

const photograph = async (here) => {
  await page.waitForTimeout(900); // the spotlight settles
  const dir = join(OUT, here.key);
  mkdirSync(dir, { recursive: true });
  const file = `${here.move + 1}.jpg`;
  await page.screenshot({ path: join(dir, file), type: "jpeg", quality: 82 });
  const focus = await focusBox();
  (manifest[here.key] ??= [])[here.move] = { src: `/docs/shots/${here.key}/${file}`, width: 1440, height: 900, alt: here.say.trim(), ...(focus ? { focus } : {}) };
  writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`shot ${here.key}:${here.move} · ${here.say.trim()}`);
};

/**
 * One step on its own (`--steps team,assign,…`): the steps outside the Ready to sell run, and the two it skips in
 * this agency. Each opens with its own guide; every move is photographed, and only the moves that open something
 * (a sheet, a menu) are acted on, so nothing is sent, saved or handed out.
 */
const OPENS = {
  "team:0": () => g("team-invite").click(),
  "book:0": () => g("book-carriers").locator("button").first().click(),
  "outcomes:0": () => g("pipeline-setup").click(),
  "queue-sla:0": confirm,
  "retention:0": () => page.locator("#thresholds").click(),
  // #vendor-bills is an empty anchor before its row: press the row the guide lights, as a person does.
  "accounting:0": async () => {
    const lit = await page.locator("[data-guide-lit]").filter({ visible: true }).first().boundingBox();
    await page.mouse.click(lit.x + lit.width / 2, lit.y + lit.height / 2);
  },
  "hierarchy:0": async () => { await page.getByRole("button", { name: /^More/ }).first().click(); await page.getByRole("menuitem", { name: /Change a manager/ }).click(); },
};
/**
 * A step's last move that only waits for the save ("Set the amount, then click Save"): the guide lights no control
 * for it, and steps aside altogether once the step is done, so it never had a picture. Here it is lit by hand on the
 * real Save/Send control, after sample values are typed in (`fill`), and never pressed. A fill only types or picks
 * on the open sheet; it runs in the Docs Screenshots agency, or anywhere when `typeAnywhere` (typing into an invite or
 * a manager sheet sends nothing until its button is pressed, and the button never is). `at` opens another address
 * first (the end state of an upload: the statement the run imported).
 */
const sheet = () => page.locator('[role="dialog"]:not([data-setup-coach]), aside[data-slot="detail-panel"]').filter({ visible: true }).last();
const saveSetting = () => sheet().getByRole("button", { name: /^Save this setting$/i });
const FINISH = {
  "accounting:1": { fill: () => page.locator("#acct-invoice-tol").fill("75.00"), find: saveSetting },
  "retention:1": { fill: () => sheet().locator('button, [role="radio"]').filter({ hasText: /Medium and above/i }).first().click(), find: saveSetting },
  "phone:1": { fill: () => page.locator("#agency-support-phone").fill("(512) 555-0142"), find: () => page.getByRole("button", { name: /^Save changes$/i }) },
  "team:1": {
    typeAnywhere: true,
    fill: async () => { await page.locator("#invite-name").fill("Jordan Avery"); await page.locator("#invite-email").fill("jordan@example.com"); },
    find: () => sheet().getByRole("button", { name: /^Send invite$/i }),
  },
  "hierarchy:1": {
    typeAnywhere: true,
    fill: async () => {
      const [producer, manager] = [sheet().locator("select").nth(0), sheet().locator("select").nth(1)];
      if ((await producer.inputValue()) === "") await producer.selectOption({ index: 1 });
      if ((await manager.inputValue()) === "" && (await manager.locator("option").count()) > 2) await manager.selectOption({ index: 2 });
    },
    find: () => g("hierarchy-save"),
  },
  "statement:4": {
    at: async () => {
      await page.goto(`${BASE}/app/statements`, { waitUntil: "domcontentloaded" });
      // No "You left … Take me back" bar from a step shot earlier in this tab.
      await page.evaluate(() => { try { sessionStorage.setItem("setup-guide-active", "null"); } catch { /* storage blocked */ } });
      const href = await page.locator('a[href^="/app/statements/"]').first().getAttribute("href");
      await page.goto(`${BASE}${href.split("?")[0]}`, { waitUntil: "domcontentloaded" });
    },
    // Its lines, where the matches are accepted (the Accept all button stays greyed out until a match is proposed).
    find: () => page.locator("table").filter({ visible: true }).first(),
  },
};

/** The guide's look drawn by hand on `locator` (its ring and coach), with the guide's own spotlight hidden. */
const lightByHand = async (locator, { index, total, label, say, detail }) => {
  await locator.waitFor({ state: "visible", timeout: 60_000 });
  await locator.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const box = await locator.boundingBox();
  await page.evaluate(({ box, index, total, label, say, detail }) => {
    document.getElementById("docs-shot-light")?.remove();
    for (const lit of document.querySelectorAll("[data-guide-lit], [data-guide-shield], [data-setup-coach][role=dialog]")) {
      lit.style.display = "none";
      for (let dim = lit.previousElementSibling; dim && dim.classList.contains("pointer-events-none"); dim = dim.previousElementSibling) dim.style.display = "none";
    }
    const pad = 4;
    const r = { x: box.x - pad, y: box.y - pad, w: box.width + pad * 2, h: box.height + pad * 2 };
    const root = document.createElement("div");
    root.id = "docs-shot-light";
    root.style.cssText = "position:fixed;inset:0;z-index:2147483000;pointer-events:none";
    const dim = document.createElement("div");
    dim.style.cssText = `position:fixed;inset:0;background:rgba(3,7,6,.55);clip-path:path(evenodd,"M0 0H${innerWidth}V${innerHeight}H0Z M${r.x} ${r.y}h${r.w}v${r.h}h${-r.w}Z")`;
    const ring = document.createElement("div");
    ring.setAttribute("data-guide-lit", "");
    ring.style.cssText = `position:fixed;left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px;border-radius:10px;box-shadow:0 0 0 2px var(--primary,#07d6a0)`;
    const coach = document.createElement("div");
    coach.setAttribute("data-setup-coach", "");
    coach.setAttribute("role", "dialog");
    const width = 320;
    const left = Math.min(Math.max(r.x + r.w - width, 12), innerWidth - width - 12);
    const room = r.y + r.h + 12 + 150 < innerHeight;
    coach.style.cssText = `position:fixed;left:${left}px;${room ? `top:${r.y + r.h + 12}px` : `bottom:${innerHeight - r.y + 12}px`};width:${width}px;display:flex;flex-direction:column;gap:6px;padding:14px;border-radius:12px;background:var(--color-card,#0d1714);border:1px solid var(--primary,#07d6a0);color:var(--foreground,#f2f7f5);font:14px/1.4 Inter,system-ui,sans-serif;box-shadow:0 12px 30px rgba(0,0,0,.35)`;
    const head = document.createElement("div");
    head.style.cssText = "display:flex;gap:8px;font-size:12px;color:var(--muted-foreground,#93a69f)";
    head.innerHTML = "<span></span><span style='flex:1'></span><span></span>";
    head.children[0].textContent = `${index} of ${total}`;
    head.children[2].textContent = label;
    const title = document.createElement("div");
    title.style.fontWeight = "600";
    title.textContent = say;
    coach.append(head, title);
    if (detail) { const more = document.createElement("div"); more.style.color = "var(--muted-foreground,#93a69f)"; more.textContent = detail; coach.append(more); }
    root.append(dim, ring, coach);
    document.body.append(root);
  }, { box, index, total, label, say, detail });
};

const finishShot = async (key, move, moves, label) => {
  const finish = FINISH[`${key}:${move}`];
  if (finish.at) await finish.at();
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
  if (finish.fill && (!AS || finish.typeAnywhere)) await finish.fill();
  await lightByHand(finish.find(), { index: move + 1, total: moves.length, label, say: moves[move].say, detail: moves[move].detail });
  await photograph({ key, move, say: moves[move].say });
  await page.evaluate(() => document.getElementById("docs-shot-light")?.remove());
};

// `--last`: only the steps' last move is photographed again; the pictures before it are kept.
const LAST_ONLY = process.argv.includes("--last");
const singles = arg("--steps")?.split(",").filter(Boolean);
if (singles) {
  const { setupStepDefinitions, guideHref } = await import("../lib/dashboard/checklist.ts");
  const { guideMovesFor } = await import("../lib/dashboard/guideMoves.ts");
  for (const key of singles) {
    const definition = setupStepDefinitions().find((item) => item.key === key);
    if (!definition) { console.log(`skip ${key}: no such step`); continue; }
    const moves = guideMovesFor(definition);
    let started = LAST_ONLY; // an earlier run's pictures stay until this one has a coach to photograph
    const finishing = (move) => FINISH[`${key}:${move}`] !== undefined;
    if (LAST_ONLY) {
      if (!finishing(moves.length - 1)) { console.log(`skip ${key}: its last move is the guide's own picture`); continue; }
      manifest[key] = Array.from({ length: moves.length }, (_, at) => manifest[key]?.[at] ?? null);
    }
    // A last move reached by its own address needs nothing before it.
    if (LAST_ONLY && FINISH[`${key}:${moves.length - 1}`].at) {
      await finishShot(key, moves.length - 1, moves, definition.label).catch((error) => console.log(`skip ${key}: ${error.message.split("\n")[0]}`));
      continue;
    }
    await page.goto(`${BASE}${guideHref({ key, path: definition.path })}`, { waitUntil: "domcontentloaded" });
    for (let move = 0; move < moves.length; move += 1) {
      if (finishing(move)) {
        if (!started) { manifest[key] = Array.from({ length: moves.length }, () => null); started = true; }
        await finishShot(key, move, moves, definition.label).catch(async (error) => {
          console.log(`skip ${key}:${move}: ${error.message.split("\n")[0]}`);
          if (process.env.DOCS_SHOTS_DEBUG) await page.screenshot({ path: join(process.env.DOCS_SHOTS_DEBUG, `${key}-${move}.jpg`), type: "jpeg" });
        });
        break;
      }
      let here = null;
      for (let wait = 0; wait < 40 && !(here && here.move >= move); wait += 1) { here = await where(); if (!(here && here.move >= move)) await page.waitForTimeout(500); }
      if (!here || here.key !== key) { console.log(`skip ${key}: no coach (not on this plan, or nothing to show)`); break; }
      if (here.move !== move) continue;
      if (moves[move].target) await page.locator('[data-setup-coach][role="dialog"]').first().waitFor({ timeout: 15_000 }).catch(() => undefined);
      await page.waitForLoadState("networkidle", { timeout: 4_000 }).catch(() => undefined);
      if (!started) { manifest[key] = Array.from({ length: moves.length }, () => null); started = true; }
      if (!LAST_ONLY) await photograph({ ...here, say: (await where())?.say ?? here.say });
      const open = OPENS[`${key}:${move}`];
      if (move === moves.length - 1 || (!open && !finishing(move + 1))) break;
      if (open) await open().catch((error) => console.log(`skip rest of ${key}: ${error.message.split("\n").slice(0, process.env.DOCS_SHOTS_DEBUG ? 14 : 1).join("\n")}`));
    }
  }
} else {
await page.goto(`${BASE}/app/setup`, { waitUntil: "domcontentloaded" });
await page.getByRole("link", { name: /Start · Insurvas shows every click|Resume/ }).first().click();
const advances = [];
let lastKey = null;
for (let guard = 0; guard < 200; guard += 1) {
  if (/\/app\/setup\?celebrate=1/.test(page.url())) break;
  let here = null;
  for (let wait = 0; wait < 120 && !here; wait += 1) { here = await where(); if (!here) await page.waitForTimeout(500); if (/celebrate=1/.test(page.url())) break; }
  if (!here) { if (/celebrate=1/.test(page.url())) break; throw new Error(`No coach on ${page.url()} after 60s`); }
  if (here.key !== lastKey) { if (lastKey) advances.push(`${lastKey} → ${here.key}`); lastKey = here.key; }
  // A move with a control is photographed once that control is lit (the coach floats beside it), never while the
  // page is still loading; a move with none (or one that never lights) after 15s, as it is.
  if (!shot.has(`${here.key}:${here.move}`)) {
    await BEFORE_SHOT[`${here.key}:${here.move}`]?.().catch(() => undefined);
    await page.locator('[data-setup-coach][role="dialog"]').first().waitFor({ timeout: 15_000 }).catch(() => undefined);
    await page.waitForLoadState("networkidle", { timeout: 4_000 }).catch(() => undefined);
    const settled = await where();
    // Its coach gone by now (a last "done" move hands straight on to the next step): nothing of it to photograph.
    if (!settled) continue;
    here = settled;
  }
  const id = `${here.key}:${here.move}`;
  if (!shot.has(id)) {
    await photograph(here);
    shot.add(id);
  }
  const act = ACTS[id];
  if (act) await act();
  // Wait for the guide to move: another move, another step, or the run's end.
  for (let wait = 0; wait < 120; wait += 1) {
    await page.waitForTimeout(500);
    if (/celebrate=1/.test(page.url())) break;
    const now = await where();
    if (now && `${now.key}:${now.move}` !== id) break;
  }
}
if (!/celebrate=1/.test(page.url())) throw new Error(`The run did not reach the end: stopped on ${page.url()}`);
console.log(`Auto-advanced: ${advances.join(", ")}`);
}

mkdirSync(OUT, { recursive: true });
writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}
`);
const body = Object.entries(manifest)
  .map(([key, shots]) => `  ${JSON.stringify(key)}: [\n${Array.from(shots, (s) => (s ? `    ${JSON.stringify(s)},` : "    null,")).join("\n")}\n  ],`)
  .join("\n");
writeFileSync(join(ROOT, "lib", "docs", "shots.ts"), `/**
 * Real screenshots of every guide move, in order, per Get set up step: what the Docs setup pages show
 * (owner 2026-11-16). Generated by scripts/docs-shots.mjs in the Docs Screenshots agency; do not edit by hand.
 */
export type DocShot = { src: string; width: number; height: number; alt: string; focus?: { x: number; y: number; w: number; h: number } };

export const DOC_SHOTS: Record<string, readonly (DocShot | null)[]> = {
${body}
};
`);
await browser.close();
console.log(`Wrote ${shot.size} screenshots and lib/docs/shots.ts`);
