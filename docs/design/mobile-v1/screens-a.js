/* Screens, part A: getting in, the role homes, search, and the Calls area (incoming, dialer, callbacks). */
(function () {
  "use strict";
  const S = window.SCREENS;
  const ic = window.MK.ic;

  // ═══ 01 · Getting in ════════════════════════════════════════════════
  S.push({
    sec: "in", id: "A1", name: "Sign in",
    note: "One app for agents, owners and partners: the account decides which app opens. Keep me signed in and the emailed link come from the web sign-in; Face ID / fingerprint is new for mobile.",
    render: (k) => ({
      tab: null,
      body:
        '<div style="padding:40px 24px 0;display:flex;flex-direction:column;gap:18px">' +
        '<div style="width:64px;height:64px;border-radius:16px;background:#0d4037;display:grid;place-items:center">' + k.logo(42) + "</div>" +
        '<div><div class="disp ink" style="font-size:30px;font-weight:700">Sign in to Insurvas</div><div class="muted" style="margin-top:4px">Your calls, leads and book, wherever you are.</div></div>' +
        k.field("Email", "jordan@elleryfields.com", { lead: "mail" }) +
        k.field("Password", "••••••••••••", { lead: "lock", trail: "eye", focus: true }) +
        '<div class="between"><span class="ink" style="font-size:15px">Keep me signed in</span>' + k.sw(true) + "</div>" +
        k.btn("Sign in", "primary") +
        k.btn(k.ios ? "Sign in with Face ID" : "Sign in with fingerprint", "outline", k.ios ? "face" : "finger") +
        '<div class="cent gr" style="font-weight:600;font-size:15px">Email me a sign-in link</div>' +
        '<div class="cent mini" style="margin-top:20px">Forgot your password? · Help</div>' +
        "</div>",
    }),
  });

  S.push({
    sec: "in", id: "A2", name: "Your sign-in code",
    note: "Two-step sign-in, same rules as the web: a 6-digit code, and “Trust this phone for 30 days” bound to the session. The code autofills from SMS / the authenticator on both platforms.",
    render: (k) => ({
      tab: null,
      header: k.header({ back: k.ios ? "Back" : "", title: "", large: false }),
      body:
        '<div style="padding:12px 24px 0;display:flex;flex-direction:column;gap:20px">' +
        '<div><div class="disp ink" style="font-size:28px;font-weight:700">Enter your code</div><div class="muted" style="margin-top:6px">We sent a 6-digit code to your authenticator app for jordan@elleryfields.com.</div></div>' +
        '<div class="otp"><span>4</span><span>8</span><span>1</span><span>9</span><span class="on"></span><span></span></div>' +
        '<div class="between"><div><div class="ink" style="font-size:15px">Trust this phone for 30 days</div><div class="mini">You won’t be asked for a code here until 24 Dec.</div></div>' + k.sw(true) + "</div>" +
        k.btn("Verify", "primary") +
        '<div class="cent gr" style="font-weight:600;font-size:15px">Use a backup code instead</div>' +
        "</div>" +
        (k.ios
          ? '<div style="position:absolute;left:0;right:0;bottom:0;background:var(--surf2);height:300px;z-index:8;padding:8px 6px"><div style="background:var(--elev);border-radius:8px;height:42px;display:grid;place-items:center;color:var(--ink);font-size:15px;margin:0 2px 10px">From Messages · <b style="margin-left:6px">481923</b></div><div class="keypad" style="padding:0 6px;gap:8px 6px"><span style="border-radius:8px;height:46px;font-size:24px;background:var(--elev)">1</span><span style="border-radius:8px;height:46px;font-size:24px;background:var(--elev)">2</span><span style="border-radius:8px;height:46px;font-size:24px;background:var(--elev)">3</span><span style="border-radius:8px;height:46px;font-size:24px;background:var(--elev)">4</span><span style="border-radius:8px;height:46px;font-size:24px;background:var(--elev)">5</span><span style="border-radius:8px;height:46px;font-size:24px;background:var(--elev)">6</span><span style="border-radius:8px;height:46px;font-size:24px;background:var(--elev)">7</span><span style="border-radius:8px;height:46px;font-size:24px;background:var(--elev)">8</span><span style="border-radius:8px;height:46px;font-size:24px;background:var(--elev)">9</span></div></div>'
          : '<div style="position:absolute;left:0;right:0;bottom:0;background:var(--surf2);height:290px;z-index:8;padding:8px 10px"><div style="display:flex;gap:8px;margin-bottom:10px"><span class="fc on" style="height:36px">481923</span><span class="muted" style="font-size:13px;align-self:center">from Messages</span></div><div class="keypad" style="padding:0;gap:8px"><span style="border-radius:24px;height:48px;font-size:22px;background:var(--elev)">1</span><span style="border-radius:24px;height:48px;font-size:22px;background:var(--elev)">2</span><span style="border-radius:24px;height:48px;font-size:22px;background:var(--elev)">3</span><span style="border-radius:24px;height:48px;font-size:22px;background:var(--elev)">4</span><span style="border-radius:24px;height:48px;font-size:22px;background:var(--elev)">5</span><span style="border-radius:24px;height:48px;font-size:22px;background:var(--elev)">6</span><span style="border-radius:24px;height:48px;font-size:22px;background:var(--elev)">7</span><span style="border-radius:24px;height:48px;font-size:22px;background:var(--elev)">8</span><span style="border-radius:24px;height:48px;font-size:22px;background:var(--elev)">9</span></div></div>'),
    }),
  });

  S.push({
    sec: "in", id: "A3", name: "Turn on alerts",
    note: "Asked once, after the first sign-in, before the system prompt. Each kind maps to an existing bell category, so the phone and the web bell stay one inbox. Push is new infrastructure (Expo push / APNs + FCM).",
    render: (k) => ({
      tab: null,
      body:
        '<div style="padding:30px 20px 0;display:flex;flex-direction:column;gap:16px">' +
        '<div style="width:60px;height:60px;border-radius:16px;background:var(--green-soft);color:var(--green-ink);display:grid;place-items:center">' + ic("bell", 30) + "</div>" +
        '<div><div class="disp ink" style="font-size:28px;font-weight:700">Know the moment it matters</div><div class="muted" style="margin-top:6px">Pick what reaches your phone. You can change this any time in Settings › Notifications.</div></div>' +
        '<div class="card" style="overflow:hidden">' +
        k.row({ i: "phoneIn", t: "A transfer is waiting for you", m: "Rings like a call, even on silent", sw: true }) +
        k.row({ i: "calCheck", t: "Callback in 5 minutes", m: "With the customer’s local time", sw: true }) +
        k.row({ i: "fileCheck", t: "A case changes at the carrier", m: "Approved, declined, needs a document", sw: true }) +
        k.row({ i: "buoy", it: "w", t: "A policy is at risk", m: "Payment missed, pending lapse", sw: true }) +
        k.row({ i: "msgs", t: "Partner messages", m: "Only chats you’re in", sw: false }) +
        "</div>" +
        k.btn("Turn on alerts", "primary") +
        '<div class="cent gr" style="font-weight:600;font-size:15px">Not now</div>' +
        "</div>",
    }),
  });

  S.push({
    sec: "in", id: "A4", name: "Face ID next time",
    note: "Offered once after the first good sign-in. The biometric unlocks a key in the Keychain / Keystore; the server session rules (remember claim, session_version) are unchanged.",
    render: (k) => ({
      tab: "home",
      header: k.header({ title: "Today", actions: ["search"] }),
      body: '<div style="padding:0 16px;display:flex;flex-direction:column;gap:12px;opacity:.6"><div class="sk" style="height:120px;border-radius:16px"></div><div class="sk" style="height:90px;border-radius:16px"></div><div class="sk" style="height:200px;border-radius:16px"></div></div>',
      overlay: k.dialog(k.ios ? "Use Face ID to sign in?" : "Sign in with your fingerprint?",
        "Next time, open Insurvas with " + (k.ios ? "Face ID" : "your fingerprint") + " instead of your password. Your agency’s two-step rule still applies every 30 days.",
        [["Use " + (k.ios ? "Face ID" : "fingerprint"), "b"], ["Not now", ""]]),
    }),
  });

  // ═══ 02 · Home by role ══════════════════════════════════════════════
  S.push({
    sec: "home", id: "B1", name: "Home · producer",
    note: "The phone version of the dashboard’s Overview: what to do next, then today’s schedule in the customer’s time, then this week’s numbers. One gold button (Start calling). Every figure opens its filtered list.",
    badges: { calls: 2, inbox: 4 },
    render: (k) => ({
      tab: "home",
      header: k.header({ title: "Today", sub: "Tuesday 24 November", actions: ["search", '<span class="av sm">JR</span>'] }),
      body:
        '<div class="pad16"><div class="card p" style="display:flex;flex-direction:column;gap:12px">' +
        '<div class="between"><div><div class="ink" style="font-weight:600;font-size:17px">38 leads ready to call</div><div class="mini">Calling window open in 31 states · closes 9:00 pm ET</div></div>' + k.chip("ok", "Open") + "</div>" +
        k.btn("Start calling", "gold", "phoneOut") + "</div></div>" +
        k.sh("Needs you", "All") +
        '<div class="strip">' +
        k.tile("Transfers waiting", '<span class="tn">2</span>', "Longest 0:48", { i: "phoneIn" }) +
        k.tile("Callbacks due", '<span class="tn">3</span>', k.chip("warn", "1 overdue"), { i: "calCheck" }) +
        k.tile("Case needs a doc", '<span class="tn">1</span>', "Corebridge · APS", { i: "fileCheck" }) +
        k.tile("Payment missed", '<span class="tn">2</span>', "Save by 2 Dec", { i: "buoy" }) +
        "</div>" +
        k.sh("Schedule", "Calendar") +
        k.group("", [
          k.row({ i: "calCheck", it: "w", t: "Maria Alvarez", m: "Callback · 2 h overdue", chip: k.chip("warn", "Overdue") }),
          k.row({ i: "calCheck", t: "Robert Chen", m: "10:30 am her time · 11:30 am yours", r: "11:30" }),
          k.row({ i: "calendar", it: "i", t: "Patricia Moore", m: "Appointment · Zoom · 1:00 pm CT", r: "2:00" }),
          k.row({ i: "calCheck", t: "James Whitfield", m: "Callback · 3:15 pm PT · 6:15 pm yours", r: "6:15" }),
        ]) +
        k.sh("This week", "Activity") +
        '<div class="tiles pad16">' +
        k.tile("Dials", '<span class="tn">412</span>', "<b>↑ 9%</b> vs last week") +
        k.tile("Talk time", '<span class="tn">6h 12m</span>', "<b>↑ 31m</b> vs last week") +
        k.tile("Applications", '<span class="tn">7</span>', "2 waiting on signature") +
        k.tile("Issued premium", '<span class="tn">' + k.money("4,812") + "</span>", "<b>↑ $640</b> vs last week") +
        "</div>" +
        '<div class="pad16" style="margin-top:10px"><div class="card p" style="display:flex;gap:14px;align-items:center">' + k.ring(64, 76) +
        '<div><div class="ink" style="font-weight:600">November goal</div><div class="muted" style="font-size:14px">$7,680 of $12,000 issued annual premium · 6 working days left</div></div></div></div>',
    }),
  });

  S.push({
    sec: "home", id: "B2", name: "Home · agency owner",
    role: "owner",
    note: "Owner tabs swap Calls/Leads for Team and Money. Same order as the web agency dashboard: needs you, the month’s money with last month as the gold dashed line, then who is making the agency money.",
    badges: { inbox: "!6" },
    render: (k) => ({
      tab: "home", role: "owner",
      header: k.header({ title: "Ellery & Fields", sub: "November so far · 18 producers", actions: ["search", '<span class="av sm">DE</span>'] }),
      body:
        '<div class="strip">' +
        k.tile("Approve payouts", '<span class="tn">4</span>', "$18,240 · due Fri", { i: "wallet" }) +
        k.tile("Complaints due", '<span class="tn">2</span>', k.chip("warn", "1 in 2 days"), { i: "alert" }) +
        k.tile("Carrier decisions", '<span class="tn">6</span>', "Pick a client · 4", { i: "files" }) +
        k.tile("Licences expiring", '<span class="tn">1</span>', "TX · 9 Dec", { i: "badge" }) +
        "</div>" +
        '<div class="pad16" style="margin-top:14px"><div class="card p">' +
        '<div class="between"><span class="muted" style="font-size:14px;font-weight:500">Submitted premium</span>' + k.chip("gold", "↑ 12% vs Oct") + "</div>" +
        '<div class="big" style="font-size:38px;margin:4px 0 8px">' + k.money("86,420") + "</div>" +
        k.lines([2, 5, 9, 14, 19, 22, 28, 33, 41, 46, 52, 57, 63, 70, 77, 86], [3, 6, 8, 12, 16, 20, 24, 29, 33, 38, 42, 47, 52, 57, 62, 67], ["1", "", "", "", "", "", "", "8", "", "", "", "", "", "", "", "16"], 330, 130) +
        '<div class="row2 mini" style="margin-top:6px"><span style="display:inline-block;width:14px;height:2px;background:var(--green)"></span>November ($ thousands)<span style="display:inline-block;width:14px;border-top:2px dashed var(--gold);margin-left:10px"></span>October</div>' +
        "</div></div>" +
        '<div class="tiles pad16" style="margin-top:10px">' +
        k.tile("Issued", '<span class="tn">' + k.money("51,300") + "</span>", "71% placement") +
        k.tile("Chargebacks", '<span class="tn">' + k.money("2,140") + "</span>", k.chip("warn", "3 policies")) +
        "</div>" +
        k.sh("Producers", "All 18") +
        '<div class="card" style="margin:0 16px;padding:4px 0">' +
        [["1", "AK", "Ava Kim", "$14,920", 100, true], ["2", "JR", "Jordan Reyes", "$11,480", 77], ["3", "MO", "Marcus Ortiz", "$9,860", 66], ["4", "SL", "Sam Lee", "$7,210", 48]].map((r) =>
          '<div class="leader"><span class="rk ' + (r[5] ? "g" : "") + '">' + r[0] + "</span>" + k.av(r[1], "sm") + '<div style="flex:1;min-width:0"><div class="between"><span class="ink" style="font-weight:500">' + r[2] + '</span><span class="tn ink">' + r[3] + '</span></div><div class="bar"><i class="' + (r[5] ? "g" : "") + '" style="width:' + r[4] + '%"></i></div></div></div>').join("") +
        "</div>",
    }),
  });

  S.push({
    sec: "home", id: "B3", name: "Home · setter",
    role: "setter",
    note: "Setters see their own queue and their weekly target, never lead cost (money boundary). Dialer and Callbacks are tabs because that is the whole job.",
    badges: { callbacks: 3 },
    render: (k) => ({
      tab: "home", role: "setter",
      header: k.header({ title: "Today", sub: "Week 48 · target 25 appointments", actions: ["search"] }),
      body:
        '<div class="pad16"><div class="card p" style="display:flex;gap:16px;align-items:center">' + k.ring(72, 84, "18/25", true) +
        '<div style="flex:1"><div class="ink" style="font-weight:600;font-size:17px">7 to go this week</div><div class="muted" style="font-size:14px">You set 4 yesterday. 2 of last week’s showed up.</div></div></div></div>' +
        '<div class="pad16" style="margin-top:12px">' + k.btn("Serve next lead", "gold", "phoneOut") + "</div>" +
        k.sh("Today") +
        '<div class="tiles pad16">' + k.tile("Dials", "96") + k.tile("Contacts", "21") + k.tile("Appointments set", "4") + k.tile("Show rate", "62%", "last 30 days") + "</div>" +
        k.sh("Appointments you set", "All") +
        k.group("", [
          k.row({ i: "calendar", it: "i", t: "Linda Okafor", m: "With Ava Kim · Thu 2:00 pm ET", chip: k.chip("info", "Scheduled") }),
          k.row({ i: "calendar", it: "i", t: "George Patel", m: "With Jordan Reyes · Thu 4:30 pm CT", chip: k.chip("info", "Scheduled") }),
          k.row({ i: "calendar", t: "Betty Holmes", m: "With Marcus Ortiz · Tue 11:00 am", chip: k.chip("ok", "Showed") }),
        ]),
    }),
  });

  S.push({
    sec: "home", id: "B4", name: "Search everything",
    note: "The phone’s ⌘K. Searches leads, clients, policies (number or phone) and pages you can open. Records show a type icon, never an avatar. Recent searches stay on the phone only.",
    render: (k) => ({
      tab: null,
      header: k.ios
        ? '<div class="hdr"><div style="display:flex;gap:10px;align-items:center;padding:6px 16px 10px"><div class="srch" style="flex:1;color:var(--ink)">' + ic("search", 18) + "<span>alva</span></div><span class=\"gr\" style=\"font-size:17px\">Cancel</span></div>" + k.fchips([{ t: "All", on: true }, "Leads", "Policies", "Cases", "Pages"]) + "</div>"
        : '<div class="hdr"><div style="display:flex;gap:6px;align-items:center;padding:6px 8px 10px;height:64px"><span class="ib" style="width:48px;height:48px;display:grid;place-items:center;color:var(--ink)">' + ic("arrowL", 24) + '</span><span style="flex:1;font-size:18px;color:var(--ink)">alva</span><span style="width:48px;height:48px;display:grid;place-items:center;color:var(--muted)">' + ic("x", 22) + "</span></div>" + k.fchips([{ t: "All", on: true }, "Leads", "Policies", "Cases", "Pages"]) + '<div style="height:1px;background:var(--line);margin-top:10px"></div></div>',
      body:
        k.group("Leads", [
          k.row({ i: "user", it: "plain", t: "Maria <b>Alva</b>rez", m: "Final expense · Callback · (305) 555-0148", chip: k.chip("warn", "Overdue") }),
          k.row({ i: "user", it: "plain", t: "Tomas <b>Alva</b>rado", m: "Term life · New · (512) 555-0190" }),
        ]) +
        k.group("Policies", [
          k.row({ i: "book", it: "plain", t: "Maria <b>Alva</b>rez", m: '<span class="mono">0119990312</span> · American Amicable', chip: k.chip("ok", "In force") }),
        ]) +
        k.group("Retention cases", [
          k.row({ i: "buoy", it: "plain", t: "Ruth <b>Alva</b>", m: "Payment missed · Mutual of Omaha", chip: k.chip("warn", "8 days left") }),
        ]) +
        k.group("Recent", [
          k.row({ i: "history", it: "plain", t: "Robert Chen", chev: false }),
          k.row({ i: "history", it: "plain", t: "0119990312", chev: false }),
        ]),
    }),
  });

  // ═══ 03 · Calls: incoming transfers ════════════════════════════════
  S.push({
    sec: "calls", id: "C1", name: "Incoming calls",
    note: "Inbound on the phone: your availability, then everyone waiting, longest first. Age is years; wait carries m:ss, two columns apart in spirit. Claim is race-safe and opens the call.",
    badges: { calls: 2, inbox: 4 },
    render: (k) => ({
      tab: "calls",
      header: k.header({ title: "Calls", actions: ["sliders"], belowFull: '<div class="pad16" style="padding-bottom:10px">' + (k.ios ? k.seg(["Incoming 2", "Dialer", "Callbacks 3"], 0) : "") + "</div>" + (k.ios ? "" : k.utabs(['Incoming <span class="n">2</span>', "Dialer", 'Callbacks <span class="n">3</span>'], 0)) }),
      body:
        '<div class="pad16" style="margin-top:' + (k.ios ? 0 : 12) + 'px"><div class="card p between"><div class="row2"><span style="width:10px;height:10px;border-radius:50%;background:var(--green)"></span><div><div class="ink" style="font-weight:600">You’re taking calls</div><div class="mini">Next transfer rings this phone · 2 ahead of you</div></div></div>' + k.sw(true) + "</div></div>" +
        '<div class="pad16" style="margin-top:12px">' + k.btn("Take the next caller", "gold", "phoneIn") + "</div>" +
        k.sh("Waiting now") +
        '<div class="pad16" style="display:flex;flex-direction:column;gap:10px">' +
        [["Dolores King", "71", "FL", "Final expense", "Apex Leads", "0:48", "ok", "DNC clear"], ["Walter Brooks", "66", "GA", "Final expense", "Summit Media", "0:21", "warn", "Needs review"]].map((r) =>
          '<div class="card p"><div class="between"><div style="min-width:0"><div class="ink" style="font-weight:600;font-size:17px">' + r[0] + '</div><div class="muted" style="font-size:14px">' + r[1] + " yrs · " + r[2] + " · " + r[3] + "</div></div>" +
          '<div style="text-align:right"><div class="tn ink disp" style="font-size:22px;font-weight:700">' + r[5] + '</div><div class="mini">waiting</div></div></div>' +
          '<div class="between" style="margin-top:10px">' + '<span class="row2 mini">' + ic("handshake", 15) + r[4] + "</span>" + k.chip(r[6], r[7]) + "</div>" +
          '<div class="btnrow" style="margin-top:12px">' + k.btn("Details", "outline", null, "sm") + k.btn("Claim", "primary", "phoneIn", "sm") + "</div></div>").join("") +
        "</div>" +
        k.sh("Handoffs for you") +
        k.group("", [k.row({ i: "userPlus", it: "g", t: "Nora Bell from Sam (assistant)", m: "Verification 9 of 12 done · 3 min ago", chip: '<span class="btn sm tonal" style="height:32px">Accept</span>', chev: false })]),
    }),
  });

  S.push({
    sec: "calls", id: "C2", name: "A transfer rings",
    note: "New for mobile. iOS: a time-sensitive notification plus a Live Activity counting the wait on the Lock Screen and Dynamic Island. Android: a full-screen call-style notification. Take call claims it server-side, then opens Caller profile.",
    render: (k) => ({
      full:
        '<div class="lock"><div class="wall"></div>' + k.status({ light: true, time: "2:14" }) +
        (k.ios ? '<div class="date">Tuesday 24 November</div><div class="time">2:14</div>' : '<div class="time">2:14</div><div class="date">Tue, 24 Nov</div>') +
        (k.ios
          ? '<div style="flex:1"></div>' +
            '<div class="live" style="margin-bottom:12px"><div class="between" style="font-size:13px;opacity:.75"><span class="row2">' + '<span style="width:20px;height:20px;border-radius:5px;background:#0d4037;display:grid;place-items:center"><img src="isotype-on-dark.svg" width="14" height="14" alt=""></span>Insurvas · Incoming transfer</span><span>now</span></div>' +
            '<div class="between" style="margin-top:10px"><div><div style="font-size:20px;font-weight:600">Dolores King</div><div style="opacity:.75;font-size:14px">71 yrs · FL · Final expense · DNC clear</div></div><div style="text-align:right"><div class="tn" style="font-family:Inter Tight;font-size:28px;font-weight:700">0:12</div><div style="opacity:.7;font-size:12px">waiting</div></div></div>' +
            '<div style="display:flex;gap:10px;margin-top:14px"><span style="flex:1;height:46px;border-radius:14px;background:rgba(255,255,255,.14);display:grid;place-items:center;font-weight:600">Pass</span><span style="flex:2;height:46px;border-radius:14px;background:#07d6a0;color:#04251d;display:flex;align-items:center;justify-content:center;gap:8px;font-weight:700">' + ic("phoneIn", 18) + "Take call</span></div></div>" +
            '<div class="noti" style="margin-bottom:96px"><div class="ai">' + '<img src="isotype-on-dark.svg" width="26" height="26" alt="">' + '</div><div class="nm"><div class="nh"><b>Insurvas</b><span>now</span></div><div class="nb"><b>Callback in 5 minutes</b><br>Robert Chen · 10:30 am his time (CT)</div></div></div>'
          : '<div style="flex:1"></div>' +
            '<div class="noti" style="margin-bottom:10px;padding:16px"><div class="top"><span class="ai"><img src="isotype-on-dark.svg" width="14" height="14" alt=""></span>Insurvas · Incoming transfer · now</div>' +
            '<div class="between"><div><div style="font-size:19px;font-weight:600">Dolores King</div><div style="opacity:.75;font-size:14px">71 yrs · FL · Final expense · DNC clear</div></div><div class="tn" style="font-family:Inter Tight;font-size:26px;font-weight:700">0:12</div></div>' +
            '<div style="display:flex;gap:10px;margin-top:8px"><span style="flex:1;height:48px;border-radius:24px;background:#3a2422;color:#f0837c;display:flex;align-items:center;justify-content:center;gap:8px;font-weight:600">' + ic("x", 18) + 'Pass</span><span style="flex:1;height:48px;border-radius:24px;background:#07d6a0;color:#04251d;display:flex;align-items:center;justify-content:center;gap:8px;font-weight:700">' + ic("phoneIn", 18) + "Take call</span></div></div>" +
            '<div class="noti" style="margin-bottom:84px"><div class="top"><span class="ai"><img src="isotype-on-dark.svg" width="14" height="14" alt=""></span>Insurvas · 2 min ago</div><div class="nb"><b>Callback in 5 minutes</b><br>Robert Chen · 10:30 am his time (CT)</div><div class="na"><span>Open</span><span>Snooze 10 min</span></div></div>') +
        "</div>",
    }),
  });

  const callSteps = (k, cur) => '<div class="pad16" style="padding-bottom:12px"><div class="between mini" style="margin-bottom:8px"><span>Step ' + (cur + 1) + " of 4 · " + ["Caller profile", "Verification", "Application", "Finish the call"][cur] + '</span><span class="row2 tn" style="color:var(--green-ink);font-weight:600">' + ic("phone", 14) + "On the call 03:18</span></div>" + k.stepper(4, cur) + "</div>";

  S.push({
    sec: "calls", id: "C3", name: "Caller profile",
    note: "Step 1 of the same four steps as the web call page (?phase=check). The checks the server already ran are ticks, not a block of text. Phone has Copy, never a tel: link.",
    render: (k) => ({
      tab: null,
      header: k.header({ back: k.ios ? "Calls" : " ", title: "Dolores King", large: false, actions: ["moreH"], belowFull: callSteps(k, 0) }),
      body:
        '<div class="pad16 gap">' +
        '<div class="card p"><div class="disp ink" style="font-size:26px;font-weight:700">Dolores King</div><div class="muted">71 yrs · Born 3 Mar 1954 · Jacksonville, FL</div>' +
        '<div class="hr"></div>' + k.kv([["Phone", '(904) 555-0117 <span class="gr" style="font-weight:600;margin-left:6px">Copy</span>'], ["Email", "dking54@mail.com"], ["Language", "English"], ["Product", "Final expense"], ["From", "Apex Leads · FE-Florida-2"]]) + "</div>" +
        '<div class="card p"><h4>Checks</h4><div style="display:flex;flex-direction:column;gap:10px;margin-top:10px">' +
        [["Not on any Do Not Call list", "Checked 0:14 ago"], ["Consent on file", "Web form · 22 Nov · TrustedForm"], ["Not already your client", "No match on phone or date of birth"], ["Inside the calling window", "2:14 pm her time · open until 8 pm"]].map((c) => '<div class="row2" style="align-items:flex-start"><span style="color:var(--ok);margin-top:1px">' + ic("checkC", 20) + '</span><div><div class="ink" style="font-size:15px">' + c[0] + '</div><div class="mini">' + c[1] + "</div></div></div>").join("") + "</div></div>" +
        '<div class="card p"><h4>From the partner</h4><div style="margin-top:6px;font-size:15px">“Wants $10k to cover burial, husband passed in spring. Prefers afternoons.”</div><div class="mini" style="margin-top:6px">Apex Leads · 2 min ago · first call with us</div></div>' +
        "</div>",
      after: '<div style="position:absolute;left:0;right:0;bottom:0;padding:12px 16px 34px;background:var(--bar);backdrop-filter:blur(20px);border-top:.5px solid var(--line);z-index:20">' + k.btn("Next: Verification", "primary") + "</div>",
    }),
  });

  S.push({
    sec: "calls", id: "C4", name: "Verification",
    note: "Field by field, each saved the moment it is tapped (a dropped call loses nothing). The next outstanding field is opened and obvious; a corrected field looks different from a confirmed one.",
    render: (k) => ({
      tab: null,
      header: k.header({ back: k.ios ? "Profile" : " ", title: "Verification", large: false, actions: ["moreH"], belowFull: callSteps(k, 1) }),
      body:
        '<div class="pad16"><div class="between" style="margin-bottom:8px"><span class="ink" style="font-weight:600">7 of 12 confirmed</span><span class="mini">1 corrected</span></div><div class="prog"><i style="width:58%"></i></div></div>' +
        k.group("Confirmed", [
          k.row({ i: "check", t: "Full legal name", m: "Dolores Ann King", chev: false, chip: k.chip("ok", "Confirmed") }),
          k.row({ i: "check", t: "Date of birth", m: "3 Mar 1954 · 71", chev: false, chip: k.chip("ok", "Confirmed") }),
          k.row({ i: "pencil", it: "i", t: "Home address", m: "4120 Oak Hollow Dr, Jacksonville FL 32210", chev: false, chip: k.chip("info", "Corrected") }),
        ]) +
        '<div class="grp-t">Now</div>' +
        '<div class="pad16"><div class="card p" style="border-color:var(--green);box-shadow:0 0 0 1px var(--green)"><div class="mini">Beneficiary</div><div class="ink" style="font-size:19px;font-weight:600;margin-top:2px">Karen King · daughter</div><div class="mini" style="margin-top:4px">From the partner’s form. Read it back to her.</div>' +
        '<div class="btnrow" style="margin-top:12px">' + k.btn("Correct", "outline", "pencil", "sm") + k.btn("Confirm", "primary", "check", "sm") + "</div></div></div>" +
        k.group("Still to check", [
          k.row({ i: "clock", it: "plain", t: "Bank for the draft", m: "Not asked yet", chev: false }),
          k.row({ i: "clock", it: "plain", t: "Tobacco in the last 12 months", m: "Not asked yet", chev: false }),
          k.row({ i: "clock", it: "plain", t: "Height and weight", m: "Optional for this product", chev: false }),
        ]),
      after: '<div style="position:absolute;left:0;right:0;bottom:0;padding:10px 16px 34px;background:var(--bar);backdrop-filter:blur(20px);border-top:.5px solid var(--line);z-index:20;display:flex;flex-direction:column;gap:6px">' + k.btn("Continue to Application", "primary") + '<div class="cent gr" style="font-weight:600;font-size:15px;padding:6px">Skip · finish the call</div></div>',
    }),
  });

  S.push({
    sec: "calls", id: "C5", name: "Correct a field",
    note: "Edit surface for C4. A sheet keeps the call context visible behind it. Saving records “corrected”, who and when, in the field history.",
    render: (k) => ({
      tab: null,
      header: k.header({ back: k.ios ? "Profile" : " ", title: "Verification", large: false, belowFull: callSteps(k, 1) }),
      body: '<div class="pad16" style="opacity:.5"><div class="prog"><i style="width:58%"></i></div></div>',
      overlay: k.sheet("Correct the beneficiary",
        '<div style="display:flex;flex-direction:column;gap:16px;padding-top:6px">' +
        '<div class="mini">Partner sent: <span class="ink">Karen King · daughter</span></div>' +
        k.field("Full name", "Karen L. Whitaker", { focus: true }) +
        k.field("Relationship", "Daughter", { trail: "chevD" }) +
        k.field("Share", "100%", { trailText: "of the benefit" }) +
        '<div class="mini">Saved the moment you tap Save. If the call drops, it’s still here.</div>' +
        k.btn("Save correction", "primary") + "</div>", { h: 560 }),
    }),
  });

  S.push({
    sec: "calls", id: "C6", name: "Finish the call",
    note: "The disposition tree, one question at a time, with the walked path editable and the consequence shown right above the commit. Saving opens Daily deal flow, as on the web.",
    render: (k) => ({
      tab: null,
      header: k.header({ back: k.ios ? "Back" : " ", title: "Finish the call", large: false, belowFull: callSteps(k, 3) }),
      body:
        '<div class="pad16 gap">' +
        '<div class="card p"><div class="mini">Your answers</div>' +
        '<div style="display:flex;flex-direction:column;gap:8px;margin-top:8px">' +
        [["1", "Did you reach the customer?", "Yes, talked"], ["2", "Is she interested?", "Yes, not today"]].map((a) => '<div class="between"><div class="row2" style="font-size:14px"><span class="mono muted">' + a[0] + '</span><span class="muted">' + a[1] + '</span></div><span class="row2 ink" style="font-size:14px;font-weight:500">' + a[2] + '<span class="gr" style="font-size:13px;font-weight:600">Edit</span></span></div>').join("") +
        "</div></div>" +
        '<div><div class="disp ink" style="font-size:24px;font-weight:700;margin:6px 0 12px">Why not today?</div><div style="display:flex;flex-direction:column;gap:8px">' +
        [["Wants to talk to family first", true], ["Needs to check the budget", false], ["Wants a lower amount", false], ["Asked us to call back later", false]].map((o) => '<div class="card" style="padding:14px 16px;display:flex;align-items:center;gap:12px;' + (o[1] ? "border-color:var(--green);background:var(--green-soft)" : "") + '"><span style="width:22px;height:22px;border-radius:50%;border:2px solid ' + (o[1] ? "var(--green)" : "var(--line2)") + ';display:grid;place-items:center">' + (o[1] ? '<i style="width:10px;height:10px;border-radius:50%;background:var(--green);display:block"></i>' : "") + '</span><span class="ink" style="font-size:16px;font-weight:' + (o[1] ? 600 : 400) + '">' + o[0] + "</span></div>").join("") +
        "</div></div>" +
        '<div class="card p"><h4>When should we call back?</h4><div class="mini" style="margin-top:2px">In her time: Florida, Eastern</div><div class="fchips" style="padding:10px 0 0">' + [{ t: "Tomorrow 2 pm", on: true }, "Thu 10 am", "Fri 4 pm", { t: "Pick…", i: "calendar" }].map((c) => typeof c === "string" ? '<span class="fc">' + c + "</span>" : '<span class="fc' + (c.on ? " on" : "") + '">' + (c.i ? ic(c.i, 16) : "") + c.t + "</span>").join("") + "</div></div>" +
        '<div class="card p" style="background:var(--surf2)"><h4>What happens when you save</h4><div style="display:flex;flex-direction:column;gap:6px;margin-top:8px;font-size:15px">' +
        '<div class="row2">' + ic("calCheck", 18) + "Callback Wed 25 Nov, 2:00 pm her time (2:00 pm yours)</div>" +
        '<div class="row2">' + ic("kanban", 18) + "Lead moves to <b class=\"ink\" style=\"margin-left:4px\">Callback</b></div>" +
        '<div class="row2">' + ic("bell", 18) + "You get a reminder 5 minutes before</div></div></div>" +
        "</div>",
      after: '<div style="position:absolute;left:0;right:0;bottom:0;padding:12px 16px 34px;background:var(--bar);backdrop-filter:blur(20px);border-top:.5px solid var(--line);z-index:20">' + k.btn("Save outcome", "primary") + "</div>",
    }),
  });

  // ═══ Dialer ═════════════════════════════════════════════════════════
  const dialerHead = (k) => k.header({
    title: "Calls", actions: ["search", "sliders"],
    belowFull: '<div class="pad16" style="padding-bottom:10px">' + (k.ios ? k.seg(["Incoming 2", "Dialer", "Callbacks 3"], 1) : "") + "</div>" + (k.ios ? "" : k.utabs(['Incoming <span class="n">2</span>', "Dialer", 'Callbacks <span class="n">3</span>'], 1)),
  });

  S.push({
    sec: "calls", id: "C7", name: "Dialer",
    note: "Web Dialer A on a phone: the list is the screen, the current lead opens in place at its head. Compliance is five ticks with Details. Tapping Call asks the server first, records the disclosure, then hands the number to the phone’s own dialer.",
    badges: { calls: 2, inbox: 4 },
    render: (k) => ({
      tab: "calls",
      header: dialerHead(k),
      body:
        '<div class="fchips" style="margin-top:' + (k.ios ? 0 : 12) + 'px">' + '<span class="fc">Called <span class="n">41</span></span><span class="fc">Contacts <span class="n">9</span></span><span class="fc">Apps <span class="n">2</span></span><span class="fc">' + ic("skip", 16) + "Auto-next " + '<span class="sw on" style="transform:scale(.6);margin:0 -8px"></span></span></div>' +
        '<div class="pad16" style="margin-top:12px"><div class="card p" style="border-color:var(--green)">' +
        '<div class="between"><div><div class="mini">Now · lead 1 of 38</div><div class="disp ink" style="font-size:24px;font-weight:700">Harold Nguyen</div><div class="muted" style="font-size:14px">64 yrs · Houston, TX · Term life</div></div>' + k.chip("ok", "Open till 8 pm CT") + "</div>" +
        '<div style="display:flex;flex-wrap:wrap;margin-top:10px;gap:6px 14px;color:var(--muted);font-size:13px;white-space:nowrap">' + '<span class="row2" style="gap:4px">' + ic("package", 15) + "Summit</span>" + '<span class="row2" style="gap:4px">' + ic("target", 15) + "TX Term Nov</span>" + '<span class="row2" style="gap:4px">' + ic("history", 15) + "Attempt 3</span>" + '<span class="row2" style="gap:4px">' + ic("clock", 15) + "1:12 pm his time</span></div>" +
        '<div class="ticks" style="margin-top:12px">' + ["Consent", "DNC clear", "Not suppressed", "In window", "Not a client"].map((t) => '<span class="chip ok" style="height:26px">' + ic("check", 14) + t + "</span>").join("") + "</div>" +
        '<div class="between" style="margin-top:8px"><span class="mini">Server checks again just before dialing.</span><span class="gr" style="font-size:14px;font-weight:600">Details</span></div>' +
        '<div class="btnrow" style="margin-top:12px">' + k.btn("Skip", "outline", "skip", "sm") + '<div class="btn primary" style="height:44px;flex:2.2">' + ic("phone", 20) + "Call (713) 555-0144</div></div>" +
        "</div></div>" +
        k.sh("Up next", "37 more") +
        k.group("", [
          k.row({ i: "user", it: "plain", t: "Linda Okafor", m: "Final expense · GA · attempt 1", chip: k.chip("brand", "High") }),
          k.row({ i: "user", it: "plain", t: "Frank Delgado", m: "Term life · AZ · attempt 2", chip: k.chip("brand", "High") }),
          k.row({ i: "user", it: "plain", t: "Ruth Simmons", m: "Final expense · OH · callback 3:00", chip: k.chip("info", "Callback") }),
          k.row({ i: "user", it: "plain", t: "Kevin Marsh", m: "IUL · CA · window opens 11 am PT", chip: k.chip("", "Later") }),
        ]),
    }),
  });

  S.push({
    sec: "calls", id: "C8", name: "Back from the call",
    note: "The call itself happens in the phone’s dialer. When you come back, the app is already on this sheet: the ten outcomes as tiles (Interested spans two), a note, then Save outcome + next lead. Start application keeps everything said so far.",
    render: (k) => ({
      tab: null,
      header: k.header({ back: k.ios ? "Dialer" : " ", title: "Harold Nguyen", large: false, actions: ["moreH"] }),
      body:
        '<div class="pad16 gap">' +
        '<div class="card p between"><div><div class="mini">Call ended</div><div class="disp ink tn" style="font-size:30px;font-weight:700">6:42</div></div><div style="text-align:right"><div class="mini">Disclosure</div>' + k.chip("ok", "Read at 0:09") + "</div></div>" +
        '<div><div class="ink" style="font-weight:600;font-size:17px;margin-bottom:10px">What happened?</div><div class="outc">' +
        [["Interested", "star", "w2 on"], ["Application", "filePen"], ["Callback", "calCheck"], ["No answer", "phoneOff"], ["Voicemail", "mic"], ["Not interested", "x"], ["Wrong number", "ban"], ["Do not call", "shieldX"], ["Appointment", "calendar"], ["Bad lead", "undo"]].map((o) => '<span class="' + (o[2] || "") + '">' + ic(o[1], 20) + o[0] + "</span>").join("") +
        "</div></div>" +
        k.field("Note for the next agent", "Wants a quote for $250k, 20 years. Wife on the call next time.", {}) +
        "</div>",
      after: '<div style="position:absolute;left:0;right:0;bottom:0;padding:12px 16px 34px;background:var(--bar);backdrop-filter:blur(20px);border-top:.5px solid var(--line);z-index:20;display:flex;gap:10px">' + k.btn("Start application", "outline", "filePen") + k.btn("Save · next lead", "primary", "skip") + "</div>",
      overlay: k.toast("Outcome saved · Interested", k.ios ? "" : "Undo"),
    }),
  });

  S.push({
    sec: "calls", id: "C9", name: "Schedule a callback",
    note: "Edit surface from C6 / C8 / the lead. Times are picked in the customer’s zone and shown in yours underneath, the failure this screen exists to prevent.",
    render: (k) => ({
      tab: null,
      header: k.header({ back: k.ios ? "Dialer" : " ", title: "Harold Nguyen", large: false }),
      body: '<div class="pad16" style="opacity:.45"><div class="sk" style="height:110px;border-radius:16px"></div></div>',
      overlay: k.sheet("Call Harold back",
        '<div style="display:flex;flex-direction:column;gap:14px">' +
        '<div class="wk" style="padding:0">' + [["Tue", "24"], ["Wed", "25", 1], ["Thu", "26"], ["Fri", "27"], ["Sat", "28"], ["Sun", "29"], ["Mon", "30"]].map((d) => '<div class="' + (d[2] ? "on" : "") + '">' + d[0] + "<b>" + d[1] + "</b></div>").join("") + "</div>" +
        '<div class="mini">His time · Texas (Central)</div>' +
        '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">' + ["9:00 am", "10:00 am", "11:30 am", "1:00 pm", "2:30 pm", "4:00 pm"].map((t, i) => '<span class="fc ' + (i === 3 ? "on" : "") + '" style="justify-content:center;height:42px">' + t + "</span>").join("") + "</div>" +
        '<div class="card p" style="background:var(--surf2);border:0"><div class="between"><span class="ink" style="font-weight:600">Wed 25 Nov, 1:00 pm his time</span></div><div class="mini" style="margin-top:2px">2:00 pm your time (Eastern)</div></div>' +
        '<div class="between"><span class="ink">Remind me 5 minutes before</span>' + k.sw(true) + "</div>" +
        '<div class="between"><span class="ink">Anyone on the team can take it</span>' + k.sw(false) + "</div>" +
        k.btn("Save callback", "primary") + "</div>", { h: 620 }),
    }),
  });

  S.push({
    sec: "calls", id: "C10", name: "Dialing blocked",
    note: "When the server says no, a dialog (the one place a notice may sit, because it blocks an action). Plain words, what was checked and when, and the next useful move.",
    render: (k) => ({
      tab: "calls",
      header: dialerHead(k),
      body: '<div class="pad16" style="margin-top:12px;opacity:.6"><div class="card p" style="height:300px"></div></div>',
      overlay: k.dialog("We can’t call this number",
        "Frank Delgado’s number is on the national Do Not Call list and we have no written consent for it. Checked just now, before dialing.",
        [["Skip to the next lead", "b"], ["See the checks", ""]]),
    }),
  });

  S.push({
    sec: "calls", id: "C11", name: "Callbacks",
    note: "Overdue first, counted, with how late each is. Every row carries the customer’s time and yours. Android gets a Schedule FAB; iOS puts + in the bar.",
    badges: { calls: 2, inbox: 4 },
    render: (k) => ({
      tab: "calls",
      header: k.header({
        title: "Calls", actions: k.ios ? ["calendar", "plus"] : ["calendar"],
        belowFull: '<div class="pad16" style="padding-bottom:10px">' + (k.ios ? k.seg(["Incoming 2", "Dialer", "Callbacks 3"], 2) : "") + "</div>" + (k.ios ? "" : k.utabs(['Incoming <span class="n">2</span>', "Dialer", 'Callbacks <span class="n">3</span>'], 2)),
      }),
      body:
        '<div class="wk" style="margin-top:' + (k.ios ? 0 : 10) + 'px">' + [["T", "24", 1, 1], ["W", "25", 0, 1], ["T", "26", 0, 1], ["F", "27"], ["S", "28"], ["S", "29"], ["M", "30", 0, 1]].map((d) => '<div class="' + (d[2] ? "on" : "") + '">' + d[0] + "<b>" + d[1] + '</b><i class="' + (d[3] ? "" : "n") + '"></i></div>').join("") + "</div>" +
        k.group('<span style="color:var(--warn);font-weight:600">Overdue · 1</span>', [
          k.row({ i: "calCheck", it: "w", t: "Maria Alvarez", m: "Was 9:30 am her time (CT) · 10:30 yours", chip: k.chip("warn", "2 h late") }),
        ]) +
        k.group("Today · 3", [
          k.row({ i: "calCheck", t: "Robert Chen", m: "10:30 am his time (CT) · 11:30 am yours", r: "11:30" }),
          k.row({ i: "calCheck", t: "James Whitfield", m: "3:15 pm his time (PT) · 6:15 pm yours", r: "6:15" }),
          k.row({ i: "calCheck", t: "Ruth Simmons", m: "3:00 pm her time (ET) · same as yours", r: "3:00" }),
        ]) +
        k.group("Tomorrow · 2", [
          k.row({ i: "calCheck", t: "Harold Nguyen", m: "1:00 pm his time (CT) · 2:00 pm yours", r: "2:00" }),
          k.row({ i: "calendar", it: "i", t: "Patricia Moore", m: "Appointment · Zoom · 10:00 am ET", r: "10:00" }),
        ]) +
        '<div class="row2 mini pad16" style="margin-top:14px;gap:14px"><span class="row2" style="gap:5px"><i style="width:8px;height:8px;border-radius:50%;background:var(--info);display:block"></i>Scheduled</span><span class="row2" style="gap:5px"><i style="width:8px;height:8px;border-radius:50%;background:var(--warn);display:block"></i>Overdue</span><span class="row2" style="gap:5px"><i style="width:8px;height:8px;border-radius:50%;background:var(--ok);display:block"></i>Completed</span></div>',
      fab: k.fab("Schedule", "plus"),
    }),
  });

  S.push({
    sec: "calls", id: "C12", name: "Callback detail",
    note: "Complete is the primary outcome; Reschedule is outline; Cancel is a quiet destructive link that asks first. Call goes through the dialer’s checks.",
    render: (k) => ({
      tab: "calls",
      header: k.header({ title: "Calls" }),
      body: '<div class="pad16" style="opacity:.4"><div class="sk" style="height:300px;border-radius:16px"></div></div>',
      overlay: k.sheet("",
        '<div style="display:flex;flex-direction:column;gap:14px">' +
        '<div><div class="disp ink" style="font-size:26px;font-weight:700">Maria Alvarez</div><div class="muted">Final expense · Miami, FL</div></div>' +
        '<div class="card p"><div class="between"><span class="ink" style="font-weight:600">Callback</span>' + k.chip("warn", "2 h overdue") + '</div><div class="ink" style="margin-top:4px">Was today 9:30 am her time (Central)</div><div class="mini">10:30 am your time (Eastern)</div></div>' +
        '<div class="btnrow">' + k.btn("Call", "primary", "phone") + k.btn("Lead", "outline", "user") + "</div>" +
        '<div class="card p"><h4>History</h4><div class="timeline" style="margin-top:10px">' +
        '<div class="ev"><div class="e1">Callback set by you</div><div class="e2">Mon 23 Nov · “Wants to talk to her son first”</div></div>' +
        '<div class="ev mut"><div class="e1">Call · 4:10</div><div class="e2">Mon 23 Nov · Interested, not today</div></div>' +
        '<div class="ev mut"><div class="e1">Lead arrived from Apex Leads</div><div class="e2">Sun 22 Nov</div></div></div></div>' +
        '<div class="btnrow">' + k.btn("Reschedule", "outline", "calendar") + k.btn("Complete", "primary", "check") + "</div>" +
        '<div class="cent" style="color:var(--bad);font-weight:600;font-size:15px;padding:4px">Cancel this callback</div>' +
        "</div>", { h: 720 }),
    }),
  });

  S.push({
    sec: "calls", id: "C13", name: "Calendar",
    note: "Appointments and callbacks together (the web Calendar). Month on top, the selected day below. Gold dots are your bookings, orange is overdue, green is done.",
    render: (k) => {
      const days = [];
      for (let i = 0; i < 35; i++) {
        const d = i - 6;
        const o = d < 1 || d > 30;
        const num = d < 1 ? 31 + d : d > 30 ? d - 30 : d;
        const dots = { 2: "u", 5: "uu", 9: "g", 12: "uug", 16: "u", 18: "g", 19: "uu", 23: "wu", 24: "uuu", 25: "u", 26: "uu", 30: "u" }[d] || "";
        days.push('<span class="' + (o ? "o " : "") + (d === 24 ? "on" : "") + '"><b>' + num + "</b><i>" + dots.split("").map((c) => '<u class="' + (c === "w" ? "w" : c === "g" ? "g" : "") + '"></u>').join("") + "</i></span>");
      }
      return {
        tab: "calls",
        header: k.header({ back: k.ios ? "Calls" : " ", title: "November 2026", large: true, actions: ["search", "plus"] }),
        body:
          '<div class="month">' + ["M", "T", "W", "T", "F", "S", "S"].map((h) => '<span class="h" style="height:auto">' + h + "</span>").join("") + days.join("") + "</div>" +
          '<div class="hr" style="margin:14px 16px"></div>' +
          '<div class="pad16 mini" style="margin-bottom:6px">Tuesday 24 November · 4 things</div>' +
          k.group("", [
            k.row({ i: "calCheck", it: "w", t: "9:30 · Maria Alvarez", m: "Callback · her time 8:30 CT", chip: k.chip("warn", "Overdue") }),
            k.row({ i: "calCheck", t: "11:30 · Robert Chen", m: "Callback · his time 10:30 CT" }),
            k.row({ i: "calendar", it: "i", t: "2:00 · Patricia Moore", m: "Appointment · Zoom · set by Lena (setter)" }),
            k.row({ i: "calCheck", t: "6:15 · James Whitfield", m: "Callback · his time 3:15 PT" }),
          ]),
      };
    },
  });
})();
