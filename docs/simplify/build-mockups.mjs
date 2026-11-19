// Builds docs/simplify/mockups.html: the whole-app simplification board (A/B), on the Settings r8 kit.
// The redesign canvas artifact is at its file cap, so this round lives in the repo like roles-r1.
// Usage (PowerShell): node docs/simplify/build-mockups.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const kitDir = join(here, "..", "design", "settings-r8");
const kitCss = readFileSync(join(kitDir, "kit.css"), "utf8");
const kitJs = readFileSync(join(kitDir, "kit.js"), "utf8");

// ── Icons: lucide-style strokes, always drawn beside a label ─────────────────────────────
const P = {
  home: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/>',
  phone: '<path d="M5 3h4l2 5-2.5 1.5a11 11 0 0 0 6 6L16 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 5a2 2 0 0 1 2-2"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7"/><path d="M18 14a6 6 0 0 1 3.5 6"/>',
  file: '<path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4"/><path d="M9 13h6M9 17h6"/>',
  shield: '<path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z"/><path d="m9 12 2 2 4-4"/>',
  dollar: '<path d="M12 2v20"/><path d="M17 6.5c0-1.9-2.2-3-5-3s-5 1.3-5 3.4c0 4.6 10 2.6 10 7.4 0 2.1-2.2 3.4-5 3.4s-5-1.1-5-3"/>',
  building: '<path d="M4 21V4h10v17"/><path d="M14 9h6v12"/><path d="M8 8h2M8 12h2M8 16h2M17 13h1M17 17h1"/><path d="M2 21h20"/>',
  cog: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 21h4"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7"/><path d="M12 17h.01"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  upload: '<path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M4 16v4h16v-4"/>',
  send: '<path d="m4 12 16-8-6 16-2.5-6.5z"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  check: '<path d="m5 12 5 5 9-10"/>',
  chev: '<path d="m9 6 6 6-6 6"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  more: '<circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/>',
  life: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="m5.6 5.6 3.6 3.6M14.8 14.8l3.6 3.6M18.4 5.6l-3.6 3.6M9.2 14.8l-3.6 3.6"/>',
  play: '<path d="M7 4v16l13-8z"/>',
  wallet: '<path d="M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H3z"/><path d="M3 7V5a2 2 0 0 1 2-2h11v4"/><circle cx="16.5" cy="13.5" r="1.2"/>',
  server: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
  card: '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
};
const ic = (n, s = 18) => `<svg class="ico" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n] ?? ""}</svg>`;

// ── Menus by role ─────────────────────────────────────────────────────────────────────────
const M = {
  home: ["Home", "home"], call: ["Call", "phone"], leads: ["Leads", "users"], sales: ["Sales", "file"],
  clients: ["Clients", "shield"], money: ["Money", "dollar"], business: ["Business", "building"],
};
const MENUS = {
  producer: ["home", "call", "leads", "sales", "clients", "money"],
  owner: ["home", "call", "leads", "sales", "clients", "money", "business"],
  solo: ["home", "call", "leads", "sales", "clients", "money", "business"],
  manager: ["home", "call", "leads", "sales", "clients", "money", "business"],
  setter: ["home", "call"],
  assistant: ["home", "call", "leads"],
  bookkeeper: ["home", "clients", "money", "business"],
  retention: ["home", "clients"],
};
const COUNTS = { call: 4, clients: 2, money: 0 };
const WHO = { producer: ["Dana Reyes", "DR", "Producer"], owner: ["Sofia Ramirez", "SR", "Owner"], solo: ["Ray Holt", "RH", "Owner · Solo"], manager: ["Marco Lee", "ML", "Manager"], setter: ["Tess Ruiz", "TR", "Setter"], assistant: ["Ana Kim", "AK", "Assistant"], bookkeeper: ["Bo Grant", "BG", "Bookkeeper"], retention: ["Rita Vos", "RV", "Retention"] };

function sideA(role, active) {
  const items = MENUS[role].map((k) => `<a class="${k === active ? "on" : ""}">${ic(M[k][1])}<span>${M[k][0]}</span>${COUNTS[k] ? `<em>${COUNTS[k]}</em>` : ""}</a>`).join("");
  const [name, ini, label] = WHO[role];
  return `<nav class="side"><div class="ws"><span class="logo"></span><div><b>Ellery &amp; Fields</b><small>${label}</small></div></div>${items}<div class="sp"></div><a>${ic("help")}<span>Guide me</span></a><a class="${active === "settings" ? "on" : ""}">${ic("cog")}<span>Settings</span></a><div class="me-row"><span class="av">${ini}</span><span>${name}</span></div></nav>`;
}
function sideB(role, active) {
  const work = ["home", "call", "leads", "sales", "clients"].filter((k) => MENUS[role].includes(k));
  const office = ["money", "business"].filter((k) => MENUS[role].includes(k));
  const row = (k) => `<a class="${k === active ? "on" : ""}">${ic(M[k][1])}<span>${M[k][0]}</span>${COUNTS[k] ? `<em>${COUNTS[k]}</em>` : ""}</a>`;
  const [name, ini, label] = WHO[role];
  return `<nav class="side"><div class="ws"><span class="logo"></span><div><b>Ellery &amp; Fields</b><small>${label}</small></div></div><h6>My work</h6>${work.map(row).join("")}${office.length ? `<h6>Run the office</h6>${office.map(row).join("")}` : ""}<div class="sp"></div><a>${ic("help")}<span>Guide me</span></a><a>${ic("cog")}<span>Settings</span></a><div class="me-row"><span class="av">${ini}</span><span>${name}</span></div></nav>`;
}
const topbar = (newLabel = "New") => `<div class="topb"><span class="cmd">${ic("search", 16)}<span>Search or jump to…</span><kbd>Ctrl K</kbd></span><span class="sp"></span><span class="btn o sm">${ic("plus", 14)}${newLabel}</span><span class="bell">${ic("bell")}<i>3</i></span></div>`;

