# Manager review — 28 Oct 2026 (Zoom recording, 52 min)

Reviewer: Umar (shared screen, reviewed the **deployed** build at `insurvas-new.vercel.app`).
Also on the call: Rion, Rinor, Olti.

Transcript was made locally with WhisperX (small model), so some words are misheard:
"careers" = **carriers**, "Rihon/Leon" = **Rion/Rinor**, "SUS/SAS" = **SaaS**, "bread" = **breadcrumb**.
Timestamps below point into the recording.

---

## 0. Process note (said at 20:57 and 24:09)

- **The app layout (sidebar, top bar, profile/account menu) is Rion's job.** Other people should only work on the pages *inside* the layout, using Rion's foundation components.
- The current deployed build mixes Rion's and Rinor's layout changes, which is why things appear in two or three places at once. Untangle these before the next review.
- Umar only reviews what is shown to him, so bring finished changes.

---

## 1. Sign-up flow (00:00 – 15:50)

What he saw: split screen, form on the left, a green panel on the right with a static
"Five steps to your workspace" checklist. Steps: Account → Email → Agency → Plan → Payment.

### 1.1 Step 1 should only ask for email + password (12:21 – 12:51)
- **He said:** the first screen should be email, password and "Continue with Google". Nothing else. First name, last name and phone go to the next step, with the business/personal info. "Mostly screens you will see like this": email, password, sign up with Google, continue. He showed Dribbble sign-up examples.
- **Also (00:01):** email and password should each be a **full-width, one-column** field (right now they sit side by side).
- **How to do it best:**
  - Order: **Continue with Google** (primary social button) → "or" divider → Email → Password (with show/hide and a live strength hint) → one **Create account** button.
  - Put the terms text *under* the button ("By continuing you agree to…") instead of a required checkbox. That's one less click, and it's the common SaaS pattern. Check with legal whether a checkbox is required.
  - Move First name, Last name and Phone into the "About you" step.
  - File: `components/public/signup-form.tsx`

### 1.2 "Your account is created" screen: one button only (01:16 – 01:46)
- **He said:** there should be **one Continue button** because it's the first step. Remove "Not you? Sign out": "We don't want people to go back… we want them to start and complete the process."
- **How to do it best:** one primary full-width **Continue**. Remove the "Next: Your email" secondary button and the Sign-out link. If the email was already verified (for example through Google), skip this screen entirely.

### 1.3 Navigation: Back + Continue pair at the bottom (02:45 – 03:14)
- **He said:** the "← Back to your email" link at the top shouldn't be there. Put a **Back** button next to the **Continue** button at the bottom: "these two buttons". Below them, only **Privacy · Terms · Support** stay. Remove "Signed in as … · Sign out".
- He stressed: *"This is the first impression of our SaaS… it needs to be very smooth and very detailed."*
- **How to do it best:** use one shared step footer for all onboarding steps: `[Back (ghost/secondary)] ……… [Continue (primary)]`, the same position and width on every step, and Enter submits. Hide Back on the first step. Keep the progress bar at the top as the only "where am I" signal.

### 1.4 Copy should follow what they chose on the landing page (02:15)
- **He said:** he started as an **independent agent** on the landing page, yet step 3 says "Tell us about your **agency**". It should say "Tell us more about **you**". "It's common sense."
- **How to do it best:** carry the persona (`agent` | `agency`) from the landing page or pricing into sign-up (query param → saved on the account). Drive the headings and field labels from it:
  - Agent: "Tell us about you", "Business name (optional)".
  - Agency: "Tell us about your agency", "Agency name".
  - File: `components/app/business-profile-form.tsx`

