/* Screens, part E (round 1b): every remaining mobile feature for getting in, the role homes, Calls, Leads and Sales. */
(function () {
  "use strict";
  const S = window.SCREENS;
  const ic = window.MK.ic;
  const bar = (k, inner, aboveTabs) => '<div style="position:absolute;left:0;right:0;bottom:' + (aboveTabs ? 84 : 0) + 'px;padding:' + (aboveTabs ? "10px 16px" : "12px 16px 34px") + ';background:var(--bar);backdrop-filter:blur(20px);border-top:.5px solid var(--line);z-index:19;display:flex;gap:10px;flex-direction:column">' + inner + "</div>";
  const tick = (ok, t, m) => '<div class="row2" style="align-items:flex-start"><span style="color:' + (ok === 1 ? "var(--ok)" : ok === 0 ? "var(--bad)" : "var(--faint)") + '">' + ic(ok === 1 ? "checkC" : ok === 0 ? "xC" : "clock", 20) + '</span><div><div class="ink" style="font-size:15px">' + t + "</div>" + (m ? '<div class="mini">' + m + "</div>" : "") + "</div></div>";
  const callsHead = (k, on, extra) => k.header({ title: "Calls", actions: extra || ["sliders"], belowFull: '<div class="pad16" style="padding-bottom:10px">' + (k.ios ? k.seg(["Incoming 2", "Dialer", "Callbacks 3"], on) : "") + "</div>" + (k.ios ? "" : k.utabs(['Incoming <span class="n">2</span>', "Dialer", 'Callbacks <span class="n">3</span>'], on)) });
  const dim = (h) => '<div class="pad16" style="opacity:.45"><div class="sk" style="height:' + (h || 260) + 'px;border-radius:16px"></div></div>';

  // ═══ 01 · Getting in ════════════════════════════════════════════════
  S.push({
    sec: "in", id: "A0", name: "First open",
    note: "The first screen after install. Sign in, or open an invite. Creating an agency and choosing a plan happen on the web: a plan sold inside the app would have to go through Apple and Google’s own payments.",
    render: (k) => ({
      tab: null,
      body:
        '<div style="height:100%;display:flex;flex-direction:column;padding:60px 24px 0">' +
        '<div style="width:72px;height:72px;border-radius:18px;background:#0d4037;display:grid;place-items:center">' + k.logo(48) + "</div>" +
        '<div class="disp ink" style="font-size:36px;font-weight:700;line-height:1.08;margin-top:28px">Your calls, leads and book. In your pocket.</div>' +
        '<div class="muted" style="margin-top:12px;font-size:16px">For agents, agencies and the partners who send them leads.</div>' +
        '<div style="display:flex;flex-direction:column;gap:12px;margin-top:150px">' + k.btn("Sign in", "primary") + k.btn("I have an invite", "outline", "mail") +
        '<div class="cent mini" style="margin-top:8px">New to Insurvas? Start your agency at <span class="gr" style="font-weight:600">insurvas.com</span></div></div></div>',
    }),
  });

  S.push({
    sec: "in", id: "A5", name: "Accept an invite",
    note: "A teammate taps the invite link in their email and lands here (universal link / app link). Their role and agency are shown before they set a password. The same screen serves a partner invited to the portal.",
    render: (k) => ({
      tab: null,
      body:
        '<div style="padding:40px 24px 0;display:flex;flex-direction:column;gap:18px">' +
        '<span class="av lg">DE</span>' +
        '<div><div class="disp ink" style="font-size:28px;font-weight:700">Dana invited you to Ellery & Fields</div><div class="muted" style="margin-top:6px">You’ll join as a <b class="ink">Producer</b>. You’ll see your own leads, calls, sales and pay.</div></div>' +
        k.field("Email", "ava.kim@elleryfields.com", { lead: "mail" }) +
        k.field("Create a password", "••••••••••", { lead: "lock", focus: true, hint: "At least 12 characters. Strong." }) +
        '<div class="between"><span class="ink" style="font-size:15px">Use ' + (k.ios ? "Face ID" : "fingerprint") + " next time</span>" + k.sw(true) + "</div>" +
        k.btn("Join Ellery & Fields", "primary") +
        '<div class="cent mini">By joining you accept the terms and privacy policy.</div></div>',
    }),
  });

  S.push({
    sec: "in", id: "A6", name: "Check your email",
    note: "After “Email me a sign-in link”. The link works once and opens the app directly on this phone. Opening it on a computer signs in there instead.",
    render: (k) => ({
      tab: null,
      header: k.header({ back: k.ios ? "Sign in" : " ", title: "", large: false }),
      body:
        '<div class="empty" style="padding-top:70px"><span class="ei">' + ic("mail", 30) + '</span><h4>Check your email</h4><p>We sent a sign-in link to <b class="ink">jordan@elleryfields.com</b>. It works once, for 15 minutes.</p>' +
        '<div style="width:260px;display:flex;flex-direction:column;gap:10px;margin-top:16px">' + k.btn("Open Mail", "primary", "mail") + k.btn("Send it again", "outline") + "</div>" +
        '<p class="mini" style="margin-top:14px">Wrong address? Go back and change it.</p></div>',
    }),
  });

  S.push({
    sec: "in", id: "A7", name: "Pick a workspace",
    note: "For people in more than one place: an agent in two agencies, an owner with a test workspace, a partner sending to several agencies. The choice is remembered; switch later from Settings.",
    render: (k) => ({
      tab: null,
      body:
        '<div style="padding:40px 0 0">' +
        '<div class="pad16"><div class="disp ink" style="font-size:28px;font-weight:700">Where are you working?</div><div class="muted" style="margin-top:6px">You have access to three places.</div></div>' +
        k.group("Agencies", [
          k.row({ i: "building", t: "Ellery & Fields", m: "Producer · 18 people", chip: k.chip("brand", "Last used") }),
          k.row({ i: "building", t: "Reyes Family Insurance", m: "Owner · just you" }),
        ]) +
        k.group("Partner portals", [k.row({ i: "handshake", t: "Apex Leads → Coastal Life Group", m: "Partner user" })]) +
        "</div>",
    }),
  });

  // ═══ 02 · Home, more roles ══════════════════════════════════════════
  S.push({
    sec: "home", id: "B5", name: "Home · assistant",
    note: "Assistants verify and hand off; they never finish a call or see cost. Their home is the verification queue and the handoffs they’re waiting on.",
    badges: { calls: 2, inbox: 1 },
    render: (k) => ({
      tab: "home",
      header: k.header({ title: "Today", sub: "Verifying for 6 licensed agents", actions: ["search"] }),
      body:
        '<div class="pad16">' + k.btn("Take the next caller", "gold", "phoneIn") + "</div>" +
        k.sh("Your handoffs") +
        k.group("", [
          k.row({ i: "userPlus", it: "g", t: "Nora Bell → Jordan Reyes", m: "Offered 3 min ago · 9 of 12 checked", chip: k.chip("info", "Waiting") }),
          k.row({ i: "checkC", it: "plain", t: "Earl Johnson → Ava Kim", m: "Accepted 11:02 · sold", chip: k.chip("ok", "Accepted") }),
        ]) +
        k.sh("Today") +
        '<div class="tiles pad16">' + k.tile("Calls verified", "14") + k.tile("Handed off", "9", "<b>↑ 3</b> vs yesterday") + k.tile("Avg to hand off", "6m 40s") + k.tile("Accepted", "8 of 9") + "</div>" +
        k.sh("Callbacks you help with", "All") +
        k.group("", [k.row({ i: "calCheck", t: "Robert Chen", m: "10:30 am his time · for Jordan", r: "11:30" })]),
    }),
  });

  S.push({
    sec: "home", id: "B6", name: "Home · bookkeeper",
    role: "bookkeeper",
    note: "Money without call operations: what’s waiting to be approved, deposits that don’t match, statements that haven’t arrived. Matching and posting open on the computer.",
    badges: { money: 5, inbox: 2 },
    render: (k) => ({
      tab: "home", role: "bookkeeper",
      header: k.header({ title: "Today", sub: "November books · close on the 5th", actions: ["search"] }),
      body:
        '<div class="strip">' + k.tile("To approve", "5", "$34,086 total", { i: "listCheck" }) + k.tile("Deposits short", "1", k.chip("warn", "$214")) + k.tile("Statements late", "2", "Corebridge, RN") + k.tile("Pay issues", '<span class="tn">' + k.money("3,912") + "</span>", "Owed to you") + "</div>" +
        k.sh("Waiting on you", "To do") +
        k.group("", [
          k.row({ i: "receipt", t: "Vendor bill · Apex Leads", m: "412 leads delivered · matches", r: "$11,536" }),
          k.row({ i: "creditCard", t: "Expense · Dialer seats", m: "Needs a category", r: "$640" }),
          k.row({ i: "wallet", t: "Team payouts · November", m: "For Dana to approve", r: "$18,240", chev: true }),
        ]) +
        k.sh("Cash this month") +
        '<div class="pad16"><div class="card p">' + k.bars([22, 14, 9, 31, 18, 27], ["Nov 3", "", "Nov 10", "", "Nov 17", "Nov 20"], 330, 100, 5) + '<div class="between" style="margin-top:8px"><span class="muted">Deposited</span><span class="big" style="font-size:22px">' + k.money("121,400") + "</span></div></div></div>",
    }),
  });

  S.push({
    sec: "home", id: "B7", name: "Home · retention",
    role: "retention",
    note: "A retention rep’s day in counts of policies, never dollars (the web’s money leak fixed on the phone too): what’s lost this week, what to call today, and their save rate.",
    badges: { cases: 9, inbox: 2 },
    render: (k) => ({
      tab: "home", role: "retention",
      header: k.header({ title: "Today", sub: "Last carrier file 6:02 am", actions: ["search"] }),
      body:
        '<div class="pad16"><div class="card p" style="display:flex;gap:16px;align-items:center">' + k.ring(56, 80, "56%") + '<div><div class="ink" style="font-weight:600;font-size:17px">23 saved of 41 worked</div><div class="muted" style="font-size:14px">November · team average 48%</div></div></div></div>' +
        '<div class="pad16" style="margin-top:12px">' + k.btn("Call the next case", "gold", "phoneOut") + "</div>" +
        k.sh("Call today", "Cases") +
        k.group("", [
          k.row({ i: "buoy", it: "w", t: "Ruth Alva", m: "Pending lapse · Mutual of Omaha", chip: k.chip("warn", "2 days left") }),
          k.row({ i: "buoy", it: "w", t: "Calvin Reed", m: "Pending lapse · Corebridge", chip: k.chip("warn", "4 days left") }),
          k.row({ i: "calCheck", t: "Howard Kim", m: "Try again · 10:00 am his time", r: "11:00" }),
        ]) +
        k.sh("Waiting on the carrier") +
        k.group("", [k.row({ i: "wrench", t: "Mae Thompson", m: "New draft date sent · 19 Nov", chip: k.chip("info", "Not in a file yet") })]),
    }),
  });

  S.push({
    sec: "home", id: "B8", name: "Home · manager",
    role: "owner",
    note: "Managers run people, not money: who’s on the phone now, today’s activity, and the team’s goals in counts. Same tabs as the owner, but Money is replaced by Calls.",
    render: (k) => ({
      tab: "home", role: "owner",
      header: k.header({ title: "Floor", sub: "Your team · 9 producers", actions: ["search"] }),
      body:
        '<div class="tiles pad16">' + k.tile("On a call now", "5", "of 7 taking calls") + k.tile("Transfers waiting", "2", "Longest 0:48") + k.tile("Applications today", "11", "<b>↑ 3</b> vs last Tue") + k.tile("Callbacks overdue", "4", k.chip("warn", "2 people")) + "</div>" +
        k.sh("Right now", "Team activity") +
        k.group("", [
          k.row({ av: "AK", t: "Ava Kim", m: "On a call · 6:12 · Linda Okafor", chip: k.chip("info", "On a call") }),
          k.row({ av: "JR", t: "Jordan Reyes", m: "Finishing a call · outcome screen", chip: k.chip("info", "Wrapping up") }),
          k.row({ av: "TB", t: "Tom Baker", m: "Not taking calls since 11:20", chip: k.chip("", "Away") }),
          k.row({ av: "SL", t: "Sam Lee", m: "Waiting for a transfer · 3 min", chip: k.chip("ok", "Ready") }),
        ]),
    }),
  });

  S.push({
    sec: "home", id: "B9", name: "Get set up",
    role: "owner",
    note: "The web’s guided setup, on the owner’s phone. Steps a phone does well happen here (invite people, turn on alerts, add your licence); the rest carry the laptop mark and send the link to the computer.",
    render: (k) => ({
      tab: null, role: "owner",
      header: k.header({ back: k.ios ? "Home" : " ", title: "Get set up", sub: "5 of 9 done", large: true }),
      body:
        '<div class="pad16"><div class="prog"><i style="width:55%"></i></div></div>' +
        k.group("Done", [
          k.row({ i: "checkC", it: "plain", t: "Create your agency", chev: false }),
          k.row({ i: "checkC", it: "plain", t: "Pick your carriers", chev: false }),
          k.row({ i: "checkC", it: "plain", t: "Set your pipelines", chev: false }),
          k.row({ i: "checkC", it: "plain", t: "Turn on alerts", chev: false }),
          k.row({ i: "checkC", it: "plain", t: "Read the disclosures", chev: false }),
        ]) +
        k.group("Next", [
          k.row({ i: "userPlus", it: "g", t: "Invite your team", m: "3 people · takes a minute" }),
          k.row({ i: "badge", t: "Add your licences", m: "Photo of each licence works" }),
          k.row({ i: "laptop", it: "plain", t: "Import your first lead list", chip: '<span style="color:var(--faint)">' + ic("laptop", 18) + "</span>", chev: false }),
          k.row({ i: "laptop", it: "plain", t: "Upload a carrier statement", chip: '<span style="color:var(--faint)">' + ic("laptop", 18) + "</span>", chev: false }),
        ]),
    }),
  });

  // ═══ 03 · Calls, every edit ═════════════════════════════════════════
  S.push({
    sec: "calls", id: "C1b", name: "Transfer details",
    note: "Tapping Details on a waiting caller: the screening, the duplicate check, what the partner wrote and the link to the lead. Claim from here is the same race-safe claim.",
    render: (k) => ({
      tab: "calls",
      header: callsHead(k, 0),
      body: dim(),
      overlay: k.sheet("Walter Brooks",
        '<div style="display:flex;flex-direction:column;gap:14px">' +
        '<div class="between"><span class="muted">66 yrs · Macon, GA · Final expense</span><span class="tn ink disp" style="font-size:20px;font-weight:700">0:21</span></div>' +
        '<div class="card p" style="display:flex;flex-direction:column;gap:10px">' +
        tick(1, "Not on any Do Not Call list", "Checked 0:19 ago") + tick(null, "Consent proof still arriving", "Summit Media sends the certificate after the call starts") + tick(0, "Maybe already a lead", "Walter Brooks, (478) 555-0133, Contacted 4 Oct by Sam Lee") +
        "</div>" +
        '<div class="card p"><h4>From Summit Media</h4><div style="margin-top:6px;font-size:15px">“Has a policy that lapses next month, wants to compare.”</div></div>' +
        '<div class="btnrow">' + k.btn("Open the lead", "outline", "user") + k.btn("Claim", "primary", "phoneIn") + "</div></div>", { h: 600 }),
    }),
  });

  S.push({
    sec: "calls", id: "C1c", name: "Inbound team",
    note: "Who is taking calls right now and who gets the next transfer. Anyone can see it; only the owner changes the order, and that stays on the computer.",
    render: (k) => ({
      tab: "calls",
      header: k.header({ back: k.ios ? "Calls" : " ", title: "Inbound team", sub: "Next transfer goes to Sam Lee", large: true }),
      body:
        k.group("Taking calls · 4", [
          k.row({ av: "SL", t: "Sam Lee", m: "Ready · waiting 3 min", chip: k.chip("ok", "Next") }),
          k.row({ av: "JR", t: "Jordan Reyes (you)", m: "Ready · waiting 1 min", chip: k.chip("ok", "2nd") }),
          k.row({ av: "AK", t: "Ava Kim", m: "On a call · 6:12", chip: k.chip("info", "On a call") }),
          k.row({ av: "MO", t: "Marcus Ortiz", m: "Wrapping up · outcome screen", chip: k.chip("info", "Wrapping up") }),
        ]) +
        k.group("Not taking calls · 3", [
          k.row({ av: "TB", t: "Tom Baker", m: "Away since 11:20" }),
          k.row({ av: "NW", t: "Nia Watts", m: "Off today" }),
          k.row({ av: "LP", t: "Lena Park (assistant)", m: "Verifying for Ava" }),
        ]),
    }),
  });

  S.push({
    sec: "calls", id: "C4b", name: "Offer a handoff",
    note: "Assistants only. Pick a licensed agent who can take this product and state; they see how far verification got before they accept. The assistant stays on until they do.",
    render: (k) => ({
      tab: null,
      header: k.header({ back: k.ios ? "Profile" : " ", title: "Verification", large: false }),
      body: dim(200),
      overlay: k.sheet("Hand Nora Bell to",
        '<div style="display:flex;flex-direction:column;gap:12px">' +
        '<div class="mini">Licensed in Georgia for final expense, ready now</div>' +
        '<div style="margin:0 -16px">' +
        k.row({ av: "JR", t: "Jordan Reyes", m: "Ready · 1 min", cls: "sel", chip: '<span style="color:var(--green-ink)">' + ic("checkC", 20) + "</span>", chev: false }) +
        k.row({ av: "SL", t: "Sam Lee", m: "Ready · 3 min", chev: false }) +
        k.row({ av: "AK", t: "Ava Kim", m: "On a call · 6:12", chev: false }) +
        "</div>" +
        k.field("Note for Jordan", "Address corrected. Beneficiary still to confirm.", {}) +
        '<div class="mini">Jordan sees 9 of 12 checks done before accepting.</div>' +
        k.btn("Offer to Jordan", "primary", "userPlus") + "</div>", { h: 620 }),
    }),
  });

  S.push({
    sec: "calls", id: "C7b", name: "Compliance details",
    note: "Details under the five ticks: every check the server ran for this number, with its source and time. The same list the evidence report prints.",
    render: (k) => ({
      tab: "calls",
      header: callsHead(k, 1, ["search", "sliders"]),
      body: dim(),
      overlay: k.sheet("Checks for (713) 555-0144",
        '<div style="display:flex;flex-direction:column;gap:12px">' +
        tick(1, "Written consent", "Web form 18 Nov 3:42 pm · certificate 9a1f…22c0") +
        tick(1, "National Do Not Call list", "Not listed · checked today 1:11 pm") +
        tick(1, "Texas Do Not Call list", "Not listed · checked today 1:11 pm") +
        tick(1, "Known litigator list", "Not listed") +
        tick(1, "Your agency’s do-not-call list", "Not listed") +
        tick(1, "Calling window", "1:12 pm in Houston · allowed 8 am – 9 pm") +
        tick(1, "Attempts", "3rd call this week · limit 6") +
        tick(1, "Not already a client", "No policy on phone or date of birth") +
        '<div class="mini">The server repeats these checks the moment you tap Call.</div></div>', { h: 680 }),
    }),
  });

  S.push({
    sec: "calls", id: "C7c", name: "Read the disclosure",
    note: "Shown the moment the customer answers, word for word, in big type. Tapping “I read it” records the disclosure with the call (evidence, not a checkbox). Version and state come from Settings › Disclosures.",
    render: (k) => ({
      tab: null,
      header: k.header({ back: k.ios ? "Dialer" : " ", title: "Harold Nguyen", large: false, belowFull: '<div class="pad16" style="padding-bottom:10px"><div class="between"><span class="mini">Read before anything else</span><span class="row2 tn" style="color:var(--green-ink);font-weight:600;font-size:13px">' + ic("phone", 14) + "On the call 0:04</span></div></div>" }),
      body:
        '<div class="pad16" style="padding-top:10px">' +
        '<div class="disp ink" style="font-size:24px;line-height:1.4;font-weight:500">“Hi Harold, this is Jordan Reyes, a licensed agent with Ellery & Fields. This call is recorded for quality. I’m calling about the life insurance information you asked for on November 18th. Is now a good time?”</div>' +
        '<div class="mini" style="margin-top:14px">Texas · outbound disclosure v4 · 31 words</div></div>',
      after: bar(k, k.btn("I read it", "primary", "check") + '<div class="cent gr" style="font-weight:600;font-size:15px;padding:4px">He didn’t answer · voicemail</div>'),
    }),
  });

  S.push({
    sec: "calls", id: "C7d", name: "Script and rebuttals",
    note: "During the call, the agency’s current script, with rebuttals one tap away. Editing saves a new version that applies from the next lead, so past calls never change.",
    render: (k) => ({
      tab: null,
      header: k.header({ back: k.ios ? "Back" : " ", title: "Script", large: false, actions: ["pencil"], belowFull: '<div class="pad16" style="padding-bottom:10px">' + k.seg(["Script", "Rebuttals", "Notes"], 1, true) + "</div>" }),
      body:
        '<div class="pad16 gap">' +
        [["“I need to think about it.”", "Totally fair. What part would you want to think over: the amount, or the monthly cost? Let’s look at just that piece together."], ["“It’s too expensive.”", "If we brought it to $10,000 instead of $15,000, it’s about $36 a month. Would that fit better?"], ["“I already have coverage.”", "Great. Is it through work? Many group plans end when you retire; this one stays with you for life."], ["“Send me something in the mail.”", "I can. So it’s useful, let me write down the two numbers that matter to you."]].map((r, i) => '<div class="card p"><div class="ink" style="font-weight:600">' + r[0] + '</div><div style="margin-top:6px;font-size:15px;' + (i ? "" : "") + '">' + r[1] + "</div></div>").join("") +
        '<div class="mini">Script v12 · updated by Dana 14 Nov</div></div>',
    }),
  });

  S.push({
    sec: "calls", id: "C7e", name: "Dialer queue filters",
    note: "Narrow the queue on the go: priority, campaign, vendor, lead type and only-callable-now. Search finds any lead by name or phone (two characters at least) and opens it in place.",
    render: (k) => ({
      tab: "calls",
      header: callsHead(k, 1, ["search", "sliders"]),
      body: "",
      overlay: k.sheet("Queue",
        '<div style="display:flex;flex-direction:column;gap:8px">' + k.search("Name or phone") +
        '<div class="mini" style="margin-top:8px">Priority</div>' + k.seg(["All", "High", "Medium", "Low"], 1, true) +
        '<div class="mini" style="margin-top:8px">Campaign</div><div class="fchips" style="padding:0;flex-wrap:wrap"><span class="fc on">TX-Term-Nov</span><span class="fc">FE-Georgia-Nov</span><span class="fc">FE-Florida-2</span><span class="fc">+ 6</span></div>' +
        '<div class="mini" style="margin-top:8px">Lead type</div><div class="fchips" style="padding:0;flex-wrap:wrap"><span class="fc">Fresh</span><span class="fc on">Aged</span><span class="fc">Callbacks</span><span class="fc">Recycled</span></div>' +
        '<div style="margin:6px -16px 0">' + k.row({ t: "Callable now only", m: "Inside each customer’s calling window", sw: true }) + k.row({ t: "Auto-next", m: "Serve the next lead after each outcome", sw: true }) + "</div>" +
        '<div class="btnrow" style="margin-top:8px">' + k.btn("Clear", "outline") + k.btn("Show 17 leads", "primary") + "</div></div>", { h: 700 }),
    }),
  });

  S.push({
    sec: "calls", id: "C8b", name: "Book an appointment",
    note: "From the dialer, the lead or a setter’s call: pick a licensed producer, how (phone, video, in person) and a slot from their calendar, in the customer’s time. The producer gets a push.",
    render: (k) => ({
      tab: null,
      header: k.header({ back: k.ios ? "Dialer" : " ", title: "Linda Okafor", large: false }),
      body: dim(180),
      overlay: k.sheet("Book an appointment",
        '<div style="display:flex;flex-direction:column;gap:12px">' +
        k.field("With", "Ava Kim · licensed in GA", { trail: "chevD" }) +
        '<div>' + k.seg(["Phone", "Video", "In person"], 2, true) + "</div>" +
        k.field("Where", "22 Abercorn St, Savannah", { lead: "pin" }) +
        '<div class="mini">Ava’s free times · her time = Linda’s (Eastern)</div>' +
        '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">' + ["Thu 10:00", "Thu 2:00", "Thu 4:30", "Fri 9:30", "Fri 1:00", "Sat 11:00"].map((t, i) => '<span class="fc ' + (i === 1 ? "on" : "") + '" style="justify-content:center;height:42px">' + t + "</span>").join("") + "</div>" +
        '<div class="between"><span class="ink">Text Linda a reminder the day before</span>' + k.sw(true) + "</div>" +
        k.btn("Book Thu 26 Nov, 2:00 pm", "primary", "calendar") + "</div>", { h: 690 }),
    }),
  });

  S.push({
    sec: "calls", id: "C13b", name: "Appointment",
    note: "For in-person sales: the address with Directions (opens Apple / Google Maps), what the setter learned, and Start application on arrival. Running late sends the customer a note through the agency’s number.",
    render: (k) => ({
      tab: null,
      header: k.header({ back: k.ios ? "Calendar" : " ", title: "", large: false, actions: ["moreH"] }),
      body:
        '<div class="pad16 gap">' +
        '<div><div class="mini">Thu 26 Nov · 2:00 – 3:00 pm</div><div class="disp ink" style="font-size:28px;font-weight:700">Linda Okafor</div><div class="muted" style="font-size:14px">In person · set by Lena Park (setter)</div></div>' +
        '<div class="card" style="overflow:hidden"><div style="height:130px;background:repeating-linear-gradient(0deg,var(--surf2) 0 1px,transparent 1px 26px),repeating-linear-gradient(90deg,var(--surf2) 0 1px,transparent 1px 26px);position:relative"><span style="position:absolute;left:50%;top:42%;transform:translate(-50%,-50%);color:var(--green)">' + ic("pin", 34) + '</span></div><div class="p" style="padding:12px 16px" ><div class="between"><div><div class="ink" style="font-weight:600">22 Abercorn St</div><div class="mini">Savannah, GA · 18 min drive</div></div>' + k.btn("Directions", "tonal", "nav", "sm") + "</div></div></div>" +
        '<div class="card p"><h4>From the setter</h4><div style="margin-top:6px;font-size:15px">“Wants $15k. Daughter Grace will be there, she pays the bills. Has a dog, knock loudly.”</div></div>' +
        '<div class="btnrow">' + k.btn("Running late", "outline", "clock") + k.btn("Start application", "primary", "filePen") + "</div>" +
        "</div>",
    }),
  });

  // ═══ 04 · Leads, every tab and edit ═════════════════════════════════
  const leadTop = (k, tab) =>
    '<div class="pad16" style="padding-bottom:12px"><div class="between"><div><div class="disp ink" style="font-size:28px;font-weight:700">Linda Okafor</div><div class="muted" style="font-size:14px">68 yrs · Savannah, GA · Final expense</div></div>' + k.chip("ok", "Clear to call") + "</div></div>" +
    k.path(["New", "Contacted", "Interested", "Quoted", "Applied", "Sold"], 2) + '<div style="height:12px"></div>' + k.utabs(["Details", "Activity", "Conversation", "Nurture", "Verification", "Application"], tab);
  const leadHdr = (k, tab) => k.header({ back: k.ios ? "Leads" : " ", title: "", large: false, actions: ["moreH"], belowFull: leadTop(k, tab) });

  S.push({
    sec: "leads", id: "D3b", name: "Lead · conversation",
    note: "Everything said about this lead with the partner who sent it, and emails logged to the lead. There is no texting from a personal phone: calls and messages go through the agency’s own lines for compliance.",
    render: (k) => ({
      tab: null,
      header: leadHdr(k, 2),
      body:
        '<div class="pad16" style="padding-top:12px">' +
        '<div class="cent mini" style="margin:4px 0 8px">Apex Leads · about Linda</div>' +
        '<div class="bubble them">Linda asked for a callback in the morning, she works afternoons.</div><div class="bmeta">Maya · Apex Leads · Sat</div>' +
        '<div class="bubble me">Thanks, set for Mon 10 am her time.</div><div class="bmeta r">Ava Kim · Sat</div>' +
        '<div class="card p" style="margin:10px 0"><div class="row2" style="gap:8px">' + ic("mail", 18) + '<div><div class="ink" style="font-weight:600">Email · Your quote from Ellery & Fields</div><div class="mini">Sent by Ava · opened twice · Mon 10:41</div></div></div></div>' +
        "</div>",
      after: '<div class="composer">' + ic("clip", 24) + '<div class="in">Message Apex Leads about Linda</div><span class="send">' + ic("send", 18) + "</span></div>",
    }),
  });

  S.push({
    sec: "leads", id: "D3c", name: "Lead · nurture",
    note: "If she isn’t ready, where she sits in recycling: the next touch, who it goes to, and why. Pausing or ending it works here; building the recycling rules is on the computer.",
    render: (k) => ({
      tab: null,
      header: leadHdr(k, 3),
      body:
        '<div class="pad16 gap" style="margin-top:14px">' +
        '<div class="card p between"><div><div class="mini">Next touch</div><div class="ink" style="font-weight:600;font-size:18px">Call · Mon 30 Nov</div><div class="mini">Goes back in Ava’s queue at 9 am her time</div></div>' + k.chip("info", "Step 2 of 5") + "</div>" +
        '<div class="card p"><h4>“Interested, not today” · 30 days</h4><div class="timeline" style="margin-top:10px">' +
        [["Call · day 1", "Done 23 Nov", 1], ["Call · day 7", "Mon 30 Nov", 0], ["Email the quote again · day 14", "Mon 7 Dec", 0], ["Call · day 21", "Mon 14 Dec", 0], ["Back to the shared pool · day 30", "Wed 23 Dec", 0]].map((e) => '<div class="ev ' + (e[2] ? "" : "mut") + '"><div class="e1">' + e[0] + '</div><div class="e2">' + e[1] + "</div></div>").join("") + "</div></div>" +
        '<div class="btnrow">' + k.btn("Pause", "outline", "pause") + k.btn("End nurture", "outline", "x") + "</div></div>",
    }),
  });

  S.push({
    sec: "leads", id: "D3d", name: "Lead · verification",
    note: "Each field’s history across calls: what the partner sent, what was confirmed or corrected, by whom and when. Read-only here; corrections happen on the call.",
    render: (k) => ({
      tab: null,
      header: leadHdr(k, 4),
      body:
        k.group("Checked on 23 Nov by Ava Kim · 10 of 12", [
          k.row({ i: "check", t: "Full legal name", m: "Linda Adaeze Okafor", chip: k.chip("ok", "Confirmed"), chev: false }),
          k.row({ i: "pencil", it: "i", t: "Date of birth", m: "Partner sent 6/11/1957 · corrected to 11 Jun 1958", chip: k.chip("info", "Corrected"), chev: false }),
          k.row({ i: "check", t: "Address", m: "22 Abercorn St, Savannah GA", chip: k.chip("ok", "Confirmed"), chev: false }),
          k.row({ i: "clock", it: "plain", t: "Beneficiary", m: "Not asked", chip: k.chip("warn", "Outstanding"), chev: false }),
          k.row({ i: "clock", it: "plain", t: "Bank for the draft", m: "Not asked", chip: k.chip("warn", "Outstanding"), chev: false }),
        ]),
    }),
  });

  S.push({
    sec: "leads", id: "D5b", name: "Hand off a lead",
    note: "From the lead’s ⋯ menu: give the lead to a licensed agent with a reason. Licensed-agent choice is required (the web’s “choose a licensed agent before offering” rule).",
    render: (k) => ({
      tab: null,
      header: leadHdr(k, 0),
      body: "",
      overlay: k.dialog("Hand Linda to another agent?",
        '<div style="display:flex;flex-direction:column;gap:12px;text-align:left;margin-top:6px">' + k.field("Agent", "Jordan Reyes · licensed in GA", { trail: "chevD" }) + k.field("Why", "Speaks Igbo with her daughter", {}) + "</div>",
        [["Hand off", "b"], ["Keep it", ""]]),
    }),
  });

  S.push({
    sec: "leads", id: "D9", name: "Same person?",
    note: "When the duplicate check finds a match, the two records side by side. Marking it as the same person links them and keeps the older owner; a full merge of histories is done on the computer.",
    render: (k) => ({
      tab: null,
      header: k.header({ back: k.ios ? "Leads" : " ", title: "Possible duplicate", large: false }),
      body:
        '<div class="pad16 gap" style="padding-top:8px">' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
        [["New today", "Earl Johnson", "(614) 555-0127", "14 Feb 1957", "Columbus, OH", "Referral · you"], ["Since 2 Oct", "Earl Johnson", "(614) 555-0127", "14 Feb 1957", "Grove City, OH", "List · Sam Lee"]].map((c) => '<div class="card p"><div class="mini">' + c[0] + '</div><div class="ink" style="font-weight:600;margin-top:4px">' + c[1] + '</div><div style="font-size:14px;margin-top:8px;display:flex;flex-direction:column;gap:6px">' + c.slice(2).map((v, i) => '<span class="' + (i === 2 ? "gi" : "") + '">' + v + "</span>").join("") + "</div></div>").join("") +
        "</div>" +
        '<div class="mini">Same phone and date of birth. City differs.</div>' +
        "</div>",
      after: bar(k, '<div class="btnrow">' + k.btn("Keep both", "outline") + k.btn("Same person", "primary", "link") + "</div>"),
    }),
  });

  S.push({
    sec: "leads", id: "D10", name: "Vendor",
    note: "A lead vendor’s card for the owner on the go: what their leads really cost and became this month. Buying more, returns and campaign setup stay on the computer.",
    role: "owner",
    render: (k) => ({
      tab: null, role: "owner",
      header: k.header({ back: k.ios ? "Menu" : " ", title: "Apex Leads", sub: "Vendor · 4 campaigns · November", large: true, actions: ["msg"] }),
      body:
        '<div class="tiles pad16">' + k.tile("Leads bought", "412", "$28.00 each") + k.tile("True cost per sale", '<span class="tn">' + k.money("281") + "</span>", "<b>↓ $22</b> vs October") + k.tile("Contact rate", "38%") + k.tile("Sold", "41", "9.9 per 100") + "</div>" +
        k.group("Campaigns", [
          k.row({ i: "target", t: "FE-Georgia-Nov", m: "180 leads · 21 sold", r: "$240" }),
          k.row({ i: "target", t: "FE-Florida-2", m: "132 leads · 14 sold", r: "$264" }),
          k.row({ i: "target", t: "FE-Ohio-Aged", m: "100 leads · 6 sold", r: "$467", chip: k.chip("warn", "Costly") }),
        ], "Right column: true cost per sale."),
    }),
  });

  // ═══ 05 · Sales, every step ═════════════════════════════════════════
  S.push({
    sec: "sales", id: "E0", name: "Applications",
    note: "Every application you started: drafts to resume (with the step they stopped on), waiting on a signature, and submitted. Resuming lands exactly where the call dropped.",
    render: (k) => ({
      tab: null,
      header: k.header({ back: k.ios ? "Menu" : " ", title: "Applications", large: true, actions: ["search"], belowFull: k.fchips([{ t: "In progress", n: 3, on: true }, { t: "Needs signature", n: 2 }, { t: "Submitted", n: 14 }]) + '<div style="height:10px"></div>' }),
      body:
        k.group("", [
          k.row({ i: "filePen", t: "Linda Okafor", m: "American Amicable · step 5 of 10 · Health", chip: '<span class="btn sm tonal" style="height:32px">Resume</span>', chev: false }),
          k.row({ i: "filePen", t: "Harold Nguyen", m: "Corebridge · step 2 of 10 · Quote", chip: '<span class="btn sm tonal" style="height:32px">Resume</span>', chev: false }),
          k.row({ i: "filePen", t: "Carl Weber", m: "Transamerica · step 8 of 10 · Payment", chip: '<span class="btn sm tonal" style="height:32px">Resume</span>', chev: false }),
        ]) +
        k.group("Needs signature", [
          k.row({ i: "pencil", it: "w", t: "Paul Stewart", m: "E-sign sent 1:58 pm · not opened", chip: k.chip("warn", "Resend") }),
          k.row({ i: "pencil", it: "w", t: "Betty Holmes", m: "Signature rejected by carrier", chip: k.chip("warn", "Sign again") }),
        ]),
    }),
  });

  S.push({
    sec: "sales", id: "E1b", name: "Start an application · which product",
    note: "Decision 6, settled: the phone takes the full application for the products with the deep flow (final expense, whole life, term). Products built on the generic template show a laptop mark; tapping one keeps the quote and sends the link to your computer.",
    render: (k) => ({
      tab: null,
      header: k.header({ back: k.ios ? "Quote" : " ", title: "Start an application", large: false }),
      body:
        '<div class="pad16" style="padding-top:14px"><div class="mini">For Linda Okafor · 68 · Georgia · $15,000</div></div>' +
        k.group("Apply on the phone", [
          k.row({ i: "filePen", t: "Final expense", m: "American Amicable · Senior Choice · $52.18", chip: k.chip("ok", "Picked") }),
          k.row({ i: "filePen", t: "Whole life", m: "Mutual of Omaha · 10 steps with signature" }),
          k.row({ i: "filePen", t: "Term life", m: "Corebridge · 10 steps with signature" }),
        ], "Every step saves as you go and works with a weak signal.") +
        k.group("Finish on a computer", [
          k.row({ i: "laptop", t: "Medicare supplement", m: "Uses your agency’s own form", chev: false }),
          k.row({ i: "laptop", t: "Annuity", m: "Uses your agency’s own form", chev: false }),
        ], "Tap one to email yourself the link. The quote and Linda’s answers come with it."),
      after: bar(k, k.btn("Start final expense application", "primary", "filePen")),
    }),
  });

  S.push({
    sec: "sales", id: "E2b", name: "Application · all steps",
    note: "Tap the step name to see all ten steps: done, now, and locked (a step opens only when the one before it is finished, as on the web’s rail).",
    render: (k) => ({
      tab: null,
      header: k.header({ back: k.ios ? "Linda" : " ", title: "Application", large: false }),
      body: dim(300),
      overlay: k.sheet("Linda · American Amicable",
        '<div style="margin:0 -16px">' +
        [["Verify", "Done", 1], ["Quote", "$15,000 · $52.18", 1], ["Eligibility", "Done", 1], ["Personal details", "Done", 1], ["Health", "Now · 3 of 7", 2], ["Medications", "", 0], ["Beneficiary", "", 0], ["Payment", "", 0], ["Review", "", 0], ["Sign", "", 0]].map((r, i) => k.row({ lead: '<span style="width:26px;height:26px;border-radius:50%;display:grid;place-items:center;font:600 12px Inter;flex:none;' + (r[2] === 1 ? "background:var(--green);color:var(--on-green)" : r[2] === 2 ? "border:2px solid var(--green);color:var(--green-ink)" : "background:var(--surf2);color:var(--faint)") + '">' + (r[2] === 1 ? ic("check", 14) : i + 1) + "</span>", t: r[0], m: r[1], chip: r[2] === 0 ? '<span style="color:var(--faint)">' + ic("lock", 16) + "</span>" : r[2] === 2 ? k.chip("brand", "Now") : "", chev: false, cls: r[2] === 2 ? "sel" : "" })).join("") +
        "</div>", { h: 720 }),
    }),
  });

  S.push({
    sec: "sales", id: "E2c", name: "Bank details, protected",
    note: "Sensitive fields (bank, SSN) are typed once, then masked. Showing them again asks for Face ID / fingerprint and is written to the audit log. Screenshots and the app switcher show them blurred.",
    render: (k) => ({
      tab: null,
      header: k.header({ back: k.ios ? "Back" : " ", title: "Application", large: false, belowFull: '<div class="pad16" style="padding-bottom:12px"><div class="between mini" style="margin-bottom:8px"><span class="ink" style="font-weight:600">Payment · 8 of 10</span><span>American Amicable</span></div>' + k.stepper(10, 7) + "</div>" }),
      body:
        '<div class="pad16 gap" style="padding-top:8px">' +
        '<div class="disp ink" style="font-size:24px;font-weight:700">Where should the draft come from?</div>' +
        k.field("Bank", "Truist", {}) +
        k.field("Routing number", "•••• •• 104", { trail: "eye" }) +
        k.field("Account number", "•••• •••• 4471", { trail: "eye" }) +
        '<div class="row2 mini">' + ic("lock", 14) + "Hidden after entry · showing again needs " + (k.ios ? "Face ID" : "your fingerprint") + "</div>" +
        k.field("Account holder", "Linda A. Okafor") + "</div>",
      overlay: k.ios
        ? '<div class="dim" style="background:rgba(0,0,0,.25)"></div><div style="position:absolute;left:50%;top:44%;transform:translate(-50%,-50%);width:160px;height:160px;border-radius:30px;background:rgba(40,48,46,.9);backdrop-filter:blur(20px);z-index:42;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;color:#fff">' + ic("face", 56) + '<span style="font-size:15px">Face ID</span></div>'
        : k.sheet("", '<div style="display:flex;flex-direction:column;align-items:center;gap:12px;padding:10px 0 20px"><div class="ink" style="font-size:20px">Show bank details</div><div class="muted">Confirm it’s you</div><span style="width:72px;height:72px;border-radius:50%;background:var(--green-soft);color:var(--green-ink);display:grid;place-items:center;margin-top:10px">' + ic("finger", 40) + '</span><div class="mini">Touch the sensor</div><div class="gr" style="font-weight:600;margin-top:6px">Cancel</div></div>', { h: 360 }),
    }),
  });

  S.push({
    sec: "sales", id: "E6b", name: "Send a scanned document",
    note: "After scanning (VisionKit on iOS, ML Kit document scanner on Android): pages in order, crop, and send to the carrier requirement. It lands on the case and the requirement turns to “Sent”.",
    render: (k) => ({
      tab: null,
      header: k.header({ back: k.ios ? "Case" : " ", title: "Doctor’s records", large: false }),
      body:
        '<div class="pad16 gap" style="padding-top:8px">' +
        '<div style="display:flex;gap:10px;overflow-x:auto">' + [1, 2, 3].map((n) => '<div style="flex:none;width:110px;height:150px;border-radius:10px;background:#e9ece6;position:relative;padding:12px 10px;color:#555;font:9px/1.5 Inter"><b style="font-size:10px">Savannah Heart</b><br>Patient: George Patel<br>DOB 07/02/1961<br>…<span style="position:absolute;right:6px;bottom:6px;background:#0d4037;color:#fff;border-radius:6px;padding:1px 6px;font-size:10px">' + n + "</span></div>").join("") + '<div style="flex:none;width:110px;height:150px;border-radius:10px;border:1.5px dashed var(--line2);display:grid;place-items:center;color:var(--muted)">' + ic("plus", 24) + "</div></div>" +
        k.field("Send to", "Corebridge · requirement APS · CB-4471902", { trail: "chevD" }) +
        k.field("Note for underwriting", "Records from 2023–2026 attached", {}) +
        "</div>",
      after: bar(k, k.btn("Send 3 pages to Corebridge", "primary", "send")),
    }),
  });
})();