/** One app screen. o = { role, active, nav:'A'|'B', crumb, title, tabs, acts, body, over, tall, plane } */
function app(o) {
  const nav = o.side ?? (o.nav === "B" ? sideB : sideA)(o.role ?? "producer", o.active);
  const tabs = o.tabs ? `<nav class="tabs">${o.tabs.map((t, i) => `<a class="${i === (o.tab ?? 0) ? "on" : ""}">${t}</a>`).join("")}</nav>` : `<span class="flex1"></span>`;
  const head = o.title ? `<div class="crumb">${o.crumb ?? ""}</div><div class="head"><h3>${o.title}</h3>${tabs}<div class="acts">${o.acts ?? ""}</div></div>` : "";
  return `<div class="app nav2${o.tall ? " tall" : ""}${o.short ? " short" : ""}">${topbar(o.newLabel)}${nav}<div class="main">${head}${o.body}</div>${o.over ?? ""}</div>`;
}
const screen = (name, why, html) => `<figure class="scr"><figcaption><b>${name}</b><span>${why}</span></figcaption>${html}</figure>`;
const section = (h, s) => `<div class="sec"><h2>${h}</h2><span>${s}</span></div>`;
const chip = (t, tone = "") => `<span class="chip ${tone}">${t}</span>`;
const table = (cols, rows, foot = "") => `<div class="card flex1"><div class="scroll"><table><thead><tr>${cols.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr${r.cls ? ` class="${r.cls}"` : ""}>${r.c.map((c, i) => `<td${i === 0 ? ' class="first"' : ""}>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>${foot ? `<div class="card-f">${foot}</div>` : ""}</div>`;
const toolbar = (search, chips = [], right = "") => `<div class="tb"><span class="input ph sm">${ic("search", 14)}${search}</span>${chips.map((c, i) => `<span class="tog${i === 0 ? " on" : ""}">${c}</span>`).join("")}<span class="sp"></span>${right}</div>`;
const pager = '<span class="small muted">1–8 of 214</span><span class="sp"></span><span class="btn o sm">Previous</span><span class="btn o sm">Next</span>';

// ── Do next ───────────────────────────────────────────────────────────────────────────────
const job = (icon, title, sub, btn, tone = "p") => `<div class="job"><span class="ic">${ic(icon)}</span><div><b>${title}</b><small>${sub}</small></div><span class="btn ${tone}">${btn}</span></div>`;
const doNext = (jobs, foot = "") => `<div class="card"><div class="card-h"><b>Do next</b><span class="r small muted">${jobs.length} things, most urgent first</span></div><div class="jobs">${jobs.join("")}</div>${foot}</div>`;
const strip = (cells) => `<div class="card"><div class="strip">${cells.map(([l, v, n]) => `<div><small>${l}</small><b>${v}</b><span class="small muted">${n ?? ""}</span></div>`).join("")}</div></div>`;
const spark = (pts, cmp) => `<svg viewBox="0 0 300 80" class="spark" preserveAspectRatio="none"><polyline fill="none" stroke="var(--primary)" stroke-width="2.5" points="${pts}"/>${cmp ? `<polyline fill="none" stroke="var(--hl-mark)" stroke-width="2" stroke-dasharray="4 4" points="${cmp}"/>` : ""}</svg>`;
const chartCard = (t, sub) => `<div class="card flex1"><div class="card-h"><b>${t}</b><span class="r small muted">${sub}</span></div><div class="card-b">${spark("0,60 40,52 80,55 120,40 160,44 200,30 240,26 300,14", "0,66 40,62 80,60 120,56 160,52 200,50 240,46 300,42")}<div class="legend"><span><i class="g"></i>This month</span><span><i class="y"></i>Last month</span></div></div></div>`;

const homeProducerA = (nav = "A") => app({ role: "producer", active: "home", nav, tall: true, crumb: "Home", title: "Good morning, Dana", tabs: ["Today", "My results"], acts: `<span class="btn hl">${ic("play", 14)}Start calling</span>`, body: `<div class="col">${doNext([
  job("phone", "Call back Jane Ortiz", "Callback due 10:30 · Term life · asked for a quote", "Call now"),
  job("file", "Finish Mark Bell's application", "Stopped at Payment · 6 of 10 done", "Continue"),
  job("shield", "Carrier wants a signature from Lin Wu", "Case 4471 · Mutual of Omaha · 2 days left", "Open case"),
  job("life", "Save Tom Hale's policy", "Payment missed · grace ends Friday", "Start save"),
  job("users", "12 new leads were given to you", "From Facebook · Final expense", "See leads", "o"),
])}<div class="row2">${strip([["Calls today", "38", "Goal 60"], ["Sales this week", "4", "↑ 1 on last week"], ["Premium this month", "$9,420", "Goal $12,000"]])}</div><div class="row2">${chartCard("Sales this month", "vs last month")}<div class="card flex1"><div class="card-h"><b>Today</b><span class="r small muted">3 appointments</span></div><div class="list">${["10:30 Jane Ortiz · callback", "13:00 Paul Grey · appointment", "16:15 Ivy Chen · callback"].map((t) => `<div class="li"><span>${t}</span><span class="end btn g sm">Open</span></div>`).join("")}</div></div></div></div>` });

const homeProducerB = () => app({ tall: true, role: "producer", active: "home", nav: "B", crumb: "Home", title: "Good morning, Dana", tabs: ["Today", "My results"], acts: `<span class="btn hl">${ic("play", 14)}Start calling</span>`, body: `<div class="body"><div class="card flex1"><div class="card-h"><b>Your day</b><span class="r small muted">Thursday · 6 things</span></div><div class="tl">${[
  ["Now", "Finish Mark Bell's application", "Stopped at Payment", "Continue", "on"],
  ["10:30", "Call back Jane Ortiz", "Asked for a quote", "Call", ""],
  ["13:00", "Appointment with Paul Grey", "Booked by Tess", "Open", ""],
  ["Any time", "Carrier wants a signature from Lin Wu", "2 days left", "Open case", ""],
  ["Any time", "Save Tom Hale's policy", "Grace ends Friday", "Start save", ""],
  ["16:15", "Call back Ivy Chen", "Wants to compare carriers", "Call", ""],
].map(([t, a, b, c, on]) => `<div class="tl-r ${on}"><span class="t">${t}</span><i></i><div><b>${a}</b><small>${b}</small></div><span class="btn ${on ? "p" : "o"} sm">${c}</span></div>`).join("")}</div></div><div class="col w320">${strip([["Calls", "38", "Goal 60"]])}${strip([["Sales this week", "4", "↑ 1"]])}${chartCard("Premium", "this month")}</div></div>` });

const miniHome = (role, title, jobs, figs) => app({ role, active: "home", short: true, crumb: "Home", title, tabs: ["Today", "Results"], body: `<div class="col">${doNext(jobs)}${strip(figs)}</div>` });

// ── Command bar ──────────────────────────────────────────────────────────────────────────
const cmdA = `<div class="scrim"></div><div class="palette"><div class="pal-in">${ic("search")}<b>jane</b><kbd>Esc</kbd></div><div class="pal-g"><h6>People and records</h6><div class="pal-i h">${ic("users")}<span><b>Jane Ortiz</b> · Lead · Term life · Callback 10:30</span><kbd>Enter</kbd></div><div class="pal-i">${ic("shield")}<span><b>Jane Ortiz</b> · Policy 88120 · In force</span></div><div class="pal-i">${ic("file")}<span><b>Jane Park</b> · Application · Submitted</span></div></div><div class="pal-g"><h6>Do</h6><div class="pal-i">${ic("phone")}<span>Call Jane Ortiz</span><kbd>C</kbd></div><div class="pal-i">${ic("cal")}<span>Book a callback for Jane Ortiz</span></div><div class="pal-i">${ic("file")}<span>Start a sale for Jane Ortiz</span></div></div><div class="pal-g"><h6>Go to</h6><div class="pal-i">${ic("chev")}<span>Call › Callbacks</span></div></div><div class="pal-f"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>Tab</kbd> actions</span><span><kbd>?</kbd> all shortcuts</span></div></div>`;
const cmdEmpty = `<div class="scrim"></div><div class="palette"><div class="pal-in">${ic("search")}<span class="muted">Type a name, a phone number, a policy number or a page</span><kbd>Esc</kbd></div><div class="pal-g"><h6>Recent</h6><div class="pal-i h">${ic("users")}<span><b>Mark Bell</b> · Application · Payment step</span></div><div class="pal-i">${ic("users")}<span><b>Lin Wu</b> · Case 4471</span></div></div><div class="pal-g"><h6>Quick actions</h6><div class="pal-i">${ic("play")}<span>Start calling</span><kbd>G C</kbd></div><div class="pal-i">${ic("plus")}<span>Add a lead</span><kbd>N L</kbd></div><div class="pal-i">${ic("file")}<span>Start a sale</span><kbd>N S</kbd></div><div class="pal-i">${ic("upload")}<span>Upload a carrier file</span></div></div><div class="pal-f"><span><kbd>?</kbd> all shortcuts</span></div></div>`;
const shortcuts = `<div class="scrim"></div><div class="dialog wide"><h4>Keyboard shortcuts</h4><div class="kgrid">${[["Ctrl K", "Search or jump anywhere"], ["G H", "Go home"], ["G C", "Go to Call"], ["N L", "Add a lead"], ["N S", "Start a sale"], ["?", "This list"], ["Space", "Dialer: call / hang up"], ["1–6", "Dialer: pick a call result"], ["S", "Dialer: skip this lead"], ["B", "Dialer: book a callback"], ["M", "Dialer: mute"], ["Esc", "Close"]].map(([k, v]) => `<div><kbd>${k}</kbd><span>${v}</span></div>`).join("")}</div><div class="row end"><span class="btn o">Close</span></div></div>`;

// ── Call ─────────────────────────────────────────────────────────────────────────────────
const dialerBody = (over = "") => `<div class="body"><div class="card flex1"><div class="card-h"><b>On the line · 02:14</b><span class="r">${chip("Connected", "ok")}</span></div><div class="card-b"><div class="who"><div><h4>Jane Ortiz</h4><small>(512) 555-0142 · Austin, TX · 64 · Non-smoker</small></div><div class="row"><span class="btn o">Mute <kbd>M</kbd></span><span class="btn danger">Hang up <kbd>Space</kbd></span></div></div><div class="disc"><b>Read this out</b><p>This call may be recorded for quality. You are speaking with Dana Reyes, a licensed agent…</p></div><div class="fgrid"><div><label class="l">Coverage asked for</label><div class="input">$25,000 final expense</div></div><div><label class="l">Best time</label><div class="input">After 5 pm</div></div><div class="full"><label class="l">Notes</label><div class="input textarea">Husband passed last year, wants to cover funeral costs. Has Medicare.</div></div></div></div></div><div class="card w320"><div class="card-h"><b>Up next</b><span class="r small muted">46 in queue</span></div><div class="list">${["Paul Grey · Facebook", "Ivy Chen · Callback 16:15", "Ron Diaz · Recycled", "Mia Fox · New"].map((t) => `<div class="li"><span>${t}</span></div>`).join("")}</div><div class="card-f"><span class="btn o sm">Skip <kbd>S</kbd></span><span class="btn o sm">Callback <kbd>B</kbd></span></div></div></div>${over}`;
const callResultA = `<div class="scrim"></div><div class="dialog wide"><div class="wz-top"><b>Call result</b><span class="small muted">Jane Ortiz · step 1 of 2</span><span class="x">${ic("x")}</span></div><div class="prog"><i style="width:50%"></i></div><h4>How did the call go?</h4><div class="bigs">${[["Sold", "1"], ["Wants a quote", "2"], ["Call back later", "3"], ["Not interested", "4"], ["No answer", "5"], ["Wrong number", "6"]].map(([t, k], i) => `<div class="big${i === 1 ? " on" : ""}"><kbd>${k}</kbd><b>${t}</b></div>`).join("")}</div><div class="more">${ic("chev", 14)}More results (8) · Do not call · Already insured · Deceased…</div><div class="row end"><span class="btn g">Back</span><span class="btn p">Next</span></div></div>`;
const callResultA2 = `<div class="scrim"></div><div class="dialog wide"><div class="wz-top"><b>Call result</b><span class="small muted">Jane Ortiz · step 2 of 2</span><span class="x">${ic("x")}</span></div><div class="prog"><i style="width:100%"></i></div><h4>When should you call Jane back?</h4><div class="bigs three">${["In 1 hour", "Tomorrow 10:00", "Pick a time"].map((t, i) => `<div class="big${i === 1 ? " on" : ""}"><b>${t}</b></div>`).join("")}</div><label class="l">Note for the callback</label><div class="input">Send quote for $25k final expense first</div><div class="more open">${ic("chev", 14)}More options<div class="fgrid mt"><div><label class="l">Give to</label><div class="input">Me</div></div><div><label class="l">Move to stage</label><div class="input">Quoted (automatic)</div></div></div></div><div class="row end"><span class="btn g">Back</span><span class="btn p">Save and call next</span></div></div>`;
const callResultB = `<div class="body"><div class="card flex1"><div class="card-h"><b>Jane Ortiz · call ended 04:51</b></div><div class="card-b"><h4 class="q">How did the call go?</h4><div class="bigs">${["Sold", "Wants a quote", "Call back later", "Not interested", "No answer", "Wrong number"].map((t, i) => `<div class="big${i === 1 ? " on" : ""}"><kbd>${i + 1}</kbd><b>${t}</b></div>`).join("")}</div><div class="more">${ic("chev", 14)}More results</div></div></div><div class="card w320"><div class="card-h"><b>Then</b></div><div class="card-b"><label class="l">Callback</label><div class="input">Tomorrow 10:00</div><label class="l mt">Note</label><div class="input textarea">Send quote first</div></div><div class="card-f"><span class="sp"></span><span class="btn p">Save and call next</span></div></div></div>`;

// ── Leads ────────────────────────────────────────────────────────────────────────────────
const leadRows = [["Jane Ortiz", "Final expense", "Facebook", chip("Callback 10:30", "warn"), "Today", "Call ›"], ["Paul Grey", "Term life", "Website", chip("Appointment", "info"), "Today", "Open ›"], ["Ivy Chen", "Whole life", "Referral", chip("Quoted", "act"), "Yesterday", "Call ›"], ["Ron Diaz", "Final expense", "Vendor · LeadCo", chip("New", "n"), "2 days", "Call ›"], ["Mia Fox", "Term life", "Facebook", chip("No answer ×3", "n"), "3 days", "Call ›"], ["Sam Ode", "Medicare", "Website", chip("Not interested", "bad"), "1 week", "Open ›"], ["Lea Park", "Whole life", "Referral", chip("Sold", "ok"), "1 week", "Open ›"]].map((c) => ({ c }));
const leadsList = (role = "producer", tabs = ["My leads", "Board"], tab = 0) => app({ role, active: "leads", crumb: "Leads", title: "Leads", tabs, tab, acts: `<span class="btn p">${ic("plus", 14)}Add a lead</span>`, body: `${toolbar("Search name or phone", ["All 214", "Call today 18", "New 32"], `<span class="btn o sm">Filters</span>`)}${table(["Name", "Product", "Source", "Status", "Last touch", ""], leadRows, pager)}` });
const leadsOwner = () => app({ role: "owner", active: "leads", crumb: "Leads", title: "Leads", tabs: ["All leads", "Board", "Bring in", "Hand out", "Duplicates"], tab: 2, acts: `<span class="btn p">${ic("upload", 14)}Import a list</span>`, body: `${toolbar("Search sources", ["All sources 9", "Needs a look 2"])}${table(["Source", "Kind", "Leads this month", "Cost per sale", "Status", ""], [["LeadCo final expense", "Vendor list", "1,240", "$212", chip("Running", "ok"), "Open ›"], ["Facebook · FE Texas", "Ad form", "386", "$148", chip("Running", "ok"), "Open ›"], ["Website quote form", "Web form", "92", "$61", chip("Running", "ok"), "Open ›"], ["BrightCalls transfers", "Partner", "57", "$305", chip("Over budget", "warn"), "Review ›"], ["Old aged leads", "Vendor list", "0", "—", chip("Paused", "n"), "Open ›"]].map((c) => ({ c })))}` });
const leadRecord = (over = "") => app({ role: "producer", active: "leads", crumb: "Leads › Jane Ortiz", title: "Jane Ortiz", tabs: ["Overview", "Calls 6", "Notes", "Files", "History"], acts: `<span class="btn o">${ic("cal", 14)}Book callback</span><span class="btn o">${ic("file", 14)}Start a sale</span><span class="btn p">${ic("phone", 14)}Call</span>`, body: `<div class="status"><span class="chip warn">Callback 10:30</span><span>Final expense · from Facebook · yours since 3 Nov</span></div><div class="body"><div class="card flex1"><div class="card-h"><b>About Jane</b><span class="r btn g sm">Edit</span></div><div class="card-b kv">${[["Phone", "(512) 555-0142"], ["Email", "jane.ortiz@example.com"], ["Born", "12 Mar 1961 · 64"], ["State", "Texas"], ["Smoker", "No"], ["Wants", "$25,000 final expense"], ["Consent", "Web form · 2 Nov · proof saved"]].map(([k, v]) => `<div><small>${k}</small><span>${v}</span></div>`).join("")}</div></div><div class="card w320"><div class="card-h"><b>Where Jane is</b></div><div class="card-b"><div class="path">${["New", "Contacted", "Quoted", "Applied", "Sold"].map((s, i) => `<span class="${i < 2 ? "done" : i === 2 ? "on" : ""}">${s}</span>`).join("")}</div><p class="small muted">Next: send the quote, then call back at 10:30.</p></div></div></div>${over}` });
const newLeadWz = (step) => {
  const steps = ["Who", "How to reach them", "What they want"];
  const bodies = [
    `<h4>Who is the lead?</h4><div class="fgrid"><div><label class="l">First name</label><div class="input focus">Jane</div></div><div><label class="l">Last name</label><div class="input">Ortiz</div></div><div><label class="l">Date of birth</label><div class="input ph">MM / DD / YYYY</div><div class="help">Optional. Needed later for a quote.</div></div><div><label class="l">State</label><div class="input">Texas</div></div></div>`,
    `<h4>How do you reach Jane?</h4><div class="fgrid"><div><label class="l">Phone</label><div class="input">(512) 555-0142</div></div><div><label class="l">Email</label><div class="input ph">Optional</div></div><div class="full"><label class="l">Did Jane say you may call?</label><div class="bigs three">${["Yes, on a form", "Yes, on the phone", "Not yet"].map((t, i) => `<div class="big${i === 0 ? " on" : ""}"><b>${t}</b></div>`).join("")}</div><div class="help">We check the number against do-not-call lists before you dial.</div></div></div>`,
    `<h4>What does Jane want?</h4><div class="bigs three">${["Final expense", "Term life", "Whole life", "Medicare", "Not sure yet"].map((t, i) => `<div class="big${i === 0 ? " on" : ""}"><b>${t}</b></div>`).join("")}</div><div class="more open">${ic("chev", 14)}More options<div class="fgrid mt"><div><label class="l">Source</label><div class="input">Referral</div></div><div><label class="l">Give to</label><div class="input">Me</div></div><div><label class="l">Pipeline</label><div class="input">Life sales</div></div><div><label class="l">Tags</label><div class="input ph">Add a tag</div></div></div></div>`,
  ];
  return `<div class="scrim"></div><aside class="sheet wide"><div class="sheet-h"><b>Add a lead</b><span class="small muted">Step ${step + 1} of 3 · ${steps[step]}</span><span class="x">${ic("x")}</span></div><div class="prog"><i style="width:${((step + 1) / 3) * 100}%"></i></div><div class="sheet-b">${bodies[step]}</div><div class="sheet-f">${step ? '<span class="btn g">Back</span>' : '<span class="btn g">Cancel</span>'}<span class="sp"></span>${step === 2 ? '<span class="btn o">Save</span><span class="btn p">Save and call</span>' : '<span class="btn p">Next</span>'}</div></aside>`;
};

// ── Sales ────────────────────────────────────────────────────────────────────────────────
const salesList = () => app({ role: "producer", active: "sales", crumb: "Sales", title: "Sales", tabs: ["In progress 3", "Waiting on carrier 5", "Issued", "Quotes"], tab: 1, acts: `<span class="btn p">${ic("plus", 14)}Start a sale</span>`, body: `${toolbar("Search client or case number", ["All 5", "Needs you 2"])}${table(["Client", "Carrier", "Product", "Submitted", "Status", ""], [["Lin Wu", "Mutual of Omaha", "Final expense", "11 Nov", chip("Signature needed", "warn"), "Open ›"], ["Mark Bell", "Americo", "Term 20", "12 Nov", chip("Medical records", "warn"), "Open ›"], ["Ivy Chen", "Transamerica", "Whole life", "13 Nov", chip("In review", "info"), "Open ›"], ["Ron Diaz", "AIG", "Final expense", "14 Nov", chip("In review", "info"), "Open ›"], ["Lea Park", "Aetna", "Final expense", "15 Nov", chip("Approved", "ok"), "Open ›"]].map((c) => ({ c })))}` });
const caseRecord = () => app({ role: "producer", active: "sales", crumb: "Sales › Lin Wu", title: "Lin Wu · Case 4471", tabs: ["What's needed", "Application", "Timeline", "Files"], acts: `<span class="btn o">${ic("phone", 14)}Call Lin</span><span class="btn p">${ic("send", 14)}Send for signature</span>`, body: `<div class="status warn"><span class="dot"></span>Mutual of Omaha needs a signature · 2 days left · then the case closes</div><div class="body"><div class="card flex1"><div class="card-h"><b>What the carrier needs</b></div><div class="list">${[["Client signature on the replacement form", "Due 20 Nov", "Send for signature", "p"], ["Bank details confirmed", "Done 12 Nov", "", ""], ["Phone interview", "Done 13 Nov", "", ""]].map(([a, b, c, t]) => `<div class="li"><span class="check${c ? "" : " on"}"></span><div><b>${a}</b><small>${b}</small></div>${c ? `<span class="end btn ${t} sm">${c}</span>` : ""}</div>`).join("")}</div></div><div class="card w320"><div class="card-h"><b>The policy</b></div><div class="card-b kv one">${[["Product", "Final expense, level"], ["Coverage", "$15,000"], ["Premium", "$58.40 / month"], ["First payment", "3 Dec"], ["Your commission", "$560 expected"]].map(([k, v]) => `<div><small>${k}</small><span>${v}</span></div>`).join("")}</div></div></div>` });
const appWz = (variant) => {
  const stepNames = ["Check the client", "Health questions", "Quote", "Application", "Beneficiaries", "Payment", "Disclosures", "Review", "Submit"];
  const cur = 5;
  const prog = `<div class="steps-line">${stepNames.map((s, i) => `<span class="${i < cur ? "done" : i === cur ? "on" : ""}">${s}</span>`).join("")}</div>`;
  const body = `<h4>How will Mark pay?</h4><div class="bigs three">${["Bank draft", "Card", "Direct Express"].map((t, i) => `<div class="big${i === 0 ? " on" : ""}"><b>${t}</b></div>`).join("")}</div><div class="fgrid mt"><div><label class="l">Routing number</label><div class="input">•••• 0210</div></div><div><label class="l">Account number</label><div class="input">•••• 4471</div></div><div><label class="l">First payment date</label><div class="input">3 Dec · Wednesday</div><div class="help">The 3rd is the day Mark's Social Security lands. Least likely to bounce.</div></div><div><label class="l">Account holder</label><div class="input">Mark Bell</div></div></div><div class="more">${ic("chev", 14)}More options · different payer, split first payment, mode</div>`;
  if (variant === "A") return app({ role: "producer", active: "sales", crumb: "Sales › Mark Bell", title: "Mark Bell · Term 20", tabs: null, acts: `<span class="btn g">Save and close</span>`, body: `<div class="prog big"><i style="width:${((cur + 1) / 9) * 100}%"></i></div><div class="small muted mb">Step 6 of 9 · Payment</div><div class="body"><div class="card flex1"><div class="card-b">${body}</div><div class="card-f"><span class="btn g">Back</span><span class="sp"></span><span class="btn p">Next: Disclosures</span></div></div><div class="card w280"><div class="card-h"><b>Steps</b></div><div class="list vsteps">${stepNames.map((s, i) => `<div class="li ${i === cur ? "on" : ""}"><span class="n ${i < cur ? "d" : ""}">${i < cur ? "✓" : i + 1}</span>${s}</div>`).join("")}</div></div></div>` });
  return app({ role: "producer", active: "sales", crumb: "Sales › Mark Bell", title: "Mark Bell · Term 20", acts: `<span class="btn g">Save and close</span>`, body: `${prog}<div class="body center"><div class="card w640"><div class="card-b">${body}</div><div class="card-f"><span class="btn g">Back</span><span class="sp"></span><span class="btn p">Next: Disclosures</span></div></div></div>` });
};

