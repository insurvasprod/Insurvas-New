/* Screens, part B: Leads (list, board, the lead page and every edit it opens) and Sales (quote, apply, sign, cases). */
(function () {
  "use strict";
  const S = window.SCREENS;
  const ic = window.MK.ic;
  const bottomBar = (k, inner) => '<div style="position:absolute;left:0;right:0;bottom:0;padding:12px 16px 34px;background:var(--bar);backdrop-filter:blur(20px);border-top:.5px solid var(--line);z-index:20;display:flex;gap:10px;flex-direction:column">' + inner + "</div>";

  // ═══ 04 · Leads ═════════════════════════════════════════════════════
  const leadsHead = (k, view) => k.header({
    title: "Leads", actions: k.ios ? ["search", "sliders", "plus"] : ["search", "sliders"],
    belowFull:
      '<div class="pad16" style="display:flex;gap:10px;align-items:center;padding-bottom:10px"><span class="fc" style="flex:none;height:34px;font-weight:600;color:var(--ink)">' + ic("kanban", 16) + "Final expense " + ic("chevD", 16) + '</span><div style="flex:1">' + k.seg(["List", "Board"], view, true) + "</div></div>" +
      k.fchips([{ t: "All", n: "1,248" }, { t: "New", n: 312, on: view === 0 }, { t: "Contacted", n: 401 }, { t: "Interested", n: 96 }, { t: "Callback", n: 58 }, { t: "Sold", n: 41 }]) + '<div style="height:10px"></div>',
  });

  S.push({
    sec: "leads", id: "D1", name: "Leads · list",
    note: "Pipeline picker, List / Board, then the stages as chips with exact counts (the web’s paged board totals). Rows: name, one fact line, one chip. Sold and charged-back stages come from the after-sale pipeline.",
    badges: { calls: 2, inbox: 4 },
    render: (k) => ({
      tab: "leads",
      header: leadsHead(k, 0),
      body:
        '<div class="between pad16 mini" style="padding-top:4px;padding-bottom:4px"><span>312 new · sorted by newest</span><span class="gr" style="font-weight:600">Mine · All</span></div>' +
        k.group("", [
          k.row({ i: "user", it: "plain", t: "Dolores King", m: "71 · FL · Apex Leads · 2 min ago", chip: k.chip("brand", "New") }),
          k.row({ i: "user", it: "plain", t: "Walter Brooks", m: "66 · GA · Summit Media · 18 min ago", chip: k.chip("warn", "Needs review") }),
          k.row({ i: "user", it: "plain", t: "Gloria Fuentes", m: "74 · TX · Web form · 1 h ago", chip: k.chip("brand", "New") }),
          k.row({ i: "user", it: "plain", t: "Earl Johnson", m: "69 · OH · List · Nov batch 4 · 3 h", chip: k.chip("brand", "New") }),
          k.row({ i: "user", it: "plain", t: "Shirley Adams", m: "72 · AL · Apex Leads · yesterday", chip: k.chip("info", "Assigned") }),
          k.row({ i: "user", it: "plain", t: "Raymond Price", m: "67 · NC · Facebook ad · yesterday", chip: k.chip("brand", "New") }),
          k.row({ i: "user", it: "plain", t: "Joyce Bennett", m: "70 · PA · Referral · 2 d", chip: k.chip("brand", "New") }),
        ]),
      fab: k.fab("Add lead", "plus"),
    }),
  });

  S.push({
    sec: "leads", id: "D2", name: "Leads · board",
    note: "The partner-pipeline look on a phone: one lane at a time, swipe sideways to the next, stage colour only in the lane head. Long-press a card to move it; the move is an outcome, as on the web.",
    badges: { calls: 2, inbox: 4 },
    render: (k) => ({
      tab: "leads",
      header: k.header({
        title: "Leads", actions: k.ios ? ["search", "sliders", "plus"] : ["search", "sliders"],
        belowFull: '<div class="pad16" style="display:flex;gap:10px;align-items:center;padding-bottom:10px"><span class="fc" style="flex:none;height:34px;font-weight:600;color:var(--ink)">' + ic("kanban", 16) + "Final expense " + ic("chevD", 16) + '</span><div style="flex:1">' + k.seg(["List", "Board"], 1, true) + "</div></div>",
      }),
      body:
        '<div style="display:flex;gap:10px;overflow-x:auto;padding:4px 16px 0;scrollbar-width:none">' +
        [["Interested", 96, [["Linda Okafor", "Wants $15k · callback Thu", "Ava"], ["George Patel", "Quote sent · AMAM $48/mo", "Jordan"], ["Betty Holmes", "Spouse decides · Fri", "Marcus"], ["Carl Weber", "Asked about IUL", "Jordan"]]], ["Callback", 58, [["Maria Alvarez", "Overdue 2 h", "Jordan"], ["Robert Chen", "Today 10:30 CT", "Jordan"]]]].map((l) =>
          '<div class="lane"><div class="lh">' + l[0] + "<span>" + l[1] + '</span></div><div style="height:3px;border-radius:2px;background:var(--green);opacity:.6;margin:-2px 4px 2px"></div>' +
          l[2].map((c) => '<div class="lcard"><div class="n">' + c[0] + '</div><div class="m">' + c[1] + '</div><div class="f"><span class="mini">2 d in stage</span><span class="av sm">' + c[2].slice(0, 2).toUpperCase() + "</span></div></div>").join("") +
          '<div class="cent mini" style="padding:6px">Show 92 more</div></div>').join("") +
        "</div>" +
        '<div class="row2" style="justify-content:center;gap:6px;margin-top:12px">' + [1, 0, 0, 0, 0, 0].map((d) => '<i style="width:' + (d ? 18 : 6) + 'px;height:6px;border-radius:3px;background:' + (d ? "var(--green)" : "var(--line2)") + ';display:block"></i>').join("") + "</div>",
      fab: k.fab("", "plus"),
    }),
  });

  const leadTop = (k, tab) =>
    '<div class="pad16" style="padding-bottom:12px"><div class="between"><div><div class="disp ink" style="font-size:28px;font-weight:700">Linda Okafor</div><div class="muted" style="font-size:14px">68 yrs · Savannah, GA · Final expense</div></div>' + k.chip("ok", "Clear to call") + "</div></div>" +
    k.path(["New", "Contacted", "Interested", "Quoted", "Applied", "Sold"], 2) +
    '<div style="height:12px"></div>' + k.utabs(["Details", "Activity", "Conversation", "Nurture", "Verification", "Application"], tab);

  S.push({
    sec: "leads", id: "D3", name: "Lead page",
    note: "Web B+C in one column: title, screening chip, the stage path (tap a stage to move with the matching outcome), the six tabs, then the person, what happens next, and where the lead came from. Call is the one primary action.",
    badges: { calls: 2, inbox: 4 },
    render: (k) => ({
      tab: "leads",
      header: k.header({ back: k.ios ? "Leads" : " ", title: "", large: false, actions: ["moreH"], belowFull: leadTop(k, 0) }),
      body:
        '<div class="pad16 gap" style="margin-top:14px">' +
        '<div class="card p">' + k.kv([["Phone", '(912) 555-0163 <span class="gr" style="font-weight:600;margin-left:6px">Copy</span>'], ["Born", "11 Jun 1958 · 68"], ["Address", "22 Abercorn St, Savannah"], ["Language", "English"], ["Owner", '<span class="row2" style="justify-content:flex-end;gap:6px"><span class="av sm">AK</span>Ava Kim</span>']]) + "</div>" +
        '<div class="card p"><h4>What happens next</h4><div style="display:flex;flex-direction:column;gap:9px;margin-top:10px;font-size:15px">' +
        [["Consent on file", 1], ["Coverage amount picked · $15,000", 1], ["Beneficiary named", 0], ["Bank for the draft", 0]].map((r) => '<div class="row2"><span style="color:' + (r[1] ? "var(--ok)" : "var(--faint)") + '">' + ic(r[1] ? "checkC" : "clock", 18) + '</span><span class="' + (r[1] ? "ink" : "muted") + '">' + r[0] + "</span></div>").join("") +
        '</div><div style="margin-top:12px">' + k.btn("Start application", "tonal", "filePen") + "</div></div>" +
        '<div class="card p"><h4>Where she came from</h4><div style="margin-top:8px">' + k.kv([["Vendor", "Apex Leads"], ["Campaign", "FE-Georgia-Nov"], ["Source", "Facebook form"], ["Cost", "$28.00 · 19 Nov"]]) + '</div></div>' +
        "</div>",
      after: '<div style="position:absolute;left:0;right:0;bottom:84px;padding:10px 16px;background:var(--bar);backdrop-filter:blur(20px);border-top:.5px solid var(--line);z-index:19;display:flex;gap:10px">' + k.btn("Schedule", "outline", "calCheck") + k.btn("Call Linda", "primary", "phone") + "</div>",
    }),
  });

  S.push({
    sec: "leads", id: "D4", name: "Lead · activity",
    note: "Calls, outcomes, moves, notes and messages in one stream, newest first. The note box stays at the bottom; visibility (team / only me) is set before posting.",
    badges: { calls: 2, inbox: 4 },
    render: (k) => ({
      tab: null,
      header: k.header({ back: k.ios ? "Leads" : " ", title: "", large: false, actions: ["moreH"], belowFull: leadTop(k, 1) }),
      body:
        '<div class="pad16" style="margin-top:16px"><div class="timeline">' +
        [["Moved to Interested", "Ava Kim · outcome Interested · today 9:12", 0], ["Call · 8:04", "Ava Kim · disclosure read at 0:07 · today 9:04", 0], ["Note", "“Prefers mornings. Daughter Grace helps with bills.” · Ava · team", 0], ["Callback kept", "Mon 23 Nov · 10:00 am her time", 1], ["Call · no answer", "Setter Lena · Sun 22 Nov", 1], ["Lead arrived", "Apex Leads · Facebook form · Sat 21 Nov", 1]].map((e) => '<div class="ev ' + (e[2] ? "mut" : "") + '"><div class="e1">' + e[0] + '</div><div class="e2">' + e[1] + "</div></div>").join("") +
        "</div></div>",
      after: '<div class="composer">' + ic("clip", 24) + '<div class="in">Add a note for the team…</div><span class="send">' + ic("send", 18) + "</span></div>",
    }),
  });

  S.push({
    sec: "leads", id: "D5", name: "Lead · more actions",
    note: "The web ⋯ menu as an iOS action sheet / Android bottom sheet. Server-permitted actions only (data.actions); the owner-only stage change is labelled for what it is.",
    render: (k) => ({
      tab: null,
      header: k.header({ back: k.ios ? "Leads" : " ", title: "", large: false, actions: ["moreH"], belowFull: leadTop(k, 0) }),
      body: "",
      overlay: k.actions("Linda Okafor", [["Hand off to a licensed agent", "userPlus"], ["Nudge the team", "bell"], ["Put back in the queue", "undo"], ["Re-check: existing customer?", "refresh"], ["Change stage without an outcome", "kanban"], ["Copy lead ID", "copy"], ["Unassign", "x", "d"]]),
    }),
  });

  S.push({
    sec: "leads", id: "D6", name: "Move to a stage",
    note: "Tapping a stage on the path asks once: the move is recorded as the outcome named like the stage. Confirmed with a toast that names from → to, with Undo.",
    render: (k) => ({
      tab: null,
      header: k.header({ back: k.ios ? "Leads" : " ", title: "", large: false, actions: ["moreH"], belowFull: leadTop(k, 0) }),
      body: "",
      overlay: k.sheet("Move Linda to Quoted?",
        '<div style="display:flex;flex-direction:column;gap:14px">' +
        '<div class="card p" style="background:var(--surf2);border:0"><div class="row2" style="font-size:15px"><span class="chip brand">Interested</span>' + ic("chevR", 16) + '<span class="chip info"><i></i>Quoted</span></div><div class="mini" style="margin-top:8px">Recorded as the outcome “Quoted”, by you, now. Her callback on Thu stays.</div></div>' +
        k.field("Quote", "American Amicable · $15,000 · $52.18/mo", { trail: "chevD" }) +
        k.field("Note (optional)", "Sent by text, she’ll read it with Grace", {}) +
        k.btn("Move to Quoted", "primary") + "</div>", { h: 470 }),
    }),
  });

  S.push({
    sec: "leads", id: "D7", name: "Add a lead",
    note: "The web’s New lead route sheet as a full sheet. Fields come from the pipeline’s template; a half-typed lead is kept as a draft (on the phone and on the server). Duplicate check runs on phone + date of birth before saving.",
    render: (k) => ({
      tab: null,
      header: k.header({ title: "Leads" }),
      body: "",
      overlay: k.sheet("New lead",
        '<div style="display:flex;flex-direction:column;gap:16px;padding-top:4px">' +
        '<div class="row2 mini">' + ic("check", 14) + "Draft saved · 9:41</div>" +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' + k.field("First name", "Earl") + k.field("Last name", "Johnson") + "</div>" +
        k.field("Phone", "(614) 555-0127", { lead: "phone" }) +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' + k.field("Date of birth", "02/14/1957") + k.field("State", "Ohio", { trail: "chevD" }) + "</div>" +
        k.field("Product", "Final expense", { trail: "chevD" }) +
        k.field("Source", "Referral", { trail: "chevD" }) +
        k.field("Consent", "He agreed on the phone · recorded", { trail: "checkC" }) +
        '<div class="row2" style="color:var(--warn);font-size:14px;align-items:flex-start">' + ic("alert", 18) + '<span>Earl Johnson, (614) 555-0127, is already a lead in Contacted (Sam Lee).</span></div>' +
        '<div class="btnrow">' + k.btn("Open existing", "outline") + k.btn("Save lead", "primary") + "</div></div>",
        { full: true, right: '<span class="gr" style="font-weight:600">Save</span>' }),
    }),
  });

  S.push({
    sec: "leads", id: "D8", name: "Filter leads",
    note: "Filters open in a sheet and show as removable chips under the stages, like the web’s active filters. Show N leads gives the exact count before closing.",
    render: (k) => ({
      tab: "leads",
      header: leadsHead(k, 0),
      body: "",
      overlay: k.sheet("Filters",
        '<div style="display:flex;flex-direction:column;gap:6px">' +
        '<div class="mini" style="margin-top:4px">Owner</div><div class="fchips" style="padding:0;flex-wrap:wrap">' + [{ t: "Me", on: true }, "Unassigned", "Ava Kim", "Sam Lee", "+ 14"].map((c) => typeof c === "string" ? '<span class="fc">' + c + "</span>" : '<span class="fc on">' + c.t + "</span>").join("") + "</div>" +
        '<div class="mini" style="margin-top:12px">Source</div><div class="fchips" style="padding:0;flex-wrap:wrap">' + ["Apex Leads", { t: "Facebook form", on: true }, "Web form", "Lists", "Referral"].map((c) => typeof c === "string" ? '<span class="fc">' + c + "</span>" : '<span class="fc on">' + c.t + "</span>").join("") + "</div>" +
        '<div class="mini" style="margin-top:12px">Time in stage</div><div class="fchips" style="padding:0;flex-wrap:wrap">' + ["Today", "1–3 days", { t: "Over 3 days", on: true }, "Over 2 weeks"].map((c) => typeof c === "string" ? '<span class="fc">' + c + "</span>" : '<span class="fc on">' + c.t + "</span>").join("") + "</div>" +
        '<div style="margin:12px -16px 0">' + k.row({ t: "State", r: "Any", chev: true }) + k.row({ t: "Age", r: "60–80", chev: true }) + k.row({ t: "Callable now only", sw: true }) + "</div>" +
        '<div class="btnrow" style="margin-top:10px">' + k.btn("Clear", "outline") + k.btn("Show 64 leads", "primary") + "</div></div>", { h: 690 }),
    }),
  });

  // ═══ 05 · Sales ═════════════════════════════════════════════════════
  S.push({
    sec: "sales", id: "E1", name: "Quick quote",
    note: "Quotes at the kitchen table. Four answers, then carriers side by side, cheapest first, with the rate class each would give. Start application carries the pick and the answers over.",
    badges: { calls: 2, inbox: 4 },
    render: (k) => ({
      tab: null,
      header: k.header({ back: k.ios ? "Menu" : " ", title: "Quote", large: true, actions: ["history"] }),
      body:
        '<div class="pad16"><div class="card p" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
        k.field("Age", "68") + k.field("State", "Georgia", { trail: "chevD" }) + k.field("Coverage", "$15,000") + k.field("Tobacco", "No", { trail: "chevD" }) +
        '<div style="grid-column:span 2">' + k.seg(["Level", "Graded", "Guaranteed"], 0, true) + "</div></div></div>" +
        k.sh("8 carriers · monthly") +
        k.group("", [
          k.row({ lead: '<span class="mono muted" style="width:20px">1</span>', t: "American Amicable", m: "Senior Choice · Level · draft any day", r: "$52.18", chip: k.chip("ok", "Best") }),
          k.row({ lead: '<span class="mono muted" style="width:20px">2</span>', t: "Mutual of Omaha", m: "Living Promise · Level", r: "$54.90" }),
          k.row({ lead: '<span class="mono muted" style="width:20px">3</span>', t: "Corebridge", m: "SIWL · Level · 2-yr wait on accidents", r: "$57.35" }),
          k.row({ lead: '<span class="mono muted" style="width:20px">4</span>', t: "Royal Neighbors", m: "Ensured Legacy · Level", r: "$58.02" }),
          k.row({ lead: '<span class="mono muted" style="width:20px">5</span>', t: "Transamerica", m: "FE Express · Level", r: "$61.40" }),
        ], "Rates from your carriers’ current tables."),
      after: bottomBar(k, k.btn("Apply with American Amicable", "primary", "filePen")),
    }),
  });

  S.push({
    sec: "sales", id: "E2", name: "Application · a question",
    note: "The web’s ten application steps, one question per screen, big answers. The step list is a sheet (tap “Health 3 of 7”). Each answer saves at once; locked steps stay locked until the earlier one is done.",
    render: (k) => ({
      tab: null,
      header: k.header({ back: k.ios ? "Linda" : " ", title: "Application", large: false, actions: ["listCheck"],
        belowFull: '<div class="pad16" style="padding-bottom:12px"><div class="between mini" style="margin-bottom:8px"><span class="row2" style="gap:6px;color:var(--ink);font-weight:600">Health · 3 of 7 ' + ic("chevD", 14) + '</span><span>Step 5 of 10 · American Amicable</span></div>' + k.stepper(10, 4) + "</div>" }),
      body:
        '<div class="pad16" style="padding-top:20px;display:flex;flex-direction:column;gap:16px">' +
        '<div class="mini">Read it exactly as written</div>' +
        '<div class="disp ink" style="font-size:24px;font-weight:600;line-height:1.3">In the past 2 years, have you been treated for or diagnosed with congestive heart failure, a stroke, or any cancer other than basal cell skin cancer?</div>' +
        '<div style="display:flex;flex-direction:column;gap:10px;margin-top:6px">' +
        '<div class="card" style="padding:18px;display:flex;align-items:center;gap:12px;font-size:18px;font-weight:600;color:var(--ink)"><span style="width:24px;height:24px;border-radius:50%;border:2px solid var(--line2)"></span>Yes</div>' +
        '<div class="card" style="padding:18px;display:flex;align-items:center;gap:12px;font-size:18px;font-weight:600;color:var(--ink);border-color:var(--green);background:var(--green-soft)"><span style="width:24px;height:24px;border-radius:50%;border:2px solid var(--green);display:grid;place-items:center"><i style="width:12px;height:12px;border-radius:50%;background:var(--green);display:block"></i></span>No</div>' +
        "</div>" +
        '<div class="mini row2">' + ic("check", 14) + "Saved · a dropped call resumes here</div>" +
        "</div>",
      after: bottomBar(k, '<div class="btnrow">' + k.btn("Back", "outline") + k.btn("Next question", "primary") + "</div>"),
    }),
  });

  S.push({
    sec: "sales", id: "E3", name: "Pick the draft date",
    note: "The draft-date optimizer inside the application: dates ranked by how likely the first payment is to clear, using the client’s benefit deposit day. One tap, with the reason shown.",
    render: (k) => ({
      tab: null,
      header: k.header({ back: k.ios ? "Back" : " ", title: "Application", large: false,
        belowFull: '<div class="pad16" style="padding-bottom:12px"><div class="between mini" style="margin-bottom:8px"><span class="ink" style="font-weight:600">Payment · 8 of 10</span><span>American Amicable</span></div>' + k.stepper(10, 7) + "</div>" }),
      body:
        '<div class="pad16" style="padding-top:10px">' +
        '<div class="disp ink" style="font-size:24px;font-weight:700">When should the first draft come out?</div>' +
        '<div class="muted" style="margin-top:6px;font-size:15px">Linda gets Social Security on the 3rd Wednesday. Drafts two days after a deposit clear most often.</div></div>' +
        k.group("Best days", [
          k.row({ i: "calCheck", it: "", t: "Fri 18 Dec", m: "2 days after her deposit · usually clears", chip: k.chip("ok", "Best"), cls: "sel" }),
          k.row({ i: "calendar", it: "plain", t: "Mon 21 Dec", m: "5 days after her deposit" }),
          k.row({ i: "calendar", it: "plain", t: "Wed 16 Dec", m: "Deposit day · can bounce if it lands late", chip: k.chip("warn", "Risky") }),
        ]) +
        k.group("Or", [k.row({ i: "calendar", it: "plain", t: "Pick another date", chev: true })]) +
        '<div class="pad16" style="margin-top:14px">' + k.field("Bank", "Truist · checking ·•••• 4471", { trail: "checkC" }) + "</div>",
      after: bottomBar(k, k.btn("Use Fri 18 Dec", "primary")),
    }),
  });

  S.push({
    sec: "sales", id: "E4", name: "Sign and submit",
    note: "In person: the client reads the summary, signs on the glass, and you submit to the carrier. A phone sale skips this for the carrier’s own e-sign link, sent from here.",
    render: (k) => ({
      tab: null,
      header: k.header({ back: k.ios ? "Back" : " ", title: "Application", large: false,
        belowFull: '<div class="pad16" style="padding-bottom:12px"><div class="between mini" style="margin-bottom:8px"><span class="ink" style="font-weight:600">Sign · 10 of 10</span><span>American Amicable</span></div>' + k.stepper(10, 9) + "</div>" }),
      body:
        '<div class="pad16 gap" style="padding-top:6px">' +
        '<div class="card p">' + k.kv([["Insured", "Linda Okafor"], ["Plan", "Senior Choice · Level"], ["Coverage", "$15,000"], ["Monthly", "$52.18"], ["First draft", "Fri 18 Dec"], ["Beneficiary", "Grace Okafor · 100%"]]) + "</div>" +
        '<div class="mini">By signing, Linda confirms the answers were read to her and are true, and agrees to the carrier’s terms and the HIPAA authorization.</div>' +
        '<div class="sigbox"><svg viewBox="0 0 360 150" fill="none"><path d="M40 98c14-30 26-54 34-52 9 2-12 56-2 58 12 2 22-40 34-40 10 0 0 34 10 34 14 0 20-26 34-26 8 0 6 18 16 18 14 0 28-24 46-28 12-3 16 14 30 10 14-4 22-16 40-20" stroke="var(--ink)" stroke-width="2.4" stroke-linecap="round"/></svg><span class="x">×</span><span class="ln"></span></div>' +
        '<div class="between mini"><span>Signed on this phone · 24 Nov 2026, 2:46 pm ET</span><span class="gr" style="font-weight:600">Clear</span></div>' +
        "</div>",
      after: bottomBar(k, k.btn("Submit to American Amicable", "primary", "send") + '<div class="cent gr" style="font-weight:600;font-size:15px;padding:4px">Send the carrier’s e-sign link instead</div>'),
    }),
  });

  S.push({
    sec: "sales", id: "E5", name: "Pending cases",
    note: "Everything between submitted and issued. What needs you first, then what sits at the carrier, then issued this month. A carrier status change is also a push.",
    badges: { calls: 2, inbox: 4 },
    render: (k) => ({
      tab: null,
      header: k.header({ back: k.ios ? "Menu" : " ", title: "Pending cases", large: true, actions: ["search"],
        belowFull: '<div class="pad16" style="padding-bottom:10px">' + (k.ios ? k.seg(["Needs you 3", "At carrier 12", "Issued 9"], 0) : "") + "</div>" + (k.ios ? "" : k.utabs(['Needs you <span class="n">3</span>', 'At carrier <span class="n">12</span>', 'Issued <span class="n">9</span>'], 0)) }),
      body:
        '<div style="height:' + (k.ios ? 0 : 8) + 'px"></div>' +
        k.group("", [
          k.row({ i: "fileCheck", it: "w", t: "George Patel", m: "Corebridge · doctor’s records (APS)", chip: k.chip("warn", "Needs a doc") }),
          k.row({ i: "pencil", it: "w", t: "Betty Holmes", m: "Mutual of Omaha · signature missing", chip: k.chip("warn", "Sign again") }),
          k.row({ i: "phone", it: "w", t: "Carl Weber", m: "Transamerica · phone interview not done", chip: k.chip("warn", "Book interview") }),
        ]) +
        k.sh("Moving at the carrier") +
        k.group("", [
          k.row({ i: "hourglass", it: "i", t: "Linda Okafor", m: "American Amicable · submitted today", chip: k.chip("info", "Received") }),
          k.row({ i: "hourglass", it: "i", t: "Shirley Adams", m: "Royal Neighbors · day 6", chip: k.chip("info", "Underwriting") }),
          k.row({ i: "hourglass", it: "i", t: "Frank Delgado", m: "Corebridge · day 11", chip: k.chip("info", "Approved, not issued") }),
        ]),
    }),
  });

  S.push({
    sec: "sales", id: "E6", name: "Case detail",
    note: "One case: where it is, what the carrier is waiting for, and the fastest fix. The camera adds a document straight to the requirement.",
    render: (k) => ({
      tab: null,
      header: k.header({ back: k.ios ? "Cases" : " ", title: "George Patel", large: false, actions: ["moreH"] }),
      body:
        '<div class="pad16 gap">' +
        '<div><div class="disp ink" style="font-size:26px;font-weight:700">George Patel</div><div class="muted" style="font-size:14px">Corebridge SIWL · $20,000 · $71.40/mo · <span class="mono">CB-4471902</span></div></div>' +
        '<div class="card p"><div class="between"><span class="ink" style="font-weight:600">Doctor’s records (APS)</span>' + k.chip("warn", "Needs a doc") + '</div><div class="ink" style="margin-top:4px;font-size:15px">Dr. Amin, Savannah Heart · asked 19 Nov · day 5 of 30</div><div class="btnrow" style="margin-top:12px">' + k.btn("Scan a document", "primary", "camera", "sm") + k.btn("Call the office", "outline", "phone", "sm") + "</div></div>" +
        '<div class="card p"><h4>Where it is</h4><div class="timeline" style="margin-top:10px">' +
        [["Requirement: APS from Dr. Amin", "Wed 19 Nov · Corebridge", 0], ["In underwriting", "Mon 17 Nov", 0], ["Received by the carrier", "Fri 14 Nov", 1], ["Submitted by Jordan Reyes", "Thu 13 Nov · e-sign", 1]].map((e) => '<div class="ev ' + (e[2] ? "mut" : "") + '"><div class="e1">' + e[0] + '</div><div class="e2">' + e[1] + "</div></div>").join("") +
        "</div></div>" +
        '<div class="card p"><h4>Still to come</h4><div style="margin-top:8px">' + k.kv([["Phone interview", "Done 17 Nov"], ["Payment", "First draft 3 Dec"], ["Policy delivery", "After issue"]]) + "</div></div>" +
        "</div>",
    }),
  });

  S.push({
    sec: "sales", id: "E7", name: "Daily deal flow",
    note: "Today’s deals across the team, as they are written. Owner and producers see premium; the figure strip has no colour, a problem tile gets one chip.",
    badges: { calls: 2, inbox: 4 },
    render: (k) => ({
      tab: null,
      header: k.header({ back: k.ios ? "Menu" : " ", title: "Deal flow", sub: "Today · 9 deals", large: true, actions: ["calendar"] }),
      body:
        '<div class="tiles pad16">' + k.tile("Annual premium", '<span class="tn">' + k.money("6,912") + "</span>", "<b>↑ $1,104</b> vs last Tue") + k.tile("Deals", "9", "3 need a signature") + "</div>" +
        k.group("Written today", [
          k.row({ av: "AK", t: "Linda Okafor", m: "Ava Kim · American Amicable · 2:46 pm", r: "$626" }),
          k.row({ av: "JR", t: "Dolores King", m: "Jordan Reyes · Mutual of Omaha · 2:31 pm", r: "$712" }),
          k.row({ av: "MO", t: "Paul Stewart", m: "Marcus Ortiz · Corebridge · 1:58 pm", r: "$1,140", chip: k.chip("warn", "Unsigned") }),
          k.row({ av: "SL", t: "Ann Murphy", m: "Sam Lee · Royal Neighbors · 12:20 pm", r: "$548" }),
          k.row({ av: "JR", t: "Nora Bell", m: "Jordan Reyes · Transamerica · 11:05 am", r: "$842" }),
        ]),
    }),
  });
})();