### 1.5 Plan step: don't ask again if they already chose (03:43 – 06:37)
- **He said:** "I already made a choice from the landing page. Why do I need to make another choice?" Show what they picked: plan, **14-day free trial**, **$0 today**, no charge until X. Then go straight to payment. No second "choose your plan".
- **Teammate clarified (04:41):** if they came from **Pricing** with a plan picked, preselect it and skip the chooser. If they clicked the top-right **"Start free trial"** without picking a plan, show the chooser. Umar agreed that's the intended logic. The current build always shows the chooser.
- **How to do it best:**
  - Plan known → show a read-only **plan summary card** (plan name, billing period, what's included, "$0 today · 14-day trial · first charge 11 Nov") with a small "Change plan" link. Merge this into the payment step so it's one fewer screen.
  - Plan unknown → show the chooser, with the recommended plan preselected.
  - File: `app/app/onboarding/plan/page.tsx`, `components/app/plan-choice.tsx`

### 1.6 Capitalisation fixes he called out (06:37 – 07:38)
- "For one agent" → **"Independent agent"**
- "For an agency" → **"For an Agency"** (capital A)
- "Primary state" → **"Primary State"**
- ⚠️ **Decision needed:** he wants **Title Case** labels (he said the same on Carriers at 31:25). The current design system uses sentence case. Pick one and apply it everywhere, don't patch it field by field. Since he asked for it twice, I recommend Title Case for **labels, tabs and buttons**, and sentence case for helper text.

### 1.7 Checkout page scrolls (07:38 – 09:12)
- **He said:** the payment page scrolls. The embedded Whop checkout can't be made smaller, so remove the things *around* it and adjust our design so the user completes it fast.
- **How to do it best:** at 1536×826 (the owner's screen) the whole checkout must fit without scrolling:
  - Remove the duplicate heading, subtitle and email block above the Whop iframe (Whop already shows email).
  - Fold the plan summary into a compact right-hand card (plan · $0 today · first charge date · coupon).
  - Put the trust line ("You won't be charged until…") under the plan card, not above the form.
  - File: `app/app/checkout/page.tsx`

### 1.8 Right-hand panel: product showcase instead of a checklist (09:37 – 11:42, 14:19)
- **He said:** the right side "is doing pretty much nothing". Show **images and cool animations of what the software looks like, and its features, as a slideshow**. Rinor suggested a **motion-design** version ("Claude can do it"), and Umar agreed. When you go to the next step, the panel moves to the next feature. It's **storytelling**: keep showing the user the pain points the product solves while they sign up. "Good software use this strategy."
- **How to do it best:**
  - Build one `<AuthShowcase step={n}>` panel shared by sign-up, onboarding and login.
  - Each step gets one feature "scene": real product UI (a cropped, slightly tilted screenshot or a live mini-component) plus one short headline and benefit. For example: Inbound transfers → Dialer + DNC check → Lead cost traced to policy → Commissions/Book.
  - Animate with a soft crossfade and slide (≈400 ms) on step change, and auto-advance every ~5 s while the user stays on a step. Respect `prefers-reduced-motion`.
  - **Reuse the existing `insurvas-demo-video/` Remotion scenes** as the source of truth for visuals, either exported as short looping MP4/WebM clips or recreated as lightweight CSS/Framer animations.
  - Keep the step progress on the left side (progress bar), not on the right.

### 1.9 Reorder the flow, make business info skippable (13:20 – 15:18)
- **He said:** once the account exists, the user has "already cleared the first thing". Add a **Skip** button on the business-info step. Better still, **move the trial/payment before business info** so they sign up faster. If they skip, then at first login show "Complete your onboarding" as the first thing and require it before they continue ("think like a trap as a sales point").
- **Recommended new order:**
  1. **Account**: email + password / Google
  2. **Plan + Payment**: summary if plan already known; Whop checkout
  3. **About you / your agency**: name, phone, state, what you sell, lead sources, volume. Has a **Skip for now** button.
  4. If skipped, a blocking "Finish setting up" card on first app load (it can sit inside the existing `Get set up` guide).

### 1.10 Smooth transitions between steps (14:41)
- **He said:** going from one page to the next "needs to be smooth".
- **How to do it best:** keep the shell (logo, progress bar, right panel) mounted across steps with a shared layout, and only animate the form area (fade + 8 px slide). Use View Transitions or a client-side step router instead of full page loads.

---

## 2. Sign-in page (15:50 – 19:10)

### 2.1 "Partner or affiliate? Use the partner portal instead" (16:43 – 17:41)
- **He said:** "Tell me the problem": it's a **different font and a different colour** from the line above ("New to Insurvas? Create an account"). Use the same colour and font. Put it on the same line or next to it to save space.
- File: `components/app/tenant-auth-workspace.tsx:393`

### 2.2 Subtitle wording (17:41 – 18:10)
- "Sign in to your **agency's** workspace" → **"Sign in to your workspace"** / "Log into your workspace". The login page doesn't know whether you're an agency or an individual agent.
- File: `components/app/tenant-auth-workspace.tsx:303`

### 2.3 Remove "Email me a link"; rename Google button (18:10 – 18:40)
- Remove the **"Email me a link"** button. The magic-link page itself is fine if ever needed.
- On the **sign-in** page, the Google button should read **"Sign in with Google"**, not "Continue with Google".
- **How to do it best:** use a single full-width Google button under the "or" divider.

### 2.4 Right-hand panel
- Same showcase panel as sign-up (1.8) ("this one or something like this where we have these sliders").

---

## 3. App layout / shell (20:30 – 28:40) — **Rion's area**

### 3.1 Sidebar sub-navigation (22:41 – 24:09)
- **He said:** the vertical line next to the group labels (e.g. "Today", "Sales" under Work) looks odd. **Remove the line**, or if you keep one, make it a **connected** tree line. "We don't need any line when there is only one." The group label must look like a **heading**: right now there's no difference in font or design between the heading and its items.
- Reference he showed: the Dribbble "Taurus" sidebar. The parent has an icon, it's bigger and bolder, and its children hang off one continuous connector line.
- **How to do it best:**
  - Parent: icon + 14px/600 label. Children: 13px/400, indented, joined by one continuous 1px line with a small elbow per item.
  - A group with a single child shows no line or label. Just show the item.
  - Active item: tinted background pill. The connector segment to the active item can be highlighted.
  - Note: the local `localhost:3000` build already has icons on children. Check it against this feedback.

### 3.2 Breadcrumb belongs on the page, not in the top bar (25:05 – 25:36)
- **He said** (partly garbled): when he went to Inbound, the navigation (breadcrumb) appeared **in the top bar**. "This is not built for navigation, because you're going to have longer navigations. Navigation always comes on the page."
- **How to do it best:** move the breadcrumb (`Partners › Publishers`) out of the top bar to the top of the page content, above the page title. The top bar keeps search, status, + New, notifications, theme, account.
- File: `components/app/app-top-bar.tsx`

### 3.3 One account menu, top right (26:06 – 26:42)
- **He said:** the account/profile/logout entry shows up **three times** (top right, bottom left, and another). Keep it **top right**. "Top right seems more natural."
- **How to do it best:** remove the bottom-left user card from the sidebar. Keep the top-right avatar menu (profile, notifications, plan & billing, shortcuts, log out). The workspace switcher stays at the top of the sidebar.

### 3.4 Settings entry (27:26)
- Partly unclear. Settings can stay where it is for now, but "remove this thing" for extra items near it. **Ask Umar to confirm which elements he meant.**

---

## 4. Settings page (29:33 – 31:30)

- **Settings nav doesn't look like navigation (30:24):** there's too much spacing, and it reads as a floating card. Make it a real **settings navigation**. At 31:05 he drew it as a column attached to the left edge, running the full height.
- **Page header (30:56):** put the title **"Settings"** plus a description at the top, so all cards **start from the same left edge** and every settings page looks the same.
- **How to do it best:**
  - Layout: `[app sidebar] [settings nav 220–240px, full height, own border-right] [content]`.
  - Group labels in small caps or muted text, with items in the same style as the app sidebar (3.1).
  - One shared `SettingsPageHeader` (title + description + optional actions on the right). The content max-width stays the same across all settings pages.
- Title Case for labels and tabs (see 1.6).

---

## 5. Carriers → "Contracting" (31:30 – 49:00) — biggest rework

What he saw: Settings › Carriers with tabs `1 · Your carriers`, `2 · States`, `3 · Field maps`, plus an
"Add carriers you are contracted with" **popup**, then per-carrier cards with a
"States you're appointed in / Contract level and writing number" to-do list.

His main complaint: *"I'm sitting here trying to figure out what to do. If you don't tell me, I don't know."*
A first-time user doesn't know they need to go to the States tab after adding carriers.

### 5.1 Rename and restructure (38:38)
- Rename **Carriers → "Contracting"** (or "Contract management").
- Under it: **Carriers** and **States** as plain lists of what's set up.
- The main **Contracting** page is a **guided setup** that walks the user through everything.

### 5.2 Step 1: Select carriers, inline with no popup (39:07 – 40:29, 42:54)
- No pop-up. The page itself shows a form where you **select carriers (multi-select)**.
- Right next to each selected carrier, show its **Contract level, Contracted from, Writing number** inline (all optional).
- At the bottom: **Next: Set up states**.

### 5.3 Progress and saved drafts (40:29)
- Show progress at the top ("50% done"). If the user leaves and comes back, **their inputs must still be there**.

### 5.4 Step 2: Set up states (41:00 – 48:42)
- Pick **many states at once**. Ticking boxes didn't work in the demo, so fix that bug.
- Default: a state applies to **all carriers** ("I could have only a state licence that works for all carriers").
- Optional: expand a state and pick specific carriers for carriers that need it (e.g. Aetna).
- Show missing-info hints ("carrier selection missing") instead of blocking.
- **It's too slow.** Each click lags. Make updates optimistic.

### 5.5 Remove the licence/NPN requirement (43:53 – 44:50)
- The "No Delaware licence on file" warnings come from the database still requiring licences and NPN.
- The teammate offered to remove that from the DB so multiple states × multiple carriers can be selected in one go. **Umar approved.**

### 5.6 Remove "Field maps" (44:50 – 46:16)
- It's for the browser-extension feature, which is postponed. "Let's make it really simple": remove the tab and hide it under an "Other/Advanced" area.
- Files: `components/app/settings/carrier-field-maps.tsx`, `carriers-settings.tsx`, `carrier-card.tsx`

### How to do it best (whole Contracting flow)

```
Contracting                                   ●━━━━━━━○  Step 1 of 2 · 50%
──────────────────────────────────────────────────────────────────────────
Step 1 · Your carriers
[ Search carriers…                    ]
☑ Mutual of Omaha   Level [110 %]  From [10/28/2026]  Writing # [      ]
☑ Aetna / CVS       Level [    ]   From [          ]  Writing # [      ]
☐ Americo
☐ Foresters …
                                         [Save & exit]  [Next: Set up states →]
──────────────────────────────────────────────────────────────────────────
Step 2 · Your states
[Select all] [Search states…]
☑ AL Alabama     All carriers ▾
☑ DE Delaware    2 carriers ▾   (Aetna, Americo)
☐ AK Alaska
                                         [← Back]      [Finish setup]
```

- The searchable carrier list on one page *is* step 1, and ticking a carrier reveals its three optional fields inline. No modal.
- Step 2 is a multi-select state grid or list with "Select all" and region shortcuts. Each row has an "All carriers ▾" control that only expands when needed.
- Save automatically on every change (debounced) and show "Saved" quietly. Progress is computed from the saved data, so leaving and returning loses nothing.
- After finishing, the Carriers and States lists become read/edit views, and the guided page shows "Contracting complete ✓" with an edit link.

---

## 6. Partners / Publishers (50:02 – 51:41)

- He opened **Add a partner** and said "You see the problems here: Email, name, time zone, country", then told the team to **come up with the changes themselves**.
- In the deployed modal, **Country** is free text ("US") and **Timezone** is free text ("UTC"). The field order is also odd: Name → Type/Country → Contact name/email → Timezone.
- **How to do it best:**
  - Order: Partner name → Type → Contact name → Contact email → Country (select, default US) → Time zone (select, defaulted from country, US zones first) → Notes.
  - Use real selects for country and time zone, and validate the email inline.
  - Note: the local build's **"Add a lead source"** modal already uses dropdowns for the time zone and a cleaner order. Check whether that version is what should ship.

---

## 7. Open questions to confirm with Umar

1. **Title Case vs sentence case** across the app (1.6 / 4)?
2. Business info: **skippable with a gate at first login** (recommended), or required before payment?
3. Breadcrumb (3.2): confirm he means "move the breadcrumb out of the top bar onto the page".
4. Settings (3.4, 27:26): which elements did "remove this thing" refer to?
5. Contracting: should states be primary (state → carriers) or carriers primary (carrier → states)? He said "whatever you want, but smooth". I recommend **carriers first, then states with an "all carriers" default**.
6. Partner modal: which specific problems did he mean with Email/Name?

---

## 8. Suggested order of work

| # | Item | Owner (per call) | Size |
|---|------|------------------|------|
| 1 | Sign-in fixes (2.1–2.3) | Rion | S |
| 2 | Sign-up step 1 + buttons + copy (1.1–1.4, 1.6) | Rion | M |
| 3 | Plan-skip logic + checkout fit (1.5, 1.7) | Rion | M |
| 4 | Flow reorder + skip + first-login gate (1.9) | Rion | M |
| 5 | Layout: sidebar sub-nav, breadcrumb, one account menu (3.x) | **Rion** | M |
| 6 | Settings nav + page header (4) | Rion | S–M |
| 7 | Contracting wizard + DB licence removal (5) | Rinor/Olti + Rion review | L |
| 8 | Auth showcase panel with motion (1.8, 1.10, 2.4) | Rion | L |
| 9 | Partner modal fields (6) | whoever owns Partners | S |

---

## Appendix: raw transcript (WhisperX small, unedited)

```
[00:01] is need to be here. Email should have like a proper one column layout and password should have one column layout, right? And then I think so. This looks fine. Even if I'm gonna click with continue with Google, that I'm trying to do now.
[00:43] Yes, it takes me there. But because I already, I already did some of the process for this. So, okay, so step one again is step one, right? So, yes.
[01:16] name email next your email they should be one button continue here because it's the first step okay what is this not you sign out what is this
[01:46] Now just remove this. We don't need this. We don't want people to go back. We don't want them to start and complete the process. So remove this one. Continue button should be here, right? So clicking on continue. It's just here. Okay. Now remember I started as
[02:15] independent agent from learning base, right? So I am getting an agency. You need to make this tell us more about you, right? Not the agency. And if he has choose it from there, the decision needs to be. It's a really common sense. I started from there. I'm just completing some process here and we need to make this quick.
[02:45] So people can get to it more quickly. So let's say I enter this information, I enter this fine, looks good, looks good, looks good, looks good. Back to your email. Now, this should not be here, right? Where this should be, it should button here to go back. And the continue button should be here. Like we have this continue button, these two buttons, okay?
[03:14] This is the first impression. This is the first impression of our SaaS. Like no one knows he is not buying anything. This is the first impression. So it needs to be very smooth. It needs to be very smooth and it needs to be very detailed, right? So two buttons here again, you're gonna remove this and only the privacy terms and support will gonna be stay here. This looks fine. I'm gonna go and I'm gonna click on
[03:43] Okay, so now it says continue. So I need to go back. Okay, so I already choose a plan. So why do I need to make another choice? I already make a choice from landing page. You just show them this information, right? And don't have to make a choice. This should be the process where you show them this is your account, you're getting free trial. No, you will not get charged anything and enter your
[04:13] whatever your payment method here and just start here. We don't you already showing him what he choose from your landing page. Whatever you are showing the details here and this is like 14 days you show 14 day trial what you have to pay today $0 and then you don't need to make it continue payment here. You just need to show the plan.
[04:41] Details here on his side, you need to show. Yeah, sorry for interrupting here. Just one thing. So this stuff was made by me before, but everyone has redesigned it. The reason why I did this way, it needs to be changed into if he has selected a plan before this step right here is automatically selected. So he doesn't need to select it one more time.
[05:11] But if he goes straight for free trial, like if he clicked free trial on the first step and it doesn't go through pricing, then it shows like choose your plan. You understand what I mean, right? So where is without free plan? No, no, no. So let me explain one more time.
[05:39] If you click it from here, it should automatically select your plan. But if you click Start Free Trial on the top right corner. Okay, where I click that it should start automatic plan? No, it should be. It should be. I'm saying it should be like that. I'm not saying it is implemented. I've only implemented it that way.
[06:09] when you click start free trial on the top right corner. I am using it as the person, whatever the option I have right now. I do understand. I'm just explaining why that step was like that. Now, when you guys are implementing that one, then we need to think when he's choosing everything from there. But for now, I am
[06:37] already made my plan. I already choose something and I am already doing a free plan. So I don't need to make anything here. Right? So you don't need this one. Again, I made a choice for one agent. So I will be stick to independent agent and again for one agent, this wording is not right. It needs to be independent agent and for an agency.
[07:06] 4 is bigger than n and then agency has a small letter. It needs to be like this. For an agency, a should be capital. Okay. And business and this is the fine primary state. Again state should have capital.
[07:38] Now I go next, I select whatever yearly plan and I select this one. This is showing me this, but I selected free trial. So this should show, okay. So again, if I'm gonna click on this, now you see the scroll.
[08:20] This cannot be made smaller because this is embedded. So you remove this one. You remove part from this. Now this cannot. Give me a second. You remove this thing, bro. You have everything. You adjust your design.
[09:12] I think so this can be adjusted, but yeah, but this will get moved one inside because I just need to make it really quick for the user to complete.
[09:37] Now this is on the left side of the screen. You see the right side of screen we're doing pretty much nothing. Just showing some random things. We need to show here some images and some cool animations, what the software is going to look like, right? And their features in a slide show.
[10:21] I think I have no idea how to do that part. So instead of slideshows, why not to make a motion design of the sus? Claude can do it. You see like this?
[10:49] On this side, you're doing your process. And this side, you're getting like an animated version of like, we will make more images, but you may use up some good images and designs. So we like see like this one. It's just an overview of the platform.
[11:12] what we do, what is like we can do something cool like this. And like there should be animations. And when you go to the next step, it shows you next one or maybe your own, if you are staying on the same page, meantime, it just switches and show you the overview of the platform because it, again, it's a storytelling. The person has not signed up yet. So you are showing him those things that those are his point points again and again, what he's trying to get now, right?
[11:42] And you see, if you can... Psychology is just trying to show him again and again things that he is signing up, he's doing things right, right? Good software, they used to do this strategy. They show you something that you're gonna get, but they are doing here, right? You can look up for, see. I don't know if you guys are seeing my screen, but you can see.
[12:21] And phone number, the first one should only have user name and password only. First name, last name, email and password only. And continue with Google at the
[12:51] them. You take the first name, last name and phone number to next stage where we're collecting his business and personal information. Right? This step we don't need the first name, last name. This step we need only email and password. Mostly screens you will see like this. Email and password, sign up with this, sign up with this, continue and like just have a look. Just have a look. Take a screenshot from this. See what they are doing.
[13:20] They are a good SaaS. Open any good SaaS that is doing the same thing. And then you go back, go to your, you go next, and then it's gonna show you personal information business because now a person is a mind. He already cleared the first thing. Okay. He can even start from there. He can even start from there. He has the login. Even he skips, even he skips that thing, we can get that information later on.
[13:49] when he logs in first thing, okay, complete your onboarding, right? We don't have to waste his time. Even he wants to skip the second part of business information, we can have him skip, but when he will log in, right? He does his payment, we need the basic information, now the account setup and his payment right now, when he logs in, show this the first thing, okay, continue, fill this to continue, otherwise your account get logged. He already paid,
[14:19] the amount, now we will fill them. Think like this, think like this. This is a SAS, you need to build a SAS, then you need to think like a trap as a sales point. Now this page, you get my feedback. This page, I will still rely on you guys to go take some screenshots, some images, make some slideshows and cover this part, okay? And the animation from
[14:48] This page to next page should be smooth, right? So when I'm going to click on next, it needs to be smooth. But overall, it's better than yesterday, but again, we have still got to do. And so you can make a skip part, skip, skip button on the next thing. So you can skip his business information. He can skip business information and go directly to filling out the.
[15:18] the free trial, and maybe you can move trial before and then business information. So he's ready for everything. So he signs up more quickly. The more quickly we can get this guy, they will be able to do that. Now I'm on sign up, sign up, sign in page, right? Okay. Again, this thing will be moved by it, changed by it. Will this design, right?
[15:52] Yeah, this one or something like this where we have these sliders. Okay. Okay. Okay. So what do we have here? Okay. Next one.
[16:43] You guys can see my screen. Yes, yes. Okay. Now tell me the problem in this section. Are you saying for the partners? Yes. What is the problem? Uh,
[17:11] Are you saying that that shouldn't be there? No, what is the problem? I'm saying what is the problem? It's an open-ended question. You guys figure out what is the problem here. Different font, you see the font here and you see the font here. Different font, different color. The color should be this one, not this one.
[17:41] and you can put it here, save the space, move it around. Again, if I am an independent agent, I don't need to know that this is agency workspace. Sign in to your workspace, make it simple. Okay, reset your password. Remove the login. In the login, it doesn't know if you're an agency or an individual agent.
[18:10] Yeah, so we don't need to put anything. Just make it. Just make it log into your workspace. Log into your workspace. Um, email me a link. What is this? We should remove this. We should remove this. Just make it sign in and then again continue with Google. No sign in with Google. We are on sign in page.
[18:40] Can you click on email link? Yeah, this is fine. This was fine if we needed it. But this one is not needed. Sign in with continue with Google now. Continue with sign in with Google. OK, so let's say this is the login I have. Again, this one needs to be changed. You can put it here.
[19:10] make it same whatever the color and font we have here. Okay, I'm going to log in. Let's see. These are the pages that we did yesterday.
[19:53] Are you going to sell your parts? No, I'm going to sell my part. Okay.
[20:32] Let me explain. So I did changes and Leon did changes. That's why it's all mixed up. So first things first, there are three options where you can see your workspace and also to log in, log out to watch your profile, which is going to be at the bottom.
[20:57] You were not supposed to work on the layout and the profiling. You were supposed only to work on the pages that are inside. So whose changes are these? These are the changes from Rihon or Rihon? Both mixed up. Why those mixed up? That was the point of doing Rihon, Rihon, the changes initially. And then you only work on chat page and the pages that are inside, not on the layout.
[21:27] and these changes. Correct, that's my mistake. So is this final or not? Should I review this or do you guys have anything to change? Yeah, continue.
[22:41] Can you guys see this?
[23:14] This is an example of some navigation, like you see the file and then you see. And now we have here spit. It looks very, very odd. So remove this line. Maybe if you want to make a line, make it connected. We don't need any line when there is only one. And this needs to be like highlighted. This should be heading.
[23:39] There is no way that I can see this is an heading. There's no difference between the font and design of these two. You can see the design, the difference here. Because it's placed before, this is placed right after. This is bigger, connected with icons, this is connected with icons. So it just look good. And I'm talking about same thing here, not even here, right? So I'm talking about same thing here. It needs to be connected and it's fine.
[24:09] Now, should I review this page here, do you guys want to take time and get whatever the changes are finalized? Because this one, I will do the revisions, and then you guys are going to change. You know, do not have to work on the layout. Layout in everything overall needs to be worked by, you know, because he has the foundation, he has everything. He did his first push yesterday. I see it was good, right? But he said that he's going to share those files. You're going to use the same components and stuff and use those inside
[24:39] pages. I did manage to do a UI works consistency foundation. OK, so I'm going to review now whatever the pages. Rion was supposed to do. OK, starting with the layout. We started at we're going to do the layout. OK.
[25:05] So I'm going to do the layout review. If you have to make notes, you can make one right now. OK, so in the layout, basically, you have this top bar, navigation bar. And when I change inbound, the navigation is going here. It should not be. The navigation should stay inside.
[25:36] This is not built for navigation because you're going to have longer navigations then. So navigation always comes on the page. Right. The bread. Right. So this is here. This is not right.
[26:06] Okay, you have this thing here and then you have this thing here. Yeah, that's what I explained. It was the mix of both codes. So we don't need this thing here? Yeah. You have three of them. You have that one right there at the top right on the bottom left.
[26:42] So we keep it on the bottom left. Top right seems more natural. This one looks fine. Yeah.
[27:26] Yeah, we can do this later, but for now, setting this fine here. I mean, it's a whole section that we need to do. So setting should be here, not in here. Or maybe it's fine, we can do it here, but we need to remove this. Remove this thing, remove this thing. This one, this thing needs to be here. And this button looks fine. We don't need this thing.
[27:55] I don't need this thing, what is this? Okay. This proper. Did you tell me the email and I'll try, oh, we can also, I was thinking to send you some in-bounds that you don't have publishers set up. The publishers.
[28:39] So did you get my input on layout? OK, let's talk about the page now. So you worked on publisher page. You were supposed to work on the first thing is setting up settings, right? So what we'll do is carry your settings, right? So where are those?
[29:33] Is this being worked by you?
[30:24] fine, I'm just looking into the design. So first of all, there is a disconnect here. See, this doesn't look like a navigation. So there is too much spacing here. And this doesn't look like a navigation. So you need to make it like a navigation, a settings navigation.
[30:56] you need to place it right here, right? So the cards start from the same side, right? And what you need to do is basically you need to put settings, title of the page here and whatever the description here, right? So it stays consistent. And then what let's say you open up carriers, right? So what you will do is basically this looks good, your carriers,
[31:25] Looks good. Again, C should be capital here. C should be capital here. And carriers is fine. See, this is everything is capital here. There is no capital thing here. So, OK. I'm going to add a new carrier.
[31:56] Patna Remove this Where is this list coming from? From Alginacyl
[32:48] What should I do? What should I do? So why I need to select this button to set up states?
[33:18] Why not? I have all the states showing up to just click and set them up. Why this is not like a two-step process? See, I'm sitting here. I'm trying to figure out what should I do here. If you don't tell me, I don't know what to do.
[33:47] Okay, I can fill in this. Okay, I can see.
[34:20] It should basically just have the button there that you should redirect you to the step two. It should be very simple. When I'm gonna click on add carrier, I should not get this popup. The first section I should see is basically you should show three steps here, one, two, three. The first step is I need to make a, when I'm gonna click on add carrier, this popup shows here, it shows me which carrier I need to select. Let's say I selected two carriers. Can I select two?
[35:10] If you select for how you're gonna set up all four of them, so you need to go again step by step for all of them. So that's why there's a second page. The first step is states you are appointed in. The first step is this one, but I am seeing you to fill this. Yeah, I'm just telling how
[35:38] how we have thoughts about that. So basically you put the careers, then as you can see is one, then two, then three. If you go to States. Who is going to tell me that I need to go to States? Should we write? I am a user. I am a user. I don't know. And this is the first time I'm seeing this platform.
[36:09] I need to go to States, okay. When I'm gonna select States, I'm gonna select career. Yep, correct. But if I don't go and click on States, how I'm gonna get there, that my promises is right. Because on the setup, if you're trying to set up a new career,
[36:39] The step set, the states should be second. First one should be contracts, whatever that was. And if you select the button, it will redirect you to the states. Which there, you can do multiple states for multiple careers. So there's a lot by a lot.
[37:09] was the condition of forgotten English. Yeah, but if you go to states, you can basically make this quicker. That's what I'm saying. How how user is good to know that he needs to click on states after selecting areas here. Yeah, we will just add a button collects click on forest. Foresters, sorry. On the your careers.
[37:48] Let me let me think something.
[38:38] So the first thing is, this should need not to be called as carriers. This should be called as contracting, contract management or contracting. And there should be three things here. Carrier, states, two options here. Carrier and states. When someone is going to come up on contracting, main page, on the main page contracting, carriers and states is just a list.
[39:07] of what we have, right? The main contracting is the page that will guide user to set up everything, right? So you will come up to this page, you will come up to this page and there will be a three step process. First is gonna select carriers. Let's say whatever the pop-up I showed, I don't need to show the pop-up. It's just show me that I need to select three carriers.
[39:35] This will make it three-step process, one, two, three. And the first step is just show me a form where I can select a carrier. When I select a carrier, right next to carrier, I should get contract level, contract from, and writing number, right next to it, right? So it just show, see, it just, when I, it just show, when I select this,
[40:03] the next two, three forms input or optionals. But if I select, this means I'm adding the writing number for mm. I'm adding the whatever the right, right? Once I finish this, once I finish this, it should have a next button. Next button says select states. Okay. Right.
[40:29] what this will do is this will allow the user to go to next page, right? And even if he comes back, even if he lose something here, he comes back and we will show progress on top. 50% done, okay, 50% remaining. Even he left out and come back to this contracting page, the input should stay there, right? And then he has a navigation, he click on States, right?
[41:00] set up states next. This should be the second step. Set up state next. You're going to click on next button. Now you're going to show him this layout, right? Where you're going to ask him to select states. And for each state. Why you are making a change right there? Save this information. See, this is taking so much time.
[41:39] So let's say I have these five states. Now in each state, when I select any state, it should give you an option right away. I can select. So this is so slow. Whatever you're writing. What is this?
[42:17] What is this? I'm not able to select deliver but I'm able to select the state inside it.
[42:54] So once you finish the states for each carrier, we don't need to show this one. Just remove this one. Just put this into setting here as a next page. So contracting should have a very smooth process. In the first step, I selected a bunch of carriers, and right after selecting should not be a pop-up. It should be a part of page. And I click on Next, Setup States. I go to States.
[43:24] And I selected, you can even make carriers having states or you can having states, carrier, whatever you want to make. But this needs to be smooth. I don't know what I'm getting here. And this is so slow. I click and it takes. I can explain the text for you. So when you first
[43:53] have done the modules and also the tasks. There has been something that the agents should add whenever they sign up in the insurance, which is going to be their licenses. So in the database structure, they're still asking for licenses. That's why and when you said that they don't need licenses, that update hasn't been made on the database.
[44:21] That's why when it's requesting a, for example, for Delaware, that's going to be because you need a license to sell in Delaware. That's why it says that way. But we can simply just edit the database into not requesting NPN and also the licenses. In that way, you can select multiple states and also multiple
[44:50] careers at the same time instead of that much faster. Yes, please do that. And what about this one? Yeah, the field maps is a is a connection for the browser extension feature that we do. We will implement actually, because we have skipped for now as our previous conversations. So basically here,
[45:18] you will set the page URL of the careers where you are required to put the fields. For example, first name, last name, social security number, whatever it is on the career page, official page. You paste the URL here and you start to map and it will automatically map the fields.
[45:46] just because you will need these in order to create forms, whatever it is for application, maybe whatever it is. But this feature has been postponed after we have created this. I don't need this. Let's make it really simple. Just remove it, put it somewhere into others. If you need it, we can use it, but remove this. So in the contracting, there should be a firm start. There should be a first step start contracting process.
[46:16] You select a bunch of carriers, you fill their information in there, you click on next, set up states, you select a bunch of states, it needs to be really smooth, right? And every state that I'm going to select, it should show me. Okay, I selected this state. You have not clicked on the checkbooks.
[46:44] I'm clicking. I don't know what's going on. This is not smooth. Use it yourself. I should be able to select a state. When I select a state, you show carrier missing, carrier selection missing.
[47:13] set up carrier selection missing. Even if I can select four, I can just open this up and then select carriers inside. If I don't wanna select carriers, don't select 10 carriers because I could have only state license that works for all the carriers, right? So I'm able to just select states. The option is I'm having to select state here. For some particular carriers like Aetna, they require
[47:43] particular state. So I can go and set up click carriers on which on which carriers you have these status. So I click on it and I go and fill out what carriers I have for each state, but selecting a state. It needs to be. I am going to select states again. Again, this needs to be this needs to be good. Can you click when you click on multiple states at a time? I don't know. I'm not able to just click.
[48:12] you're not clicking on the box for the states bro i'm here to just click why am see wait it was working with checks uh could you please refresh maybe i'm not sure it was working on your side i don't know so yeah
[48:42] just fix this one okay so you set up your carriers and you're contracting so this should be your second part here okay this is fine okay
[49:10] Again, read on which other pages you have worked on. Anything in the settings?
[50:02] Okay, have you worked on partners pages after settings? You were supposed to work on partner pages because we're going to set up partners. This one.
[50:53] You see the problems here. Email, name, time zone, country.
[51:41] Well, then just come up with the changes, please. I will give you, I will see only the things that shown to me, right? So come up once your changes are ready. Okay, what's next? What are the pages that you have worked on?
[52:10] Yeah, for those pages it would be better to log in as someone else. I'll give you the credentials because you will not see any leads or anything like that. Okay. Let me just get the
```