// ── Clients ──────────────────────────────────────────────────────────────────────────────
const clientsList = () => app({ role: "producer", active: "clients", crumb: "Clients", title: "Clients", tabs: ["Policies", "To save 2", "Changes sent", "Win back"], tab: 0, acts: `<span class="btn o">${ic("upload", 14)}Add existing book</span>`, body: `${toolbar("Search client or policy number", ["All 486", "Paying 451", "At risk 7"])}${table(["Client", "Carrier", "Policy", "Premium", "Status", ""], [["Tom Hale", "Americo", "AM-77120", "$64.10", chip("Payment missed", "bad"), "Save ›"], ["Lea Park", "Aetna", "AE-55018", "$41.00", chip("Paying", "ok"), "Open ›"], ["Jon Lake", "Mutual of Omaha", "MO-30442", "$88.20", chip("Paying", "ok"), "Open ›"], ["Bea Cruz", "Transamerica", "TA-11903", "$122.75", chip("Grace period", "warn"), "Save ›"], ["Dee Moss", "AIG", "AG-90001", "$37.60", chip("Paying", "ok"), "Open ›"], ["Kai Bro", "Americo", "AM-71000", "$51.30", chip("Lapsed", "n"), "Win back ›"]].map((c) => ({ c })), pager)}` });
const policyRecord = () => app({ role: "producer", active: "clients", crumb: "Clients › Tom Hale", title: "Tom Hale · AM-77120", tabs: ["Overview", "Payments", "Commission", "History"], acts: `<span class="btn o">${ic("phone", 14)}Call Tom</span><span class="btn p">${ic("life", 14)}Start save</span>`, body: `<div class="status bad"><span class="dot"></span>Payment missed on 1 Nov · grace ends Friday 21 Nov · $560 commission at risk</div><div class="body"><div class="card flex1"><div class="card-h"><b>Policy</b></div><div class="card-b kv">${[["Carrier", "Americo"], ["Product", "Final expense $15,000"], ["Premium", "$64.10 / month by bank draft"], ["Issued", "4 Jun 2026"], ["Beneficiary", "Rosa Hale (wife)"], ["Writing agent", "Dana Reyes"], ["Came from", "Facebook lead · sold 28 May"]].map(([k, v]) => `<div><small>${k}</small><span>${v}</span></div>`).join("")}</div></div><div class="card w320"><div class="card-h"><b>Last payments</b></div><div class="list">${[["1 Nov", "Returned", "bad"], ["1 Oct", "Paid", "ok"], ["1 Sep", "Paid", "ok"]].map(([d, s, t]) => `<div class="li"><span>${d}</span><span class="end">${chip(s, t)}</span></div>`).join("")}</div></div></div>` });
const saveWz = `<div class="scrim"></div><aside class="sheet wide"><div class="sheet-h"><b>Save Tom Hale's policy</b><span class="small muted">Step 2 of 3 · What happened</span><span class="x">${ic("x")}</span></div><div class="prog"><i style="width:66%"></i></div><div class="sheet-b"><h4>Why did the payment fail?</h4><div class="bigs">${["Not enough money", "Bank changed", "Wants to cancel", "Didn't know", "Couldn't reach Tom", "Other"].map((t, i) => `<div class="big${i === 1 ? " on" : ""}"><b>${t}</b></div>`).join("")}</div><h4 class="mt">What will you do?</h4><div class="bigs three">${["Send new bank details to carrier", "Move the draft date", "Call back"].map((t, i) => `<div class="big${i === 0 ? " on" : ""}"><b>${t}</b></div>`).join("")}</div></div><div class="sheet-f"><span class="btn g">Back</span><span class="sp"></span><span class="btn p">Next</span></div></aside>`;

