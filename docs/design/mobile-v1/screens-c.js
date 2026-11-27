/* Screens, part C: Book & retention, Money, and the Inbox (alerts, partner chat, notification settings). */
(function () {
  "use strict";
  const S = window.SCREENS;
  const ic = window.MK.ic;
  const bottomBar = (k, inner) => '<div style="position:absolute;left:0;right:0;bottom:0;padding:12px 16px 34px;background:var(--bar);backdrop-filter:blur(20px);border-top:.5px solid var(--line);z-index:20;display:flex;gap:10px;flex-direction:column">' + inner + "</div>";

  // ═══ 06 · Book & retention ══════════════════════════════════════════
  S.push({
    sec: "book", id: "F1", name: "Policies",
    role: "bookkeeper",
    note: "The book, searchable by name, policy number or phone. Shown on the bookkeeper’s Book tab; producers reach it from Menu and see their own book. No client contact detail for bookkeepers.",
    render: (k) => ({
      tab: "book", role: "bookkeeper",
      header: k.header({ title: "Book", actions: ["sliders"], below: k.search("Name, policy number or phone"), belowFull: k.fchips([{ t: "In force", n: "2,814", on: true }, { t: "Pending", n: 61 }, { t: "Lapsed", n: 133 }, { t: "Charged back", n: 22 }]) + '<div style="height:10px"></div>' }),
      body:
        k.group("", [
          k.row({ i: "book", it: "plain", t: "Maria Alvarez", m: '<span class="mono">0119990312</span> · American Amicable · $41.20/mo', chip: k.chip("ok", "In force") }),
          k.row({ i: "book", it: "plain", t: "Dolores King", m: '<span class="mono">MO-88120455</span> · Mutual of Omaha · $55.70', chip: k.chip("ok", "In force") }),
          k.row({ i: "book", it: "plain", t: "Ruth Alva", m: '<span class="mono">MO-87004213</span> · Mutual of Omaha · $38.90', chip: k.chip("warn", "Payment missed") }),
          k.row({ i: "book", it: "plain", t: "Frank Delgado", m: '<span class="mono">CB-4470031</span> · Corebridge · $96.15', chip: k.chip("info", "Pending issue") }),
          k.row({ i: "book", it: "plain", t: "Harriet Lowe", m: '<span class="mono">RN-2210987</span> · Royal Neighbors · $44.00', chip: k.chip("ok", "In force") }),
          k.row({ i: "book", it: "plain", t: "Vernon Hayes", m: '<span class="mono">TA-61200442</span> · Transamerica · $62.10', chip: k.chip("bad", "Lapsed") }),
          k.row({ i: "book", it: "plain", t: "Ellen Price", m: '<span class="mono">0119991877</span> · American Amicable · $49.95', chip: k.chip("ok", "In force") }),
        ]),
    }),
  });

  S.push({
    sec: "book", id: "F2", name: "Policy",
    note: "Web policy page round 6: the client as the title, the figure strip, where each fact came from (tap ⓘ), and Open the case. Contact goes through the dialer.",
    render: (k) => ({
      tab: null,
      header: k.header({ back: k.ios ? "Book" : " ", title: "", large: false, actions: ["moreH"] }),
      body:
        '<div class="pad16 gap">' +
        '<div><div class="between"><div class="disp ink" style="font-size:28px;font-weight:700">Maria Alvarez</div>' + k.chip("ok", "In force") + '</div><div class="muted" style="font-size:14px">American Amicable · Senior Choice · <span class="mono">0119990312</span></div></div>' +
        '<div class="tiles">' + k.tile("Monthly", '<span class="tn">' + k.money("41", "20") + "</span>") + k.tile("Coverage", '<span class="tn">' + k.money("10,000") + "</span>") + k.tile("Issued", '<span class="tn" style="font-size:22px">2 Mar 2026</span>', "Month 9 of 12 chargeback window") + k.tile("Next draft", '<span class="tn" style="font-size:22px">3 Dec</span>', "Last 3 drafts cleared") + "</div>" +
        '<div class="card p"><h4>Policy</h4><div style="margin-top:8px">' + k.kv([["Writing agent", "Jordan Reyes"], ["Beneficiary", "Luis Alvarez · son"], ["Draft day", "3rd of the month"], ["Status from", '<span class="row2" style="justify-content:flex-end;gap:6px">AMAM file · 14 Nov ' + ic("alert", 14) + "</span>"]]) + "</div></div>" +
        '<div class="card p"><h4>Commission</h4><div style="margin-top:8px">' + k.kv([["Advance paid", "$370.80 · Mar"], ["Earned so far", "$278.10"], ["At risk if it lapses", "$92.70"]]) + "</div></div>" +
        '<div class="btnrow">' + k.btn("Call Maria", "primary", "phone") + k.btn("Open the case", "outline", "fileCheck") + "</div>" +
        "</div>",
    }),
  });

  S.push({
    sec: "book", id: "F3", name: "Retention cases",
    role: "retention",
    note: "The ladder from the carrier files, never a prediction: payment problem → pending lapse → reinstatable → lost. Counts on top, then cases grouped by how soon they’re lost. Paperwork sits beside the ladder.",
    badges: { cases: 9, inbox: 2 },
    render: (k) => ({
      tab: "cases", role: "retention",
      header: k.header({ title: "Cases", sub: "From carrier files · last file 6:02 am", actions: ["search", "sliders"] }),
      body:
        '<div class="strip">' +
        k.tile("Payment problem", "14", "Save before pending lapse") + k.tile("Pending lapse", "9", k.chip("warn", "3 this week")) + k.tile("Reinstatable", "6", "Win back with one payment") + k.tile("Paperwork", "4", "Address, bank, beneficiary") +
        "</div>" +
        k.group('<span style="color:var(--warn);font-weight:600">Lost this week unless worked · 3</span>', [
          k.row({ i: "buoy", it: "w", t: "Ruth Alva", m: "Mutual of Omaha · 2 drafts returned", chip: k.chip("warn", "2 days left") }),
          k.row({ i: "buoy", it: "w", t: "Calvin Reed", m: "Corebridge · pending lapse notice", chip: k.chip("warn", "4 days left") }),
          k.row({ i: "buoy", it: "w", t: "Irene Wallace", m: "AMAM · bank account closed", chip: k.chip("warn", "6 days left") }),
        ]) +
        k.group("This month · 11", [
          k.row({ i: "buoy", t: "Howard Kim", m: "Transamerica · first payment missed", chip: k.chip("info", "Called 1×") }),
          k.row({ i: "buoy", t: "Mae Thompson", m: "Royal Neighbors · draft returned", chip: k.chip("info", "Waiting on carrier") }),
          k.row({ i: "buoy", t: "Luther Grant", m: "AMAM · reinstatable until 30 Dec", chip: k.chip("", "Not started") }),
        ]),
    }),
  });

  S.push({
    sec: "book", id: "F4", name: "Retention case",
    note: "One case on the ladder: where it stands, the real deadline (never clamped to today), what the carrier file said, and the steps for this reason. Call is the dialer; a change sent to the carrier waits until the next file proves it.",
    render: (k) => ({
      tab: null,
      header: k.header({ back: k.ios ? "Cases" : " ", title: "Ruth Alva", large: false, actions: ["moreH"] }),
      body:
        '<div class="pad16 gap">' +
        '<div><div class="disp ink" style="font-size:26px;font-weight:700">Ruth Alva</div><div class="muted" style="font-size:14px">Mutual of Omaha · Living Promise · <span class="mono">MO-87004213</span> · $38.90/mo</div></div>' +
        k.path(["Payment problem", "Pending lapse", "Reinstatable", "Lost"], 1).replace('class="path"', 'class="path" style="padding:0"') +
        '<div class="card p between"><div><div class="mini">Lost on</div><div class="disp ink tn" style="font-size:26px;font-weight:700">Thu 26 Nov</div><div class="mini">2 days left · grace ends at the carrier</div></div>' + k.ring(80, 72, "2d") + "</div>" +
        '<div class="card p"><h4>What the carrier file said</h4><div style="margin-top:8px;font-size:15px" class="ink">“DRAFT RTN NSF 11/02, 11/16 — PENDING LAPSE”</div><div class="mini" style="margin-top:4px">Mutual of Omaha policy file · 18 Nov · row 1,204</div></div>' +
        '<div class="card p"><h4>Steps</h4><div style="display:flex;flex-direction:column;gap:10px;margin-top:10px;font-size:15px">' +
        [["Call Ruth and find a draft date that clears", 1, "Called 23 Nov · no answer"], ["Take a new bank or a new date", 0, ""], ["Send the change to Mutual of Omaha", 0, "Their service line or the agent portal"], ["Wait for the next file to show it paid", 0, ""]].map((r) => '<div class="row2" style="align-items:flex-start"><span style="color:' + (r[1] ? "var(--ok)" : "var(--faint)") + '">' + ic(r[1] ? "checkC" : "clock", 18) + '</span><div><div class="' + (r[1] ? "ink" : "") + '">' + r[0] + "</div>" + (r[2] ? '<div class="mini">' + r[2] + "</div>" : "") + "</div></div>").join("") +
        "</div></div>" +
        "</div>",
      after: bottomBar(k, '<div class="btnrow">' + k.btn("Log attempt", "outline", "note") + k.btn("Call Ruth", "primary", "phone") + "</div>"),
    }),
  });

  S.push({
    sec: "book", id: "F5", name: "Log an attempt",
    note: "Edit surface from F4. One outcome, an optional note, and when to try next (the case moves to that day in the list).",
    render: (k) => ({
      tab: null,
      header: k.header({ back: k.ios ? "Cases" : " ", title: "Ruth Alva", large: false }),
      body: "",
      overlay: k.sheet("Log an attempt",
        '<div style="display:flex;flex-direction:column;gap:14px">' +
        '<div class="outc">' + [["Reached her", "checkC", "on"], ["No answer", "phoneOff"], ["Left voicemail", "mic"], ["Wrong number", "ban"], ["She’ll call the carrier", "phoneOut", "w2"]].map((o) => '<span class="' + (o[2] || "") + '">' + ic(o[1], 20) + o[0] + "</span>").join("") + "</div>" +
        k.field("What changed", "New bank: Navy Federal, draft on the 5th. She’ll call MoO today too.", {}) +
        k.field("Try again", "Wed 25 Nov · 10:00 am her time", { trail: "calendar" }) +
        '<div class="between"><span class="ink">Mark “Send the change” as done</span>' + k.sw(true) + "</div>" +
        k.btn("Save attempt", "primary") + "</div>", { h: 600 }),
    }),
  });

  S.push({
    sec: "book", id: "F6", name: "Carrier sync · needs you",
    role: "bookkeeper",
    note: "The carrier files leave a few decisions to a person. The ones a phone can settle in one tap (which client is this?) are cards; money that doesn’t match opens on the computer.",
    render: (k) => ({
      tab: null, role: "bookkeeper",
      header: k.header({ back: k.ios ? "Menu" : " ", title: "Needs you", sub: "6 decisions from carrier files", large: true }),
      body:
        '<div class="pad16 gap">' +
        '<div class="card p"><div class="between"><span class="mini">1 of 4 · Which client is this?</span>' + k.chip("info", "AMAM file") + '</div>' +
        '<div class="ink" style="font-size:17px;font-weight:600;margin-top:8px">“PATEL, G  DOB 07/02/1961  POL 0119993301”</div><div class="mini">American Amicable policy file · 22 Nov · row 88</div>' +
        '<div style="display:flex;flex-direction:column;gap:8px;margin-top:12px">' +
        '<div class="card" style="padding:12px 14px;border-color:var(--green);background:var(--green-soft)"><div class="ink" style="font-weight:600">George Patel</div><div class="mini">Born 2 Jul 1961 · lead in Applied · Jordan Reyes</div></div>' +
        '<div class="card" style="padding:12px 14px"><div class="ink" style="font-weight:600">Gita Patel</div><div class="mini">Born 7 Feb 1961 · policy 0119990088 · Ava Kim</div></div>' +
        '<div class="card" style="padding:12px 14px"><div class="ink" style="font-weight:600">Neither · a sale no carrier had</div><div class="mini">Opens a new policy from this row</div></div>' +
        "</div>" +
        '<div class="btnrow" style="margin-top:12px">' + k.btn("Skip", "outline", null, "sm") + k.btn("Link to George", "primary", null, "sm") + "</div></div>" +
        k.group("On the computer", [
          k.row({ i: "laptop", it: "plain", t: "Paid short · $214.00", m: "Corebridge statement · 3 policies" }),
          k.row({ i: "laptop", it: "plain", t: "Never paid · $96.15", m: "Transamerica · CB window" }),
        ], "Money that doesn’t match needs the statement beside it.") +
        "</div>",
    }),
  });

  // ═══ 07 · Money ═════════════════════════════════════════════════════
  S.push({
    sec: "money", id: "G1", name: "My pay",
    note: "A producer’s pay: what they earned this month, what came back, and every statement. Never blended with the agency’s money. Rises are gold, a chargeback is said in its chip.",
    badges: { calls: 2, inbox: 4 },
    render: (k) => ({
      tab: null,
      header: k.header({ back: k.ios ? "Menu" : " ", title: "My pay", sub: "November · paid on the 5th", large: true, actions: ["download"] }),
      body:
        '<div class="pad16"><div class="card p"><div class="mini">Expected for November</div><div class="big" style="font-size:40px;margin-top:2px">' + k.money("7,412", "50") + '</div><div class="d mini" style="margin-top:4px"><b class="gi">↑ $1,208.00</b> vs October</div>' +
        '<div style="margin-top:12px">' + k.bars([4.1, 5.2, 4.8, 6.0, 6.2, 7.4], ["Jun", "Jul", "Aug", "Sep", "Oct", "Nov"], 330, 110, 5) + "</div></div></div>" +
        k.group("This month", [
          k.row({ i: "trend", t: "Advances", m: "11 policies issued", r: "$6,904.00", chev: false }),
          k.row({ i: "receipt", t: "As earned", m: "Renewals and months 10–12", r: "$1,120.50", chev: false }),
          k.row({ i: "undo", it: "w", t: "Chargebacks", m: "2 policies lapsed in month 4", r: "−$612.00", chip: k.chip("warn", "2 lapsed"), chev: false }),
          k.row({ i: "wallet", t: "Agency override", m: "Kept by Ellery & Fields", r: "Not shown", chev: false }),
        ]) +
        k.group("Statements", [
          k.row({ i: "file", it: "plain", t: "October 2026", m: "Paid 5 Nov", r: "$6,204.50" }),
          k.row({ i: "file", it: "plain", t: "September 2026", m: "Paid 5 Oct", r: "$6,018.00" }),
          k.row({ i: "file", it: "plain", t: "August 2026", m: "Paid 5 Sep", r: "$4,820.25" }),
        ]),
    }),
  });

  S.push({
    sec: "money", id: "G2", name: "Pay statement",
    note: "One month, line by line: one line per policy, plain figures, colour only in the chip. Shareable as the private PDF the web already makes.",
    render: (k) => ({
      tab: null,
      header: k.header({ back: k.ios ? "My pay" : " ", title: "October 2026", large: false, actions: ["download"] }),
      body:
        '<div class="pad16"><div class="tiles">' + k.tile("Paid", '<span class="tn">' + k.money("6,204", "50") + "</span>", "5 Nov · direct deposit") + k.tile("Policies", "14", "1 charged back") + "</div></div>" +
        k.group("Advances", [
          k.row({ t: "Dolores King", m: "Mutual of Omaha · 9 mo advance", r: "$501.30", chev: false }),
          k.row({ t: "Earl Johnson", m: "AMAM · 9 mo advance", r: "$446.40", chev: false }),
          k.row({ t: "Nora Bell", m: "Transamerica · 9 mo advance", r: "$606.24", chev: false }),
          k.row({ t: "+ 8 more", m: "", r: "$4,190.06", chev: true }),
        ]) +
        k.group("Back to the carrier", [
          k.row({ t: "Vernon Hayes", m: "Transamerica · lapsed in month 4", r: "−$372.60", chip: k.chip("bad", "Charged back"), chev: false }),
        ]) +
        k.group("As earned", [k.row({ t: "Renewals", m: "31 policies", r: "$831.10", chev: false })]),
    }),
  });

  S.push({
    sec: "money", id: "G3", name: "Money · owner",
    role: "owner",
    note: "The owner’s Money tab: what waits on them first (approve, pay), then the month: deposits matched to what carriers said, and profit. Reconciling and tax stay on the computer.",
    badges: { inbox: "!6", money: 4 },
    render: (k) => ({
      tab: "money", role: "owner",
      header: k.header({ title: "Money", sub: "November so far", actions: ["calendar"] }),
      body:
        k.group("Waiting on you · 4", [
          k.row({ i: "users", it: "g", t: "Team payouts · November", m: "6 people · statements ready", r: "$18,240" }),
          k.row({ i: "handshake", it: "g", t: "Partner payouts", m: "Apex Leads, Summit Media", r: "$4,310" }),
          k.row({ i: "receipt", t: "Vendor bill · Apex Leads", m: "Matches 412 leads delivered", r: "$11,536" }),
          k.row({ i: "creditCard", t: "Expense · Dialer seats", m: "Added by Sam (bookkeeper)", r: "$640" }),
        ]) +
        '<div class="sh"><span>November</span><a>Profit & loss</a></div>' +
        '<div class="pad16"><div class="card p">' +
        k.kv([["Commission received", "$64,880"], ["Lead spend", "−$21,410"], ["Team pay", "−$18,240"], ["Other expenses", "−$6,105"]]) +
        '<div class="hr"></div><div class="between"><span class="ink" style="font-weight:600">Profit so far</span><span class="big" style="font-size:26px">' + k.money("19,125") + "</span></div>" +
        '<div class="mini" style="margin-top:4px"><b class="gi">↑ $2,940</b> vs October at this point</div></div></div>' +
        k.group("Bank deposits", [
          k.row({ i: "landmark", t: "Mutual of Omaha", m: "20 Nov · matches statement", r: "$22,418", chip: k.chip("ok", "Matched") }),
          k.row({ i: "landmark", t: "Corebridge", m: "18 Nov · statement says $14,630", r: "$14,416", chip: k.chip("warn", "$214 short") }),
        ]),
    }),
  });

  S.push({
    sec: "money", id: "G4", name: "Approve team payouts",
    role: "owner",
    note: "Approving is reviewed in a sheet: who gets what, by their pay plan. The sheet names what happens; the payout is then sent by the agency’s own bank or payroll, as on the web.",
    render: (k) => ({
      tab: "money", role: "owner",
      header: k.header({ title: "Money" }),
      body: "",
      overlay: k.sheet("November team payouts",
        '<div style="display:flex;flex-direction:column;gap:12px">' +
        '<div class="between"><span class="muted">6 people · by each pay plan</span><span class="big" style="font-size:26px">' + k.money("18,240") + "</span></div>" +
        '<div style="margin:0 -16px">' +
        [["AK", "Ava Kim", "80% of advance · 14 policies", "$4,920.00"], ["JR", "Jordan Reyes", "75% of advance · 11 policies", "$4,140.00"], ["MO", "Marcus Ortiz", "75% · 9 policies", "$3,610.00"], ["SL", "Sam Lee", "70% · 7 policies", "$2,830.00"], ["LN", "Lena Park", "Setter · 25 appointments", "$1,500.00"], ["TB", "Tom Baker", "70% · 1 chargeback", "$1,240.00"]].map((r) => k.row({ av: r[0], t: r[1], m: r[2], r: r[3], chev: false })).join("") +
        "</div>" +
        '<div class="mini">Each person gets a private statement when you approve. Payment itself goes out from your payroll or bank.</div>' +
        k.btn("Approve $18,240.00", "primary", "check") + "</div>", { h: 720 }),
    }),
  });

  S.push({
    sec: "money", id: "G5", name: "Snap a receipt",
    note: "New for mobile. Expenses › Add opens the camera with the edge found for you. The photo is read for vendor, date and amount, then the form opens filled (G6).",
    render: (k) => ({
      full:
        '<div class="cam"></div>' + '<div style="position:relative;z-index:3">' + k.status({ light: true }) + "</div>" +
        '<div class="cam" style="background:transparent;z-index:3"><div class="tip">Fit the receipt in the frame</div>' +
        '<div class="doc"><b style="font-size:15px">STAPLES</b><br>Store 1142 · Savannah GA<br>11/23/2026 4:12 PM<br><br>HEADSET USB MONO ×2 ......... 79.98<br>TONER 26A ..................... 64.99<br><br>SUBTOTAL ...................... 144.97<br>TAX ............................ 10.15<br><b>TOTAL ......................... 155.12</b><br><br>VISA ****4471</div>' +
        '<div class="frame"></div><span class="lowr">Cancel</span><div class="shut"><i></i></div><span class="lowr2">Auto</span></div>',
    }),
  });

  S.push({
    sec: "money", id: "G6", name: "Add expense",
    note: "The receipt read back: amount, vendor and date filled, category suggested from earlier expenses. The photo stays attached to the expense for the tax summary.",
    role: "owner",
    render: (k) => ({
      tab: "money", role: "owner",
      header: k.header({ title: "Money" }),
      body: "",
      overlay: k.sheet("New expense",
        '<div style="display:flex;flex-direction:column;gap:14px">' +
        '<div class="row2"><div style="width:64px;height:84px;border-radius:8px;background:#e9ece6;flex:none"></div><div><div class="ink" style="font-weight:600">Receipt read</div><div class="mini">Staples · 23 Nov · $155.12</div><div class="gr" style="font-weight:600;font-size:14px;margin-top:4px">Retake</div></div></div>' +
        k.field("Amount", "$155.12") +
        k.field("Paid to", "Staples") +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' + k.field("Date", "23 Nov 2026", { trail: "calendar" }) + k.field("Paid with", "Visa ••4471", { trail: "chevD" }) + "</div>" +
        k.field("Category", "Office & equipment", { trail: "chevD", hint: "You used this for Staples last time." }) +
        k.btn("Save expense", "primary") + "</div>", { h: 700 }),
    }),
  });

  // ═══ 08 · Inbox & chat ══════════════════════════════════════════════
  S.push({
    sec: "inbox", id: "H1", name: "Inbox · alerts",
    note: "The bell, full screen. Anything a page wanted to say lands here, never on the page (owner rule). Unread is a gold dot; swipe to mark read or snooze. Each alert opens exactly the filtered place it is about.",
    badges: { calls: 2, inbox: 4 },
    render: (k) => ({
      tab: "inbox",
      header: k.header({ title: "Inbox", actions: [k.ios ? '<span style="font-size:17px">Read all</span>' : "listCheck", "settings"],
        belowFull: '<div class="pad16" style="padding-bottom:10px">' + (k.ios ? k.seg(["Alerts 4", "Messages 3"], 0) : "") + "</div>" + (k.ios ? "" : k.utabs(['Alerts <span class="n">4</span>', 'Messages <span class="n">3</span>'], 0)) }),
      body:
        '<div style="height:' + (k.ios ? 0 : 6) + 'px"></div>' +
        k.group("Today", [
          k.row({ lead: '<span style="width:8px;height:8px;border-radius:50%;background:var(--gold);flex:none;margin-left:-4px"></span>', i: null, t: "Frank Delgado was approved", m: "Corebridge · $96.15/mo · 9:12 am", chev: true }),
          k.row({ lead: '<span style="width:8px;height:8px;border-radius:50%;background:var(--gold);flex:none;margin-left:-4px"></span>', t: "Ruth Alva: 2 days to save", m: "Pending lapse · Mutual of Omaha · 6:02 am" }),
          k.row({ lead: '<span style="width:8px;height:8px;border-radius:50%;background:var(--gold);flex:none;margin-left:-4px"></span>', t: "You missed a transfer", m: "Gloria Fuentes · taken by Ava · 8:48 am" }),
          k.row({ lead: '<span style="width:8px;height:8px;border-radius:50%;background:var(--gold);flex:none;margin-left:-4px"></span>', t: "Corebridge needs doctor’s records", m: "George Patel · day 5 of 30" }),
        ]) +
        '<div class="grp-t">Yesterday</div>' +
        '<div style="position:relative;overflow:hidden;' + (k.ios ? "margin:0 16px;border-radius:14px;border:1px solid var(--line)" : "") + '"><div style="position:absolute;inset:0;display:flex;justify-content:flex-end"><span style="width:84px;background:var(--info);color:#fff;display:grid;place-items:center;font-size:13px;font-weight:600">Snooze</span><span style="width:84px;background:var(--green);color:var(--on-green);display:grid;place-items:center;font-size:13px;font-weight:600">Read</span></div>' +
        '<div style="position:relative;transform:translateX(-168px);background:var(--surf)">' + k.row({ t: "Statements from Corebridge are late", m: "Expected 20 Nov · nothing since 20 Oct" }) + "</div></div>" +
        k.group("", [
          k.row({ t: "Robert Chen’s callback was kept", m: "By you · 4:10 call · Mon" }),
          k.row({ t: "November goal: 64%", m: "$7,680 of $12,000 · Mon" }),
          k.row({ t: "New lead list ready", m: "Nov batch 4 · 1,200 leads · Mon" }),
        ]),
    }),
  });

  S.push({
    sec: "inbox", id: "H2", name: "Inbox · messages",
    note: "Partner chat, one row per conversation, groups first. Unread counts are gold. Only chats you’re in.",
    badges: { calls: 2, inbox: 4 },
    render: (k) => ({
      tab: "inbox",
      header: k.header({ title: "Inbox", actions: ["search", "pencil"],
        belowFull: '<div class="pad16" style="padding-bottom:10px">' + (k.ios ? k.seg(["Alerts 4", "Messages 3"], 1) : "") + "</div>" + (k.ios ? "" : k.utabs(['Alerts <span class="n">4</span>', 'Messages <span class="n">3</span>'], 1)) }),
      body:
        '<div style="height:' + (k.ios ? 0 : 6) + 'px"></div>' +
        k.group("", [
          k.row({ i: "handshake", t: "Apex Leads", m: "Maya: Dolores is warm, wants $10k", chip: '<span class="badge" style="position:static">2</span>', r: "2:12" }),
          k.row({ i: "handshake", t: "Summit Media", m: "You: Walter needs a review first", r: "1:40" }),
          k.row({ i: "users", t: "Floor · all producers", m: "Ava: Taking the next two, then lunch", chip: '<span class="badge" style="position:static">1</span>', r: "12:05" }),
          k.row({ i: "handshake", t: "Bright Path Referrals", m: "Payout for October received, thanks", r: "Mon" }),
          k.row({ i: "handshake", t: "Coastal Insure Ads", m: "New campaign live: GA + FL", r: "Sun" }),
        ]),
      fab: k.fab("", "pencil"),
    }),
  });

  S.push({
    sec: "inbox", id: "H3", name: "Partner chat",
    note: "A thread with a partner. A lead they sent shows as a small record card that opens the lead. New messages rise in; history stays still. Attach a document or a photo.",
    render: (k) => ({
      tab: null,
      header: k.header({ back: k.ios ? "Inbox" : " ", title: "Apex Leads", large: false, actions: ["phone", "moreH"] }),
      body:
        '<div class="pad16" style="padding-top:8px">' +
        '<div class="cent mini" style="margin:6px 0 10px">Today 2:09 pm</div>' +
        '<div class="bubble them">Transferring Dolores King now, 71, Jacksonville.</div>' +
        '<div class="card p" style="max-width:78%;margin:4px 0"><div class="row2" style="gap:8px">' + ic("user", 18) + '<div><div class="ink" style="font-weight:600">Dolores King</div><div class="mini">Final expense · FL · DNC clear</div></div></div></div>' +
        '<div class="bmeta">Maya · Apex Leads · 2:10 pm</div>' +
        '<div class="bubble them">She’s warm, wants $10k for burial. Husband passed in spring, be gentle.</div>' +
        '<div class="bmeta">Maya · 2:11 pm</div>' +
        '<div class="bubble me">Got her, on the call now. Thanks Maya.</div><div class="bmeta r">Read 2:12 pm</div>' +
        '<div class="bubble them">Can you send me the outcome when you finish? We’re tracking FL quality this week.</div><div class="bmeta">Maya · 2:12 pm</div>' +
        "</div>",
      after: '<div class="composer">' + ic("clip", 24) + '<div class="in">Message Apex Leads</div><span class="send">' + ic("send", 18) + "</span></div>",
    }),
  });

  S.push({
    sec: "inbox", id: "H4", name: "Notification settings",
    note: "Per kind of alert: push, and for transfers the ringing. Quiet hours never hold back a transfer you’re available for. Same categories as the web bell.",
    render: (k) => ({
      tab: null,
      header: k.header({ back: k.ios ? "Settings" : " ", title: "Notifications", large: true }),
      body:
        k.group("Calls", [
          k.row({ t: "Transfer waiting", m: "Ring like a call, even on silent", sw: true }),
          k.row({ t: "Callback in 5 minutes", sw: true }),
          k.row({ t: "Someone handed a call to you", sw: true }),
        ]) +
        k.group("Sales and book", [
          k.row({ t: "Case changed at the carrier", sw: true }),
          k.row({ t: "A policy is at risk", sw: true }),
          k.row({ t: "Commission statement posted", sw: false }),
        ]) +
        k.group("Messages", [k.row({ t: "Partner chat", m: "Only chats you’re in", sw: true }), k.row({ t: "Team floor", sw: false })]) +
        k.group("Quiet hours", [k.row({ t: "From 9:00 pm to 7:30 am", r: "On" }), k.row({ t: "Let transfers through", m: "Only while you’re taking calls", sw: true })], "Alerts still wait in the Inbox during quiet hours."),
    }),
  });
})();
