// Run with: npm test
//
// docs/design/UI-CONSISTENCY.md §18 (Motion, 2026-11-09) as checks on source text: the overlay utilities the kit's
// class names rely on exist, there is one reduced-motion stop, page motion never starts from blank, and the shared
// parts keep the hooks the motion layer reads. DB-free and network-free.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const read = (path) => readFileSync(join(ROOT, path), "utf8");
const css = read("app/globals.css");

function walk(dir, out = []) {
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, out);
    else if (rel.endsWith(".tsx")) out.push(rel);
  }
  return out;
}

test("every enter/exit class the kit uses is defined in the motion layer", () => {
  // These were dead for months: no plugin defined them, so every overlay opened with a cut.
  const used = new Set();
  for (const file of [...walk("components"), ...walk("app")]) {
    for (const match of read(file).matchAll(/\b(animate-in|animate-out|fade-(?:in|out)|zoom-(?:in|out)|slide-in-from-(?:top|bottom|left|right)|slide-out-to-(?:top|bottom|left|right))(?=-\d|\b)/g)) used.add(match[1]);
  }
  for (const name of used) {
    const utility = name.startsWith("animate-") ? `@utility ${name} ` : `@utility ${name}-* `;
    assert.ok(css.includes(utility), `${name} is used but globals.css has no "${utility.trim()}"`);
  }
});

test("one reduced-motion stop for every animation and transition", () => {
  const global = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{\s*\*,/g)];
  assert.equal(global.length, 1, "exactly one global reduced-motion block");
  assert.match(css, /::view-transition-new\(\*\) \{ animation: none !important; \}/, "view transitions stop too");
});

test("page and row motion never starts from blank (the light-mode flash, 2026-11-03)", () => {
  for (const name of ["m-vt-rise", "m-vt-from-right", "m-vt-from-left", "m-rows-next", "m-rows-prev", "m-shell-side", "m-shell-top", "m-content-in", "m-rise"]) {
    const frames = css.match(new RegExp(`@keyframes ${name}\\s+\\{ from \\{ opacity: ([.\\d]+);`));
    assert.ok(frames, `${name} is missing`);
    assert.ok(Number(frames[1]) >= 0.7, `${name} starts at opacity ${frames[1]}`);
  }
  assert.equal([...css.matchAll(/@keyframes m-draw\b/g)].length, 1, "m-draw is defined once");
});

test("the shared parts carry what the motion layer reads", () => {
  const transition = read("components/portal/portal-page-transition.tsx");
  assert.match(transition, /<PageEntrance key=\{pathname\}>/, "the page remounts per address");
  assert.match(transition, /for \(const mover of movers\) mover\.dataset\.enter = direction;/, "only what is on screen as the page arrives moves");
  assert.match(read("components/ui/nav-pending.tsx"), /markNavDirection\(props\.transitionTypes\)/, "a link marks its direction");
  for (const move of ["area", "forward", "back"]) assert.match(css, new RegExp(`\\.portal-page-transition \\[data-enter="${move}"\\] \\{ animation: m-vt-`), `${move} has its move`);
  for (const rail of ["components/app/step-frame/step-rail.tsx", "components/app/reports/reports-rail.tsx", "components/app/lead-sources/leads-in-rail.tsx"]) {
    assert.match(read(rail), /transitionTypes=\{on \? undefined : \[here >= 0 && index < here \? "nav-back" : "nav-forward"\]\}/, `${rail} tags its direction`);
  }
  assert.match(read("components/app/agent-sidebar.tsx"), /<IntentLink\s+href=\{item\.path\}/, "the sidebar prefetches on intent");
  assert.match(read("components/ui/detail-panel.tsx"), /data-state=\{closing \? "closed" : "open"\}/, "the panel plays its exit");
  assert.match(read("components/ui/paged.tsx"), /data-page-turn=\{paged\?\.turn \?\? undefined\}/);
  assert.match(read("components/ui/tab-track.tsx"), /data-tab-pill=/);
  assert.match(read("components/app/tenant-auth-workspace.tsx"), /markShellEntrance\(\); router\.replace/);
  assert.match(read("app/app/(shell)/layout.tsx"), /<ShellEntrance \/>/);
});