// ── Money ────────────────────────────────────────────────────────────────────────────────
const myPay = () => app({ role: "producer", active: "money", crumb: "Money", title: "My pay", tabs: ["This month", "Statements", "Paid back"], acts: `<span class="btn o">Download statement</span>`, body: `${strip([["Expected", "$4,820", "12 policies"], ["Paid to you", "$3,960", "on 15 Nov"], ["Still coming", "$860", "3 policies"], ["Paid back", "$0", "no chargebacks"]])}<div class="mt"></div>${table(["Client", "Carrier", "Expected", "Paid", "Status", ""], [["Lea Park", "Aetna", "$410.00", "$410.00", chip("Paid", "ok"), "Open ›"], ["Lin Wu", "Mutual of Omaha", "$560.00", "—", chip("Waiting on carrier", "info"), "Open ›"], ["Ron Diaz", "AIG", "$300.00", "$270.00", chip("$30.00 short", "warn"), "Ask why ›"], ["Jon Lake", "Mutual of Omaha", "$720.00", "$720.00", chip("Paid", "ok"), "Open ›"]].map((c) => ({ c })))}` });
const ownerMoney = () => app({ role: "owner", active: "money", crumb: "Money", title: "Money", tabs: ["To do 6", "Carrier money", "Team pay", "Bills & costs", "Profit", "More ▾"], acts: `<span class="btn o">${ic("upload", 14)}Upload carrier file</span><span class="btn p">${ic("wallet", 14)}Pay the team</span>`, body: `${table(["What", "Where", "Amount", "Waiting since", "Status", ""], [["Americo paid less than expected", "Carrier money", "$1,240.00", "3 days", chip("$1,240.00 short", "warn"), "Review ›"], ["4 statement rows have no producer", "Carrier money", "$880.00", "5 days", chip("Needs a name", "warn"), "Decide ›"], ["November team pay is ready", "Team pay", "$18,450.00", "today", chip("Ready", "act"), "Pay ›"], ["LeadCo bill doesn't match leads", "Bills & costs", "$3,100.00", "1 week", chip("120 leads short", "warn"), "Review ›"], ["Bank deposit not matched", "Carrier money", "$6,020.00", "2 days", chip("Unmatched", "n"), "Match ›"], ["BrightCalls payout due", "Team pay", "$2,050.00", "today", chip("Due", "act"), "Pay ›"]].map((c) => ({ c })))}` });
const moreMenu = `<div class="pop" style="right:300px;top:126px"><div class="menu"><div>Tax summaries</div><div>Commission history</div><div>Lead refunds</div><div>Shared policies</div><hr><div>Money settings</div></div></div>`;
const uploadWz = (step) => {
  const names = ["Carrier", "File", "Check", "Done"];
  const bodies = [
    `<h4>Which carrier sent this file?</h4><div class="bigs">${["Americo", "Mutual of Omaha", "Aetna", "Transamerica", "AIG", "Other…"].map((t, i) => `<div class="big${i === 0 ? " on" : ""}"><b>${t}</b></div>`).join("")}</div>`,
    `<h4>Drop the Americo file</h4><div class="drop">${ic("upload", 28)}<b>americo_comm_2026-11.xlsx</b><small>212 rows · read in 2 seconds</small></div><div class="help">Policy and commission files both work. We recognise the layout.</div>`,
    `<h4>We read 212 rows. 4 need you.</h4>${strip([["Matched", "198", "to policies"], ["New policies", "10", "added to Clients"], ["Need you", "4", "no client found"]])}<div class="list mt">${["Row 41 · R. Diaz · two clients match", "Row 77 · K. Bro · no policy found", "Row 102 · amount differs by $30.00", "Row 188 · agent code unknown"].map((t) => `<div class="li"><span>${t}</span><span class="end btn o sm">Decide</span></div>`).join("")}</div><div class="more">${ic("chev", 14)}More options · column mapping, file date, skip rows</div>`,
    `<div class="empty"><span class="ic">${ic("check")}</span><b>Americo file is in</b><p>198 policies updated, 10 added, 4 left in To do.</p><div class="row center"><span class="btn o">Upload another</span><span class="btn p">Open To do</span></div></div>`,
  ];
  return `<div class="scrim"></div><aside class="sheet wide"><div class="sheet-h"><b>Upload a carrier file</b><span class="small muted">Step ${step + 1} of 4 · ${names[step]}</span><span class="x">${ic("x")}</span></div><div class="prog"><i style="width:${((step + 1) / 4) * 100}%"></i></div><div class="sheet-b">${bodies[step]}</div>${step < 3 ? `<div class="sheet-f">${step ? '<span class="btn g">Back</span>' : '<span class="btn g">Cancel</span>'}<span class="sp"></span><span class="btn p">${step === 2 ? "Finish" : "Next"}</span></div>` : ""}</aside>`;
};
const payWz = `<div class="scrim"></div><aside class="sheet wide"><div class="sheet-h"><b>Pay the team · November</b><span class="small muted">Step 2 of 3 · Check</span><span class="x">${ic("x")}</span></div><div class="prog"><i style="width:66%"></i></div><div class="sheet-b"><h4>Check each person's pay</h4><table><thead><tr><th>Producer</th><th>Earned</th><th>Paid back</th><th>To pay</th></tr></thead><tbody>${[["Dana Reyes", "$4,820.00", "$0.00", "$4,820.00"], ["Marco Lee", "$6,110.00", "$310.00", "$5,800.00"], ["Jo Park", "$3,900.00", "$0.00", "$3,900.00"], ["Ali Shah", "$3,930.00", "$0.00", "$3,930.00"]].map((r) => `<tr>${r.map((c, i) => `<td${i === 0 ? ' class="first"' : ""}>${c}</td>`).join("")}</tr>`).join("")}</tbody></table><div class="tot"><span>Total</span><b>$18,450.00</b></div><div class="more">${ic("chev", 14)}More options · hold someone's pay, add a bonus, change the pay date</div></div><div class="sheet-f"><span class="btn g">Back</span><span class="sp"></span><span class="btn p">Approve $18,450.00</span></div></aside>`;

// ── Business, Settings ───────────────────────────────────────────────────────────────────
const business = () => app({ role: "owner", active: "business", crumb: "Business", title: "Business", tabs: ["Team", "Partners", "Reports", "Compliance 1"], tab: 0, acts: `<span class="btn p">${ic("plus", 14)}Invite someone</span>`, body: `${toolbar("Search people", ["Everyone 14", "Producers 9", "Setters 3"])}${table(["Name", "Role", "Sales this month", "Licensed in", "Status", ""], [[`<span class="av">DR</span> Dana Reyes`, "Producer", "4", "TX, OK", chip("Active", "ok"), "Open ›"], [`<span class="av">ML</span> Marco Lee`, "Manager", "7", "TX, LA, AR", chip("Active", "ok"), "Open ›"], [`<span class="av">TR</span> Tess Ruiz`, "Setter", "—", "—", chip("Active", "ok"), "Open ›"], [`<span class="av">JP</span> Jo Park`, "Producer", "2", "TX", chip("Licence ends in 9 days", "warn"), "Renew ›"], [`<span class="av">NV</span> Nia Volk`, "Producer", "—", "—", chip("Invite sent", "n"), "Resend ›"]].map((c) => ({ c })))}` });
const reports = () => app({ role: "owner", active: "business", crumb: "Business › Reports", title: "Business", tabs: ["Team", "Partners", "Reports", "Compliance 1"], tab: 2, body: `<div class="rgrid">${[["Sales", "Calls, quotes, sales and why carriers say no"], ["Cost per sale", "What a sale really costs, by source"], ["Book health", "Policies still paying, chargebacks"], ["Team", "Who is profitable, not just busy"], ["Partners", "Which partners send leads that buy"], ["Saves", "Policies saved and lost, per person"], ["Call order", "Whether the dialer's order beats plain order"], ["Team structure", "Who reports to whom, overrides"]].map(([t, s]) => `<div class="card rc"><div class="card-h"><b>${t}</b><span class="r small muted">Open ›</span></div><div class="card-b">${spark("0,60 50,50 100,52 150,40 200,34 250,30 300,22")}<small class="muted">${s}</small></div></div>`).join("")}</div>` });
const settings = () => app({ role: "owner", active: "settings", crumb: "Settings", title: "Settings", body: `<div class="toolbar1"><span class="input ph">${ic("search", 14)}Search settings, e.g. "callback", "pipeline", "logo"</span></div><div class="sgrid">${[["Your profile", "Name, photo, password, notifications", "users"], ["Your business", "Name, logo, licences, plan and billing", "building"], ["Calling", "Caller ID, hours, scripts, do-not-call", "phone"], ["Leads", "Sources, forms, who gets which lead", "users"], ["Selling", "Products, carriers, quotes, applications", "file"], ["Clients", "Stages, saves, carrier files", "shield"], ["Money", "Pay plans, splits, bank, tax", "dollar"], ["Team", "People, roles, teams", "building"], ["Connections", "Google, Whop, API, webhooks", "link"]].map(([t, s, i]) => `<div class="card sc"><span class="ic">${ic(i)}</span><div><b>${t}</b><small>${s}</small></div>${ic("chev")}</div>`).join("")}</div><div class="setup"><b>Getting set up</b><span class="small muted">6 of 9 done</span><div class="prog"><i style="width:66%"></i></div><span class="btn o sm">Continue</span></div>` });
const inviteWz = `<div class="scrim"></div><aside class="sheet"><div class="sheet-h"><b>Invite someone</b><span class="small muted">Step 2 of 2</span><span class="x">${ic("x")}</span></div><div class="prog"><i style="width:100%"></i></div><div class="sheet-b"><h4>What will Nia do?</h4><div class="list">${[["Sell", "Calls leads, quotes, writes policies"], ["Book calls", "Calls leads and books appointments for sellers"], ["Help", "Answers inbound calls, keeps callbacks"], ["Keep the books", "Commissions and bills, no client calls"], ["Save policies", "Works the policies at risk"]].map(([a, b], i) => `<div class="li ${i === 0 ? "on" : ""}"><span class="radio${i === 0 ? " on" : ""}"></span><div><b>${a}</b><small>${b}</small></div></div>`).join("")}</div><div class="more">${ic("chev", 14)}More options · team, manager, pay plan</div></div><div class="sheet-f"><span class="btn g">Back</span><span class="sp"></span><span class="btn p">Send invite</span></div></aside>`;

