/* Screens, part F (round 1b): every remaining mobile feature for Book & retention, Money, Team, reports and
 * compliance, Menu and settings, the partner app, phone-only extras and states. Also the scope map (window.SCOPE). */
(function () {
  "use strict";
  const S = window.SCREENS;
  const ic = window.MK.ic;
  const bar = (k, inner) => '<div style="position:absolute;left:0;right:0;bottom:0;padding:12px 16px 34px;background:var(--bar);backdrop-filter:blur(20px);border-top:.5px solid var(--line);z-index:20;display:flex;gap:10px;flex-direction:column">' + inner + "</div>";
  const dim = (h) => '<div class="pad16" style="opacity:.45"><div class="sk" style="height:' + (h || 260) + 'px;border-radius:16px"></div></div>';
  const flat = (html) => html.replace('class="grp"', 'class="grp" style="margin:0"').replace('class="grp-t"', 'class="grp-t" style="padding-left:16px"');

  // ═══ 06 · Book & retention ══════════════════════════════════════════
  S.push({
    sec: "book", id: "F2b", name: "Commission ledger",
    note: "A policy’s commission, line by line, as the carrier statements posted it: advance, as-earned months, chargeback. Read-only on the phone; posting and corrections on the computer.",
    render: (k) => ({
      tab: null,
      header: k.header({ back: k.ios ? "Policy" : " ", title: "Commission", sub: "Maria Alvarez · 0119990312", large: true }),
      body:
        '<div class="tiles pad16">' + k.tile("Paid to date", '<span class="tn">' + k.money("648", "90") + "</span>") + k.tile("Still at risk", '<span class="tn">' + k.money("92", "70") + "</span>", "Until month 12") + "</div>" +
        k.group("Posted lines", [
          k.row({ t: "Advance · 9 months", m: "AMAM statement · 14 Mar", r: "$370.80", chev: false }),
          k.row({ t: "As earned · month 10", m: "AMAM statement · 14 Dec", r: "$41.20", chip: k.chip("info", "Expected"), chev: false }),
          k.row({ t: "Renewal · year 2", m: "Starts Mar 2027", r: "—", chev: false }),
        ]) +
        k.group("Split", [k.row({ av: "JR", t: "Jordan Reyes", m: "75% of advance", r: "$278.10", chev: false }), k.row({ i: "building", t: "Agency override", m: "25%", r: "$92.70", chev: false })]),
    }),
  });

  S.push({
    sec: "book", id: "F3b", name: "Waiting on the carrier",
    role: "retention",
    note: "Changes you sent to a carrier (new bank, new draft date, reinstatement). Each stays open until the next carrier file proves it, then closes by itself.",
    render: (k) => ({
      tab: "cases", role: "retention",
      header: k.header({ back: k.ios ? "Cases" : " ", title: "Waiting on the carrier", large: true }),
      body:
        k.group("Not in a file yet · 4", [
          k.row({ i: "wrench", t: "Mae Thompson", m: "New draft date · sent to RN 19 Nov", chip: k.chip("info", "5 days") }),
          k.row({ i: "wrench", t: "Ruth Alva", m: "New bank · sent to MoO today", chip: k.chip("info", "Today") }),
          k.row({ i: "wrench", t: "Luther Grant", m: "Reinstatement paid · AMAM 16 Nov", chip: k.chip("warn", "8 days, check") }),
          k.row({ i: "wrench", t: "Irene Wallace", m: "Address change · AMAM 12 Nov", chip: k.chip("warn", "12 days, check") }),
        ]) +
        k.group("Proved by a file this week · 3", [
          k.row({ i: "checkC", it: "plain", t: "Howard Kim", m: "Draft cleared · Transamerica file 21 Nov", chip: k.chip("ok", "Saved") }),
          k.row({ i: "checkC", it: "plain", t: "Ellen Price", m: "Beneficiary updated · AMAM 20 Nov", chip: k.chip("ok", "Done") }),
        ]),
    }),
  });

  S.push({
    sec: "book", id: "F3c", name: "Win-back",
    role: "retention",
    note: "Former clients worth winning back once the cooling-off has passed: when they lapsed, why, and what a new policy would cost now. Call goes through the dialer’s checks.",
    render: (k) => ({
      tab: "cases", role: "retention",
      header: k.header({ back: k.ios ? "Cases" : " ", title: "Win-back", sub: "Cooling-off passed · 26 people", large: true }),
      body:
        k.group("", [
          k.row({ i: "heart", t: "Vernon Hayes", m: "Lapsed Jun · price · TA $62 → AMAM $49", chip: k.chip("ok", "Ready") }),
          k.row({ i: "heart", t: "Gloria Watts", m: "Lapsed May · bank closed", chip: k.chip("ok", "Ready") }),
          k.row({ i: "heart", t: "Dennis Ruiz", m: "Lapsed Apr · moved to OR, not licensed", chip: k.chip("", "Can’t write") }),
          k.row({ i: "heart", t: "Opal Simms", m: "Lapsed Mar · called 2× · no answer", chip: k.chip("info", "Try in Dec") }),
        ]),
    }),
  });

  S.push({
    sec: "book", id: "F3d", name: "Open a retention case",
    note: "When a client calls you first (“I changed banks”), open a case before any carrier file says so. Pick the policy, the reason, and the case lands on the ladder.",
    role: "retention",
    render: (k) => ({
      tab: "cases", role: "retention",
      header: k.header({ title: "Cases" }),
      body: "",
      overlay: k.sheet("New case",
        '<div style="display:flex;flex-direction:column;gap:14px">' +
        k.field("Policy", "Harriet Lowe · RN-2210987 · Royal Neighbors", { lead: "search" }) +
        '<div class="mini">Reason</div><div class="outc">' + [["Changed banks", "landmark", "on"], ["Can’t afford it", "dollar"], ["Moved", "pin"], ["Wants to cancel", "x"], ["Beneficiary change", "users", "w2"]].map((o) => '<span class="' + (o[2] || "") + '">' + ic(o[1], 20) + o[0] + "</span>").join("") + "</div>" +
        k.field("What she said", "New account at Navy Federal from December", {}) +
        k.btn("Open case", "primary") + "</div>", { h: 640 }),
    }),
  });

  // ═══ 07 · Money ═════════════════════════════════════════════════════
  S.push({
    sec: "money", id: "G3b", name: "Partner payouts",
    role: "owner",
    note: "Review what each partner earned from the ledger, by their deal (per sold lead, per transfer, revenue share), and approve. Payment goes out from the agency’s bank.",
    render: (k) => ({
      tab: "money", role: "owner",
      header: k.header({ title: "Money" }),
      body: "",
      overlay: k.sheet("November partner payouts",
        '<div style="display:flex;flex-direction:column;gap:12px">' +
        '<div class="between"><span class="muted">2 partners</span><span class="big" style="font-size:26px">' + k.money("4,310") + "</span></div>" +
        '<div style="margin:0 -16px">' + k.row({ i: "handshake", t: "Apex Leads", m: "41 sold × $95 · 12 transfers × $35", r: "$4,315", chev: false }) + k.row({ i: "handshake", t: "Summit Media", m: "Clawback: 1 returned lead", r: "−$5", chip: k.chip("warn", "Returned"), chev: false }) + "</div>" +
        '<div class="mini">Each partner sees their statement in their portal when you approve.</div>' +
        k.btn("Approve $4,310.00", "primary", "check") + "</div>", { h: 470 }),
    }),
  });

  S.push({
    sec: "money", id: "G3c", name: "Vendor bill",
    role: "owner",
    note: "A lead bill checked against what actually arrived: leads delivered, returns credited, the difference said in one chip. Approve, or dispute with the returns attached.",
    render: (k) => ({
      tab: "money", role: "owner",
      header: k.header({ back: k.ios ? "Money" : " ", title: "Apex Leads · Nov 1–15", large: false }),
      body:
        '<div class="pad16 gap">' +
        '<div class="card p"><div class="between"><span class="mini">Bill</span>' + k.chip("ok", "Matches") + '</div><div class="big" style="font-size:34px;margin-top:4px">' + k.money("11,536", "00") + "</div></div>" +
        '<div class="card p">' + k.kv([["Leads billed", "412 × $28.00"], ["Leads arrived", "412"], ["Returns credited", "0"], ["Due", "Fri 27 Nov"], ["Paid with", "ACH · Truist ••4471"]]) + "</div>" +
        "</div>",
      after: bar(k, '<div class="btnrow">' + k.btn("Dispute", "outline") + k.btn("Approve", "primary", "check") + "</div>"),
    }),
  });

  S.push({
    sec: "money", id: "G3d", name: "Bank deposit",
    role: "owner",
    note: "A deposit matched to what the carrier said it paid. When it’s short, the difference becomes a pay issue with one tap; the line-by-line hunt happens on the computer.",
    render: (k) => ({
      tab: "money", role: "owner",
      header: k.header({ back: k.ios ? "Money" : " ", title: "Corebridge · 18 Nov", large: false }),
      body:
        '<div class="pad16 gap">' +
        '<div class="card p"><div class="between"><span class="mini">Landed in Truist ••4471</span>' + k.chip("warn", "$214.00 short") + '</div><div class="big" style="font-size:34px;margin-top:4px">' + k.money("14,416", "00") + '</div><div class="mini">Statement said $14,630.00</div></div>' +
        flat(k.group("Statement lines not paid in full", [k.row({ t: "George Patel", m: "Advance", r: "$128.40", chev: false }), k.row({ t: "Paul Stewart", m: "Advance", r: "$85.60", chev: false })])) +
        "</div>",
      after: bar(k, k.btn("Open a pay issue for $214.00", "primary")),
    }),
  });

  S.push({
    sec: "money", id: "G3e", name: "Profit & loss",
    role: "owner",
    note: "Did this month make money: the month against the last six, and where it went. Categories open their expenses; the accountant’s tax summaries stay on the computer.",
    render: (k) => ({
      tab: "money", role: "owner",
      header: k.header({ back: k.ios ? "Money" : " ", title: "Profit & loss", large: true, belowFull: '<div class="pad16" style="padding-bottom:10px">' + k.seg(["Month", "Quarter", "Year"], 0, true) + "</div>" }),
      body:
        '<div class="pad16"><div class="card p"><div class="mini">November so far</div><div class="big" style="font-size:36px">' + k.money("19,125") + '</div><div class="mini"><b class="gi">↑ $2,940</b> vs October at this point</div><div style="margin-top:10px">' + k.bars([11, 14, 9, 16, 17, 19], ["Jun", "Jul", "Aug", "Sep", "Oct", "Nov"], 330, 100, 5) + "</div></div></div>" +
        k.group("Where it went", [
          k.row({ i: "package", t: "Leads", m: "4 vendors", r: "$21,410" }),
          k.row({ i: "users", t: "Team pay", m: "6 people", r: "$18,240" }),
          k.row({ i: "headset", t: "Dialer and phone lines", r: "$2,880" }),
          k.row({ i: "building", t: "Office and equipment", r: "$1,605" }),
          k.row({ i: "creditCard", t: "Software", r: "$1,620" }),
        ]),
    }),
  });

  S.push({
    sec: "money", id: "G7", name: "My balance",
    note: "A producer’s share in the agency’s books: what they’re owed, what they owe back after chargebacks, and how it nets on the next pay day.",
    render: (k) => ({
      tab: null,
      header: k.header({ back: k.ios ? "Menu" : " ", title: "My balance", large: true }),
      body:
        '<div class="pad16"><div class="card p"><div class="mini">Owed to you on 5 Dec</div><div class="big" style="font-size:38px">' + k.money("6,800", "50") + "</div></div></div>" +
        k.group("How it adds up", [k.row({ t: "Your share of November commission", r: "$7,412.50", chev: false }), k.row({ t: "Chargebacks you owe back", m: "Vernon Hayes, Ida Collins", r: "−$612.00", chip: k.chip("warn", "2"), chev: false }), k.row({ t: "Advance from the agency", m: "Repaid in full", r: "$0.00", chev: false })]) +
        k.group("History", [k.row({ i: "file", it: "plain", t: "October", r: "$6,204.50" }), k.row({ i: "file", it: "plain", t: "September", r: "$6,018.00" })]),
    }),
  });

  S.push({
    sec: "money", id: "G8", name: "Pay issues",
    role: "bookkeeper",
    note: "What carriers owe the agency, by carrier, with the total to the cent (never a $0 nothing checked). Disputing each line needs the statement beside it, so the list opens on the computer.",
    render: (k) => ({
      tab: "money", role: "bookkeeper",
      header: k.header({ title: "Pay issues", sub: "Owed to you", actions: ["laptop"] }),
      body:
        '<div class="pad16"><div class="card p"><div class="big" style="font-size:36px">' + k.money("3,912", "40") + '</div><div class="mini">18 items · 4 never paid, 14 paid short</div></div></div>' +
        k.group("By carrier", [
          k.row({ i: "landmark", t: "Corebridge", m: "9 paid short", r: "$1,844.10" }),
          k.row({ i: "landmark", t: "Transamerica", m: "3 never paid", r: "$1,210.00" }),
          k.row({ i: "landmark", t: "Mutual of Omaha", m: "4 paid short", r: "$612.30" }),
          k.row({ i: "landmark", t: "Royal Neighbors", m: "2 never paid", r: "$246.00" }),
        ]),
    }),
  });

  // ═══ 09 · Team, reports & compliance ════════════════════════════════
  S.push({
    sec: "team", id: "I4b", name: "Team activity",
    role: "owner",
    note: "Today on the phones, per person: dials, contacts, talk time and applications. A setter sees only their own row (their scorecard).",
    render: (k) => ({
      tab: null, role: "owner",
      header: k.header({ back: k.ios ? "Reports" : " ", title: "Team activity", large: false, belowFull: '<div class="pad16" style="padding-bottom:10px">' + k.seg(["Today", "Week", "Month"], 0, true) + "</div>" }),
      body:
        '<div class="tiles pad16">' + k.tile("Dials", "1,284") + k.tile("Talk time", "41h 10m") + "</div>" +
        k.group("By person · talk time", [
          k.row({ av: "AK", t: "Ava Kim", m: "142 dials · 31 contacts · 4 apps", r: "6h 02m", chev: false }),
          k.row({ av: "JR", t: "Jordan Reyes", m: "131 dials · 27 contacts · 3 apps", r: "5h 41m", chev: false }),
          k.row({ av: "LP", t: "Lena Park (setter)", m: "96 dials · 21 contacts · 4 set", r: "3h 12m", chev: false }),
          k.row({ av: "TB", t: "Tom Baker", m: "48 dials · 7 contacts · 0 apps", r: "1h 05m", chev: false }),
        ]),
    }),
  });

  S.push({
    sec: "team", id: "I4c", name: "Retention scorecard",
    role: "owner",
    note: "Policies worked, contact rate and save rate, by reason and by person, in counts. The bands-came-true analysis (Retention results) stays on the computer.",
    render: (k) => ({
      tab: null, role: "owner",
      header: k.header({ back: k.ios ? "Reports" : " ", title: "Retention scorecard", large: false }),
      body:
        '<div class="tiles pad16">' + k.tile("Worked", "41") + k.tile("Saved", "23", "56% save rate") + k.tile("Reached", "33", "80% contact rate") + k.tile("Lost", "9", "3 still open") + "</div>" +
        k.group("Save rate by reason", [k.row({ t: "Draft returned", r: "64%", chev: false }), k.row({ t: "Bank closed", r: "58%", chev: false }), k.row({ t: "First payment missed", r: "41%", chev: false }), k.row({ t: "Can’t afford it", r: "22%", chev: false })]) +
        k.group("By person", [k.row({ av: "RC", t: "Rosa Cruz", r: "61%", chev: false }), k.row({ av: "DM", t: "Dev Mehta", r: "47%", chev: false })]),
    }),
  });

  S.push({
    sec: "team", id: "I4d", name: "Callbacks kept",
    note: "Callbacks booked, kept and missed, week by week. A missed callback opens its lead.",
    render: (k) => ({
      tab: null,
      header: k.header({ back: k.ios ? "Reports" : " ", title: "Callbacks kept", large: false }),
      body:
        '<div class="pad16"><div class="card p"><div class="between"><span class="mini">Kept on time · last 8 weeks</span>' + k.chip("gold", "↑ 6 pts") + '</div><div class="big" style="font-size:34px">84%</div><div style="margin-top:8px">' + k.bars([71, 74, 70, 78, 79, 80, 82, 84], ["", "", "", "", "", "", "", "This wk"], 330, 90, 7) + "</div></div></div>" +
        k.group("Missed this week · 4", [k.row({ t: "Maria Alvarez", m: "Jordan · 2 h late, still open" }), k.row({ t: "Opal Simms", m: "Tom · not called" }), k.row({ t: "Earl Johnson", m: "Sam · 1 day late" })]),
    }),
  });

  S.push({
    sec: "team", id: "I4e", name: "Partner quality",
    role: "owner",
    note: "The cost-free view of partners: sold per 100 leads, contact rate and returns. Kept separate from True CPA on purpose, so roles that must not see spend can still judge quality.",
    render: (k) => ({
      tab: null, role: "owner",
      header: k.header({ back: k.ios ? "Reports" : " ", title: "Partner quality", large: false }),
      body:
        k.group("Sold per 100 leads · November", [
          k.row({ i: "handshake", t: "Bright Path Referrals", m: "62 leads · 2 returned", r: "14.5", chip: k.chip("gold", "Best") }),
          k.row({ i: "handshake", t: "Apex Leads", m: "412 leads · 0 returned", r: "9.9" }),
          k.row({ i: "handshake", t: "Summit Media", m: "288 leads · 11 returned", r: "6.3" }),
          k.row({ i: "handshake", t: "Coastal Insure Ads", m: "140 leads · 19 returned", r: "3.6", chip: k.chip("warn", "Many returns") }),
        ]),
    }),
  });

  S.push({
    sec: "team", id: "I5b", name: "Consent proof",
    note: "Look up the consent behind any number: the form, the words they agreed to, the time and IP, the certificate, or the recording of a verbal yes (plays in the app).",
    render: (k) => ({
      tab: null,
      header: k.header({ back: k.ios ? "Menu" : " ", title: "Consent locker", large: true, below: k.search("Phone number or name") }),
      body:
        '<div class="pad16 gap">' +
        '<div class="card p"><div class="between"><div><div class="ink" style="font-weight:600;font-size:17px">Harold Nguyen</div><div class="mini">(713) 555-0144</div></div>' + k.chip("ok", "Consent on file") + '</div><div class="hr"></div>' +
        k.kv([["Given", "18 Nov 2026, 3:42 pm CT"], ["Where", "summitquotes.com/term"], ["IP", "73.14.208.91"], ["Certificate", '<span class="mono">9a1f…22c0</span>'], ["Expires", "18 Nov 2027"]]) +
        '<div class="card" style="margin-top:12px;padding:12px;background:var(--surf2);border:0;font-size:14px">“By clicking Get my quote, I agree that Ellery & Fields may call me at the number above, including by automated means…”</div></div>' +
        '<div class="card p row2"><span style="width:40px;height:40px;border-radius:50%;background:var(--green);color:var(--on-green);display:grid;place-items:center">' + ic("play", 18) + '</span><div style="flex:1"><div class="ink" style="font-weight:600">Verbal yes on the call</div><div class="mini">23 Nov · 0:41 into the call · 6 s</div></div></div>' +
        "</div>",
    }),
  });

  S.push({
    sec: "team", id: "I6b", name: "Complaint",
    role: "owner",
    note: "One complaint: the countdown, who owns it, what was said, and the log. Assign and log a reply on the phone; the evidence report is put together on the computer.",
    render: (k) => ({
      tab: null, role: "owner",
      header: k.header({ back: k.ios ? "Complaints" : " ", title: "", large: false, actions: ["moreH"] }),
      body:
        '<div class="pad16 gap">' +
        '<div><div class="disp ink" style="font-size:26px;font-weight:700">Vernon Hayes</div><div class="muted" style="font-size:14px">By email · received 20 Nov · Transamerica TA-61200442</div></div>' +
        '<div class="card p between"><div><div class="mini">Reply due</div><div class="disp ink tn" style="font-size:26px;font-weight:700">Thu 26 Nov</div><div class="mini">2 days left · state rule 5 business days</div></div>' + k.ring(60, 72, "2d") + "</div>" +
        '<div class="card p"><h4>What he said</h4><div style="margin-top:6px;font-size:15px">“I cancelled in June and you still took $62 in July.”</div></div>' +
        flat(k.group("Log", [k.row({ av: "TB", t: "Assigned to Tom Baker", m: "Dana · 20 Nov", chev: false }), k.row({ i: "phone", t: "Tom called him back", m: "21 Nov · refund asked from carrier", chev: false })])) +
        "</div>",
      after: bar(k, '<div class="btnrow">' + k.btn("Reassign", "outline", "userPlus") + k.btn("Log a reply", "primary", "note") + "</div>"),
    }),
  });

  S.push({
    sec: "team", id: "I7", name: "Licences and appointments",
    note: "Your licences and carrier appointments with their expiry dates; a push 30, 14 and 3 days before. Owners see the whole team; a photo of a renewed licence updates it.",
    render: (k) => ({
      tab: null,
      header: k.header({ back: k.ios ? "Menu" : " ", title: "Licences", large: true, actions: ["plus"] }),
      body:
        k.group("Licences", [
          k.row({ i: "badge", t: "Texas", m: "Resident · renews 9 Dec", chip: k.chip("warn", "15 days") }),
          k.row({ i: "badge", t: "Florida", m: "Non-resident · renews Aug 2027", chip: k.chip("ok", "Active") }),
          k.row({ i: "badge", t: "Georgia", m: "Non-resident · renews Mar 2027", chip: k.chip("ok", "Active") }),
        ]) +
        k.group("Appointed with", [
          k.row({ i: "landmark", t: "Mutual of Omaha", m: "14 states", chip: k.chip("ok", "Appointed") }),
          k.row({ i: "landmark", t: "Corebridge", m: "Sent 12 Nov · TX, GA", chip: k.chip("info", "Pending") }),
          k.row({ i: "landmark", t: "American Amicable", m: "22 states", chip: k.chip("ok", "Appointed") }),
        ]),
      fab: k.fab("Add", "camera"),
    }),
  });

  S.push({
    sec: "team", id: "I8", name: "Partner (agency side)",
    role: "owner",
    note: "A publisher from the agency’s side: their deal, this month’s numbers, open payouts and the chat. Contract and pricing changes on the computer.",
    render: (k) => ({
      tab: null, role: "owner",
      header: k.header({ back: k.ios ? "Partners" : " ", title: "Apex Leads", sub: "Publisher · since Feb 2026", large: true, actions: ["msg"] }),
      body:
        '<div class="tiles pad16">' + k.tile("Sent", "412") + k.tile("Sold", "41", "9.9 per 100") + k.tile("Owed", '<span class="tn">' + k.money("4,315") + "</span>", "Due 5 Dec") + k.tile("Returns", "0") + "</div>" +
        k.group("Deal", [k.row({ t: "Per sold lead", r: "$95", chev: false }), k.row({ t: "Per live transfer", r: "$35", chev: false }), k.row({ t: "Return window", r: "7 days", chev: false })]) +
        k.group("People at Apex", [k.row({ av: "MS", t: "Maya Santos", m: "Partner admin" }), k.row({ av: "DK", t: "Devon King", m: "Partner user" })]),
    }),
  });

  // ═══ 10 · Menu & settings ═══════════════════════════════════════════
  S.push({
    sec: "menu", id: "J3b", name: "Edit profile",
    note: "Name, photo (staff only have photos), phone shown to partners, and time zone, which every “your time” on the app uses.",
    render: (k) => ({
      tab: null,
      header: k.header({ back: k.ios ? "Settings" : " ", title: "Profile", large: false, actions: [k.ios ? '<span style="font-weight:600">Save</span>' : "check"] }),
      body:
        '<div class="pad16 gap" style="padding-top:10px;align-items:center"><div style="display:flex;flex-direction:column;align-items:center;gap:8px">' + k.av("JR", "lg") + '<span class="gr" style="font-weight:600;font-size:15px">Add a photo</span></div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' + k.field("First name", "Jordan") + k.field("Last name", "Reyes") + "</div>" +
        k.field("Work phone", "(904) 555-0100", { lead: "phone" }) + k.field("Time zone", "Eastern · New York", { trail: "chevD" }) + k.field("Languages", "English, Spanish", { trail: "chevD" }) + "</div>",
    }),
  });

  S.push({
    sec: "menu", id: "J3c", name: "Signed-in devices",
    note: "Every place you’re signed in, with this phone marked. Sign out a lost phone from anywhere; a lost phone also loses its trusted-device pass.",
    render: (k) => ({
      tab: null,
      header: k.header({ back: k.ios ? "Settings" : " ", title: "Signed-in devices", large: true }),
      body:
        k.group("", [
          k.row({ i: "smartphone", t: k.ios ? "iPhone 16 · this phone" : "Pixel 9 · this phone", m: "Jacksonville · now", chip: k.chip("ok", "This one"), chev: false }),
          k.row({ i: "laptop", t: "Chrome on Windows", m: "Jacksonville · 2 h ago · trusted till 24 Dec", chev: false, chip: '<span style="color:var(--bad);font-weight:600;font-size:14px">Sign out</span>' }),
          k.row({ i: "smartphone", t: "iPad", m: "Orlando · 9 days ago", chev: false, chip: '<span style="color:var(--bad);font-weight:600;font-size:14px">Sign out</span>' }),
        ]) + '<div class="pad16" style="margin-top:16px">' + k.btn("Sign out everywhere else", "outline", "logout") + "</div>",
    }),
  });

  S.push({
    sec: "menu", id: "J4", name: "Help and guides",
    note: "The web’s /app/docs on the phone: search the guides, short how-tos for the screen you came from, and contact support with the screen and app version attached.",
    render: (k) => ({
      tab: "menu",
      header: k.header({ title: "Help", below: k.search("Search the guides") }),
      body:
        k.group("For this screen · Dialer", [k.row({ i: "help", t: "Why was a call blocked?" }), k.row({ i: "help", t: "How auto-next works" }), k.row({ i: "help", t: "Reading the disclosure" })]) +
        k.group("Popular", [k.row({ i: "file", it: "plain", t: "Taking your first transfer" }), k.row({ i: "file", it: "plain", t: "Callbacks and time zones" }), k.row({ i: "file", it: "plain", t: "Filling an application with a client" })]) +
        k.group("", [k.row({ i: "msg", t: "Contact support", m: "Usually answers within an hour" })], "App 1.0 (142) · iOS 19.1"),
    }),
  });

  S.push({
    sec: "menu", id: "J5", name: "Switch workspace",
    note: "From Settings › Switch workspace. Switching reloads the tabs and menu for that role; alerts from every workspace still reach the phone, labelled with where they came from.",
    render: (k) => ({
      tab: "menu",
      header: k.header({ title: "Menu" }),
      body: "",
      overlay: k.sheet("Switch workspace",
        '<div style="margin:0 -16px">' + k.row({ i: "building", t: "Ellery & Fields", m: "Producer", cls: "sel", chip: '<span style="color:var(--green-ink)">' + ic("checkC", 20) + "</span>", chev: false }) + k.row({ i: "building", t: "Reyes Family Insurance", m: "Owner · 2 alerts", chev: false }) + k.row({ i: "handshake", t: "Apex Leads → Coastal Life Group", m: "Partner user", chev: false }) + "</div>", { h: 360 }),
    }),
  });

  // ═══ 11 · Partner app, every type ═══════════════════════════════════
  S.push({
    sec: "partner", id: "K1b", name: "Partner home · affiliate",
    role: "partner",
    note: "The same app for an affiliate or marketing partner: their links and the referrals that came through each, instead of a lead form. What a partner sees follows their partner type.",
    render: (k) => ({
      tab: "home", role: "partner",
      header: k.header({ title: "Bright Path", sub: "Affiliate · Ellery & Fields", actions: ['<span class="av sm">BP</span>'] }),
      body:
        '<div class="tiles pad16">' + k.tile("Clicks", "1,904") + k.tile("Referrals", "62", "<b>↑ 9</b> vs October") + k.tile("Sold", "9") + k.tile("Earned", '<span class="tn">' + k.money("1,125") + "</span>", "Revenue share") + "</div>" +
        k.sh("Your links") +
        k.group("", [
          k.row({ i: "link", t: "Final expense · Facebook", m: "elleryfields.com/r/bp-fe · 41 referrals", chip: '<span class="gr" style="font-weight:600;font-size:14px">Copy</span>', chev: false }),
          k.row({ i: "link", t: "Term life · newsletter", m: "elleryfields.com/r/bp-term · 21 referrals", chip: '<span class="gr" style="font-weight:600;font-size:14px">Copy</span>', chev: false }),
        ]),
    }),
  });

  S.push({
    sec: "partner", id: "K2b", name: "Live transfer",
    role: "partner",
    note: "For call-centre partners: start a warm transfer with the caller on the line. The partner sees when an agent claims it and stays on to introduce; then the call is the agency’s.",
    render: (k) => ({
      tab: "submit", role: "partner",
      header: k.header({ title: "Send a lead", belowFull: '<div class="pad16" style="padding-bottom:10px">' + k.seg(["Live transfer", "Lead only"], 0, true) + "</div>" }),
      body:
        '<div class="pad16 gap">' +
        '<div class="card p"><div class="between"><div><div class="mini">Transfer</div><div class="disp ink" style="font-size:24px;font-weight:700">Ida Collins</div><div class="mini">70 · AL · final expense</div></div><div style="text-align:right"><div class="disp ink tn" style="font-size:26px;font-weight:700">0:34</div><div class="mini">waiting</div></div></div>' +
        '<div style="display:flex;flex-direction:column;gap:10px;margin-top:14px">' +
        '<div class="row2" style="color:var(--ok)">' + ic("checkC", 18) + '<span class="ink">Sent to Ellery & Fields</span></div>' +
        '<div class="row2" style="color:var(--ok)">' + ic("checkC", 18) + '<span class="ink">Checks passed · consent proof attached</span></div>' +
        '<div class="row2" style="color:var(--faint)">' + ic("clock", 18) + "<span>Waiting for an agent to claim · 4 ready</span></div></div></div>" +
        '<div class="mini">Stay on the line. When an agent claims, introduce Ida and drop off.</div>' +
        k.btn("Cancel transfer", "outline", "x") + "</div>",
    }),
  });

  S.push({
    sec: "partner", id: "K3b", name: "Partner · a lead",
    role: "partner",
    note: "One lead a partner sent: where it is, with the agency’s outcome in the partner’s words (never internal notes), and a message thread about it. Returned leads say why.",
    render: (k) => ({
      tab: "pipeline", role: "partner",
      header: k.header({ back: k.ios ? "Pipeline" : " ", title: "Ida Collins", large: false }),
      body:
        '<div class="pad16 gap">' +
        '<div class="card p between"><div><div class="mini">Sent 20 Nov</div><div class="ink" style="font-weight:600;font-size:18px">Returned · wrong number</div><div class="mini">Not billed · within the 7-day window</div></div>' + k.chip("bad", "Returned") + "</div>" +
        '<div class="card p"><div class="timeline">' + [["Returned: wrong number", "21 Nov · agency", 0], ["Called 3 times", "20–21 Nov", 1], ["Accepted", "20 Nov 2:14 pm", 1], ["Sent by Maya Santos", "20 Nov 2:12 pm", 1]].map((e) => '<div class="ev ' + (e[2] ? "mut" : "") + '"><div class="e1">' + e[0] + '</div><div class="e2">' + e[1] + "</div></div>").join("") + "</div></div>" +
        k.btn("Message the agency about Ida", "outline", "msg") + "</div>",
    }),
  });

  S.push({
    sec: "partner", id: "K5", name: "Partner messages",
    role: "partner",
    note: "The partner’s side of partner chat: their groups with the agency, unread counts in gold. The same threads the agents see in their Inbox.",
    badges: { messages: 2 },
    render: (k) => ({
      tab: "messages", role: "partner",
      header: k.header({ title: "Messages", actions: ["pencil"] }),
      body:
        k.group("", [
          k.row({ i: "building", t: "Ellery & Fields · transfers", m: "Jordan: Got her, on the call now", chip: '<span class="badge" style="position:static">2</span>', r: "2:12" }),
          k.row({ i: "building", t: "Ellery & Fields · billing", m: "Dana: November payout approved", r: "Mon" }),
          k.row({ i: "building", t: "Ellery & Fields · quality", m: "You: Florida batch fixed", r: "Fri" }),
        ]),
    }),
  });

  S.push({
    sec: "partner", id: "K6", name: "Partner team",
    role: "partner",
    note: "A partner admin’s people: who can send leads and see the pipeline. Invite from the phone; roles are fixed (partner admin, partner user).",
    render: (k) => ({
      tab: "account", role: "partner",
      header: k.header({ back: k.ios ? "Account" : " ", title: "Team access", large: true, actions: ["userPlus"] }),
      body:
        k.group("4 people", [
          k.row({ av: "MS", t: "Maya Santos (you)", m: "Partner admin", chev: false }),
          k.row({ av: "DK", t: "Devon King", m: "Partner user · sent 120 this month" }),
          k.row({ av: "AL", t: "Amir Lane", m: "Partner user · sent 88" }),
          k.row({ av: "RP", t: "Rita Pope", m: "Invited · not joined", chip: k.chip("info", "Invited") }),
        ]),
    }),
  });

  // ═══ 12 · Phone-only extras ═════════════════════════════════════════
  S.push({
    sec: "native", id: "L5", name: "Ask Siri or Google",
    note: "The four shortcuts are App Intents (iOS) and App Actions (Android): “Serve my next lead”, “What’s my next callback?”, “Add a lead”, “Check a number”. Answers stay on the lock screen only after Face ID.",
    render: (k) => ({
      full:
        '<div style="position:absolute;inset:0;background:#0b1614"></div><div style="position:relative">' + k.status({ light: true }) + "</div>" +
        '<div style="position:absolute;left:14px;right:14px;bottom:' + (k.ios ? 40 : 30) + 'px;border-radius:' + (k.ios ? 26 : 28) + 'px;background:' + (k.ios ? "rgba(40,48,46,.94)" : "#1f2a27") + ';padding:18px;color:#fff">' +
        '<div style="font-size:15px;opacity:.7">“What’s my next callback?”</div>' +
        '<div class="row2" style="gap:10px;margin-top:14px"><span style="width:36px;height:36px;border-radius:9px;background:#0d4037;display:grid;place-items:center"><img src="isotype-on-dark.svg" width="22" height="22" alt=""></span><div><div style="font-weight:600;font-size:17px">Robert Chen at 11:30</div><div style="font-size:14px;opacity:.7">10:30 his time, Central. Wants a quote for $25,000.</div></div></div>' +
        '<div style="display:flex;gap:10px;margin-top:16px"><span style="flex:1;height:44px;border-radius:12px;background:rgba(255,255,255,.14);display:grid;place-items:center;font-weight:600">Open</span><span style="flex:1;height:44px;border-radius:12px;background:#07d6a0;color:#04251d;display:grid;place-items:center;font-weight:700">Call now</span></div></div>',
    }),
  });

  S.push({
    sec: "native", id: "L6", name: "Tablet",
    note: "The same app on an iPad or Android tablet uses two panes: the list on the left, the record on the right, like the web. Drawn here at phone scale; tablets get their own round later.",
    render: (k) => ({
      tab: null,
      header: k.header({ title: "Dialer · tablet", large: false }),
      body:
        '<div style="display:grid;grid-template-columns:130px 1fr;gap:8px;padding:0 8px">' +
        '<div class="card" style="padding:6px 0">' + ["Harold N.", "Linda O.", "Frank D.", "Ruth S.", "Kevin M.", "Earl J."].map((n, i) => '<div style="padding:9px 10px;font-size:13px;' + (i ? "" : "background:var(--green-soft);color:var(--green-ink);font-weight:600") + '">' + n + "</div>").join("") + "</div>" +
        '<div class="card p"><div class="disp ink" style="font-size:18px;font-weight:700">Harold Nguyen</div><div class="mini">64 · TX · term</div><div class="ticks" style="margin-top:8px">' + ["Consent", "DNC", "Window"].map((t) => '<span class="chip ok" style="height:22px;font-size:11px">' + t + "</span>").join("") + '</div><div style="margin-top:10px">' + k.btn("Call", "primary", "phone", "sm") + "</div></div></div>",
    }),
  });

  // ═══ 13 · States ════════════════════════════════════════════════════
  S.push({
    sec: "states", id: "M6", name: "Account paused",
    note: "When the agency’s account is paused or suspended, the book stays readable and every write is off, with the reason and who can fix it. Buttons that write are visible but disabled.",
    render: (k) => ({
      tab: "home",
      header: k.header({ title: "Today", actions: ['<span class="chip" style="height:26px">' + ic("lock", 14) + "Read only</span>"] }),
      body:
        '<div class="empty" style="padding-top:40px"><span class="ei">' + ic("lock", 30) + '</span><h4>Your agency’s account is paused</h4><p>The last payment didn’t go through. Dana Ellery can fix it on the web. You can still read your leads, policies and pay.</p></div>' +
        '<div class="pad16" style="margin-top:20px;opacity:.5;pointer-events:none">' + k.btn("Start calling", "gold", "phoneOut") + "</div>",
    }),
  });

  S.push({
    sec: "states", id: "M7", name: "Locked after a pause",
    note: "After 5 minutes in the background (agency can shorten it), the app locks behind Face ID / fingerprint. The app switcher shows a plain cover, never client data.",
    render: (k) => ({
      full:
        '<div style="position:absolute;inset:0;background:#0b1614;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;color:#fff">' +
        '<div style="width:80px;height:80px;border-radius:20px;background:#0d4037;display:grid;place-items:center"><img src="isotype-on-dark.svg" width="52" height="52" alt=""></div>' +
        '<div style="font-family:Inter Tight;font-size:24px;font-weight:600">Insurvas is locked</div>' +
        '<span style="width:70px;height:70px;border-radius:50%;background:rgba(7,214,160,.14);color:#07d6a0;display:grid;place-items:center;margin-top:10px">' + ic(k.ios ? "face" : "finger", 38) + "</span>" +
        '<div style="opacity:.7;font-size:15px">' + (k.ios ? "Look at your phone to unlock" : "Touch the sensor to unlock") + '</div><div style="color:#4fe3bb;font-weight:600;margin-top:30px">Use password</div></div>',
    }),
  });

  S.push({
    sec: "states", id: "M8", name: "Update needed",
    note: "When the API changes in a way an old app can’t handle, the app asks for an update instead of breaking. Small changes ship over the air (Expo updates) without this screen.",
    render: (k) => ({
      tab: null,
      body: '<div class="empty" style="padding-top:150px"><span class="ei">' + ic("download", 30) + '</span><h4>Update Insurvas to keep going</h4><p>This version can’t talk to the latest Insurvas. The update takes about a minute; nothing you saved is lost.</p><div style="width:240px;margin-top:14px">' + k.btn(k.ios ? "Open the App Store" : "Open Google Play", "primary") + "</div></div>",
    }),
  });

  // ═══ Scope map: every web page and what it becomes on the phone ════
  window.SCOPE = [
    { g: "Home" },
    ["Dashboard", "full", "A home for each role: producer, owner, manager, setter, assistant, bookkeeper, retention (B1–B8)."],
    ["Get set up", "lite", "Phone steps done here, the rest sent to the computer (B9)."],
    ["Agency dashboard", "full", "The owner’s Home and Team tabs (B2, I1)."],
    ["Producers", "lite", "Team list and the producer page (I1, I2); invites and pay plans on the computer."],
    ["Compare", "desk", "Side-by-side periods and people need width."],
    { g: "Today" },
    ["Inbound (incoming calls)", "full", "Availability, waiting callers, details, claim, the four call steps, handoffs (C1–C6, C1b, C4b)."],
    ["Inbound team", "full", "Who is taking calls and who’s next (C1c); the order is set on the computer."],
    ["Dialer", "full", "Serve, checks, disclosure, script, outcomes, filters, blocked (C7–C10, C7b–C7e)."],
    ["Callbacks", "full", "Overdue first, both time zones, complete / reschedule (C9, C11, C12)."],
    ["Calendar", "full", "Month and day, appointment with directions (C13, C13b)."],
    ["Appointments & setters", "full", "Book an appointment, setter home (B3, C8b)."],
    { g: "Leads" },
    ["Lead workspace (board)", "full", "List or board per pipeline, filters, add lead (D1, D2, D7, D8)."],
    ["Lead page", "full", "Path, all six tabs, actions, move, hand off (D3–D6, D3b–D3d, D5b)."],
    ["Duplicate check", "lite", "Same-person check on the phone (D9); full history merge on the computer."],
    ["Vendors & campaigns", "lite", "A vendor’s real cost and results (D10); buying and setup on the computer."],
    ["List import", "desk", "Column mapping and bulk review need the file beside the grid."],
    ["Lead flow / sources / lists", "desk", "Campaign setup and routing rules."],
    ["Lead routing", "desk", "Rules and capacities for a whole team."],
    ["Lead recycling", "lite", "A lead’s own nurture: pause or end (D3c); building rules on the computer."],
    { g: "Sales" },
    ["Applications", "full", "List, one question a screen, all steps, protected bank, draft date, sign (E0, E2–E4, E2b, E2c)."],
    ["Pending cases", "full", "Needs you / at carrier / issued, case, scan and send documents (E5, E6, E6b)."],
    ["Quotes", "full", "Kitchen-table quoting (E1)."],
    ["Draft dates", "full", "Inside the application (E3)."],
    ["Daily deal flow", "full", "Today’s deals (E7)."],
    ["Application review", "desk", "Sampled QA against the checks, side by side."],
    { g: "Book of business" },
    ["Policies", "full", "Search and the policy page (F1, F2)."],
    ["Commission ledger", "lite", "A policy’s posted lines and split (F2b); posting on the computer."],
    ["Carrier files", "desk", "File uploads, layouts and row-level review."],
    ["Rate card", "desk", "Contract levels per carrier."],
    { g: "Carrier sync" },
    ["Needs you", "lite", "One-tap “which client?” decisions (F6); money mismatches on the computer."],
    ["Carrier terms · Card moves · Agent codes · Files in", "desk", "Setup."],
    ["Lapse risk", "lite", "Folded into Retention cases."],
    { g: "Retention" },
    ["Cases", "full", "Ladder, case, log attempt, open a case (F3–F5, F3d)."],
    ["Waiting on the carrier", "full", "Open until the next file proves it (F3b)."],
    ["Win-back", "full", "Ready to win back, call through the dialer (F3c)."],
    { g: "Commissions" },
    ["My pay", "full", "Earned, came back, statements (G1, G2)."],
    ["Team payouts", "lite", "Review and approve (G4); pay plans on the computer."],
    ["Partner payouts", "lite", "Review and approve (G3b)."],
    ["Pay issues", "lite", "Owed to you, by carrier (G8); disputing lines on the computer."],
    ["Statements · Who gets the credit · Producer pay · Commission splits", "desk", "Matching statements to policies is wide, careful work."],
    { g: "Accounting" },
    ["To do", "lite", "Approvals on the owner’s and bookkeeper’s phones (G3, B6)."],
    ["Expenses", "full", "Snap a receipt, add expense (G5, G6)."],
    ["Vendor bills", "lite", "Check against delivered leads, approve or dispute (G3c)."],
    ["Bank deposits", "lite", "Matched or short, open a pay issue (G3d)."],
    ["Profit & loss", "lite", "Month, trend, where it went (G3e)."],
    ["My balance", "full", "A producer’s share and what came back (G7)."],
    ["Vendor returns · Producer splits · Tax summaries", "desk", "Evidence and accountant work."],
    { g: "Partners" },
    ["Partner chat", "full", "Inbox › Messages and threads (H2, H3)."],
    ["Publishers", "lite", "A partner’s deal, numbers and people (I8); contracts on the computer."],
    { g: "Compliance" },
    ["TCPA / DNC", "full", "Check a number (I5)."],
    ["Consent locker", "full", "Consent proof, words, certificate, recording (I5b)."],
    ["Complaints", "full", "Countdown list, complaint, assign, log a reply (I6, I6b)."],
    ["Carrier appointments", "full", "Licences and appointments with expiry pushes (I7)."],
    ["Overview · Deletion requests · Evidence report", "desk", "Legal paperwork and certificates."],
    { g: "Reports" },
    ["Sales performance · Team activity · Retention scorecard · Callbacks kept · Partner quality", "lite", "One report a screen (I3, I4, I4b–I4e)."],
    ["Book scorecards · Producer scorecards", "lite", "As cards (I3) and on the producer page (I2)."],
    ["True CPA · Lead sources · Queue scoring · Retention results · Hierarchy", "desk", "Wide tables and cost breakdowns."],
    { g: "Settings" },
    ["Profile · Notifications · Security · Devices · Availability · Workspace", "full", "Settings on the phone (J3, J3b, J3c, J5, H4)."],
    ["Help and guides", "full", "Guides for the screen you’re on, contact support (J4)."],
    ["Pipelines · Products · Carriers · Field maps · Form templates · Disclosures · Team & roles", "desk", "Agency setup."],
    ["Plan & billing", "desk", "Kept off the phone on purpose (store purchase rules, A0, M4)."],
    { g: "Partner portal" },
    ["Overview (by partner type)", "full", "Lead partners and affiliates each get their own home (K1, K1b)."],
    ["Submit a lead · Live transfer", "full", "Form with consent proof, warm transfer (K2, K2b)."],
    ["Pipeline · Lead", "full", "Where each lead is, returned reasons (K3, K3b)."],
    ["Messages · Payouts · Team access", "full", "K4, K5, K6."],
    ["Team review · Partner settings", "lite", "Read and small edits."],
    { g: "Only on the phone" },
    ["Push alerts", "new", "Transfers ring; callbacks, case changes, at-risk policies, chat, licence expiry (A3, C2, H4)."],
    ["Biometrics and app lock", "new", "Face ID / fingerprint sign-in, protected fields, lock after a pause (A4, E2c, M7)."],
    ["Live Activity / ongoing call notification", "new", "Timer and outcome while on a call (L2)."],
    ["Widgets, icon shortcuts, Siri and Google", "new", "L1, L3, L5."],
    ["Camera, scanner and signature", "new", "Receipts, case documents, licences, sign on the glass (G5, E6b, I7, E4)."],
    ["Maps", "new", "Directions to in-person appointments (C13b)."],
    ["Offline saving", "new", "Notes, outcomes and application answers wait and send (L4)."],
    { g: "Admin console (Insurvas staff)" },
    ["Every admin page", "desk", "Not in the customer app."],
  ];
})();
