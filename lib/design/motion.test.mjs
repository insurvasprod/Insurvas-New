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
  assert.match(transition, /movers\.forEach\(\(mover, index\) => stamp\(mover, "enter", direction, index\)\);/, "only what is on screen as the page arrives moves");
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

test("the calm cascade: one section at a time, capped, late content settles (owner 2026-11-12)", () => {
  const transition = read("components/portal/portal-page-transition.tsx");
  assert.match(transition, /direction === "area" \? sectionsOf\(child\) : \[child as HTMLElement\]/, "an area move cascades the page's sections; a rail move slides it as one");
  assert.match(transition, /const CASCADE_STEPS = 5;/, "the cascade is capped, so a page settles in about 0.4s");
  assert.match(transition, /Math\.min\(index, CASCADE_STEPS - 1\)/);
  assert.match(transition, /observer\.disconnect\(\), SETTLE_WINDOW_MS/, "late content is watched for a while, then let go");
  assert.match(css, /\[data-enter="area"\] \{ animation: m-vt-rise var\(--t-page\) var\(--e-out\) backwards; animation-delay: calc\(var\(--enter-i, 0\) \* 50ms\); \}/);
  assert.match(css, /\[data-settle\] \{ animation: m-content-in /, "a swapped skeleton settles, never slides again");
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
  // A fresh document after sign-out (2026-11-13): the client move left the dim on the sign-in page.
  assert.match(read("components/app/app-top-bar.tsx"), /document\.documentElement\.classList\.add\("shell-leave"\);[\s\S]{0,600}?window\.location\.replace\(redirect\);/, "signing out dims the workspace, then loads the sign-in page fresh");
  assert.match(css, /html\.shell-leave \.portal-agent:not\(\.portal-tenant-auth-shell\) \{/, "the dim never reaches the sign-in page, which wears portal-agent too");
  assert.doesNotMatch(read("components/app/logout-button.tsx"), /router\.push\("\/app\/login"\)/, "every sign-out loads the sign-in page fresh");
  assert.match(read("components/app/shell-entrance.tsx"), /classList\.remove\("shell-leave"\)/, "a new workspace starts bright");
});

test("pending button: the request is on its way (Sign in, 2026-11-13)", () => {
  const button = read("components/ui/button.tsx");
  assert.match(button, /data-pending=\{pending \? "" : undefined\}/);
  assert.match(button, /disabled=\{disabled \|\| pending\}/, "a pending button cannot be pressed twice");
  assert.match(css, /\[data-slot="button"\]\[data-pending\]::after \{[\s\S]{0,240}?animation: m-nav-progress/, "the pending hairline, inside the button");
  const signIn = read("components/app/tenant-auth-workspace.tsx");
  assert.match(signIn, /pending=\{loginLoading\}/);
  assert.match(signIn, /if \(!opening\) \{ inFlight\.current = false; setLoginLoading\(false\); \}/, "it stays pending until the app is here");
  assert.match(signIn, /form\.elements\.namedItem\("password"\)/, "an autofilled password is read on the first click");
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
  // Round 7 (2026-11-10): a bank line's matches moved out of its row into the Match dialog, where they settle in.
  assert.match(read("components/app/accounting/bank-match.tsx"), /<div key=\{m\.id\} className="m-content-in/, "a bank match settles in, in its dialog");
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
  // Wave C (2026-11-18): only a lead slides; the skeleton between two leads settles in place.
  assert.match(read("components/app/dialer-workspace.tsx"), /<div key=\{leadKey\} data-enter=\{panel && leadKey !== firstLead \? "forward" : undefined\} data-settle=\{panel \? undefined : ""\}/, "the next lead slides in");
  assert.match(read("components/app/appointment-calendar.tsx"), /data-enter=\{turn && turn\.to === anchor/, "a day or week move slides");
  assert.match(read("components/app/calendar/mini-month.tsx"), /<div key=\{index\} data-enter=\{seen\.enter\}/, "the month slides");
  assert.match(read("components/app/callback-calendar.tsx"), /<tbody key=\{listCurrent\} data-page-turn=\{pageTurn\}>/, "callbacks turn their pages");
});

test("Tier 1–2 change moments: each keyframe once, on the tokens, never looping (sign-off, 2026-11-17)", () => {
  for (const token of ["--t-exit-row", "--t-stamp", "--t-saved", "--t-highlight"]) {
    assert.equal([...css.matchAll(new RegExp(`^\\s*${token}:\\s+\\d+ms;`, "gm"))].length, 1, `${token} is defined once beside the other tokens`);
  }
  const uses = {
    "m-row-out": /\[data-row-exit\] \{[^}]*animation: m-row-out var\(--t-exit-row\) var\(--e\) both;/,
    "m-row-collapse": /m-row-collapse var\(--t-exit-row\) var\(--e\) both;/,
    "m-row-new": /\[data-row-new\]::after \{[^}]*animation: m-row-new var\(--t-highlight\) var\(--e\) both;/,
    "m-saved": /\[data-saved\]::after \{[^}]*animation: m-saved var\(--t-saved\) var\(--e\) both;/,
    "m-badge-in": /\[data-count-badge\]\[data-state="entering"\] \{ animation: m-badge-in var\(--t-panel\) var\(--e-out\) backwards; \}/,
    "m-badge-out": /\[data-count-badge\]\[data-state="leaving"\] \{ animation: m-badge-out var\(--t-float-out\) var\(--e\) both; \}/,
    "m-pop": /\.m-pop \{ animation: m-pop var\(--t-panel\) var\(--e-out\) backwards; \}/,
    "m-error-in": /\.m-error-in \{ animation: m-error-in var\(--t-panel\) var\(--e-out\) backwards; \}/,
    "m-line-open": /m-line-open var\(--t-panel\) var\(--e-out\) backwards;/,
  };
  for (const [name, use] of Object.entries(uses)) {
    assert.equal([...css.matchAll(new RegExp(`@keyframes ${name}\\b`, "g"))].length, 1, `${name} is defined once`);
    assert.match(css, use, `${name} runs on its token`);
  }
  assert.match(css, /\.m-stamp-check \{ stroke-dasharray: 1; animation: m-draw var\(--t-stamp\) var\(--e-out\) backwards; \}/, "the stamp's check draws in --t-stamp");
  assert.match(css, /\.m-deny-now \{ animation: m-deny var\(--t-panel\) var\(--e\) 1 both; \}/, "a refused submit shakes once");
  // The section between its own heading and the next one: no loop, no hand-set timing, nothing but the row collapse
  // and the error line's open (both by height, as a fold) touching layout.
  const block = css.slice(css.indexOf("/* 5i · Change moments"), css.indexOf("/* 5e · Shell entrance"));
  assert.ok(block.length > 0, "the change moments have their section");
  assert.doesNotMatch(block, /infinite|alternate/, "nothing loops");
  for (const decl of block.matchAll(/animation: ([^;]+);/g)) {
    for (const part of decl[1].split(/,(?![^(]*\))/)) assert.match(part.trim(), /^m-[\w-]+ var\(--t-[\w-]+\) var\(--e(?:-out)?\)/, `animation "${part.trim()}" runs on a token`);
  }
  for (const decl of block.matchAll(/transition: ([^;]+);/g)) {
    for (const part of decl[1].split(",")) assert.match(part.trim(), /^(opacity|transform|background-color|color) var\(--t-[\w-]+\) var\(--e(?:-out)?\)$/, `transition "${part.trim()}" is opacity, transform or a chip's colour, on a token`);
  }
  for (const frames of block.matchAll(/@keyframes ([\w-]+) \{([^@]*?)\}\s*\}?\n/g)) {
    const props = [...frames[2].matchAll(/([a-z-]+):/g)].map((m) => m[1]);
    const allowed = frames[1] === "m-row-collapse" ? ["block-size", "padding-block", "margin-block", "border-block-width"]
      : frames[1] === "m-line-open" ? ["block-size", "margin-block-start"] : ["opacity", "transform"];
    for (const prop of props) assert.ok(allowed.includes(prop), `${frames[1]} animates ${prop}`);
  }
  // Every change moment is stilled by the one reduce block (it sets every animation and transition to .01ms).
  assert.ok(css.indexOf("@media (prefers-reduced-motion: reduce) {\n  *,") < css.indexOf("/* 5i · Change moments"), "the reduce block covers them");
});

test("Tier 1–2 change moments: the shared hooks and opt-in props", () => {
  const rowExit = read("components/ui/use-row-exit.ts");
  assert.match(rowExit, /if \(reducedMotion\(\)\) void finish\(\);/, "reduced motion finishes the exit at once");
  assert.match(rowExit, /motionMs\("--t-exit-row", 200\)/, "the wait is the row-exit token");
  assert.match(rowExit, /"data-row-exit": ""/);
  assert.match(read("components/ui/use-arrivals.ts"), /: new Set\(ids\.filter\(\(id\) => !state\.seen\.has\(id\)\)\)/, "only ids not seen before are new");
  assert.match(read("components/ui/count-up.tsx"), /!changesOnly && \(hydrated \|\| fromZero\) \? 0 : null/, "changesOnly never counts on the first paint");
  const badge = read("components/ui/count-badge.tsx");
  assert.match(badge, /<CountUp text=\{[^}]+\} changesOnly duration=\{ROLL_MS\} \/>/, "a badge rolls with CountUp's easing");
  assert.match(badge, /data-state=\{leaving \? "leaving" : /, "a badge shrinks away at 0");
  assert.match(read("components/ui/view-switch.tsx"), /useGlidePill\(track, /, "it reuses the tab track's measuring");
  assert.match(read("components/ui/tab-track.tsx"), /const pill = useGlidePill\(ref\);/, "TabTrack measures with the same hook");
  const bulk = read("components/ui/bulk-bar.tsx");
  // Wave B (2026-11-18): the sliding bar is the only bar; no opt-in left (see "Wave B · the bulk bar and one checkbox").
  assert.match(bulk, /data-state=\{open \? "open" : "closed"\}/, "the sliding bar stays mounted");
  // Wave B made the error reveal the default: no opt-in left (checked in "Wave B · …" below).
  assert.match(read("components/ui/save-status.tsx"), /const SAVED_HOLD_MS = 2000;/);
  assert.match(read("components/ui/done-stamp.tsx"), /className="m-stamp-check" pathLength=\{1\}/);
  const lab = read("components/app/motion-lab/change-moments.tsx");
  for (const part of ["useRowExit", "useArrivals", "CountBadge", "StatusChip tone={state.tone}", "ViewSwitch fallback=\"table\" label=\"Show as\"", "ShowSwap", "addTransitionType(to > at ? \"nav-forward\" : \"nav-back\")", "useGlidePill", "SaveStatus", "useSavedFlash", "useDenyShake", "<BulkBar count", "<CheckBox", "DoneStamp", "UploadProgress", "m-dropzone"]) {
    assert.ok(lab.includes(part), `the motion lab shows ${part}`);
  }
});

test("Wave A: Tier 1 on every screen (owner sign-off, 2026-11-17)", () => {
  // Status chips cross-fade, always: no opt-in left.
  const chip = read("components/ui/status-chip.tsx");
  assert.match(chip, /className=\{`m-chip-fade inline-flex/, "every chip cross-fades between states");
  assert.match(chip, /<span data-chip-dot="" className/, "its dot fades with it");
  assert.doesNotMatch(chip, /fade\?: boolean/, "no opt-in left on the chip");

  // Table · Chart glides, always, and the view under it crosses in, once in the frames.
  const viewSwitch = read("components/ui/view-switch.tsx");
  assert.match(viewSwitch, /data-glide-track=""/, "the switch always glides");
  assert.doesNotMatch(viewSwitch, /glide\?: boolean|glide = false/, "no opt-in left on the switch");
  assert.match(viewSwitch, /return <div key=\{show\} data-show-swap="" className=\{cn\("flex min-w-0 flex-col gap-4 \[&>\*\]:shrink-0", flipped && "m-swap"\)\}>/, "the view remounts per ?show= and crosses in only after a flip");
  assert.match(read("components/app/reports/reports-page.tsx"), /\{show \? <ShowSwap fallback=\{show\}>\{children\}<\/ShowSwap> : children\}/, "every Reports view with the switch crosses in");
  assert.match(read("components/app/retention/retention-page.tsx"), /\{show \? <ShowSwap fallback=\{show\}>\{children\}<\/ShowSwap> : children\}/, "a Retention step with the switch crosses in");
  for (const [file, pattern] of Object.entries({
    "app/app/(shell)/retention-results/page.tsx": /show="chart"/,
    "app/app/(shell)/retention-scorecard/page.tsx": /show="chart"/,
  })) assert.match(read(file), pattern, `${file} tells its frame it has the switch`);
  // Every screen with a ViewSwitch hands the frame its `show` (a switch with nothing crossing under it is a cut).
  for (const file of [...walk("components"), ...walk("app")]) {
    if (file === "components/ui/view-switch.tsx" || file.includes("motion-lab")) continue;
    const source = read(file);
    if (!/<ViewSwitch\b/.test(source)) continue;
    assert.ok(/<ReportsPage\b|<RetentionPage\b|ShowSwap/.test(source), `${file} draws a ViewSwitch but its view never crosses in`);
  }

  // ‹ › between records slides from the side clicked: no record stepper link without its direction.
  const tag = /<(Link|IntentLink)\s((?:[^<>]|=>)*?title=\{`(Previous|Next) [^`:]*:(?:[^<>]|=>)*?)>/g;
  let steppers = 0;
  for (const file of [...walk("components"), ...walk("app")]) {
    for (const match of read(file).matchAll(tag)) {
      steppers++;
      const direction = match[3] === "Previous" ? "nav-back" : "nav-forward";
      assert.equal(match[1], "IntentLink", `${file}: a ‹ › link marks its direction (IntentLink), "${match[3]} …"`);
      assert.ok(match[2].includes(`transitionTypes={["${direction}"]}`), `${file}: "${match[3]} …" slides with ${direction}`);
    }
  }
  assert.ok(steppers >= 20, `the record steppers were found (${steppers})`);

  // Counts roll everywhere: rail badges, title-line tab counts, the bell, the figures.
  for (const rail of ["components/app/step-frame/step-rail.tsx", "components/app/reports/reports-rail.tsx", "components/app/lead-sources/leads-in-rail.tsx"]) {
    const source = read(rail);
    assert.match(source, /<CountBadge value=\{[^}]+\} [^>]*tone="warning"/, `${rail}'s badge rolls, pops in and shrinks away`);
    assert.doesNotMatch(source, /tabular-nums">\{/, `${rail} draws no hand-made badge`);
    assert.match(source, /const pill = useRailGlide\(list, /, `${rail}'s open step glides`);
    assert.match(source, /<RailHighlight pill=\{pill\} \/>/);
    assert.match(source, /<ul ref=\{list\} data-rail-track=""/);
    assert.match(source, /transitionTypes=\{on \? undefined : \[here >= 0 && index < here \? "nav-back" : "nav-forward"\]\}/, `${rail} keeps its step direction`);
    assert.doesNotMatch(source, /duration-\d|cubic-bezier|\d+ms\b/, `${rail} times its motion with the tokens only`);
  }
  assert.match(read("components/app/step-frame/rail-glide.tsx"), /useGlidePill\(list, \{ items: ":scope > li > a", chosen: '\[aria-current="page"\]', watch: "aria-current", remember: `rail:\$\{name\}` \}\)/, "the rail measures with the tabs' hook and carries its pill to the next page");
  assert.match(css, /\[data-tab-pill\]\[data-tab-indicator="rail"\] \{/, "the rail's pill has its look");
  assert.match(read("components/ui/view-tabs.tsx"), /<CountUp text=\{value\.toLocaleString\("en-US"\)\} changesOnly duration=\{ROLL_MS\} \/>/, "a tab's count rolls when it changes");
  const topBar = read("components/app/app-top-bar.tsx");
  assert.equal((topBar.match(/<CountBadge value=\{[^}]+\}[^>]* tone="bare" className="portal-top-badge/g) ?? []).length, 3, "the inbox, bell and alerts counts roll");
  assert.doesNotMatch(topBar, /<span className="portal-top-badge/, "no hand-made top-bar badge left");
  assert.match(read("components/ui/stat.tsx"), /<CountUp text=\{String\(value\)\} changesOnly duration=\{ROLL_MS\} \/>/, "a strip figure (StatCard, BoardStatTile) rolls on a change, never on the first paint");
  assert.match(read("components/ui/kpi-tile.tsx"), /<CountUp text=\{String\(value\)\} changesOnly duration=\{ROLL_MS\} \/>/, "a KPI figure rolls on a change, never on the first paint");
  assert.match(read("components/ui/count-badge.tsx"), /data-state=\{leaving \? "leaving" : settled \? undefined : "entering"\}/, "a badge there on the first paint does not pop");
});

test("Wave A · rows that leave when you finish them, and rows that arrive (Tier 1, 2026-11-17)", () => {
  // Each of the six screens adopts the kit: a decided row plays out, a new one arrives tinted.
  const screens = {
    "pay issues": ["components/app/commissions/pay-issues/pay-issues-list.tsx", "components/app/commissions/pay-issues/group-rows.tsx"],
    "statement lines": ["components/app/statement-review.tsx"],
    "needs you": ["components/app/book/needs-you/needs-you-list.tsx", "components/app/book/needs-you/review-workspace.tsx"],
    "accounting to do": ["components/app/accounting/todo-board.tsx"],
    "dashboard needs you": ["components/app/home/dash/dash-needs-live.tsx"],
    "refreshed lists": ["components/app/carrier-files-table.tsx", "components/app/agent-floor.tsx"],
  };
  for (const [screen, files] of Object.entries(screens)) {
    for (const file of files) assert.match(read(file), /import \{[^}]*\b(useRowExit|useDepartures|useArrivals)\b[^}]*\} from "@\/components\/ui\/use-(row-exit|arrivals)";/, `${screen}: ${file} uses the row kit`);
  }

  // No decided row is removed before it has played out: the refresh runs inside exit(…, then).
  const statement = read("components/app/statement-review.tsx");
  assert.match(statement, /const leave = useRowExit\(lines\);/, "statement lines are let go when the refresh lands");
  assert.match(statement, /void leave\.exit\(leaving, \(\) => router\.refresh\(\)\);/, "a decided statement line plays out before the refresh");
  assert.match(statement, /<tr key=\{line\.id\} \{\.\.\.leave\.rowProps\(line\.id\)\}/);
  const bulk = read("components/app/book/needs-you/bulk-resolve.tsx");
  assert.match(bulk, /if \(exitRows && saved\.size\) void exitRows\(\[\.\.\.saved\], refresh\);/, "a bulk answer hands its refresh to the rows' exit");
  assert.doesNotMatch(bulk, /const unsaved = [^\n]*\n\s*router\.refresh\(\);/, "the bulk refresh no longer lands before the rows leave");
  const decide = read("components/app/book/needs-you/item-decide.tsx");
  assert.match(decide, /inline\.onDone\(how, \(\) => router\.refresh\(\)\);/, "an answer in place refreshes only after its row has left");
  assert.doesNotMatch(decide, /inline\.onDone\(how\);\s*router\.refresh\(\);/);
  const review = read("components/app/book/needs-you/review-workspace.tsx");
  assert.match(review, /void exitRow\(key, \(\) => \{ setGone\(\(now\) => new Set\(now\)\.add\(key\)\); refresh\?\.\(\); \}\);/, "an answered item leaves the queue, then the refresh runs");
  assert.match(review, /exitRows=\{exitNoSale\}/, "ticked items answered together leave together");
  assert.match(review, /<li key=\{key\} \{\.\.\.leave\.rowProps\(key\)\}/);
  const list = read("components/app/book/needs-you/needs-you-list.tsx");
  assert.match(list, /exitRows=\{\(ids, then\) => leave\.exit\(/, "Confirm all on a fold sends its rows out first");
  assert.match(list, /<tr key=\{key\} \{\.\.\.leave\.rowProps\(key\)\}/);

  // Rows finished elsewhere (their page, a sheet, someone else) leave as the refresh lands; new ones arrive tinted.
  assert.match(read("components/app/accounting/todo-board.tsx"), /const left = useDepartures\(items, \(item\) => item\.key, groupLabel\);/);
  assert.match(read("components/app/accounting/todo-board.tsx"), /<tbody key=\{`\$\{show\}\|\$\{order\}`\} className="m-rows-settle">/, "a new pick settles in");
  assert.match(read("components/app/commissions/pay-issues/group-rows.tsx"), /\{\.\.\.left\.rowProps\(row\.id\)\} data-row-new=\{isNew\(row\.id\) \? "" : undefined\}/);
  assert.match(read("components/app/commissions/pay-issues/pay-issues-list.tsx"), /const left = useDepartures\(issues, issueKey, tab\);/);
  const dash = read("components/app/home/dash/dash-needs-live.tsx");
  assert.match(dash, /const isNew = useArrivals\(all\.map\(\(item\) => item\.key\), live === null\);/, "the first live read is the baseline");
  assert.match(dash, /const left = useDepartures\(all, \(item\) => item\.key\);/);
  assert.match(read("components/app/home/dash/dash-kit.tsx"), /<div key=\{item\.key\} className="grid" \{\.\.\.item\.motion\}>/, "the Needs you cell carries its tile's motion");

  // The kit: several rows at once go 30ms apart, capped at the twelfth, and the wait covers the last one.
  const rowExit = read("components/ui/use-row-exit.ts");
  assert.match(rowExit, /const STAGGER_MS = 30;\nconst STAGGER_CAP = 12;/);
  assert.match(rowExit, /motionMs\("--t-exit-row", 200\) \+ delayOf\(count - 1\)/);
  assert.match(rowExit, /const fresh = other \|\| reducedMotion\(\) \? \[\] :/, "departures are a no-op under reduced motion");
  assert.match(read("components/ui/use-arrivals.ts"), /fresh: baseline \? new Set<string>\(\) : new Set\(ids\.filter\(\(id\) => !state\.seen\.has\(id\)\)\)/, "another list is a new baseline");
  // One reduced-motion stop: the screens add none of their own.
  for (const files of Object.values(screens)) for (const file of files) assert.doesNotMatch(read(file), /prefers-reduced-motion/, `${file} has no reduced-motion block of its own`);
});

test("Wave B · the bulk bar and one checkbox (Tier 2, owner sign-off 2026-11-18)", () => {
  // The bar is always in the page: it slides over the table's top edge, so the table never jumps.
  const bulk = read("components/ui/bulk-bar.tsx");
  assert.ok(bulk.includes("export function BulkBar("), "BulkBar is defined");
  const bar = bulk.slice(bulk.indexOf("export function BulkBar(")); // the file's last function
  assert.doesNotMatch(bar, /return null/, "BulkBar never returns null");
  assert.doesNotMatch(bulk, /persistent/, "no opt-in left on the bar");
  assert.match(bar, /<CountUp text=\{shown\.toLocaleString\(\)\} changesOnly duration=\{360\} \/>/, "the count rolls");
  assert.match(bar, /\{selectAll \? <span className="mr-1\.5 inline-flex">\{selectAll\}<\/span> : null\}/, "the bar carries the select-all box it covers");
  for (const file of walk("components").concat(walk("app"))) {
    const text = read(file);
    if (!text.includes("<BulkBar")) continue;
    assert.doesNotMatch(text, /<BulkBar\s+persistent/, `${file} has no opt-in left`);
    assert.doesNotMatch(text, /count > 0 \? \(\s*<BulkBar/, `${file} keeps the bar mounted`);
    if (!file.includes("motion-lab")) assert.match(text, /selectAll=\{<SelectAllCheckbox /, `${file} puts the select-all box in the bar that covers it`);
  }

  // One checkbox: the kit's CheckBox (its tick pops in, m-tick). The header and row boxes of every table use it.
  const box = read("components/ui/check-box.tsx");
  assert.match(box, /m-tick pointer-events-none relative hidden size-3 text-primary-foreground peer-checked:block/, "the tick follows the input, so an uncontrolled box ticks too");
  assert.match(box, /data-check-box=""/, "legacy portal rules skip it");
  assert.match(bulk, /<CheckBox\s+ref=\{ref\}[\s\S]*?mixed=\{coverage === "some"\}/, "select-all shows a dash when some rows are ticked");
  assert.match(bulk, /ref\.current\.indeterminate = coverage === "some"/, "and stays indeterminate for assistive tech");
  for (const file of walk("components/ui")) {
    if (file === "components/ui/check-box.tsx") continue;
    assert.doesNotMatch(read(file), /type="checkbox"/, `${file} uses CheckBox, not a raw checkbox`);
  }
  // A ratchet: raw checkboxes left in the app may only go down. Today's two are not plain checkboxes: the
  // sound toggle switch (portal-toggle) and the carrier × state matrix cells (partner-market-access-panel).
  const RAW_CHECKBOX_BASELINE = 2;
  const raw = [];
  for (const file of walk("components").concat(walk("app"))) {
    if (file === "components/ui/check-box.tsx") continue;
    const count = (read(file).match(/type="checkbox"/g) ?? []).length;
    if (count) raw.push(`${file} (${count})`);
  }
  const total = raw.reduce((sum, entry) => sum + Number(entry.match(/\((\d+)\)$/)[1]), 0);
  assert.ok(total <= RAW_CHECKBOX_BASELINE, `raw checkboxes went up to ${total}: ${raw.join(", ")}. Use <CheckBox> from components/ui/check-box`);
});

test("Wave B · save states and gentle errors (Tier 2, 2026-11-18)", () => {
  // Every "Saving… / Saved" swap is the kit's SaveStatus: Saving…, ✓ Saved with the tick popping, gone after 2s.
  const kit = read("components/ui/save-status.tsx");
  assert.match(kit, /<Check aria-hidden="true" className="m-pop size-3\.5"/, "the tick pops");
  assert.match(css, /\[data-save-status\]\[data-state="fading"\] \{ animation: m-vt-out var\(--t-float-out\) var\(--e\) both; \}/, "Saved fades out, shorter than it came");
  const workspace = read("components/app/applications/workspace/save-status.tsx");
  assert.match(workspace, /<KitSaveStatus state=\{state\} errorLabel=\{saveError \?\? undefined\} className=\{className\} \/>/, "the application steps use the kit");
  assert.doesNotMatch(workspace, /text = "Saved"/, "no hand-made Saved left in the workspace");
  for (const file of ["components/app/settings/patterns.tsx", "components/app/settings/carrier-card.tsx", "components/app/settings/contracting-setup.tsx"]) {
    const source = read(file);
    assert.match(source, /<SaveStatus state=\{/, `${file} shows its save state with SaveStatus`);
    assert.doesNotMatch(source, /"Saving…".*"Saved"|>Saved<\/StatusChip>|&& "Saved"/, `${file} has no hand-made Saving… / Saved swap`);
  }

  // The saved glow, one shared hook: an inline edit's cell, row or field glows once beside its toast.
  const flash = read("components/ui/use-saved-flash.ts");
  assert.match(flash, /motionMs\("--t-saved", 900\)/, "the mark lasts one --t-saved");
  assert.match(flash, /\{ "data-saved": "" \}/);
  const glows = {
    "components/app/accounting/expenses-board.tsx": /<td className="whitespace-nowrap" \{\.\.\.saved\.props\(fact\.key\)\}>/,
    "components/app/calling-window-settings.tsx": /<li key=\{campaign\.id\} \{\.\.\.saved\.props\(campaign\.id\)\}>/,
    "components/app/dispute-letter-actions.tsx": /\{\.\.\.glow\.props\("address"\)\}/,
    "components/app/settings/contracting-setup.tsx": /\{\.\.\.glow\.props\("contract"\)\}/,
    "components/app/settings/carrier-card.tsx": /\{\.\.\.glow\.props\("contract"\)\}/,
  };
  for (const [file, pattern] of Object.entries(glows)) {
    const source = read(file);
    assert.match(source, /import \{ useSavedFlash \} from "@\/components\/ui\/use-saved-flash";/, `${file} uses the shared glow`);
    assert.match(source, pattern, `${file} marks what saved`);
    assert.match(source, /\.flash\(/, `${file} flashes it once the save lands`);
  }

  // Errors arrive gently everywhere: the reveal is the Field's default, with no opt-in left.
  const field = read("components/ui/field.tsx");
  assert.match(field, /<span role="alert" data-field-error="" className="m-error-in /, "every field's error line opens gently");
  assert.doesNotMatch(field, /revealError/, "no opt-in left on the field");

  // A refused submit shakes once, on the error summary or the primary button, never in a loop.
  const deny = read("components/ui/use-deny-shake.ts");
  assert.match(deny, /className: on \? "m-deny-now" : undefined/);
  assert.match(deny, /motionMs\("--t-panel", 200\)/, "the class comes off after one shake");
  assert.match(deny, /form\.querySelector\("\[data-field-error\]"\)/, "a form left showing an error line is refused");
  const overlay = read("components/app/applications/submit/overlay.tsx");
  assert.match(overlay, /onSubmit\(event\); refusal\.denyIfErrors\(form\);/, "every application overlay's submit shakes its actions when refused");
  assert.match(overlay, /cn\("flex flex-wrap items-center gap-2\.5", refusal\.className\)/);
  for (const file of ["components/app/accounting/expenses-board.tsx", "components/app/accounting/invoices-board.tsx", "components/app/applications/quotes/add-quote-form.tsx"]) {
    const source = read(file);
    assert.match(source, /refusal\.deny\(\)/, `${file} shakes a refused save`);
    assert.match(source, /className=\{refusal\.className\}/, `${file}'s primary button carries the shake`);
  }

  // Sign-in: the alert rises in and a refused try shakes it once after; a wrong code shakes the boxes as they clear.
  assert.match(css, /\.m-alert-in \{ animation: m-alert-in var\(--t-panel\) var\(--e-out\) backwards; \}/, "the alert rises in");
  assert.match(css, /\.m-alert-in\[data-refused\] \{ animation: m-alert-in var\(--t-panel\) var\(--e-out\) backwards, m-deny var\(--t-panel\) var\(--e\) var\(--t-panel\) 1 forwards; \}/, "a refusal shakes once, after the rise");
  const alert = read("components/portal/auth-controls.tsx");
  assert.match(alert, /data-refused=\{tone === "error" && shake \? "" : undefined\}/);
  assert.match(alert, /className=\{cn\("m-alert-in grid/);
  const otp = read("components/app/otp-input.tsx");
  assert.match(otp, /if \(value === "" && latest\.current\.length === 6\) deny\(\);/, "a full code the page clears was refused");
  assert.match(otp, /cn\("flex justify-center gap-2", shake\)/);
  // The app, partner and admin doors share these parts.
  assert.match(read("components/app/tenant-auth-workspace.tsx"), /<AuthAlert shake=\{loginError !== notice\}>/, "a notice the page opens with does not shake");
  assert.match(read("components/partner/partner-login-form.tsx"), /<AuthAlert id="partner-login-error">/);
  const admin = read("app/admin/login/page.tsx");
  assert.match(admin, /<AuthAlert id="admin-login-error">/);
  assert.match(admin, /<OtpInput/);
});

test("Wave B · completion moments: stamps, the setup tick and glide, uploads and drop zones (Tier 2, 2026-11-18)", () => {
  // The shared pieces: a stamp plays, then the refresh, and the list plays the row out; uploads report real progress.
  const stamps = read("components/ui/use-done-stamps.ts");
  assert.match(stamps, /motionMs\("--t-stamp", 400\)/, "the refresh waits for the stamp, on the token");
  assert.match(stamps, /if \(reducedMotion\(\)\) then\(\);/, "reduced motion runs at once");
  const xhr = read("components/ui/upload-request.ts");
  assert.match(xhr, /request\.upload\.onprogress = /, "uploads report how far the bytes have gone");
  assert.match(xhr, /reject\(new TypeError\("Failed to fetch"\)\)/, "a network failure reads as fetch's");

  // Get set up: the menu's active pill glides to the next step, and a tick that just turned done pops and draws.
  const menu = read("components/ui/menu-card.tsx");
  assert.match(menu, /useGlidePill\(track, \{ items: "a\[data-menu-item\]", chosen: '\[aria-current="page"\]', watch: "aria-current", remember: `menu:\$\{label\}` \}\)/);
  assert.match(menu, /data-tab-indicator="menu"/);
  assert.match(menu, /className="m-pop inline-flex[^"]*"[^>]*>\s*<StampCheck/, "the new tick pops and its check draws");
  assert.match(css, /\[data-tab-pill\]\[data-tab-indicator="menu"\] \{/);
  assert.match(read("components/app/setup/setup-guide-bar.tsx"), /\{done \? <DoneStamp label="Done" \/> : null\}/, "the guide bar stamps Done once, outside its button branches");
  assert.match(read("components/app/setup/setup-celebration.tsx"), /./, "the celebration stays as it is (no confetti)");

  // Paid, Approved, Matched: the stamp plays where it was done.
  assert.match(read("components/app/commissions/partner-payouts/invoice-parts.tsx"), /if \(payload\.action === "paid"\) setStamped\("Paid"\);/);
  assert.match(read("components/app/accounting/invoices-board.tsx"), /setStamped\(\{ label: payload\.action === "paid" \? "Paid" : "Approved", from: inv\.status \}\)/);
  assert.match(read("components/app/accounting/producers-board.tsx"), /if \(body\.action === "paid"\) \{ setStamped\(run\.id\); afterStamp\(proceed\); \}/);
  assert.match(read("components/app/commissions/team-payouts/team-payouts-board.tsx"), /setStamped\(true\);\s*afterStamp\(onDone\);/);
  assert.match(read("components/app/accounting/expense-record.tsx"), /afterStamp\(\(\) => advance\(okd \+ 1\)\)/, "an OK'd expense stamps Paid, then steps on");
  assert.match(read("components/app/accounting/expenses-board.tsx"), /\{paidHere \? <DoneStamp label="Paid"/);
  const bank = read("components/app/accounting/bank-board.tsx");
  assert.match(bank, /onDone=\{\(label\) => void stamps\.stamp\(current\.id, label, refresh\)\}/, "a confirmed match stamps the row, then refreshes");
  assert.match(bank, /const left = useDepartures\(shown, \(t\) => t\.id, `\$\{filter\}\|\$\{account\}\|\$\{needle\}`\);/, "and the row plays out of To match");
  assert.match(read("components/app/accounting/bank-match.tsx"), /if \(andNext\) after\("Matched"\); else \{ settle\("Matched"\); onClose\(\); \}/);

  // Uploads: a real bar that ends on its check before the dialog closes.
  for (const file of ["components/app/carrier-file-upload.tsx", "components/app/book/setup/files-in-import-dialog.tsx", "components/app/statement-import.tsx", "components/app/accounting/bank-board.tsx", "components/app/accounting/expense-record.tsx", "components/app/accounting/invoices-board.tsx"]) {
    const source = read(file);
    assert.match(source, /sendWithProgress\(/, `${file} uploads with progress`);
    assert.match(source, /<UploadProgress /, `${file} draws the bar`);
  }

  // Every file drop target lifts and glows.
  for (const file of ["components/app/book-import.tsx", "components/app/book/setup/files-in-import-dialog.tsx", "components/app/accounting/bank-check.tsx", "components/app/accounting/expense-record.tsx", "components/app/accounting/invoices-board.tsx", "components/app/accounting/tax-board.tsx", "components/app/applications/submit/attachment-field.tsx", "components/app/lead-import-workspace.tsx", "components/app/settings/sales/disclosures-editor.tsx"]) {
    const source = read(file);
    assert.match(source, /m-dropzone/, `${file} is a drop zone`);
    assert.match(source, /"data-drag-over"|data-drag-over=/, `${file} marks a file held over it`);
  }
});

test("Wave C · dialer and inbound: calm call states, one pulse each, the live transfer card (Tier 3, 2026-11-18)", () => {
  // The CSS: on the tokens, inside the change-moments section (so its no-loop, token and opacity/transform checks
  // cover it), each keyframe defined once.
  const block = css.slice(css.indexOf("/* 5i · Change moments"), css.indexOf("/* 5e · Shell entrance"));
  const calls = block.slice(block.indexOf("/* Calls (Wave C"));
  assert.ok(block.includes("/* Calls (Wave C") && calls.length > 0, "the call moments live in the change-moments section");
  for (const name of ["m-attention", "m-corner-in", "m-corner-out"]) assert.equal([...css.matchAll(new RegExp(`@keyframes ${name}\\b`, "g"))].length, 1, `${name} is defined once`);
  assert.doesNotMatch(calls, /infinite|alternate|iteration-count/, "nothing loops");
  assert.match(calls, /\[data-call-pulse\] \{[^}]*animation: m-attention var\(--t-saved\) var\(--e-out\) both; \}/, "ringing and connected each send one ring, on a token");
  assert.match(calls, /\[data-call-pulse="connected"\] \{/, "connected has its own, softer, green ring");
  // The live transfer card: in from its corner, out quicker than it came, one ring after it lands.
  assert.match(calls, /\[data-live-transfer\] \{ animation: m-corner-in var\(--t-enter\) var\(--e-out\) backwards; \}/, "the card enters over --t-enter");
  assert.match(calls, /\[data-live-transfer\]\[data-state="closed"\] \{ pointer-events: none; animation: m-corner-out var\(--t-float-out\) var\(--e\) both; \}/, "and leaves over --t-float-out");
  const token = (name) => Number(css.match(new RegExp(`^\\s*${name}:\\s+(\\d+)ms;`, "m"))[1]);
  assert.ok(token("--t-float-out") < token("--t-enter"), "the exit is shorter than the entrance");
  assert.match(calls, /\[data-transfer-ping\] \{[^}]*animation: m-attention var\(--t-saved\) var\(--e-out\) var\(--t-enter\) both; \}/, "one attention ring once the card has landed");
  assert.match(calls, /\.m-stamp-leave \{ animation: m-vt-out var\(--t-float-out\) var\(--e\) var\(--t-saved\) both; \}/, "the Dialer's stamp fades after it has played");

  // The live transfer card plays its exit, then unmounts; the endless ping is gone.
  const card = read("components/app/inbound/live-transfer-card.tsx");
  assert.doesNotMatch(card, /animate-ping|infinite/, "the dot rings once, never on a loop");
  assert.match(card, /data-state=\{leaving \? "closed" : "open"\}/);
  assert.match(card, /<span data-transfer-ping="" /);
  assert.match(card, /reducedMotion\(\) \? 0 : motionMs\("--t-float-out", 120\)/, "it unmounts when its exit has played, on the token");

  // Inbound: a new caller rises in (m-alert-in, rise only), once; the five-step call slides by direction with the kit hook.
  const home = read("components/app/inbound/inbound-home.tsx");
  assert.match(home, /<Arrival key=\{next\.id\} enter=\{isNewCaller\(next\.id\) \? "m-alert-in" : "m-content-in"\}>/);
  assert.match(home, /const \[className\] = useState\(enter\);/, "a card's arrival is fixed at mount, never replayed by a later read");
  assert.match(home, /useArrivals\(line\.map\(\(item\) => item\.id\), Boolean\(floor\)\)/, "the first floor read is a baseline");
  assert.doesNotMatch(home, /m-deny/, "no shake for a caller");
  const call = read("components/app/inbound/inbound-call.tsx");
  assert.match(call, /const enter = useStepDirection\(phase, CALL_PHASES\);/);
  assert.match(call, /<div key=\{phase\} data-enter=\{enter\}/);

  // The Dialer: the status line rises in once, its chip cross-fades and its words settle; each new state's panel settles.
  const dialer = read("components/app/dialer-workspace.tsx");
  assert.match(dialer, /<div className="m-swap flex items-center gap-2\.5">/, "the call's status line settles in (m-swap)");
  assert.match(dialer, /<StatusChip tone=\{state === "dialling" \? "info" : state === "live" \? "good" : "neutral"\} dot><span key=\{text\} className="m-content-in">/, "the chip cross-fades its tone; its words settle");
  assert.match(dialer, /<span key=\{state\} data-call-pulse=\{state === "live" \? "connected" : "ringing"\}/, "one ring per state, replayed only by a new state");
  assert.match(dialer, /<div key=\{dialled \? "live" : "ready"\} className="m-content-in flex flex-wrap/, "the call step settles in when the call goes live");
  assert.match(dialer, /<div key=\{dialled \? "live" : "ready"\} className="m-content-in grid flex-1/, "the outcome tiles settle in when they open");
  assert.equal((dialer.match(/className="m-content-in rounded-xl border/g) ?? []).length, 2, "the do-not-call and return confirms settle in");
  // The timer: a steady counter, tabular figures, a fixed width; no motion class on it.
  assert.match(dialer, /<span role="timer" aria-label="Time on the call" className="inline-block min-w-\[7ch\][^"]*tabular-nums">/);
  assert.match(dialer, /const now = useNow\(1000\);/);
  // The outcome stamps Done while the next lead is served: never awaited, never in the way of auto-next.
  assert.match(dialer, /<DoneStamp label=\{stamp\.label\} \/>/, "the outcome uses DoneStamp");
  assert.match(dialer, /motionMs\("--t-highlight", 1200\)/);
  const hook = read("components/app/dialer/use-dialer.ts");
  assert.match(hook, /announceDisposition\(value, body\);\s*\/\/[^\n]*\n\s*setRecorded\(\(current\) => \(\{ label: outcomeLabel\(value\), n: \(current\?\.n \?\? 0\) \+ 1 \}\)\);\s*resetCall\(\);/, "the stamp is set, then the call resets at once");
  assert.match(hook, /else if \(autoNext\) await serveNextNow\(\);/, "auto-next is unchanged");
  assert.doesNotMatch(hook, /afterStamp|setTimeout\(\(\) => void serveNext/, "nothing holds the next lead for the stamp");

  // Callbacks: a person's history settles in in sequence, and an entry new since the last read is tinted once.
  const history = read("components/app/callbacks/person-history.tsx");
  assert.match(history, /<ol className="m-seq m-0 flex list-none flex-col p-0">/);
  assert.match(history, /data-row-new=\{isNew\(item\.id\) \? "" : undefined\}/);
});

test("Wave C · drag and drop that feels physical: lift, gap, slide and land (plan item 12, 2026-11-18)", () => {
  // The FLIP helper: transform only, on the motion tokens, still under reduced motion, only what is on screen.
  const flip = read("components/ui/use-flip.ts");
  assert.match(flip, /const duration = motionMs\("--t-panel", 200\);/, "the glide is timed by --t-panel");
  assert.match(flip, /const easing = motionEase\("--e-out", /, "and eased by --e-out");
  assert.match(flip, /item\.animate\(\[\{ transform: `translate\(\$\{dx\}px, \$\{dy\}px\)` \}, \{ transform: "translate\(0, 0\)" \}\], \{ duration, easing, composite: "add" \}\)/, "it moves by transform only");
  assert.equal([...flip.matchAll(/\.animate\(/g)].length, 1, "one glide, nothing else animated");
  assert.match(flip, /const still = reducedMotion\(\);/);
  assert.match(flip, /if \(still\) continue;/, "under reduced motion places just update");
  assert.match(flip, /if \(!onScreen\(rect\.left, rect\.top\) && !onScreen\(rect\.left \+ dx, rect\.top \+ dy\)\) continue;/, "only cards someone can see glide");
  assert.match(read("components/ui/motion-tokens.ts"), /export function motionEase\(/);

  // The lift: no browser ghost, a copy that tilts unless motion is reduced.
  const lift = read("components/ui/use-drag-lift.ts");
  assert.match(lift, /event\.dataTransfer\.setDragImage\(image, 0, 0\)/, "the browser's drag image is a transparent pixel");
  assert.match(lift, /node\.classList\.add\("m-lift"\);\s*if \(reducedMotion\(\)\) node\.setAttribute\("data-still", ""\);/);
  assert.match(lift, /element\.classList\.add\("m-lifted"\);\s*if \(reducedMotion\(\)\) element\.setAttribute\("data-still", ""\);/);

  // The CSS: one section, transform and opacity only in its keyframes, stilled by the script and the one reduce block.
  const start = css.indexOf("/* 5j · Drag");
  assert.ok(start > css.indexOf("@media (prefers-reduced-motion: reduce) {\n  *,"), "the reduce block covers it");
  const drag = css.slice(start, css.indexOf("/* 5e · Shell entrance", start));
  assert.match(drag, /@keyframes m-lift-in \{ from \{ transform: none; \} \}/);
  assert.match(drag, /\.m-lift \{[^}]*transform: scale\(1\.02\) rotate\(1\.5deg\);[^}]*animation: m-lift-in var\(--t-panel\) var\(--e-out\) backwards;/);
  assert.match(drag, /:is\(\.m-lift, \.m-lifted\)\[data-still\] \{ transform: none; \}/, "reduced motion: no tilt");
  assert.match(drag, /\.m-drop-gap \{[^}]*animation: m-fade var\(--t-micro\) var\(--e-out\) backwards;/);
  assert.doesNotMatch(drag, /prefers-reduced-motion|infinite/, "no second reduce block, nothing loops");
  for (const frames of drag.matchAll(/@keyframes [\w-]+ \{(.*)\}/g)) assert.doesNotMatch(frames[1], /\b(?:width|height|top|left|margin|box-shadow)\s*:/, "keyframes move transform or opacity only");

  // Every board and reorder list glides through the one helper.
  const lists = {
    "components/app/lead-workspace.tsx": /const flip = useFlip\(boardRef\);/,
    "components/partner/partner-lead-pipeline.tsx": /useFlip\(boardRef\);/,
    "components/app/settings/pipelines-outcomes.tsx": /const flip = useFlip\(listRef\);/,
    "components/app/settings/cadence/timeline.tsx": /const flip = useFlip\(gridRef\);/,
    "components/app/assignment-workspace.tsx": /const ruleFlip = useFlip\(rulesRef\);/,
    "components/app/form-templates/form-canvas.tsx": /const flip = useFlip\(pageRef\);/,
    "components/app/settings/sales/templates-builder.tsx": /const flip = useFlip\(listRef\);/,
  };
  for (const [file, uses] of Object.entries(lists)) {
    const source = read(file);
    assert.match(source, uses, `${file} uses the FLIP helper`);
    assert.match(source, /data-flip-key=/, `${file} keys what glides`);
    assert.doesNotMatch(source, /\.animate\(\[|data-flip-id/, `${file} has no FLIP of its own`);
  }

  // No native drag shows the browser's ghost: every drag start lifts through the kit.
  for (const file of [...walk("components"), ...walk("app")]) {
    const source = read(file);
    if (!/onDragStart=/.test(source)) continue;
    assert.match(source, /useDragLift\(\)/, `${file} starts a drag without the lift`);
  }
  const board = read("components/app/lead-workspace.tsx");
  assert.match(board, /onDragStart=\{\(event\) => \{ event\.dataTransfer\.setData\("text\/plain", lead\.id\); lift\.lift\(event\); setDragged\(\{ id: lead\.id, height: event\.currentTarget\.offsetHeight \}\); \}\}/, "a board card lifts as it is picked up");
  assert.match(board, /<div key="__drop-gap" aria-hidden="true" className="m-drop-gap rounded-md" style=\{\{ height: dragged\.height \}\} \/>/, "the target lane opens a gap");
  assert.match(board, /const at = lift\.rect\(\); if \(at\) flip\.place\(lead\.id, at\); onStageChange\(lead, column\.id\);/, "the dropped card glides from where it was let go; the move is unchanged");
  assert.match(board, /<article data-flip-key=\{lead\.id\} draggable/);
  assert.match(board, /<div data-flip-scroll="" className=/, "a lane's own scroll never reads as a move");
  const partner = read("components/partner/partner-lead-pipeline.tsx");
  assert.doesNotMatch(partner, /draggable|onDragStart/, "partners read the board; nothing to drag");
  assert.match(partner, /data-flip-key=\{row\.id\}\s*className="m-drop-in /, "a partner card lands with m-drop-in and glides when its stage changes");
  assert.match(read("components/app/settings/pipelines-outcomes.tsx"), /className="m-lift box-border flex h-\[52px\]/, "the held stage is the kit's lifted card");
  assert.match(read("components/app/settings/cadence/timeline.tsx"), /flip\.place\(`call-\$\{call\.n\}`, letGo\(event\.currentTarget\)\);/, "a cadence dot glides from where it was let go");
  assert.match(read("components/app/assignment-workspace.tsx"), /onKeyDown=\{\(event\) => handleKeys\(event, draft\.key\)\}/, "keyboard reorder still works");
});

test("Wave D · admin, theme and stamps: the console moves as the app does, the theme reveals, approvals stamp (plan items 15–16, 2026-11-18)", () => {
  // Item 15: admin pages arrive in the calm cascade, and its rails mark each move as an area move.
  const adminLayout = read("app/admin/(protected)/layout.tsx");
  assert.match(adminLayout, /import \{ PortalPageTransition \} from "@\/components\/portal\/portal-page-transition";/);
  assert.match(adminLayout, /<PortalPageTransition>\{children\}<\/PortalPageTransition><\/div>\{\/\*[^]*?\*\/\}\{sheet\}/, "the page transitions; the @sheet panel stays outside it");
  const rail = read("components/portal/nav-rail.tsx");
  assert.doesNotMatch(rail, /<Link\b/, "every staff and partner rail link is an IntentLink");
  assert.equal((rail.match(/<IntentLink\b/g) ?? []).length, (rail.match(/transitionTypes=\{RAIL_MOVE\}/g) ?? []).length, "each rail link passes transitionTypes");
  assert.match(rail, /const RAIL_MOVE = \["nav-area"\];/);
  const sidebar = read("components/admin/admin-sidebar.tsx");
  assert.match(sidebar, /<IntentLink\s+href=\{entry\.href\}\s+transitionTypes=\{\["nav-area"\]\}/, "the admin drawer's links pass transitionTypes");
  assert.match(read("app/admin/admin-plane.css"), /transition: background-color var\(--t-micro\) var\(--e\);/, "admin hover eases on the kit's tokens");
  assert.match(css, /\/\* 5k · Admin and theme/);

  // Item 16: the theme switch reveals as a circle, skipped under reduced motion, torn down on transition.finished.
  const reveal = read("components/theme-reveal.ts");
  assert.match(reveal, /doc\.startViewTransition\(apply\)/);
  assert.match(reveal, /if \(!doc\.startViewTransition \|\| reducedMotion\(\) \|\| !changes\) \{/, "reduced motion switches at once");
  assert.match(reveal, /transition\.finished[^]*?root\.classList\.remove\("theme-reveal", "theme-switching"\)/, "the classes come off on transition.finished");
  assert.match(reveal, /motionMs\("--t-reveal", 650\)/);
  assert.match(css, /--t-reveal: 650ms;/);
  const toggle = read("components/theme-toggle.tsx");
  assert.match(toggle, /revealTheme\(event\.currentTarget, \(\) => setTheme\(value\)/, "ThemeToggle uses the shared startViewTransition reveal");
  const publicSwitch = read("components/public/theme-switch.tsx");
  assert.match(publicSwitch, /revealTheme\(event\.currentTarget, \(\) => setTheme\(next\)\)/, "one helper, not a copy");
  assert.doesNotMatch(publicSwitch, /startViewTransition/);

  // Wave B leftover: admin and settings approvals stamp where they were done.
  const markPaid = read("components/admin/mark-paid-dialog.tsx");
  assert.match(markPaid, /\{stamped \? <DoneStamp label="Paid"/, "Mark paid… stamps Paid");
  assert.match(markPaid, /if \(onPaid\) onPaid\(refresh\);\s*else afterStamp\(refresh\);/);
  assert.match(read("components/admin/invoice-detail-view.tsx"), /<MarkPaidDialog invoiceId=\{invoice\.id\}/, "the invoice's Mark paid… is the stamping dialog");
  assert.match(read("components/admin/billing/recon-settle.tsx"), /trigger=\{\{ label: "Mark paid…", variant: "outline", className: "" \}\} onPaid=\{onPaid\} \/>/);
  const recon = read("components/admin/billing/recon-table.tsx");
  assert.match(recon, /onPaid=\{\(refresh\) => void stamps\.stamp\(focused\.key, "Paid", refresh\)\}/);
  assert.match(recon, /<DoneStamp label=\{stamps\.labelOf\(row\.key\)!\} \/>/);
  assert.match(recon, /const left = useDepartures\(shownRows, \(row\) => row\.key, /);
  const credits = read("components/admin/credit-notes-table.tsx");
  assert.match(credits, /if \(stamped\) return <DoneStamp label="Approved" \/>;/, "credit note Approve stamps");
  assert.match(credits, /const left = useDepartures\(rows, \(note\) => note\.id, `\$\{lens\}\|\$\{q\}`\);/);
  const statusMaps = read("components/admin/status-maps-review.tsx");
  assert.match(statusMaps, /\}, "Approved"\)\}>Approve<\/Button>/, "status map Approve stamps");
  assert.match(statusMaps, /if \(stamp\) await stamps\.stamp\(key, stamp, reload\);/);
  assert.match(statusMaps, /<DoneStamp label=\{stamps\.labelOf\(row\.id\)!\} \/>/);
  assert.match(statusMaps, /useDepartures\(mappingRows, \(row\) => row\.id, /);
  const onboarding = read("components/app/agency/producer-onboarding-tab.tsx");
  assert.match(onboarding, /if \(item === "contracting"\) await stamps\.stamp\(item, "Approved", reload\);/, "producer onboarding Approve stamps");
  assert.match(onboarding, /<DoneStamp label=\{stamps\.labelOf\(i\.item\)!\} \/>/);
});

test("Wave D · polish: overlays, toggles, empty states, live dots and the motion on the tokens (plan items 17–19, 2026-11-18)", () => {
  // Item 17 · Overlays and toggles. The hover peek opens like the info tip and the dropdown: a fade and a zoom.
  const peek = read("components/ui/hover-peek.tsx");
  assert.match(peek, /data-\[state=open\]:animate-in data-\[state=open\]:fade-in-0 data-\[state=open\]:zoom-in-95/, "the peek zooms in");
  assert.match(peek, /data-\[state=closed\]:zoom-out-95/, "and out");
  // The ⌘K highlight is one tint gliding from row to row, and a new set of results settles in once.
  const bar = read("components/app/app-top-bar.tsx");
  assert.match(bar, /useGlidePill\(track, \{ items: '\[role="option"\]', chosen: "\[data-active\]", watch: "data-active" \}\)/, "the ⌘K highlight glides");
  assert.match(bar, /data-tab-indicator="hit"/);
  assert.match(bar, /<div key=\{settleKey\} className="m-rows-settle">/, "results settle when they change");
  assert.match(css, /\[data-tab-pill\]\[data-tab-indicator="hit"\] \{/);
  // A toggle chip fades between on and off on the tokens and dips when pressed.
  const chip = read("components/ui/toggle-chip.tsx");
  assert.match(chip, / m-chip-toggle",/);
  assert.doesNotMatch(chip, /transition-colors|duration-\d/, "no Tailwind default timing");
  assert.match(css, /\.m-chip-toggle \{ transition: background-color var\(--t-panel\) var\(--e\), color var\(--t-panel\) var\(--e\), border-color var\(--t-panel\) var\(--e\), transform var\(--t-micro\) var\(--e\); \}/);
  assert.match(css, /\.m-chip-toggle:active:not\(:disabled\) \{ transform: scale\(\.97\); \}/);

  // Item 18 · Empty states rise in; stage strips draw with the connector; the live dot rings once, then rests.
  const states = read("components/ui/page-states.tsx");
  for (const name of ["EmptyState", "NoMatches"]) {
    const body = states.slice(states.indexOf(`export function ${name}(`));
    assert.match(body.slice(0, body.indexOf("\n}\n")), /className="m-in /, `${name} rises in`);
  }
  assert.match(read("components/app/book/files/stage-strip.tsx"), /const fill = "m-track";/, "a file's stages draw with the kit's connector");
  assert.match(read("components/app/settings/carriers/add-carrier-dialog.tsx"), /className="m-track block size-full bg-\[var\(--primary\)\]"/, "a passed step's line draws in");
  assert.match(css, /\.m-track \{ transform-origin: left; animation: m-grow var\(--t-enter\) var\(--e-out\) both;/);
  assert.match(css, /\.m-live-dot \{ animation: m-pulse var\(--t-saved\) var\(--e-out\) 1 backwards; \}/, "the live dot pulses once");
  for (const rule of css.matchAll(/\.m-live-dot[^{]*\{([^}]*)\}/g)) assert.doesNotMatch(rule[1], /infinite/, ".m-live-dot never loops");

  // Item 19 · The off-token literals are gone; each one rounds to a kit token.
  for (const literal of [
    "m-bar-rise .9s", "cubic-bezier(.2, .8, .2, 1)", "cubic-bezier(.2,.8,.2,1)", "cubic-bezier(.22, 1, .36, 1)",
    "m-grow-y 600ms", "m-draw 900ms", "m-grow-x 700ms", "m-reveal-x 900ms", "m-sweep 700ms", "m-ring-draw 900ms",
    "m-grow 700ms", "m-grow 520ms", "m-rise 260ms", "@keyframes m-stage-fill",
  ]) assert.ok(!css.includes(literal), `globals.css still has ${literal}`);
  assert.match(css, /\.m-bar-rise \{ transform-origin: bottom; animation: m-bar-rise var\(--t-saved\) var\(--e-out\) both; \}/);
  assert.match(css, /\.m-stat-card \{ transition: transform var\(--t-panel\) var\(--e-out\), box-shadow var\(--t-panel\) var\(--e\); \}/);
  assert.match(css, /\.m-swap \{ animation: m-rise var\(--t-data\) var\(--e-out\) backwards; \}/);
  const flyout = read("components/app/agent-sidebar.tsx");
  assert.match(flyout, /animate-\[m-flyout-in_var\(--t-float-in\)_var\(--e-out\)_both\]/, "the flyout opens on the overlay tokens");
  assert.match(flyout, /animate-\[m-flyout-out_var\(--t-float-out\)_var\(--e\)_both\]/);
  assert.doesNotMatch(flyout, /m-flyout-(?:in|out)_\./, "no literal flyout timing");
  for (const file of ["components/app/book/files/stage-strip.tsx", "components/app/step-frame/step-rail.tsx", "components/app/reports/reports-rail.tsx", "components/app/lead-sources/leads-in-rail.tsx"]) {
    assert.doesNotMatch(read(file), /cubic-bezier|duration-\d|\d+ms\b/, `${file} times its motion with the tokens only`);
  }

  // Leftovers. Inbound's listening ring goes out once; the auth showcase plays once; the rail's corner dot pops and shrinks.
  const quiet = read("components/app/inbound/quiet-line.tsx");
  assert.doesNotMatch(quiet, /infinite/, "the listening ring never loops");
  assert.match(quiet, /className="m-listen-ring /);
  assert.match(css, /\.m-listen-ring \{ animation: m-ring var\(--t-saved\) var\(--e-out\) 1 both; \}/);
  assert.doesNotMatch(read("components/app/auth-showcase.module.css"), /infinite|alternate/, "the sign-in showcase plays once and rests");
  const dot = read("components/app/step-frame/rail-glide.tsx");
  assert.match(dot, /export function RailCornerDot\(/);
  assert.match(dot, /data-count-badge=""\s*data-state=\{!on \? "leaving" : settled \? undefined : "entering"\}/, "the dot pops in and shrinks away as CountBadge does");
  for (const rail of ["components/app/step-frame/step-rail.tsx", "components/app/reports/reports-rail.tsx", "components/app/lead-sources/leads-in-rail.tsx"]) {
    const source = read(rail);
    assert.match(source, /<RailCornerDot on=\{/, `${rail} draws the collapsed dot through RailCornerDot`);
    assert.doesNotMatch(source, /size-2\.5 rounded-full bg-\[var\(--warning\)\]/, `${rail} has no dot of its own`);
  }
  // A board card hands the browser something to carry, so a drag starts in Firefox.
  assert.match(read("components/app/lead-workspace.tsx"), /event\.dataTransfer\.setData\("text\/plain", lead\.id\);/, "the board card sets dataTransfer");
});

test("Wave D · nothing in globals.css loops but the skeleton sheen and the two spinners (ratchet, 2026-11-18)", () => {
  // The allowed loops (UI-CONSISTENCY §17): a skeleton's sheen while data is on its way, and a spinner that waits on an
  // answer. The pending hairline eases and waits; it does not loop. A new `infinite` needs the rules changed first.
  const allowed = [
    /animation: m-sheen 1\.4s linear infinite, m-skel-show 1ms 180ms both;/,
    /^\.portal-auth-spinner \{.*animation: portal-auth-spin \.75s linear infinite; \}$/,
    /^\.portal-set-password-spinner \{.*animation: portal-auth-spin \.75s linear infinite; \}$/,
  ];
  const lines = css.split("\n").map((line) => line.trim()).filter((line) => /\binfinite\b/.test(line));
  assert.equal(lines.length, allowed.length, `globals.css loops ${lines.length} times, the baseline is ${allowed.length}: ${lines.join(" | ")}`);
  for (const line of lines) assert.ok(allowed.some((rule) => rule.test(line)), `an endless animation that is not allowed: ${line}`);
  assert.doesNotMatch(css, /animation-iteration-count:\s*infinite|\balternate\b/, "no loop by another name");
});