// ── Overlays shared ──────────────────────────────────────────────────────────────────────
const guideMe = `<aside class="sheet"><div class="sheet-h"><b>${ic("help")} Guide me</b><span class="small muted">Leads</span><span class="x">${ic("x")}</span></div><div class="sheet-b"><p class="small muted">What do you want to do?</p><div class="list">${["Add one lead by hand", "Import a list of leads", "Give leads to my team", "Find a lead", "Change the lead stages"].map((t) => `<div class="li"><span>${t}</span><span class="end">${ic("chev", 16)}</span></div>`).join("")}</div><div class="card mt"><div class="card-b"><b>Add one lead by hand</b><ol class="small"><li>Press <b>Add a lead</b> at the top right.</li><li>Answer three short questions.</li><li>Press <b>Save and call</b> to ring them now.</li></ol><span class="btn p sm">Show me</span></div></div></div></aside>`;
const leaveDlg = `<div class="scrim"></div><div class="dialog"><h4>Leave the application?</h4><p>Mark Bell's answers up to Payment are saved. You can finish later from Home.</p><div class="row end"><span class="btn o">Keep going</span><span class="btn p">Leave, keep answers</span></div></div>`;
const toastOver = `<div class="toastwrap"><span class="toast"><i></i>Saved: callback tomorrow 10:00 · Calling Paul Grey…<b class="u">Undo</b></span></div>`;
const rowMenu = `<div class="pop" style="right:40px;top:208px"><div class="menu"><div class="h">Call</div><div>Book a callback</div><div>Start a sale</div><div>Give to…</div><hr><div>Mark do not call</div></div></div>`;
const snooze = `<div class="pop" style="right:150px;top:170px"><div class="menu"><div class="h">Later today</div><div>Tomorrow morning</div><div>Next week</div><hr><div>It's done</div><div>Not mine</div></div></div>`;

// ── Empty states ─────────────────────────────────────────────────────────────────────────
const empty = (icon, t, p, btn, alt = "") => `<div class="card"><div class="empty"><span class="ic">${ic(icon)}</span><b>${t}</b><p>${p}</p><div class="row center">${alt ? `<span class="btn o">${alt}</span>` : ""}<span class="btn p">${btn}</span></div></div></div>`;

// ── Phone ────────────────────────────────────────────────────────────────────────────────
const phone = (inner) => `<div class="phone"><div class="ph-top"><span class="logo"></span><span class="sp"></span>${ic("search")}${ic("bell")}</div>${inner}<div class="ph-tabs">${[["home", "Home", 1], ["phone", "Call"], ["users", "Leads"], ["file", "Sales"], ["more", "More"]].map(([i, l, on]) => `<span class="${on ? "on" : ""}">${ic(i)}<small>${l}</small></span>`).join("")}</div></div>`;
const phoneHome = phone(`<div class="ph-b"><h3>Good morning, Dana</h3><span class="btn hl full">${ic("play", 14)}Start calling</span><div class="card mt"><div class="card-h"><b>Do next</b></div><div class="jobs">${job("phone", "Call back Jane Ortiz", "10:30 · wants a quote", "Call")}${job("file", "Finish Mark Bell", "Payment step", "Go")}${job("life", "Save Tom Hale", "Grace ends Fri", "Go")}</div></div></div>`);
const phoneSheet = phone(`<div class="ph-b dim"><h3>Good morning, Dana</h3></div><div class="ph-sheet"><i class="grab"></i><b>Call result · Jane Ortiz</b><div class="bigs two">${["Sold", "Wants a quote", "Call back", "Not interested", "No answer", "Wrong number"].map((t, i) => `<div class="big${i === 1 ? " on" : ""}"><b>${t}</b></div>`).join("")}</div><span class="btn p full">Next</span></div>`);

// ── Admin console ────────────────────────────────────────────────────────────────────────
const adminSide = (active) => `<nav class="side adm"><div class="ws"><span class="logo"></span><div><b>Insurvas admin</b><small>Super admin</small></div></div>${[["home", "Home", "home"], ["building", "Customers", "customers"], ["dollar", "Billing", "billing"], ["list", "Catalog", "catalog"], ["server", "System", "system"]].map(([i, l, k]) => `<a class="${k === active ? "on" : ""}">${ic(i)}<span>${l}</span>${k === "system" ? "<em>3</em>" : ""}</a>`).join("")}<div class="sp"></div><a>${ic("cog")}<span>Admin settings</span></a><div class="me-row"><span class="av">QA</span><span>Quinn Admin</span></div></nav>`;
const adminHome = () => app({ side: adminSide("home"), crumb: "Home", title: "Admin home", tabs: ["Today", "Revenue"], body: `<div class="col">${doNext([job("server", "3 scheduled jobs are failing", "Callback reminders, retention ladder, statement import", "Open System"), job("card", "2 payments failed overnight", "Ellery & Fields · Gulf Life Group", "Open Billing"), job("building", "5 trials end this week", "None has finished setup", "See trials", "o"), job("chat", "1 refund asked for", "Ray Holt · $99.00 · 'double charged'", "Review")])}${strip([["Paying customers", "41", "↑ 3 this month"], ["Monthly revenue", "$18,240", "↑ 6%"], ["Trials", "12", "5 end this week"], ["Failing jobs", "3", ""]])}</div>` });
const adminCustomers = () => app({ side: adminSide("customers"), crumb: "Customers", title: "Customers", tabs: ["All 53", "Trials 12", "Past due 2", "Cancelled"], acts: `<span class="btn o">Export</span>`, body: `${toolbar("Search name, email or ID", ["All", "Agency", "Individual"])}${table(["Customer", "Plan", "Seats", "Monthly", "Status", ""], [["Ellery & Fields", "Agency 1-50", "14", "$1,190.00", chip("Past due", "bad"), "Open ›"], ["Ray Holt", "Individual Basic", "1", "$99.00", chip("Refund asked", "warn"), "Open ›"], ["Gulf Life Group", "Agency 51+", "62", "$4,860.00", chip("Past due", "bad"), "Open ›"], ["Nora Insurance", "Individual Advanced", "1", "$199.00", chip("Paying", "ok"), "Open ›"], ["Lone Star Final", "Agency 1-50", "8", "$680.00", chip("Trial · 4 days", "info"), "Open ›"]].map((c) => ({ c })), pager)}` });
const adminRecord = () => app({ side: adminSide("customers"), crumb: "Customers › Ray Holt", title: "Ray Holt", tabs: ["Overview", "Billing", "People", "Usage", "Activity"], tab: 1, acts: `<span class="btn o">Sign in as Ray</span><span class="btn p">Refund or credit</span>`, body: `<div class="status warn"><span class="dot"></span>Ray asked for a refund on 17 Nov: "double charged"</div>${table(["Invoice", "Date", "Amount", "Paid with", "Status", ""], [["INV-2210", "1 Nov", "$99.00", "Visa 4242", chip("Paid", "ok"), "Open ›"], ["INV-2211", "1 Nov", "$99.00", "Visa 4242", chip("Paid twice", "warn"), "Refund ›"], ["INV-2104", "1 Oct", "$99.00", "Visa 4242", chip("Paid", "ok"), "Open ›"]].map((c) => ({ c })))}`, over: `<div class="scrim"></div><aside class="sheet"><div class="sheet-h"><b>Refund or credit · Ray Holt</b><span class="small muted">Step 2 of 3</span><span class="x">${ic("x")}</span></div><div class="prog"><i style="width:66%"></i></div><div class="sheet-b"><h4>How much, and how?</h4><div class="bigs three">${["Refund to card", "Credit next bill", "Both"].map((t, i) => `<div class="big${i === 0 ? " on" : ""}"><b>${t}</b></div>`).join("")}</div><div class="fgrid mt"><div><label class="l">Amount</label><div class="input">$99.00</div></div><div><label class="l">Reason</label><div class="input">Charged twice</div></div></div><div class="help">Ray gets an email with the credit note.</div></div><div class="sheet-f"><span class="btn g">Back</span><span class="sp"></span><span class="btn p">Next: confirm</span></div></aside>` });

// ── Partner portal ───────────────────────────────────────────────────────────────────────
const partnerSide = (active, type = "Marketing partner") => `<nav class="side prt"><div class="ws"><span class="logo"></span><div><b>BrightCalls</b><small>${type}</small></div></div>${[["home", "Home", "home"], ["users", "My leads", "leads"], ["link", "Links", "links"], ["chat", "Chat", "chat"], ["dollar", "Money", "money"], ["building", "Team", "team"]].filter(([, , k]) => !(k === "links" && type === "Marketing partner")).map(([i, l, k]) => `<a class="${k === active ? "on" : ""}">${ic(i)}<span>${l}</span>${k === "chat" ? "<em>2</em>" : ""}</a>`).join("")}<div class="sp"></div><a>${ic("help")}<span>Guide me</span></a><a>${ic("cog")}<span>Settings</span></a><div class="me-row"><span class="av">BC</span><span>Bo Carter</span></div></nav>`;
const partnerHome = () => app({ side: partnerSide("home"), crumb: "Home", title: "Hi Bo", tabs: ["Today", "Results"], acts: `<span class="btn p">${ic("send", 14)}Send a lead</span>`, body: `<div class="col">${doNext([job("users", "2 leads need more details", "Ellery & Fields asked for a date of birth", "Add details"), job("chat", "2 new messages", "From Marco Lee about yesterday's transfers", "Read"), job("dollar", "Payout of $2,050.00 is on its way", "Sent 18 Nov · arrives in 2 days", "See payout", "o")])}${strip([["Leads sent", "57", "this month"], ["Sold", "9", "16%"], ["Earned", "$2,050", "↑ $310"]])}</div>` });
const partnerLeads = () => app({ side: partnerSide("leads"), crumb: "My leads", title: "My leads", tabs: ["All 57", "Need details 2", "Sold 9"], acts: `<span class="btn p">${ic("send", 14)}Send a lead</span>`, body: `${toolbar("Search name or phone")}${table(["Name", "Sent", "Product", "Status", "You earn", ""], [["Ann Lowe", "18 Nov", "Final expense", chip("Needs date of birth", "warn"), "—", "Add ›"], ["Bob Price", "17 Nov", "Final expense", chip("Sold", "ok"), "$150.00", "Open ›"], ["Cy Nash", "17 Nov", "Term life", chip("Talking", "info"), "—", "Open ›"], ["Di Ross", "16 Nov", "Final expense", chip("Not sold", "n"), "—", "Open ›"]].map((c) => ({ c })))}` });
const partnerSend = `<div class="scrim"></div><aside class="sheet"><div class="sheet-h"><b>Send a lead to Ellery &amp; Fields</b><span class="small muted">Step 1 of 2</span><span class="x">${ic("x")}</span></div><div class="prog"><i style="width:50%"></i></div><div class="sheet-b"><h4>Who is it?</h4><div class="fgrid"><div><label class="l">First name</label><div class="input">Ann</div></div><div><label class="l">Last name</label><div class="input">Lowe</div></div><div><label class="l">Phone</label><div class="input">(214) 555-0199</div></div><div><label class="l">State</label><div class="input">Texas</div></div><div class="full"><label class="l">Did Ann agree to be called?</label><div class="bigs two">${["Yes, I have proof", "Not yet"].map((t, i) => `<div class="big${i === 0 ? " on" : ""}"><b>${t}</b></div>`).join("")}</div></div></div><div class="more">${ic("chev", 14)}More options · date of birth, product, notes</div></div><div class="sheet-f"><span class="btn g">Cancel</span><span class="sp"></span><span class="btn p">Next</span></div></aside>`;
const partnerLinks = () => app({ side: partnerSide("links", "Affiliate partner"), crumb: "Links", title: "Links", tabs: ["My links", "Results"], acts: `<span class="btn p">${ic("plus", 14)}New link</span>`, body: `${table(["Link", "Goes to", "Clicks", "Leads", "Sold", ""], [["fe-texas-fb", "Final expense quote form", "1,204", "86", "11", "Copy ›"], ["term-blog", "Term life quote form", "312", "14", "2", "Copy ›"]].map((c) => ({ c })))}` });

