/* Screens, part D: team, reports and compliance; Menu and settings; the partner app; phone-only extras; states.
 * Also the page-by-page scope map (window.SCOPE) drawn in section 00. */
(function () {
  "use strict";
  const S = window.SCREENS;
  const ic = window.MK.ic;
  const bottomBar = (k, inner) => '<div style="position:absolute;left:0;right:0;bottom:0;padding:12px 16px 34px;background:var(--bar);backdrop-filter:blur(20px);border-top:.5px solid var(--line);z-index:20;display:flex;gap:10px;flex-direction:column">' + inner + "</div>";

  // ═══ 09 · Team, reports & compliance ════════════════════════════════
  S.push({
    sec: "team", id: "I1", name: "Team",
    role: "owner",
    note: "Producers ranked by what they actually make the agency, with placement and chargebacks beside it. A manager sees the same list without the money columns.",
    badges: { inbox: "!6", money: 4 },
    render: (k) => ({
      tab: "team", role: "owner",
      header: k.header({ title: "Team", actions: ["search", "userPlus"], belowFull: '<div class="pad16" style="padding-bottom:10px">' + k.seg(["Month", "Quarter", "Year"], 0, true) + "</div>" + k.fchips([{ t: "Issued premium", on: true, dd: true }, { t: "All 18", dd: true }, "On the phone now"]) + '<div style="height:10px"></div>' }),
      body:
        '<div class="card" style="margin:0 16px;padding:4px 0">' +
        [["1", "AK", "Ava Kim", "$14,920", "82% placed", 100, true, ""], ["2", "JR", "Jordan Reyes", "$11,480", "74% placed", 77, false, ""], ["3", "MO", "Marcus Ortiz", "$9,860", "69% placed", 66, false, ""], ["4", "SL", "Sam Lee", "$7,210", "71% placed", 48, false, ""], ["5", "TB", "Tom Baker", "$5,040", "58% placed", 34, false, "2 chargebacks"], ["6", "NW", "Nia Watts", "$4,310", "77% placed", 29, false, ""], ["7", "RV", "Rafael Vega", "$3,920", "64% placed", 26, false, ""]].map((r) =>
          '<div class="leader"><span class="rk ' + (r[6] ? "g" : "") + '">' + r[0] + "</span>" + k.av(r[1], "sm") + '<div style="flex:1;min-width:0"><div class="between"><span class="ink" style="font-weight:500">' + r[2] + '</span><span class="tn ink">' + r[3] + '</span></div><div class="between mini" style="margin-top:2px"><span>' + r[4] + "</span>" + (r[7] ? k.chip("warn", r[7]) : "") + '</div><div class="bar"><i class="' + (r[6] ? "g" : "") + '" style="width:' + r[5] + '%"></i></div></div></div>').join("") +
        "</div>",
    }),
  });

  S.push({
    sec: "team", id: "I2", name: "Producer",
    role: "owner",
    note: "One producer: the month against their goal (the ring turns gold at 100%), what they wrote and what came back, licences that are about to expire, and a way to reach them.",
    render: (k) => ({
      tab: "team", role: "owner",
      header: k.header({ back: k.ios ? "Team" : " ", title: "", large: false, actions: ["msg", "moreH"] }),
      body:
        '<div class="pad16 gap">' +
        '<div class="row2" style="gap:14px">' + k.av("AK", "lg") + '<div><div class="disp ink" style="font-size:26px;font-weight:700">Ava Kim</div><div class="muted" style="font-size:14px">Producer · reports to Dana Ellery · since Mar 2025</div></div></div>' +
        '<div class="card p" style="display:flex;gap:16px;align-items:center">' + k.ring(100, 84, "112%", true) + '<div><div class="ink" style="font-weight:600;font-size:17px">Goal passed on 19 Nov</div><div class="muted" style="font-size:14px">$14,920 of $13,300 issued annual premium</div></div></div>' +
        '<div class="tiles">' + k.tile("Applications", "21", "<b>↑ 4</b> vs October") + k.tile("Placement", "82%", "Agency 71%") + k.tile("Talk time", "31h", "This month") + k.tile("Chargebacks", '<span class="tn">' + k.money("0") + "</span>", "None in 90 days") + "</div>" +
        k.group("Licences and appointments", [
          k.row({ i: "badge", t: "Texas licence", m: "Renews 9 Dec", chip: k.chip("warn", "15 days") }),
          k.row({ i: "badge", t: "Mutual of Omaha", m: "Appointed in 14 states", chip: k.chip("ok", "Appointed") }),
        ]).replace(/class="grp-t"/, 'class="grp-t" style="padding-left:16px"').replace('class="grp"', 'class="grp" style="margin:0"') +
        "</div>",
    }),
  });

  S.push({
    sec: "team", id: "I3", name: "Reports",
    note: "The reports that read well on a phone, each as a card with its one number and a sparkline (owner pick: switch + sparkline cards, no donuts). The table-heavy reports open on the computer.",
    role: "owner",
    render: (k) => ({
      tab: null, role: "owner",
      header: k.header({ back: k.ios ? "Menu" : " ", title: "Reports", large: true, actions: ["calendar"] }),
      body:
        '<div class="pad16 gap">' +
        [["Sales performance", "Applications this month", "142", "<b>↑ 18</b> vs October", [80, 92, 101, 96, 120, 131, 142]], ["Team activity", "Talk time per producer, daily", "1h 52m", "<b>↑ 9m</b> vs last week", [90, 96, 101, 99, 104, 108, 112]], ["Book scorecards", "13-month persistency", "84%", "Same as last quarter", [83, 84, 82, 84, 85, 84, 84]], ["Retention scorecard", "Saved this month", "23 of 41", "56% save rate", [10, 14, 12, 17, 19, 21, 23]], ["Partner quality", "Sold per 100 leads, all partners", "9.6", "<b>↑ 0.8</b> vs October", [7.9, 8.2, 8.4, 8.8, 9.1, 9.2, 9.6]]].map((r) =>
          '<div class="card p"><div class="between"><span class="ink" style="font-weight:600">' + r[0] + "</span>" + ic("chevR", 18).replace('class="ico"', 'class="ico" style="color:var(--faint)"') + '</div><div class="between" style="margin-top:6px;align-items:flex-end"><div><div class="mini">' + r[1] + '</div><div class="big" style="font-size:28px">' + r[2] + '</div><div class="mini">' + r[3].replace("<b>", '<b class="gi">') + "</div></div>" + k.spark(r[4], 110, 44) + "</div></div>").join("") +
        k.group("On the computer", [k.row({ i: "laptop", it: "plain", t: "True CPA, Lead sources, Queue scoring, Hierarchy" })]).replace('class="grp"', 'class="grp" style="margin:0"').replace('class="grp-t"', 'class="grp-t" style="padding-left:16px"') +
        "</div>",
    }),
  });

  S.push({
    sec: "team", id: "I4", name: "Sales performance",
    note: "One report on a phone: the funnel as bars (each opens its list), then why carriers declined. Period switch at the top; every change names its comparison.",
    role: "owner",
    render: (k) => ({
      tab: null, role: "owner",
      header: k.header({ back: k.ios ? "Reports" : " ", title: "Sales performance", large: false, actions: ["sliders"], belowFull: '<div class="pad16" style="padding-bottom:10px">' + k.seg(["Week", "Month", "Quarter"], 1, true) + "</div>" }),
      body:
        '<div class="pad16 gap">' +
        '<div class="card p"><h4>From lead to policy · November</h4><div style="display:flex;flex-direction:column;gap:12px;margin-top:12px">' +
        [["Leads", "4,212", 100], ["Contacted", "1,604", 38], ["Quoted", "402", 9.5], ["Applied", "142", 3.4], ["Issued", "96", 2.3]].map((f) => '<div><div class="between" style="font-size:15px"><span class="ink">' + f[0] + '</span><span class="tn ink">' + f[1] + ' <span class="mini">' + (f[2] === 100 ? "" : f[2] + "%") + '</span></span></div><div class="prog" style="height:8px;margin-top:5px"><i style="width:' + Math.max(f[2], 2) + '%"></i></div></div>').join("") +
        "</div></div>" +
        '<div class="card p"><h4>Days from application to issue</h4><div class="big" style="font-size:30px;margin-top:4px">11.4 <small>days</small></div><div class="mini"><b class="gi">↓ 2.1 days</b> vs October, faster is better</div><div style="margin-top:10px">' + k.bars([14, 13, 15, 12, 12, 11, 11.4], ["May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov"], 330, 100, 6) + "</div></div>" +
        k.group("Why carriers declined · 14", [
          k.row({ t: "Heart history in 2 years", r: "5" }), k.row({ t: "Prescription check", r: "4" }), k.row({ t: "Build (height and weight)", r: "3" }), k.row({ t: "Other", r: "2" }),
        ]).replace('class="grp"', 'class="grp" style="margin:0"').replace('class="grp-t"', 'class="grp-t" style="padding-left:16px"') +
        "</div>",
    }),
  });

  S.push({
    sec: "team", id: "I5", name: "Check a number",
    note: "TCPA / DNC check for any number you were handed, before a lead exists (the orphaned preflight checker finally gets a home). Open to setters and assistants too.",
    render: (k) => ({
      tab: null,
      header: k.header({ back: k.ios ? "Menu" : " ", title: "Check a number", large: true }),
      body:
        '<div class="pad16 gap">' +
        k.field("Phone number", "(813) 555-0199", { lead: "phone", focus: true }) +
        '<div class="card p"><div class="between"><div><div class="ink" style="font-weight:600;font-size:18px">Don’t call this number</div><div class="mini">Checked 9:41 am · Tampa, FL · mobile</div></div>' + k.chip("bad", "Blocked") + "</div>" +
        '<div style="display:flex;flex-direction:column;gap:10px;margin-top:14px">' +
        [["National Do Not Call list", "Listed since 2019", 0], ["Florida Do Not Call list", "Not listed", 1], ["Known litigator list", "Not listed", 1], ["Your agency’s do-not-call list", "Added 2 Oct by Sam Lee", 0], ["Written consent on file", "None found", 0]].map((c) => '<div class="row2" style="align-items:flex-start"><span style="color:' + (c[2] ? "var(--ok)" : "var(--bad)") + '">' + ic(c[2] ? "checkC" : "xC", 20) + '</span><div><div class="ink" style="font-size:15px">' + c[0] + '</div><div class="mini">' + c[1] + "</div></div></div>").join("") +
        "</div></div>" +
        '<div class="btnrow">' + k.btn("Evidence report", "outline", "file") + k.btn("Check another", "primary", "refresh") + "</div>" +
        "</div>",
    }),
  });

  S.push({
    sec: "team", id: "I6", name: "Complaints",
    role: "owner",
    note: "Every complaint with an owner, a deadline and a countdown, soonest first. Assigning and logging a reply work on the phone; the evidence packet is built on the computer.",
    render: (k) => ({
      tab: null, role: "owner",
      header: k.header({ back: k.ios ? "Menu" : " ", title: "Complaints", sub: "2 open · 31 closed this year", large: true }),
      body:
        k.group("Open", [
          k.row({ i: "alert", it: "w", t: "Vernon Hayes", m: "Says he was charged after cancelling · Tom Baker", chip: k.chip("warn", "2 days left") }),
          k.row({ i: "alert", t: "(813) 555-0199", m: "Called while on DNC · state regulator · Sam Lee", chip: k.chip("info", "12 days left") }),
        ]) +
        k.group("Closed lately", [
          k.row({ i: "checkC", it: "plain", t: "Mae Thompson", m: "Draft date changed · closed 14 Nov", chip: k.chip("ok", "Resolved") }),
          k.row({ i: "checkC", it: "plain", t: "Ellen Price", m: "Wrong beneficiary spelling · 2 Nov", chip: k.chip("ok", "Resolved") }),
        ]),
    }),
  });

  // ═══ 10 · Menu, settings & the computer hand-off ═══════════════════
  const menuRow = (k, i, t, desk, n) => k.row({ i, t, chip: (n ? '<span class="tn" style="color:var(--gold-ink);font-weight:600;font-size:14px">' + n + "</span>" : "") + (desk ? '<span style="color:var(--faint)">' + ic("laptop", 18) + "</span>" : ""), chev: !desk });

  S.push({
    sec: "menu", id: "J1", name: "Menu",
    note: "The web sidebar, whole, in the same eleven groups and order, filtered by role and plan like the web menu. Pages that work on a phone open; pages built for a big screen carry a laptop mark.",
    badges: { calls: 2, inbox: 4 },
    render: (k) => ({
      tab: "menu",
      header: k.header({ title: "Menu", actions: ["search"] }),
      body:
        '<div class="pad16"><div class="card p row2" style="gap:12px">' + k.av("JR") + '<div style="flex:1"><div class="ink" style="font-weight:600">Jordan Reyes</div><div class="mini">Producer · Ellery & Fields</div></div>' + ic("chevR", 18).replace('class="ico"', 'class="ico" style="color:var(--faint)"') + "</div></div>" +
        k.group("Today", [menuRow(k, "calendar", "Calendar"), menuRow(k, "headset" in window.MK.I ? "headset" : "users", "Appointments & setters")]) +
        k.group("Leads", [menuRow(k, "package", "Lead flow", true), menuRow(k, "upload", "List import", true), menuRow(k, "store" in window.MK.I ? "store" : "building", "Vendors & campaigns")]) +
        k.group("Sales", [menuRow(k, "filePen", "Applications"), menuRow(k, "hourglass", "Pending cases", false, 3), menuRow(k, "calc", "Quote"), menuRow(k, "clipboard", "Daily deal flow")]) +
        k.group("Book of business", [menuRow(k, "book", "Policies"), menuRow(k, "receipt", "Commission ledger"), menuRow(k, "files", "Carrier files", true)]) +
        k.group("Retention", [menuRow(k, "buoy", "Cases", false, 2), menuRow(k, "wrench", "Waiting on the carrier"), menuRow(k, "heart", "Win-back")]) +
        k.group("Commissions", [menuRow(k, "wallet", "My pay")]) +
        k.group("Accounting", [menuRow(k, "wallet", "My balance")]) +
        k.group("Partners", [menuRow(k, "msgs", "Partner chat", false, 3)]) +
        k.group("Compliance", [menuRow(k, "shield", "Check a number"), menuRow(k, "lock", "Consent locker"), menuRow(k, "badge", "Carrier appointments")]) +
        k.group("Reports", [menuRow(k, "chart", "Sales performance"), menuRow(k, "activity", "Team activity"), menuRow(k, "calCheck", "Callbacks kept")]) +
        k.group("", [menuRow(k, "settings", "Settings"), menuRow(k, "globe", "Help and guides")]),
    }),
  });

  S.push({
    sec: "menu", id: "J2", name: "Opens on a computer",
    note: "Tapping a laptop-marked page never dead-ends. It says what the page is for and sends the exact link to your computer (email, or the bell on your next web sign-in).",
    render: (k) => ({
      tab: "menu",
      header: k.header({ title: "Menu" }),
      body: "",
      overlay: k.sheet("",
        '<div style="display:flex;flex-direction:column;gap:14px;align-items:flex-start">' +
        '<div style="width:56px;height:56px;border-radius:16px;background:var(--surf2);display:grid;place-items:center;color:var(--green-ink)">' + ic("laptop", 28) + "</div>" +
        '<div><div class="disp ink" style="font-size:24px;font-weight:700">List import works best on a computer</div><div class="muted" style="margin-top:6px;font-size:15px">You map columns side by side with the file, review thousands of rows and fix them in bulk. A phone screen hides most of that.</div></div>' +
        '<div style="width:100%;display:flex;flex-direction:column;gap:10px">' + k.btn("Email me the link", "primary", "mail") + k.btn("Put it in my bell on the web", "outline", "bell") + "</div>" +
        '<div class="cent gr" style="font-weight:600;font-size:15px;align-self:center">Open in this phone’s browser anyway</div></div>', { h: 520 }),
    }),
  });

  S.push({
    sec: "menu", id: "J3", name: "Settings on the phone",
    note: "Only what belongs to you and this phone: profile, availability, sign-in and security, appearance, notifications. Agency settings (pipelines, products, carriers, plan and billing) stay on the computer.",
    render: (k) => ({
      tab: null,
      header: k.header({ back: k.ios ? "Menu" : " ", title: "Settings", large: true }),
      body:
        '<div class="pad16"><div class="card p row2" style="gap:14px">' + k.av("JR", "lg") + '<div style="flex:1"><div class="ink" style="font-weight:600;font-size:18px">Jordan Reyes</div><div class="mini">jordan@elleryfields.com · Producer</div><div class="gr" style="font-weight:600;font-size:14px;margin-top:4px">Edit profile</div></div></div></div>' +
        k.group("Work", [k.row({ i: "phoneIn", t: "Taking calls", m: "Transfers ring this phone", sw: true }), k.row({ i: "clock", t: "Working hours", r: "8:30 am – 6 pm ET" }), k.row({ i: "users", t: "Use the producer tabs", m: "For owners who also sell", sw: false })]) +
        k.group("Sign-in and security", [k.row({ i: k.ios ? "face" : "finger", t: k.ios ? "Face ID" : "Fingerprint", sw: true }), k.row({ i: "lock", t: "Two-step sign-in", r: "On" }), k.row({ i: "laptop", t: "Signed-in devices", r: "3" })]) +
        k.group("This phone", [k.row({ i: "bell", t: "Notifications" }), k.row({ i: "moon", t: "Appearance", r: "Dark" }), k.row({ i: "download", t: "Saved for offline", r: "2 drafts" })]) +
        k.group("", [k.row({ i: "building", t: "Switch workspace", r: "Ellery & Fields" }), k.row({ i: "logout", it: "b", t: '<span style="color:var(--bad)">Sign out</span>', chev: false })]),
    }),
  });

  // ═══ 11 · Partner app ═══════════════════════════════════════════════
  S.push({
    sec: "partner", id: "K1", name: "Partner home",
    role: "partner",
    note: "A partner signs in to the same app and lands here: what they sent, what it became, and what they’re owed. What shows follows their partner type (a transfer call centre sees transfers; an affiliate sees links).",
    badges: { messages: 2 },
    render: (k) => ({
      tab: "home", role: "partner",
      header: k.header({ title: "Apex Leads", sub: "Sending to Ellery & Fields · November", actions: ['<span class="av sm">MS</span>'] }),
      body:
        '<div class="tiles pad16">' + k.tile("Sent", "412", "<b>↑ 38</b> vs October") + k.tile("Accepted", "388", "94% of sent") + k.tile("Sold", "41", "9.9 per 100") + k.tile("You’re owed", '<span class="tn">' + k.money("4,310") + "</span>", "Paid on 5 Dec") + "</div>" +
        '<div class="pad16" style="margin-top:12px">' + k.btn("Send a lead", "gold", "send") + "</div>" +
        k.sh("Latest", "Pipeline") +
        k.group("", [
          k.row({ i: "user", it: "plain", t: "Dolores King", m: "Transferred 2:09 pm · Jordan took it", chip: k.chip("info", "On a call") }),
          k.row({ i: "user", it: "plain", t: "Linda Okafor", m: "Sent 21 Nov", chip: k.chip("ok", "Sold") }),
          k.row({ i: "user", it: "plain", t: "Walter Brooks", m: "Sent today · agency is reviewing", chip: k.chip("warn", "Needs review") }),
          k.row({ i: "user", it: "plain", t: "Ida Collins", m: "Sent 20 Nov · returned: wrong number", chip: k.chip("bad", "Returned") }),
        ]),
    }),
  });

  S.push({
    sec: "partner", id: "K2", name: "Send a lead",
    role: "partner",
    note: "The partner form from the agency’s template, short on a phone. Consent is captured as proof (a certificate ID or a recorded verbal), never a bare checkbox. A call centre can also start a live transfer from here.",
    render: (k) => ({
      tab: "submit", role: "partner",
      header: k.header({ title: "Send a lead", actions: ["history"], belowFull: '<div class="pad16" style="padding-bottom:10px">' + k.seg(["Live transfer", "Lead only"], 1, true) + "</div>" }),
      body:
        '<div class="pad16 gap">' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' + k.field("First name", "Ida") + k.field("Last name", "Collins") + "</div>" +
        k.field("Phone", "(205) 555-0182", { lead: "phone" }) +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' + k.field("Date of birth", "04/09/1955") + k.field("State", "Alabama", { trail: "chevD" }) + "</div>" +
        k.field("Product", "Final expense", { trail: "chevD" }) +
        k.field("Consent proof", "TrustedForm · 7f3c…a19e", { lead: "shield", hint: "Or attach the call recording where she agreed." }) +
        k.field("Note for the agent", "Wants a callback after 3 pm", {}) +
        "</div>",
      after: '<div style="position:absolute;left:0;right:0;bottom:84px;padding:10px 16px;background:var(--bar);backdrop-filter:blur(20px);border-top:.5px solid var(--line);z-index:19">' + k.btn("Send to Ellery & Fields", "primary", "send") + "</div>",
    }),
  });

  S.push({
    sec: "partner", id: "K3", name: "Partner pipeline",
    role: "partner",
    note: "Where every lead they sent is now, in the partner’s own stages (from their pipeline, never another partner type’s). Tap a lead for its history and to message about it.",
    badges: { messages: 2 },
    render: (k) => ({
      tab: "pipeline", role: "partner",
      header: k.header({ title: "Pipeline", actions: ["search"], belowFull: k.fchips([{ t: "All", n: 412 }, { t: "Working", n: 211, on: true }, { t: "Sold", n: 41 }, { t: "Not sold", n: 136 }, { t: "Returned", n: 24 }]) + '<div style="height:10px"></div>' }),
      body:
        k.group("Working · 211", [
          k.row({ i: "user", it: "plain", t: "Dolores King", m: "On a call with Jordan · 2:09 pm", chip: k.chip("info", "On a call") }),
          k.row({ i: "user", it: "plain", t: "George Patel", m: "Applied · at the carrier", chip: k.chip("info", "Applied") }),
          k.row({ i: "user", it: "plain", t: "Betty Holmes", m: "Callback Fri", chip: k.chip("info", "Callback") }),
          k.row({ i: "user", it: "plain", t: "Walter Brooks", m: "Agency is reviewing", chip: k.chip("warn", "Needs review") }),
          k.row({ i: "user", it: "plain", t: "Carl Weber", m: "Contacted · interested", chip: k.chip("info", "Interested") }),
        ]),
    }),
  });

  S.push({
    sec: "partner", id: "K4", name: "Partner payouts",
    role: "partner",
    note: "The Account tab’s first page: what they’re owed and every statement, from the agency’s ledger (no more WhatsApp). Team access and partner settings sit below it.",
    render: (k) => ({
      tab: "account", role: "partner",
      header: k.header({ title: "Account" }),
      body:
        '<div class="pad16"><div class="card p"><div class="mini">Next payout · 5 Dec</div><div class="big" style="font-size:38px">' + k.money("4,310", "00") + '</div><div class="mini">41 sold leads × $95 + 12 transfers × $35</div></div></div>' +
        k.group("Statements", [
          k.row({ i: "file", it: "plain", t: "October 2026", m: "Paid 5 Nov · bank transfer", r: "$3,725.00" }),
          k.row({ i: "file", it: "plain", t: "September 2026", m: "Paid 5 Oct", r: "$3,140.00" }),
        ]) +
        k.group("Your company", [k.row({ i: "users", t: "Team access", r: "4 people" }), k.row({ i: "landmark", t: "Payout details", r: "Regions ••0912" }), k.row({ i: "bell", t: "Notifications" }), k.row({ i: "logout", it: "b", t: '<span style="color:var(--bad)">Sign out</span>', chev: false })]),
    }),
  });

  // ═══ 12 · Phone-only extras ═════════════════════════════════════════
  const appIcon = (bg, label, inner) => '<div style="display:flex;flex-direction:column;align-items:center;gap:5px;font-size:11.5px;color:#fff"><span style="width:62px;height:62px;border-radius:15px;background:' + bg + ';display:grid;place-items:center">' + (inner || "") + "</span>" + label + "</div>";
  const wall = 'background:linear-gradient(160deg,#16302a,#0b1614 60%)';

  S.push({
    sec: "native", id: "L1", name: "Home-screen widgets",
    note: "Two widgets: Today (next callback in the customer’s time, the goal, Start calling) and the agency’s month for owners. Tapping any part deep-links to that screen. They refresh with push, not by polling.",
    render: (k) => ({
      full:
        '<div style="position:absolute;inset:0;' + wall + '"></div><div style="position:relative">' + k.status({ light: true }) + "</div>" +
        '<div style="position:relative;padding:' + (k.ios ? "14px 22px" : "18px 18px") + ';display:flex;flex-direction:column;gap:22px">' +
        '<div class="widget" style="background:rgba(14,26,23,.92);border-color:rgba(255,255,255,.08);color:#c9d6d1;border-radius:' + (k.ios ? 22 : 28) + 'px">' +
        '<div class="between"><span class="row2" style="gap:6px;font-size:13px;font-weight:600;color:#4fe3bb"><img src="isotype-on-dark.svg" width="16" height="16" alt="">Today</span><span style="font-size:12px;opacity:.7">updated 9:40</span></div>' +
        '<div class="between" style="margin-top:10px;align-items:flex-end"><div><div style="font-size:13px;opacity:.75">Next callback</div><div style="color:#fff;font-weight:600;font-size:18px">Robert Chen · 11:30</div><div style="font-size:12.5px;opacity:.7">10:30 his time (CT)</div></div>' + '<div style="text-align:right"><div style="font-size:13px;opacity:.75">Goal</div><div style="color:#fff;font-family:Inter Tight;font-weight:700;font-size:24px">64%</div></div></div>' +
        '<div style="display:flex;gap:8px;margin-top:12px"><span style="flex:1;height:38px;border-radius:10px;background:#f2b33d;color:#2a1c00;display:flex;align-items:center;justify-content:center;gap:6px;font-weight:700;font-size:14px">' + ic("phoneOut", 16) + 'Start calling</span><span style="flex:1;height:38px;border-radius:10px;background:rgba(255,255,255,.1);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:600;font-size:14px">3 callbacks</span></div></div>' +
        '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:18px 10px">' +
        '<div style="grid-column:span 2;grid-row:span 2;border-radius:' + (k.ios ? 22 : 28) + 'px;background:rgba(14,26,23,.92);border:1px solid rgba(255,255,255,.08);padding:14px;color:#c9d6d1;display:flex;flex-direction:column;justify-content:space-between"><span class="row2" style="gap:6px;font-size:12.5px;font-weight:600;color:#4fe3bb"><img src="isotype-on-dark.svg" width="14" height="14" alt="">Agency · Nov</span><div><div style="font-size:12px;opacity:.75">Submitted</div><div style="color:#fff;font-family:Inter Tight;font-weight:700;font-size:26px">$86.4k</div><div style="font-size:12px;color:#f5c562">↑ 12% vs Oct</div></div></div>' +
        appIcon("#0d4037", "Insurvas", '<img src="isotype-on-dark.svg" width="40" height="40" alt="">') + appIcon("#2b6cb0", "Mail", ic("mail", 28)) + appIcon("#38a169", "Phone", ic("phone", 28)) + appIcon("#4a5568", "Calendar", ic("calendar", 28)) +
        appIcon("#805ad5", "Notes", ic("note", 28)) + appIcon("#dd6b20", "Photos", ic("camera", 28)) + appIcon("#2c7a7b", "Maps", ic("pin", 28)) + appIcon("#718096", "Settings", ic("settings", 28)) +
        "</div></div>",
    }),
  });

  S.push({
    sec: "native", id: "L2", name: "A call in progress",
    note: "While you’re on a call from the dialer or a transfer, iOS shows a Live Activity in the Dynamic Island (timer, lead, back to the outcome screen); Android keeps an ongoing notification. Both stop when the outcome is saved.",
    render: (k) => ({
      full:
        '<div style="position:absolute;inset:0;background:#0b1614"></div>' +
        (k.ios
          ? '<div style="position:absolute;top:11px;left:12px;right:12px;height:150px;border-radius:44px;background:#000;z-index:8;padding:18px 22px;color:#fff"><div class="between"><span class="row2" style="gap:8px"><span style="width:34px;height:34px;border-radius:9px;background:#0d4037;display:grid;place-items:center"><img src="isotype-on-dark.svg" width="22" height="22" alt=""></span><span><span style="display:block;font-weight:600">Harold Nguyen</span><span style="display:block;font-size:12.5px;opacity:.7">Term life · TX · attempt 3</span></span></span><span class="tn" style="font-family:Inter Tight;font-size:28px;font-weight:700;color:#07d6a0">4:18</span></div><div style="display:flex;gap:10px;margin-top:14px"><span style="flex:1;height:40px;border-radius:20px;background:rgba(255,255,255,.14);display:grid;place-items:center;font-weight:600;font-size:14px">Note</span><span style="flex:1;height:40px;border-radius:20px;background:#07d6a0;color:#04251d;display:grid;place-items:center;font-weight:700;font-size:14px">Outcome</span></div></div>' +
            '<div style="position:relative;padding-top:200px;text-align:center;color:#fff"><div style="font-size:30px;font-weight:500">(713) 555-0144</div><div style="opacity:.6;margin-top:4px">4:18</div></div>' +
            '<div style="position:absolute;left:0;right:0;bottom:40px;display:grid;grid-template-columns:repeat(3,1fr);gap:22px;padding:0 44px;color:#fff;text-align:center;font-size:13px">' + ["Mute", "Keypad", "Speaker", "Add", "FaceTime", "Contacts"].map((t, i) => '<div><span style="width:72px;height:72px;border-radius:50%;background:rgba(255,255,255,.16);display:grid;place-items:center;margin:0 auto 6px">' + ic(["mic", "keypad", "speaker", "plus", "camera", "user"][i], 28) + "</span>" + t + "</div>").join("") + '<div style="grid-column:2"><span style="width:72px;height:72px;border-radius:50%;background:#e5484d;display:grid;place-items:center;margin:0 auto">' + ic("phoneOff", 30) + "</span></div></div>"
          : '<div style="position:relative">' + k.status({ light: true }) + "</div>" +
            '<div style="position:relative;margin:6px 10px 0;border-radius:28px;background:#1b2522;padding:16px;color:#e6efec"><div class="row2" style="gap:8px;font-size:12.5px;opacity:.8"><span style="width:22px;height:22px;border-radius:50%;background:#0d4037;display:grid;place-items:center"><img src="isotype-on-dark.svg" width="14" height="14" alt=""></span>Insurvas · on a call · 4:18</div><div style="font-size:18px;font-weight:600;margin-top:8px">Harold Nguyen</div><div style="font-size:13.5px;opacity:.75">Term life · TX · attempt 3 · disclosure read</div><div style="display:flex;gap:18px;margin-top:12px;color:#4fe3bb;font-weight:600;font-size:14px"><span>Outcome</span><span>Add a note</span><span>Callback</span></div></div>' +
            '<div style="position:relative;margin:10px 10px 0;border-radius:28px;background:#1b2522;padding:16px;color:#e6efec"><div class="row2" style="gap:8px;font-size:12.5px;opacity:.8">' + ic("phone", 14) + "Phone · ongoing call</div><div style=\"font-size:17px;font-weight:600;margin-top:6px\">(713) 555-0144</div><div style=\"display:flex;gap:18px;margin-top:10px;font-weight:600;font-size:14px\"><span style=\"color:#f0837c\">Hang up</span><span style=\"color:#4fe3bb\">Speaker</span></div></div>"),
    }),
  });

  S.push({
    sec: "native", id: "L3", name: "Shortcuts from the app icon",
    note: "Long-press the icon: Serve next lead, Add a lead, Check a number, Search. The same four are Siri / Google Assistant shortcuts and can sit on the Action button.",
    render: (k) => ({
      full:
        '<div style="position:absolute;inset:0;' + wall + ';filter:blur(0)"></div><div style="position:absolute;inset:0;background:rgba(0,0,0,.45)"></div><div style="position:relative">' + k.status({ light: true }) + "</div>" +
        '<div style="position:absolute;left:' + (k.ios ? 30 : 26) + 'px;top:330px;width:250px;border-radius:' + (k.ios ? 14 : 24) + 'px;background:' + (k.ios ? "rgba(40,48,46,.94)" : "#1f2a27") + ';color:#fff;overflow:hidden;font-size:16px">' +
        [["Serve next lead", "phoneOut"], ["Add a lead", "userPlus"], ["Check a number", "shield"], ["Search", "search"]].map((r, i) => '<div class="between" style="padding:13px 16px;' + (i ? "border-top:.5px solid rgba(255,255,255,.12)" : "") + '"><span>' + r[0] + "</span>" + ic(r[1], 20) + "</div>").join("") + "</div>" +
        '<div style="position:absolute;left:' + (k.ios ? 30 : 26) + 'px;top:520px">' + appIcon("#0d4037", "Insurvas", '<img src="isotype-on-dark.svg" width="40" height="40" alt="">') + "</div>",
    }),
  });

  S.push({
    sec: "native", id: "L4", name: "Working offline",
    note: "No signal in a client’s kitchen: notes, outcomes and application answers save on the phone and send in order when it reconnects. The state is a small mark in the bar, not a banner. Dialing and claiming need the server, so they wait.",
    render: (k) => ({
      tab: null,
      statusOpt: { offline: true },
      header: k.header({ back: k.ios ? "Linda" : " ", title: "Application", large: false, actions: ['<span class="chip warn" style="height:26px">' + ic("wifiOff", 14) + "Offline · 3 to send</span>"],
        belowFull: '<div class="pad16" style="padding-bottom:12px"><div class="between mini" style="margin-bottom:8px"><span class="ink" style="font-weight:600">Beneficiary · 6 of 10</span><span>American Amicable</span></div>' + k.stepper(10, 5) + "</div>" }),
      body:
        '<div class="pad16 gap" style="padding-top:10px">' +
        '<div class="disp ink" style="font-size:24px;font-weight:700">Who should receive the benefit?</div>' +
        k.field("Full name", "Grace Okafor") + k.field("Relationship", "Daughter", { trail: "chevD" }) + k.field("Share", "100%") +
        '<div class="row2 mini">' + ic("check", 14) + "Saved on this phone · sends when you’re back online</div>" +
        "</div>",
      after: bottomBar(k, '<div class="btnrow">' + k.btn("Back", "outline") + k.btn("Next", "primary") + "</div>"),
    }),
  });

  // ═══ 13 · States ════════════════════════════════════════════════════
  S.push({
    sec: "states", id: "M1", name: "Loading",
    note: "Frame first (web §7a): the bar, title and tabs are there at once; the skeleton only appears if data takes over 180ms, and its sheen is the only motion that waits.",
    badges: { calls: 2, inbox: 4 },
    render: (k) => ({
      tab: "leads",
      header: leadsHeadStub(k),
      body: k.group("", [1, 2, 3, 4, 5, 6].map(() => '<div class="skrow"><span class="sk a"></span><div style="flex:1;display:flex;flex-direction:column;gap:7px"><span class="sk b" style="width:55%"></span><span class="sk b" style="width:80%;height:10px"></span></div><span class="sk b" style="width:56px;height:22px"></span></div>')),
    }),
  });

  function leadsHeadStub(k) {
    return k.header({ title: "Leads", actions: k.ios ? ["search", "sliders", "plus"] : ["search", "sliders"], belowFull: k.fchips([{ t: "All" }, { t: "New", on: true }, { t: "Contacted" }, { t: "Interested" }, { t: "Callback" }]) + '<div style="height:10px"></div>' });
  }

  S.push({
    sec: "states", id: "M2", name: "Nothing here yet",
    note: "A true empty state says why and offers the next useful move. It never shows when the fetch failed (that is M4).",
    badges: { calls: 0, inbox: 4 },
    render: (k) => ({
      tab: "calls",
      header: k.header({ title: "Calls", belowFull: '<div class="pad16" style="padding-bottom:10px">' + (k.ios ? k.seg(["Incoming", "Dialer", "Callbacks"], 2) : "") + "</div>" + (k.ios ? "" : k.utabs(["Incoming", "Dialer", "Callbacks"], 2)) }),
      body: '<div class="empty"><span class="ei">' + ic("calCheck", 30) + "</span><h4>No callbacks today</h4><p>You’re clear until Thursday, 10:00 am (Patricia Moore). Serve the next lead while it’s quiet.</p><div style=\"width:220px;margin-top:10px\">" + k.btn("Serve next lead", "primary", "phoneOut") + "</div></div>",
    }),
  });

  S.push({
    sec: "states", id: "M3", name: "Couldn’t load",
    note: "An error says what failed and how to fix it, in place, with Try again. Pull to refresh does the same. No toast for an error you have to act on.",
    badges: { calls: 2, inbox: 4 },
    render: (k) => ({
      tab: "calls",
      header: k.header({ title: "Calls", belowFull: '<div class="pad16" style="padding-bottom:10px">' + (k.ios ? k.seg(["Incoming", "Dialer", "Callbacks 3"], 0) : "") + "</div>" + (k.ios ? "" : k.utabs(["Incoming", "Dialer", "Callbacks 3"], 0)) }),
      body: '<div class="empty"><span class="ei" style="color:var(--bad);background:var(--bad-s)">' + ic("refresh", 30) + "</span><h4>We couldn’t load incoming calls</h4><p>The connection dropped while loading. Transfers are still being held for you for 60 seconds.</p><div style=\"width:200px;margin-top:10px\">" + k.btn("Try again", "primary", "refresh") + "</div></div>",
    }),
  });

  S.push({
    sec: "states", id: "M4", name: "Not in your plan",
    note: "When the agency’s plan doesn’t include a module, the page says so and who can change it. No prices or buy buttons in the app: App Store and Play rules would force in-app purchase for a subscription sold inside the app.",
    render: (k) => ({
      tab: null,
      header: k.header({ back: k.ios ? "Menu" : " ", title: "Retention", large: true }),
      body: '<div class="empty"><span class="ei">' + ic("lock", 30) + "</span><h4>Retention isn’t in your agency’s plan</h4><p>Dana Ellery (owner) can add it from Plan and billing on the web. Your book and policies stay open as before.</p><div style=\"width:220px;margin-top:10px\">" + k.btn("Tell Dana", "outline", "send") + "</div></div>",
    }),
  });

  S.push({
    sec: "states", id: "M5", name: "Light theme",
    note: "The same producer home in light theme v1 (white + olive lines): white tiles outlined, olive bands, gold kept to its roles. Every screen on this board switches with App theme in the toolbar.",
    badges: { calls: 2, inbox: 4 },
    light: true,
    render: (k) => {
      const b = window.SCREENS.find((s) => s.id === "B1").render(k);
      return b;
    },
  });


})();