test("Wave 1: the shell and the dashboard carry their motion", () => {
  assert.match(read("components/app/home/dash/dash-kit.tsx"), /className="m-dash flex w-full/, "DashLayout's cards stagger in");
  for (const view of ["overview-view", "agency-view"]) assert.match(read(`components/app/home/views/${view}.tsx`), /className="m-dash-ov flex w-full/, `${view}'s cards stagger in`);
  assert.match(read("components/app/home/dash/dash-kit.tsx"), /<CountUp text=\{total\} fromZero \/>/, "the big figure counts up");
  assert.match(read("components/app/agent-sidebar.tsx"), /\$\{moving \? "is-moving" : ""\}/, "the rail glides only when toggled");
  assert.match(css, /\.portal-agent-sidebar-desktop\.is-moving \{ transition: width/);
});

test("Wave 8: signing in, signing up and signing out", () => {
  const auth = read("components/portal/auth-layout.tsx");
  assert.match(auth, /<div data-auth-steps="">/);
  assert.match(auth, /<div data-auth-step-body="">/);
  assert.match(css, /\[data-auth-body\]:has\(> \[data-auth-steps\]\) > \[data-auth-step-body\] \{ animation: m-vt-from-right/, "a sign-up step slides in while the bars hold");
  assert.match(read("components/app/app-top-bar.tsx"), /document\.documentElement\.classList\.add\("shell-leave"\);\n\s*router\.push\(redirect\);/, "signing out dims the workspace");
  assert.match(read("components/app/shell-entrance.tsx"), /classList\.remove\("shell-leave"\)/, "a new workspace starts bright");
});

test("Wave 7: Compliance, Reports, Partners and Settings", () => {
  assert.match(read("components/app/agent-settings-tabs.tsx"), /data-enter=\{sectionEnter === "area" \? undefined : sectionEnter\}/, "a settings section slides by menu direction");
  assert.match(read("components/ui/settings-layout.tsx"), /className="m-savebar sticky/, "the save bar rises in");
  assert.match(read("components/app/partner-chat-workspace.tsx"), /isNew\(item\.id\) && "m-msg-in"/, "a new chat message rises in");
  assert.match(read("components/app/compliance/compliance-flow.tsx"), /StepFrame/, "Compliance uses the shared step frame");
  assert.match(read("components/app/reports/reports-page.tsx"), /data-page-content className=\{FRAME_STEP\}/, "a Reports view is what moves");
});

test("Wave 6: Retention, Commissions and Accounting", () => {
  for (const frame of ["retention/retention-page", "commissions/commissions-page", "accounting/accounting-page"]) {
    assert.match(read(`components/app/${frame}.tsx`), /StepFrame/, `${frame} uses the shared step frame, so its steps slide and its title and rail hold`);
  }
  assert.match(read("components/app/accounting/bank-board.tsx"), /<div key=\{m\.id\} className="m-content-in/, "a bank match settles in under its row");
});

test("Wave 5: Book of business and Carrier sync", () => {
  assert.match(read("components/app/policy-book.tsx"), /className="m-rows-settle">/, "a new set of policies settles in");
  assert.match(read("components/ui/pager.tsx"), /onClick=\{\(event\) => markPageTurn\(event\.currentTarget, to, true\)\}/, "a server-paged list turns its page once the rows arrive");
  assert.match(read("components/app/book/needs-you/review-workspace.tsx"), /<div key=\{keyOf\(current\)\} data-enter="forward">/, "the next question slides in");
  assert.match(css, /\.m-rows-settle > \* \{ animation: m-panel-settle/);
  assert.ok(css.indexOf(".m-rows-settle > *") < css.indexOf('[data-page-turn="next"] > *'), "a page turn overrides the settle");
});

test("Wave 4: Sales, and every list paged with the Pager", () => {
  const workspace = read("components/app/applications/workspace/application-workspace.tsx");
  assert.equal((workspace.match(/<div key=\{step\} data-enter=\{enter\}/g) ?? []).length, 2, "both application step columns slide by direction");
  assert.doesNotMatch(workspace, /animate-\[m-rise_/, "no hand-rolled rise left");
  assert.match(read("components/ui/pager.tsx"), /onClick=\{\(event\) => \{ markPageTurn\(event\.currentTarget, to\); onPage\?\.\(to\); \}\}/, "a client-paged list turns its page with motion");
});

test("Wave 3: Leads", () => {
  assert.match(read("components/app/lead-sources/leads-in.tsx"), /<div key=\{step\} data-page-content className="m-content-in/, "a Leads-in step's column is what moves");
  assert.match(read("components/app/lead-workspace.tsx"), /data-dragging=\{dragging \? "" : undefined\} className=\{cn\("m-drop-in/, "board cards settle in and fade while dragged");
  assert.match(read("components/app/lead-workspace.tsx"), /<div key=\{view\} className=\{cn\("m-content-in"/, "a lead view switch settles in");
  assert.match(read("components/app/lead-duplicate-review.tsx"), /<div key=\{item\.id\} data-enter=\{enter\}/, "the next duplicate slides in");
  assert.match(css, /\.m-drop-in\[data-dragging\] \{ opacity: \.45;/);
  assert.match(read("components/app/lead-sources/leads-in-rail.tsx"), /rememberLeadsIn\(\{ steps, collapsed \}\)/, "the Leads in menu remembers itself");
  assert.match(read("components/app/shell-loading.tsx"), /const leads = leadsInFor\(pathname\);/, "a loading Leads in step keeps its title and menu");
});

test("Wave 2: Today's pages move in the direction of the work", () => {
  assert.match(read("components/app/inbound/inbound-call.tsx"), /<div key=\{phase\} data-enter=/, "a call step slides by direction");
  assert.match(read("components/app/dialer-workspace.tsx"), /<div key=\{leadKey\} data-enter=\{leadKey !== firstLead \? "forward" : undefined\}/, "the next lead slides in");
  assert.match(read("components/app/appointment-calendar.tsx"), /data-enter=\{turn && turn\.to === anchor/, "a day or week move slides");
  assert.match(read("components/app/calendar/mini-month.tsx"), /<div key=\{index\} data-enter=\{seen\.enter\}/, "the month slides");
  assert.match(read("components/app/callback-calendar.tsx"), /<tbody key=\{listCurrent\} data-page-turn=\{pageTurn\}>/, "callbacks turn their pages");
});