// ── Map of the page pattern ──────────────────────────────────────────────────────────────
const patternMap = `<div class="pmap">${[["1", "Title line", "Trail, title, (i), the sub-page bar, one primary button on the right."], ["2", "Sub-page bar", "Every sibling page is a tab. ≤ 6 tabs; extra ones in More ▾. No step rail beside it."], ["3", "List", "One-line table, ≤ 6 columns, one chip, a verb › at the end. Filters as chips over the table."], ["4", "Record page", "Same title line: name, status line, tabs (Overview · … · History), the next step as the primary button."], ["5", "Wizard", "Anything with more than 5 fields or 2 decisions: one question per step, progress bar, More options, Back always works, answers kept."], ["6", "Overlays", "Dialog: short edit. Right sheet: a quick create or a short wizard (≤ 4 steps). Full page: long wizard (application). Toast: confirm. Never a side panel for reading."]].map(([n, t, s]) => `<div class="card"><div class="card-b"><span class="ic">${n}</span><b>${t}</b><p class="small">${s}</p></div></div>`).join("")}</div>`;

// ── The board ────────────────────────────────────────────────────────────────────────────
const extraCss = `
.app.nav2{grid-template-columns:216px 1fr;grid-template-rows:52px 1fr}
.app.nav2>.main{grid-column:2;grid-row:2;overflow:hidden}
.app.nav2>.topb{grid-row:1;grid-column:1/-1}
.app.short{height:560px}.app.tall{height:880px}
.topb{grid-column:1/-1;background:var(--nav);display:flex;align-items:center;gap:12px;padding:0 16px 0 232px;color:var(--nav-ink)}
.topb .cmd{flex:0 0 360px;height:34px;border-radius:8px;background:rgba(234,246,242,.1);color:var(--nav-muted);display:flex;align-items:center;gap:8px;padding:0 10px;font-size:14px}
.topb .cmd span{flex:1}
.topb .sp{flex:1}
.topb .bell{position:relative;display:grid;place-items:center;width:34px;height:34px}
.topb .bell i{position:absolute;top:2px;right:0;font-style:normal;font-size:12px;font-weight:700;background:var(--hl);color:var(--on-hl);border-radius:6px;padding:0 4px}
kbd{font:600 12px Inter,system-ui,sans-serif;padding:1px 6px;border-radius:5px;border:1px solid var(--border);background:var(--band);color:var(--muted)}
.topb kbd{background:transparent;border-color:rgba(234,246,242,.25);color:var(--nav-muted)}
.side{grid-row:1/3;grid-column:1;background:var(--nav);color:var(--nav-ink);display:flex;flex-direction:column;gap:2px;padding:10px;z-index:2}
.side .ws{display:flex;gap:10px;align-items:center;padding:6px 6px 14px;border-bottom:1px solid var(--nav-line);margin-bottom:8px}
.side .ws .logo{width:28px;height:28px;border-radius:8px;background:var(--primary);flex:none}
.side .ws b{display:block;font-size:14px}.side .ws small{color:var(--nav-muted)}
.side a{display:flex;align-items:center;gap:12px;height:44px;padding:0 12px;border-radius:10px;font-size:14px;font-weight:500;color:var(--nav-ink);opacity:.9}
.side a.on{background:rgba(7,214,160,.18);color:#fff;font-weight:600;opacity:1;box-shadow:inset 3px 0 0 var(--primary)}
.side a em{margin-left:auto;font-style:normal;font-size:12px;font-weight:700;background:var(--hl);color:var(--on-hl);border-radius:6px;padding:0 6px}
.side h6{font-size:12px;font-weight:600;color:var(--nav-muted);margin:12px 12px 4px}
.side .sp{flex:1}
.side .me-row{display:flex;align-items:center;gap:10px;padding:10px 6px 2px;border-top:1px solid var(--nav-line);font-size:14px}
.ico{flex:none}
.flex1{flex:1}
.col{display:flex;flex-direction:column;gap:12px;min-height:0;overflow:auto;flex:1}
.row2{display:flex;gap:12px}.row2>.card{flex:1}
.w320{width:320px;flex:none}.w280{width:280px;flex:none}.w640{width:640px;max-width:100%}
.body.center{justify-content:center}
.mt{margin-top:12px}.mb{margin-bottom:8px}
.jobs .job{display:flex;align-items:center;gap:14px;padding:10px 16px;border-bottom:1px solid var(--rule);min-height:64px}
.jobs .job:last-child{border-bottom:0}
.col>.card,.col>.row2{flex:none}
.jobs .job:not(:first-child) .btn.p{background:var(--card);border-color:var(--border);color:var(--ink)}
.jobs .job:first-child{background:var(--primary-soft)}
.job b{display:block;font-size:16px;font-weight:600;color:var(--ink)}.job small{color:var(--muted)}
.job>div{flex:1;min-width:0}
.job .btn{height:44px;padding:0 18px}
.legend{display:flex;gap:14px;font-size:12px;color:var(--muted)}.legend i{display:inline-block;width:10px;height:3px;margin-right:6px;vertical-align:middle;background:var(--primary)}.legend i.y{background:var(--hl-mark)}
.spark{width:100%;height:80px;display:block}
.tl{padding:6px 0}.tl-r{display:grid;grid-template-columns:80px 14px 1fr auto;gap:12px;align-items:center;padding:12px 16px;border-bottom:1px solid var(--rule)}
.tl-r .t{font-size:12px;color:var(--muted);font-weight:600}.tl-r i{width:10px;height:10px;border-radius:50%;border:2px solid var(--border-strong)}
.tl-r.on{background:var(--primary-soft)}.tl-r.on i{background:var(--primary);border-color:var(--primary)}
.tl-r b{display:block;font-size:16px}.tl-r small{color:var(--muted)}
.tb{display:flex;gap:8px;align-items:center;margin-bottom:10px}.tb .sp{flex:1}.input.sm{width:260px;height:36px}
td.first{font-weight:500;color:var(--ink)}
tbody td:last-child{color:var(--accent-ink);font-weight:500;text-align:right}
.status{font-size:14px}.status .chip{margin-right:4px}
.kv{display:grid;grid-template-columns:1fr 1fr;gap:12px 20px}.kv.one{grid-template-columns:1fr}.kv small{display:block;color:var(--muted)}.kv span{color:var(--ink)}
.path{display:flex;gap:4px;margin-bottom:10px}.path span{flex:1;text-align:center;font-size:12px;padding:6px 0;border-radius:6px;background:var(--band);color:var(--muted)}.path span.done{background:var(--primary-soft);color:var(--accent-ink)}.path span.on{background:var(--primary);color:var(--on-primary);font-weight:600}
.who{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px}.who h4{font-size:24px;margin:0}
.disc{border-left:3px solid var(--bad);background:var(--bad-s);padding:10px 12px;border-radius:8px;margin-bottom:14px}.disc p{margin:4px 0 0;font-size:14px}
.dialog.wide{width:600px}
.wz-top{display:flex;gap:10px;align-items:center;margin-bottom:10px}.wz-top b{font-size:16px}.wz-top .x{margin-left:auto;color:var(--muted)}
.prog{height:4px;background:var(--band);border-radius:4px;overflow:hidden;margin:0 0 16px}.prog i{display:block;height:100%;background:var(--primary)}
.sheet .prog{margin:0}.prog.big{height:6px;margin-bottom:6px}
.bigs{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:8px 0 12px}.bigs.three{grid-template-columns:repeat(3,1fr)}.bigs.two{grid-template-columns:1fr 1fr}
.big{min-height:64px;border:1px solid var(--border-strong);border-radius:12px;padding:10px 12px;display:flex;align-items:center;gap:10px;background:var(--card)}
.big b{font-size:16px;font-weight:600;color:var(--ink)}
.big.on{border:2px solid var(--primary);background:var(--primary-soft)}
.more{display:block;font-size:14px;color:var(--accent-ink);font-weight:500;padding:8px 0}.more .ico{vertical-align:-3px;margin-right:4px}.more.open>.ico{transform:rotate(90deg)}
.row.end{justify-content:flex-end;margin-top:14px}.row.center{justify-content:center}
h4{font-size:16px;margin:0 0 10px}.q{font-size:24px}
.steps-line{display:flex;gap:4px;margin:4px 0 14px}.steps-line span{flex:1;font-size:12px;color:var(--muted);border-top:3px solid var(--band);padding-top:6px}.steps-line span.done{border-color:var(--primary-soft);color:var(--accent-ink)}.steps-line span.on{border-color:var(--primary);color:var(--ink);font-weight:600}
.vsteps .li{font-size:14px;padding:8px 12px}.vsteps .n{width:22px;height:22px;border-radius:50%;display:grid;place-items:center;font-size:12px;font-weight:700;background:var(--band);color:var(--muted)}.vsteps .n.d{background:var(--primary-soft);color:var(--accent-ink)}.vsteps .li.on .n{background:var(--primary);color:var(--on-primary)}
.drop{border:2px dashed var(--border-strong);border-radius:14px;padding:28px;text-align:center;display:flex;flex-direction:column;align-items:center;gap:6px;background:var(--band)}
.tot{display:flex;justify-content:space-between;padding:10px 14px;font-size:16px}
.pop{position:absolute;z-index:7}
.toastwrap{position:absolute;left:50%;bottom:24px;transform:translateX(-50%);z-index:8}.toast .u{margin-left:8px;color:var(--primary)}
.palette{position:absolute;left:50%;top:90px;transform:translateX(-50%);width:600px;background:var(--card);border:1px solid var(--card-border);border-radius:16px;box-shadow:var(--overlay);z-index:7;overflow:hidden}
.pal-in{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--rule);font-size:16px}.pal-in b{flex:1;color:var(--ink)}.pal-in span{flex:1}
.pal-g{padding:6px}.pal-g h6{font-size:12px;color:var(--muted);margin:6px 10px 4px;font-weight:600}
.pal-i{display:flex;align-items:center;gap:10px;height:44px;padding:0 10px;border-radius:8px;font-size:14px;color:var(--body)}.pal-i span{flex:1}.pal-i.h{background:var(--primary-soft)}
.pal-f{display:flex;gap:16px;padding:10px 16px;border-top:1px solid var(--rule);font-size:12px;color:var(--muted)}
.kgrid{display:grid;grid-template-columns:1fr 1fr;gap:8px 20px;margin:10px 0}.kgrid div{display:flex;gap:10px;align-items:center;font-size:14px}.kgrid kbd{min-width:56px;text-align:center}
.rgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;overflow:auto}
.sgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:12px}
.sc{flex-direction:row;align-items:center;gap:12px;padding:14px 16px;min-height:72px}.sc div{flex:1}.sc b{display:block;font-size:16px}.sc small{color:var(--muted)}
.setup{display:flex;align-items:center;gap:14px;margin-top:14px;padding:12px 16px;border:1px solid var(--card-border);border-radius:16px;background:var(--card)}.setup .prog{flex:1;margin:0}
.toolbar1 .input{max-width:520px}
.pmap{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:20px}.pmap b{display:block;font-size:16px;margin:8px 0 4px}
.scr{margin:0 0 22px}.scr figcaption{display:flex;gap:12px;align-items:baseline;margin-bottom:8px;color:var(--board-ink)}.scr figcaption b{font-size:14px}.scr figcaption span{font-size:12px;opacity:.75}
.grid2{display:grid;grid-template-columns:1fr}
.grid2.half{grid-template-columns:1fr 1fr;gap:16px}
.half .tabs{min-width:120px}
.emp{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:22px}
.phones{display:flex;gap:24px;flex-wrap:wrap;margin-bottom:22px}
.phone{width:375px;height:740px;border-radius:32px;border:10px solid #0d1714;background:var(--canvas);color:var(--ink);overflow:hidden;position:relative;display:flex;flex-direction:column}
.ph-top{height:52px;background:var(--nav);color:var(--nav-ink);display:flex;align-items:center;gap:14px;padding:0 16px}.ph-top .logo{width:24px;height:24px;border-radius:7px;background:var(--primary)}.ph-top .sp{flex:1}
.ph-b{padding:16px;flex:1;overflow:auto}.ph-b h3{font-size:24px;margin:0 0 12px}.ph-b.dim{opacity:.35}
.btn.full{width:100%;justify-content:center;height:48px}
.ph-tabs{display:flex;border-top:1px solid var(--border);background:var(--card)}.ph-tabs span{flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;padding:8px 0;color:var(--muted)}.ph-tabs span.on{color:var(--accent-ink);font-weight:600}
.ph-sheet{position:absolute;left:0;right:0;bottom:0;background:var(--card);border-radius:20px 20px 0 0;box-shadow:var(--overlay);padding:12px 16px 20px;z-index:3}.ph-sheet .grab{display:block;width:40px;height:4px;border-radius:4px;background:var(--border-strong);margin:0 auto 12px}
.phone .job{flex-wrap:wrap}.phone .job .btn{height:40px}
.mtree{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:22px}
.mtree .card-b{font-size:14px}.mtree ul{margin:4px 0 0;padding-left:18px}.mtree li{margin:2px 0}.mtree small{color:var(--muted)}
.crit{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:12px 0}
.crit div{background:var(--board-card);border:1px solid var(--board-line);border-radius:12px;padding:10px 12px;font-size:14px}
.crit b{display:block}
.av{vertical-align:middle;margin-right:6px}
@media (max-width:1100px){.app.nav2{grid-template-columns:1fr}.side{display:none}.topb{padding-left:16px}.grid2,.emp,.mtree,.pmap,.rgrid,.sgrid{grid-template-columns:1fr}.w320,.w280{display:none}}
`;

const tree = (role, label, items) => `<div class="card"><div class="card-h"><b>${label}</b><span class="r small muted">${role}</span></div><div class="card-b"><ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul></div></div>`;
const menuTrees = `<div class="mtree">${[
  tree("6 items", "Producer", ["<b>Home</b> <small>Today · My results</small>", "<b>Call</b> <small>Dialer · Inbound · Callbacks · Calendar · Chat</small>", "<b>Leads</b> <small>My leads · Board</small>", "<b>Sales</b> <small>In progress · Waiting on carrier · Issued · Quotes · Today's sales</small>", "<b>Clients</b> <small>Policies · To save · Changes sent · Win back</small>", "<b>Money</b> <small>My pay · My balance · Lead refunds</small>"]),
  tree("7 + Settings", "Owner / admin", ["<b>Home</b> <small>Today · Agency · Compare</small>", "<b>Call</b> <small>+ Floor · Setters</small>", "<b>Leads</b> <small>All · Board · Bring in · Hand out · Duplicates</small>", "<b>Sales</b> <small>+ Spot checks</small>", "<b>Clients</b> <small>+ Carrier files · To check</small>", "<b>Money</b> <small>To do · Carrier money · Team pay · Bills & costs · Profit · More</small>", "<b>Business</b> <small>Team · Partners · Reports · Compliance</small>"]),
  tree("7, no team", "Solo owner", ["Same as owner, minus Floor, Setters, Hand out, Team pay, Team tab", "Business = Partners · Reports · Compliance", "Comes back the day a setter or agent joins"]),
  tree("7, no money", "Manager", ["Home = Today · Agency (no $)", "Call · Leads · Sales · Clients: own team's", "Money = My pay only", "Business = Team · Reports (no $)"]),
  tree("2 items", "Setter", ["<b>Home</b> <small>Today · My results</small>", "<b>Call</b> <small>Dialer · Calendar · Do-not-call check</small>"]),
  tree("3 items", "Assistant", ["<b>Home</b>", "<b>Call</b> <small>Inbound · Callbacks · Calendar · Do-not-call · Consent</small>", "<b>Leads</b> <small>Leads · Board</small>"]),
  tree("4 items", "Bookkeeper", ["<b>Home</b>", "<b>Clients</b> <small>Policies · Carrier files · To check (no contact details)</small>", "<b>Money</b> <small>everything</small>", "<b>Business</b> <small>Reports · Partners</small>"]),
  tree("2 items", "Retention", ["<b>Home</b> <small>Today · My saves</small>", "<b>Clients</b> <small>To save · Changes sent · Win back · At risk</small>"]),
].join("")}</div><div class="mtree">${[
  tree("5 items", "Admin console", ["<b>Home</b> <small>Today · Revenue</small>", "<b>Customers</b> <small>Customers · People (was Tenants · Users)</small>", "<b>Billing</b> <small>To do · Subscriptions · Invoices · Refunds &amp; credits · Discounts · More</small>", "<b>Catalog</b> <small>Plans · Features · Products · Carriers · Carrier files · More</small>", "<b>System</b> <small>Jobs · Sign-ins · Audit log · Rules · Mail · Admins · More (Monitoring + Platform)</small>"]),
  tree("5–6 items", "Partner admin", ["<b>Home</b> <small>Today · Results</small>", "<b>My leads</b> <small>All · Need details · Sold · Today (was Daily deal flow) · Drafts</small>", "<b>Links</b> <small>affiliates only (new)</small>", "<b>Chat</b>", "<b>Money</b> <small>Invoices · Coming up</small>", "<b>Team</b> <small>People · Performance</small>"]),
  tree("3–4 items", "Partner user", ["Home · My leads · Chat", "Links if affiliate", "Only their own leads (as today)"]),
  tree("", "Footer, every role", ["Guide me", "Settings (each section gated)", "Your name → profile, theme, sign out", "Top bar: Search or jump (Ctrl K) · New · Bell"]),
].join("")}</div>`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Simplify Insurvas</title>
<style>
${kitCss}
${extraCss}
</style>
</head>
<body class="light" data-opt="A">
<div class="board">
  <h1>Simplify the whole app · round 1</h1>
  <p class="lead">Every page of the agency app, the admin console and the partner portal, made obvious for a non-technical salesperson, with nothing lost. A is recommended throughout. B is the alternative at each decision. Screens marked "both" are the same in A and B. Plan and feature-parity table: <b>docs/simplify/SIMPLIFY-WHOLE-APP.md</b>. All names and numbers are demo data.</p>
  <div class="crit">
    <div><b>Self-critique, fixed before showing</b>Do next first drew 7 jobs; cut to 5 so it fits above the fold at 1440×900. The owner's Money tab bar had 8 tabs; 5 + More ▾ now.</div>
    <div><b>Self-critique, fixed</b>Gold was on Start calling and on "Approve pay"; pay is not a feature button, so it is green. Gold stays on Start calling, counts, avatars and rises only.</div>
    <div><b>Self-critique, fixed</b>Every Do next row had a green button: five primaries fought each other. Only the top job is green and tinted; the rest are outline.</div>
    <div><b>Self-critique, fixed</b>The call result first asked for the outcome through a 14-option list. Now six big answers with number keys, the rest behind More results.</div>
    <div><b>Open risk</b>Removing the step rails reverses the owner's 2026-10-30/11-02 "in one page" rails. The rails' steps become the sub-page bar; this is the decision pick 3 asks for.</div>
  </div>
  <div class="bar" role="toolbar">
    <div class="grp"><span>Option</span><button data-opt-btn="A">A · Jobs menu + Do next</button><button data-opt-btn="B">B · Two groups + day timeline</button></div>
    <div class="grp"><span>Theme</span><button data-theme-btn="light">Light</button><button data-theme-btn="dark">Dark</button></div>
    <span class="hint">Keys 1–2 option · L / D theme</span>
  </div>

  ${section("1 · The menu, per role", "A: one flat list of jobs. B: the same jobs under My work / Run the office. Rare pages become sub-page tabs inside their parent.")}
  ${menuTrees}

  ${section("2 · The page pattern", "One pattern on every page of all three planes")}
  ${patternMap}

  <div class="opt A">
    ${section("3A · Homes: Do next", "The next 3–5 jobs as big buttons, figures and charts under them")}
    ${screen("Producer home", "One gold button (Start calling). Do next is sorted by urgency; each row's button does the job.", homeProducerA())}
    ${screen("Producer home · snooze menu on a job", "Every job can be put off or dismissed, so the list stays honest", app({ role: "producer", active: "home", crumb: "Home", title: "Good morning, Dana", tabs: ["Today", "My results"], body: `<div class="col">${doNext([job("phone", "Call back Jane Ortiz", "Callback due 10:30", "Call now"), job("file", "Finish Mark Bell's application", "Stopped at Payment", "Continue")])}</div>`, over: snooze }))}
  </div>
  <div class="opt B">
    ${section("3B · Homes: Your day", "A timeline of today's jobs in time order, figures in a side column")}
    ${screen("Producer home", "Same jobs, ordered by clock time rather than urgency", homeProducerB())}
  </div>
  <div class="grid2 half">
    ${screen("Owner home (both)", "Agency jobs first; the agency dashboard is the second tab", app({ role: "owner", active: "home", crumb: "Home", title: "Good morning, Sofia", tabs: ["Today", "Agency", "Compare"], body: `<div class="col">${doNext([job("dollar", "Americo paid $1,240.00 less than expected", "Carrier money · 3 days", "Review"), job("wallet", "November team pay is ready", "$18,450.00 for 9 people", "Pay the team"), job("shield", "A complaint is due in 2 days", "Ann Lowe · Texas DOI", "Open"), job("upload", "No Aetna file this month", "Usually arrives by the 15th", "Upload")])}${strip([["Premium this month", "$84,300", "↑ 8%"], ["Sales", "61", "↑ 5"], ["Cost per sale", "$188", ""]])}</div>`, short: true }))}
    ${screen("Setter home (both)", "No money anywhere", miniHome("setter", "Good morning, Tess", [job("play", "Start booking calls", "46 leads ready", "Start calling", "hl"), job("cal", "Dana has 3 open slots this afternoon", "13:00, 14:30, 16:00", "See slots", "o")], [["Booked today", "4", "Goal 8"], ["This week", "17", "↑ 3"]]))}
    ${screen("Assistant home (both)", "Inbound and callbacks only", miniHome("assistant", "Good morning, Ana", [job("phone", "2 callers waiting", "Longest 0:48", "Take next caller"), job("cal", "5 callbacks due today", "First at 10:30", "Open callbacks", "o")], [["Calls taken", "12", ""], ["Handed to agents", "9", ""]]))}
    ${screen("Bookkeeper home (both)", "Money jobs; no client phone numbers", miniHome("bookkeeper", "Good morning, Bo", [job("dollar", "Americo short $1,240.00", "3 days", "Review"), job("upload", "Aetna file missing", "Due by the 15th", "Upload", "o")], [["Received", "$71,200", "of $76,900 expected"], ["To match", "6", ""]]))}
    ${screen("Retention home (both)", "Saves, counted in policies, not dollars", miniHome("retention", "Good morning, Rita", [job("life", "7 policies to save", "2 grace periods end this week", "Start saving"), job("chat", "3 changes sent, carrier hasn't confirmed", "Oldest 9 days", "Check", "o")], [["Saved this month", "14", "of 19 worked"], ["Contact rate", "71%", ""]]))}
    ${screen("Manager home (both)", "Team figures in counts, no money", miniHome("manager", "Good morning, Marco", [job("users", "Jo Park hasn't called today", "Last call yesterday 17:10", "Message"), job("file", "2 of your team's cases need a signature", "Both due Friday", "Open", "o")], [["Team calls", "412", ""], ["Team sales", "19", "↑ 4"]]))}
  </div>

  ${section("4 · Command bar (both)", "Ctrl K from anywhere: people and records first, then actions, then pages")}
  <div class="grid2 half">
    ${screen("Typing a name", "Records, then things to do with them, then pages", app({ role: "producer", active: "home", crumb: "Home", title: "Good morning, Dana", body: "", over: cmdA, short: true }))}
    ${screen("Just opened", "Recent records and quick actions with their shortcut", app({ role: "producer", active: "home", crumb: "Home", title: "Good morning, Dana", body: "", over: cmdEmpty, short: true }))}
  </div>
  ${screen("? · All shortcuts", "Dialer shortcuts live here too", app({ role: "producer", active: "call", crumb: "Call", title: "Dialer", body: "", over: shortcuts, short: true }))}

  ${section("5 · Call", "List page = the dialer itself; the wizard = the call result")}
  ${screen("Dialer, on a call (both)", "Lead in the middle, queue on the right, shortcuts on every button", app({ role: "producer", active: "call", crumb: "Call", title: "Call", tabs: ["Dialer", "Inbound", "Callbacks 4", "Calendar", "Chat"], acts: `<span class="btn o">Pause</span>`, body: dialerBody() }))}
  <div class="opt A">
    <div class="grid2">
      ${screen("A · Call result, step 1", "A dialog over the call; six big answers, keys 1–6", app({ role: "producer", active: "call", crumb: "Call", title: "Call", tabs: ["Dialer", "Inbound", "Callbacks 4", "Calendar", "Chat"], body: dialerBody(callResultA) }))}
      ${screen("A · Call result, step 2", "Only asked when the answer needs it; More options for the rest", app({ role: "producer", active: "call", crumb: "Call", title: "Call", tabs: ["Dialer", "Inbound", "Callbacks 4", "Calendar", "Chat"], body: dialerBody(callResultA2) }))}
    </div>
    ${screen("A · After saving", "A toast confirms and offers Undo; the next lead rings", app({ role: "producer", active: "call", crumb: "Call", title: "Call", tabs: ["Dialer", "Inbound", "Callbacks 4", "Calendar", "Chat"], body: dialerBody(toastOver) }))}
  </div>
  <div class="opt B">
    ${screen("B · Call result in place", "The call card turns into the result; no dialog", app({ role: "producer", active: "call", nav: "B", crumb: "Call", title: "Call", tabs: ["Dialer", "Inbound", "Callbacks 4", "Calendar", "Chat"], body: callResultB }))}
  </div>

  ${section("6 · Leads", "List, record, Add a lead wizard; the owner's tabs")}
  <div class="grid2">
    ${screen("Producer: My leads (both)", "One line a row, one chip, the next step at the end", leadsList())}
    ${screen("Row menu (both)", "Everything you can do to one lead", app({ role: "producer", active: "leads", crumb: "Leads", title: "Leads", tabs: ["My leads", "Board"], acts: `<span class="btn p">${ic("plus", 14)}Add a lead</span>`, body: `${toolbar("Search name or phone", ["All 214", "Call today 18"])}${table(["Name", "Product", "Status", ""], leadRows.slice(0, 5).map((r) => ({ c: [r.c[0], r.c[1], r.c[3], ic("more")] })))}`, over: rowMenu }))}
    ${screen("Owner: Leads › Bring in (both)", "Lead sources, vendors, imports and forms are one tab", leadsOwner())}
    ${screen("Lead page (both)", "Status line, About, where the lead is, the next step as the primary button", leadRecord())}
  </div>
  <div class="grid2">
    ${screen("Add a lead · 1 of 3", "Right sheet: a short wizard keeps the list behind", leadsList("producer").replace(/<\/div>$/, `${newLeadWz(0)}</div>`))}
    ${screen("Add a lead · 2 of 3", "Consent asked in plain words", leadsList("producer").replace(/<\/div>$/, `${newLeadWz(1)}</div>`))}
    ${screen("Add a lead · 3 of 3, More options open", "Source, owner, pipeline and tags never removed, just folded", leadsList("producer").replace(/<\/div>$/, `${newLeadWz(2)}</div>`))}
    ${screen("Guide me on Leads", "Same sheet on every page: what do you want to do, then the steps", leadsList("producer").replace(/<\/div>$/, `${guideMe}</div>`))}
  </div>

  ${section("7 · Sales", "List, case page, the application wizard")}
  <div class="grid2">
    ${screen("Sales › Waiting on carrier (both)", "Pending cases are a tab of Sales, not a page", salesList())}
    ${screen("Case page (both)", "What the carrier needs is the first tab", caseRecord())}
  </div>
  <div class="opt A">${screen("A · Application wizard", "Full page, progress bar, steps listed on the right, More options folded", appWz("A"))}</div>
  <div class="opt B">${screen("B · Application wizard", "Full page, one centred card, steps as a line on top", appWz("B"))}</div>
  ${screen("Leaving mid-application (both)", "Answers are kept; Home lists it as a job", app({ role: "producer", active: "sales", crumb: "Sales › Mark Bell", title: "Mark Bell · Term 20", body: `<div class="prog big"><i style="width:66%"></i></div>`, over: leaveDlg, short: true }))}

  ${section("8 · Clients", "Policies, retention and carrier sync under one item")}
  <div class="grid2">
    ${screen("Clients › Policies (both)", "Retention's pages are tabs here", clientsList())}
    ${screen("Policy page (both)", "The problem in one line, the fix as the primary button", policyRecord())}
  </div>
  ${screen("Save a policy · 2 of 3 (both)", "The save ladder as three questions", clientsList().replace(/<\/div>$/, `${saveWz}</div>`))}

  ${section("9 · Money", "A producer's pay; the owner's To do, the carrier-file and pay wizards")}
  <div class="grid2">
    ${screen("Producer: My pay (both)", "Commissions, balance and chargebacks in one page", myPay())}
    ${screen("Owner: Money › To do (both)", "Every money job in one list; 5 tabs + More", ownerMoney())}
    ${screen("More ▾ open (both)", "Rare money pages stay one click away", ownerMoney().replace(/<\/div>$/, `${moreMenu}</div>`))}
    ${screen("Pay the team · 2 of 3 (both)", "Pick month → check → approve", ownerMoney().replace(/<\/div>$/, `${payWz}</div>`))}
  </div>
  <div class="grid2">
    ${[0, 1, 2, 3].map((s) => screen(`Upload a carrier file · ${s + 1} of 4 (both)`, ["Pick the carrier", "Drop the file", "What we read, what needs you", "Done, with the next step"][s], ownerMoney().replace(/<\/div>$/, `${uploadWz(s)}</div>`))).join("")}
  </div>

  ${section("10 · Business and Settings", "Team, partners, reports and compliance under one item; Settings as plain-language cards")}
  <div class="grid2">
    ${screen("Business › Team (both)", "Producers, setters and invites", business())}
    ${screen("Invite someone · 2 of 2 (both)", "Roles in plain words", business().replace(/<\/div>$/, `${inviteWz}</div>`))}
    ${screen("Business › Reports (both)", "Ten report views as cards, each a sparkline and a sentence", reports())}
    ${screen("Settings (both)", "Search first, nine cards in plain words, setup progress at the foot", settings())}
  </div>

  ${section("11 · Empty states (both)", "Each says what to do and offers the button for it")}
  <div class="emp">
    ${empty("users", "No leads yet", "Add one by hand, or import a list from a vendor or a spreadsheet.", "Add a lead", "Import a list")}
    ${empty("cal", "No callbacks today", "When you pick \"Call back later\" after a call, it shows up here.", "Start calling")}
    ${empty("file", "No sales in progress", "Start a sale from a lead's page, or here.", "Start a sale")}
    ${empty("upload", "No carrier files yet", "Upload this month's commission file and we'll match it to your policies.", "Upload a carrier file", "How files arrive")}
    ${empty("dollar", "No pay yet", "Your pay shows here once a policy you wrote is paid by the carrier.", "See my sales")}
    ${empty("send", "You haven't sent a lead yet", "Send your first lead to Ellery & Fields. It takes a minute.", "Send a lead")}
  </div>

  ${section("12 · Phone (both)", "Bottom tabs = the first four menu items + More; sheets come from the bottom")}
  <div class="phones">${phoneHome}${phoneSheet}</div>

  ${section("13 · Admin console", "Five items; the same Do next home and pattern")}
  <div class="grid2">
    ${screen("Admin home", "Failing jobs, failed payments, trials, refund asks", adminHome())}
    ${screen("Customers", "Every customer in one list; status chip says what's wrong", adminCustomers())}
  </div>
  ${screen("Customer page + Refund or credit wizard", "Billing tab; refund as a three-step sheet", adminRecord())}

  ${section("14 · Partner portal", "Menu by partner type; Send a lead is the one primary button")}
  <div class="grid2">
    ${screen("Marketing partner home", "No Links item for a marketing partner", partnerHome())}
    ${screen("My leads", "Only their own leads, their own statuses", partnerLeads())}
    ${screen("Send a lead · 1 of 2", "The short form; extras behind More options", partnerLeads().replace(/<\/div>$/, `${partnerSend}</div>`))}
    ${screen("Affiliate partner: Links", "Affiliates see their links (today they can't)", partnerLinks())}
  </div>

  ${section("Pick", "Nothing is built until you choose")}
  <div class="pick">
    <div class="rec"><b>1 · Menu: A, the jobs menu (recommended)</b>Six items for a producer, seven + Settings for an owner. B adds two group headings; useful only if owners say seven feels like a wall.</div>
    <div class="rec"><b>2 · Home: A, Do next (recommended)</b>Sorted by urgency, each job one button. B's timeline is better for appointment-heavy setters; could be a setting later.</div>
    <div class="rec"><b>3 · Rails become the sub-page bar (recommended)</b>Every step rail turns into ≤ 6 tabs + More ▾. Keep a rail only in Settings. This reverses the "in one page" rails.</div>
    <div class="rec"><b>4 · Call result: A, dialog wizard (recommended)</b>Keys 1–6, step 2 only when needed. B keeps the agent on the card but hides the queue.</div>
    <div class="rec"><b>5 · Application: A, full page with step list (recommended)</b>Agents jump back to a step during the call; B hides that.</div>
    <div><b>6 · Renames</b>The rename table in the plan, all or by row.</div>
  </div>
</div>
<script>
${kitJs.replace('if (e.key === "3") opt("C");', "")}
</script>
</body>
</html>`;

writeFileSync(join(here, "mockups.html"), html);
console.log("wrote mockups.html", html.length, "bytes");
