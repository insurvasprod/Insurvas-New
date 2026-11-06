# Landing page review — Umar's call, 2026-11-04

Source: Zoom recording `2026-11-04 16-13-15.mp4` (24:37, 1280×720).
Transcribed and read frame-by-frame on 2026-11-06.

**Who is speaking.** Umar Masood shares his screen and does almost all the talking — he is
the one giving direction. Rion Reqica answers. Olti and Rinor are on the call but silent.
There was no speaker diarisation, so attribution is inferred from context: if a line reads
like an instruction, it is Umar; short confirmations ("Yeah", "Got you", "I'll work
something around it") are Rion.

**How reliable this is.** Audio was transcribed locally with WhisperX `small`. Umar speaks
fast with a strong accent, so the raw transcript is noisy. Quotes below are cleaned up
where a mis-transcription is obvious and certain (`Clipso` → **Clepso**, `find defense` →
**final expense**, `in service`/`Shorbas` → **Insurvas**, `learning page` → **landing
page**). Anything I could not resolve is flagged **[unclear]** rather than guessed.
Every claim about *what was on screen* comes from a frame I actually looked at, and the
frame time is cited. The full raw transcript is in the appendix — read it if a point here
matters and you want the unedited words.

**State of the code.** Umar was reviewing the live site, which matches the marketing
commits of 2026-11-04 (`ec54c251` … `11e6554e`). Nothing in `components/marketing/` has
been touched since. **All of the feedback below is outstanding work.**

**Scope.** The landing page review runs **00:00 – 18:36**. At 18:36 the call moves on to
the BPO recruiting pipeline — a separate project — and that part is deliberately left out
of this document, including from the transcript in the appendix.

---

## The review, section by section

Page order today (`app/page.tsx`):
`LandingHero` → `LandingBuiltFor` → `LandingStack` → `LandingAudience` → `LandingBento`
→ `LandingPricingTeaser` → `LandingFaq` → `LandingRoadmap` → `SiteFooter`.

Umar reviewed **bottom-up** — he says so explicitly at 03:15: *"The above part is not done
yet. So that's why I'm showing this. We started from the bottom, not from the top. From
top, we have some ideas I'm gonna share."* That is why the roadmap and footer get the most
airtime and the hero gets the least.

### A0. Two things said up front that apply to the whole page

**A0.1 — Mobile is broken. (00:00)**
> *"Still, it's not responsive mobile. So we need to look into that."*

First sentence of the call, before anything else. Not elaborated. Treat as: the landing
page does not work on a phone yet, and that is a real item, not a passing remark.

**A0.2 — There is too much text everywhere. (03:15, repeated 10:53)**
> *"First, there's too much text. No one would read all of those texts."*
> *"the section design is good but of course the content is too much."*

This is the single most repeated note in the call. It applies to the bento feature
sections, the stack section and the roadmap.

**A0.3 — Alternate energy and text down the page. (17:06)**
> *"image stops you, it gives you some energy. There is no energy on top — energy here,
> then you have text. And then energy here, then you have text. So we need to put some
> energy. Landing page is more about grabbing attention… the more they stay, the more
> they'll learn about the product."*

The rhythm he wants: visual → text → visual → text. Right now it is text-heavy with the
road photo as the only real image break.

---

### A1. Hero — `components/marketing/landing-hero.tsx`

Frames 00:32–01:30. Heading on screen: **"The *Complete OS* for life insurance sales teams."**
with *Complete OS* set in italic serif green, sub-line *"Leads, calls, applications,
commissions, chargebacks and compliance on one ledger…"*, two buttons (*Start your free
trial*, *See how it works*), and a large dark dashboard device mock below.

**A1.1 — Drop "Complete" and restructure the headline. (00:29)**
> *"The title is the problem there on the hero section. […] I think we will remove
> `Complete`. The operating system for life… would be below. And I think this will not be
> the complete text. The text needs to be reviewed."*

He wants "Complete" gone and the line re-broken so *"the operating system for life
insurance"* sits on the lower line. The wording is not final — he is asking for a copy
pass on the headline, not dictating the replacement.

**A1.2 — Put something behind the headline. (00:58)**
> *"But you see the geometry? I think this start, we can have something that goes behind
> this and it gets empowered."*

A background/geometric element behind the hero heading so it reads stronger. **[unclear]**
exactly what form — "geometry" suggests the existing faint grid should become a deliberate
shape, but he does not specify.

**A1.3 — The logo is a placeholder and needs redesigning. (01:10)**
> Umar: *"So the logo needs to be updated. This was like a PNG, right?"*
> Rion: *"Yeah. Like just done fast."*

Both agree the current mark was done quickly and is not final. Note for accuracy: the
site renders `components/shared/insurvas-logo.tsx` and `public/brand/insurvas-logo.svg`
(SVG, not PNG) — the PNG at `public/brand/email/insurvas-logo@2x.png` is the email asset.
The substance of the note stands regardless of format: **the logo needs a proper design
pass.** This is brand work, not a code change — check with Umar before anyone redraws it.

**A1.4 — Animate the hero device through the app's screens. (01:25) — explicitly "later"**
> *"I thought if we could use this and animate and show different screens on this page…
> So it changes to Inbound and then shows Inbound how it works, and then changes to Dialer
> and then Dialer, and then Callbacks. […] we can do it interactive — people can change it
> themselves if they want, or it can be animated on its own. **But I think we can do this
> later, now it's fine.**"*

The device mock currently shows the Agency dashboard only. He wants it to cycle
Dashboard → Inbound → Dialer → Callbacks, either auto-playing or user-switchable.
**He deferred this himself. Do not build it this round unless everything else is done.**

---

### A2. "Built by industry experts" social proof — `components/marketing/landing-audience.tsx`

Frame 12:40. On screen: *"Made by people who sold final expense and ran live-transfer
floors."*, four avatar dots, *"Trusted by 2,400+ agents and 180+ agencies"*, and the
figures **2,400+** and **$48M**.

**A2.1 — Too basic; it has to actually build credibility. (12:21)**
> *"This one is more like social proof — needs to improve. This design is just basic. When
> someone lands on the landing page, he knows only that it's a complete OS. How is it an
> operating system? Like, it's being built by someone — so you just build some credibility
> here. It's being used by agents, internal team running for two years, and stuff like
> that. Once you have credibility, now you come up with *why this*."*

The job of this band is to answer "who are you and why should I believe you", and right
now it is a headline and two numbers. He wants it to carry real substance — who built it,
how long it has been run, who uses it.

---

### A3. "Sound like your agency?" five-tools section — `components/marketing/landing-stack.tsx`

Frames 13:20–14:10. On screen: *"Most Final Expense agencies run on five tools that don't
talk to each other."* with five flat boxes in a row — **A CRM** (for tracking) · **A
dialer** (for calls) · **A spreadsheet** (for commissions) · **Another spreadsheet** (for
publisher payouts) · **A prayer** (for compliance) — then *"I've watched what that chaos
costs from the inside"* with four dashes, and a *"One system instead"* panel with four
items.

**A3.1 — Make the five tools stacked 3D cards that Insurvas replaces. (13:15)**
> *"Then we need to show, like, they have a CRM and they have a dialer and they have a
> spreadsheet. I was thinking to make some 3D cards here — they get stacked. And then
> Insurvas here is just replacing those cards. But I just don't have time to get this to a
> design. Like we have a CRM here, a dialer here, a 3D card showing a dialer there, a
> CRM here, another spreadsheet for commission, policy spreadsheet, a compliance prayer…
> and then there is one — you just show Insurvas here, just taking them over."*

Replace the five flat boxes with 3D cards that stack, then resolve into a single Insurvas
card that takes them over.

**A3.2 — This section needs a story, not a list. (14:13)**
> *"We have watched chaos from inside — looks like we ran an insurance agency for two years
> and we have seen all these problems, and then we come up with our own system that can do
> all these things. We need to build some story here. […] Even if we don't do an
> introduction and just put the problem there, so they can relate."*

**A3.3 — The Clepso pattern is the reference for this whole idea. (14:41) — IMPORTANT**
> *"Now this idea is more about having **Clepso** on the one side, putting the problems in
> and going through Insurvas and then just coming out as solutions. So you want to kind of
> take this design from Clepso, this one. I discussed with Artan and it makes more sense,
> because now you have problems coming in… and they're going through a system and get
> refined and come out as a solution. But this needs to be made more presentable. What I
> have right now is just in my head — it's only a concept. Design will make that story
> realistic."*

**The reference site is `clepso.com`** — it was open in a tab and he switched to it twice
(frames 14:48 and 18:00). What it does: scattered dark cards representing mess (*Call
note — "Liability cap discussed, not written up yet"*, *Unbilled work — "Draft review ·
1.1h, sitting since Sep 30"*, *Document — "MSA_v3 (final) (2).docx — which version is
current?"*, *Email thread — "Re: Re: Re: MSA, 14 messages"*, *Timer — "Running since
10:02"*) drift inward toward a glowing central logo with a vertical light beam, and come
out the other side resolved.

Translate that to Insurvas: the agency's mess (dead leads, duplicate dials, unmatched
statement lines, missed drafts, compliance gaps) flows in → passes through Insurvas →
comes out as clean outcomes. Go and look at clepso.com before building this.

**[unclear]** "Artan" is a name from the audio; it may be spelled differently.

---

### A4. "What's broken today" — `components/marketing/landing-audience.tsx`

Frames 02:08, 15:12, 16:08. On screen: *"Seven leaks in your business. One system closes
them."*, a horizontally scrolling row of real-photo cards (Lapses, Draft dates, Underpaid
commission, Vendors, Compliance, Profit, Your team) with a *1 of 7 · Lapses* counter and
‹ › arrows, and a two-column *Broken today / With Insurvas* panel below.

Umar scrolled past this repeatedly but gave **no direct criticism of it**. It is the
section most recently rebuilt (`2b147c16`, 2026-11-04). The general "too much text" note
applies; nothing section-specific was said. **Leave it alone this round.**

---

### A5. Feature bento — `components/marketing/landing-bento.tsx`

Frames 09:30–12:00. Section heading *"Built for the way insurance is really sold."*
Five numbered panels, each a heading + lede + bullet list + CTA on the left and a 3D
isometric illustration on the right:

| # | Today | Line |
|---|---|---|
| 01/05 | Lead flow | `landing-bento.tsx:28` |
| 02/05 | Floor & dialer | `:45` |
| 03/05 | Applications | `:62` |
| 04/05 | Commissions & book | `:77` |
| 05/05 | Retention & partners | `:91` |

**A5.1 — The structure he wants is SEVEN modules, not five. (09:26 – 10:53) — IMPORTANT**

He walks through them one at a time. Reconstructed from the transcript:

1. **Partnerships & lead flow** — *"you can set up all your partnerships, get lead sources,
   and you have a dialer and flow, take inbounds, communication with your partnerships."*
2. **Outbound dialer & lead management** — *"you have outbound dialer and management of
   your leads that you are importing."*
3. **Applications** — *"one main operation for submitting and interviewing clients."*
4. **Commissions & book of business** — *"everything after your submission: commission and
   book of business, automations."*
5. **Accounting** — *"then the next one should be accounting."*
6. **Retention** — *"and the next one we could do is retention. Yes, retention could be a
   good one."*
7. **Compliance** — *"and the last one could be compliance."*

> *"Of course these will be more like a module — each will be part of a module and a
> solution, like a feature."*

Note this splits today's "Retention & partners" (partners move up into #1, retention
becomes its own #6) and adds **Accounting** and **Compliance**, which have no panel today.
He is thinking out loud here — the names are his, the exact wording is not fixed. Confirm
the final seven with him before building, but the *shape* (seven modules, these subjects)
is clear.

**A5.2 — The section design is good; the content is too long. (10:53)**
> *"This one is good actually, to highlight the features and modules — the section design
> is good, but of course the content is too much."*

Keep the layout. Cut the copy.

**A5.3 — Replace the 3D illustrations with 2D animated flow diagrams. (10:53 – 12:00) — IMPORTANT**
> *"This side, if we can bring some other design — I was thinking if we can do like flow
> diagrams, small flow diagrams where they pass data and show the whole workflow, that
> would be pretty much very engaging. Because in retention, if I can see how retention
> works in Insurvas — if we can show it here, pretty much solid. So instead of making them
> 3D, we can even have the 2D, but it's just one file shows up here, and then data flows
> from here to the next one — but actually how retention is happening inside the service,
> and then it's responding to that. And very quick, like a small kind of video card — but
> it's an animated video card, it's not actually a video."*

So: drop the isometric 3D card stacks. Each module gets a small **2D animated flow
diagram** showing a real record moving through that module's actual workflow. It should
read like a short looping video but be rendered, not a video file. He calls it an
"animated video card".

---

### A6. Pricing — `components/marketing/landing-pricing.tsx`

Frames 07:20–08:50 (dark), 08:40 (light), 15:44 (Team view). On screen: an *Independent
agent | Team* switch above three cards — **Ledger $99** (corner tab "Start here"),
**Basic $249** (tab "Recommended", wrapped in a hatched diagonal brand edge), **Advanced
$449** (tab "Everything") — each with the same ticked/crossed feature rows and a *Start
14-day free trial* button.

**A6.1 — The cards should be selectable, with animation. (07:29 – 08:28)**
> *"No, the design that you have done is good. Just this one was selected with the lines —
> I don't know about it. And if there is no animation yet, it's not even selected. So we
> need to make it selected. And when someone selects, it shows this line and maybe changes
> some colour. […] There is no animation here. So we need to put animation, and when
> someone selects a particular one it will come up and show up, like this one got
> selected."*

Today the hatched edge is baked onto the middle card as decoration. He wants it to be a
real **selection state**: click a plan → it becomes selected → the edge treatment and a
colour change follow the selection, with a transition.

Where: `landing-pricing.module.css:54` — `.featured::before` is the hatched ring
(`repeating-linear-gradient(135deg, var(--primary) 0 2px, transparent 2px 7px)`), and
`landing-pricing.tsx:93` `const featured = index === recommended` is what decides it.

**A6.2 — The hatched line can go. (08:28, repeated 15:39)**
> *"This line we can even remove this."*

Said twice. If the selection state in A6.1 carries the meaning, the permanent hatched ring
is no longer needed.

**A6.3 — Light mode is wrong here. (08:28)**
> *"In the white version it just looks very different, so we need to make it like with a
> different background here."*

He toggled to light at 08:40 to show this. The pricing section needs its own background
treatment in the light theme — the cards currently go pale mint on white and lose
definition.

**A6.4 — Rename the audience switch. (08:57)**
> *"This is important because someone is going to select an independent agent. I think we
> should do this agent / agent and team — agent workspace, team workspace, kind of like
> this. It will be much better."*

Change **"Independent agent" / "Team"** → **"Agent workspace" / "Team workspace"**.
Exact string: `landing-pricing.tsx:83`
`{who === "individual" ? "Independent agent" : "Team"}`.

---

### A7. FAQ — `components/marketing/landing-faq.tsx`

Frames 06:56–07:15. On screen: *"The ones people actually ask"* with an isometric card
graphic and five numbered rows (*Do you store card details?*, *Is screening really run
before every dial?*, *What happens to my data?*, *Can partners see each other's leads?*,
*Do you charge per lead?*), each with a `+` and a divider rule.

**A7.1 — The design is fine. (06:31)**
> *"Then I think the FAQs — the design is fine."*

**A7.2 — Remove the last line. (07:00)**
> *"I think we need to just remove the last line, this last line. And other than that, I
> think it's fine enough."*

The rule under the final FAQ row. Where: `landing-faq.module.css:16` —
`.item { border-bottom: 1px solid var(--border); }`. Needs a `:last-child` exception.
(There is precedent: `73af7e00` already removed the lines above the section.)

**A7.3 — The questions need rewriting. (07:10)**
> *"This needs to be changed. So these need to be rewritten content-wise."*

Copy work on the five questions and answers. He did not say what they should become.

---

### A8. Roadmap — `components/marketing/landing-roadmap.tsx` — the longest note in the call

Frames 02:08–06:30 and 16:30–18:05. On screen: *"See what we are building next."* with
*See the full roadmap →*, over a full-bleed aerial photograph of a winding mountain road,
with four pins (Shipped · Q4 2026 "Lead cost on every lead"; Now · Q4 2026 "Save queue and
payment repair"; Exploring · Later "Carrier e-application"; Next · Q1 2027 "Vendor
scorecard with lapses included"), each opening its detail on hover.

**A8.1 — Keep the section and the idea. Non-negotiable. (06:02)**
> *"But we definitely, we cannot remove this section. We need to build this section and
> improve this design."*

**A8.2 — The photo doesn't match the page. (02:17)**
> *"Also this journey image. I don't know if Ean or Umar has done it, but I don't think it
> matches the landing page at all."*

**A8.3 — The image is too tall and swallows the section. (03:42)**
> *"This image, I think we need to put some more text here. We need to cover this — put
> more text here and make this short, find a shorter image. It's too much. It takes the
> whole screen and it's not readable. When I see the hero, there is a whole screen that
> takes it. So when I go to this part, it doesn't."*

The photo is the section background edge-to-edge (`2a2887bb`) and runs full viewport
height. Reduce its height and put real content on top of it.

**A8.4 — Darken it, push it back, add text over it. (05:38)**
> *"More text on the image, and the less image will be. Right now the image is too much
> exposed — there is no text on it. If we have more text, we need to put more transparency,
> and just move it back and give it a blackish look. But of course it has green, and green
> will resonate with the green on top."*

Concretely: raise the dark overlay, let the photo recede, keep the green cast so it ties
to the rest of the page, and fill the space with copy.

**A8.5 — Keep a photo there, for energy. (16:36)**
> *"We're going to keep this image. If you have a better image than that, we can use it.
> But we need to keep this image — it's just to make this energetic. If I'm scrolling and
> I come back and I see some image here, I will stop. Image stops you, gives you energy."*

So A8.2 is not "remove the photo" — it is "this particular photo is wrong, find a better
one, but a photo belongs here".

**A8.6 — ADD A CONTACT FORM. This is a missing feature, not a tweak. (04:11 – 05:10) — IMPORTANT**
> *"The roadmap is important because we will not find every feature right now in the chat
> and in the application. So if we want to hold them and show them what we are building
> next, maybe they still start some conversation — or maybe we use this roadmap and try to
> get a **contact now** section here, so people can contact and do their custom queries.
> **Because that part is also missing. How will people contact us? Contact form is
> missing.**"*

> *"We need to build something around this idea where we show what we are building, what is
> our motive about this product, how we care about that product, what is our roadmap. And
> if they are interested in this idea and think about the tech we are building, and they
> want to get something customised for themselves — we'll try to engage them and help them
> fill a form or a query or something, to get back to them."*

> *(06:31)* *"This is the last part of the page. So if they're not seeing any value,
> they're not getting connected — how will they be able to connect with us? So we need to
> connect that part."*

**There is no way to contact Insurvas anywhere on the site.** He wants a contact /
custom-request form attached to the roadmap section, framed as: here is where we are
going; if you want something custom, tell us. He returns to it at 18:05: *"Maybe they have
some custom request or they have some question — because this gets people to interact and
maybe send over some queries."*

This is the only genuinely *missing* thing in the call. Everything else is restyling.

---

### A9. Footer — `components/public/site-footer.tsx`

Frame 02:00. On screen: logo, *"The Complete OS for life insurance sales teams."*, a
*Start free trial* button, three link columns (Product / Sign in / Legal), copyright, and
a very large ghosted INSURVAS wordmark behind it.

**A9.1 — Still not right. (01:48)**
> *"I had this idea like footer — it was a bigger one, we'll try to make it compact. I
> think still it doesn't look good."*

He made it compact already and is not happy. No specific direction given. Needs another
pass.

---

### A10. The dedicated /roadmap and /pricing pages

Frame 16:24 — he opened `app.insurvas.com/roadmap` (*"Where Insurvas is going."*).

**A10.1 — They need the same treatment. (16:07)**
> *"We have a dedicated roadmap page. So we need to design this as if we have a roadmap
> page, pricing page. What if the pricing is within? And then we have an external page — I
> think there is one. So we need to animate these."*

The standalone `app/roadmap/` and `app/pricing/` pages need the same design and animation
work as their landing-page counterparts. **[unclear]** — *"What if the pricing is within?"*
reads like he is wondering whether pricing should live only on the landing page rather than
having its own route. Worth asking him.

---

### A11. What comes after this round

**(18:05)**
> *"Other than that, then we are good. It's enough. Then we will work on SEO, and then
> trying to write some copies around all these different sections for social media."*

SEO and social copy are the next phase, after the design work. Not now.

**(15:39)** On who is doing what:
> Umar: *"The next iteration, if you are going to work on it… I'm just here to talk to
> Benjamin on a few things, so I will not be able to give some time. But after the day I
> will be able to review. You pretty much have a good idea of how I am thinking, and you
> can even come up with an improvised version."*
> Rion: *"I've got the feedback, got the concepts, so I'll work something around it."*

Umar is not designing this. Rion builds it, Umar reviews. That means judgement calls are
Rion's to make — but check the seven modules (A5.1) and the logo (A1.3) before building.

---

## Priority summary

**Missing feature (build it):**
- A8.6 — contact / custom-request form on the roadmap section. Nothing like it exists.

**Structural (changes what the page says):**
- A5.1 — bento goes from five panels to seven modules
- A5.3 — 2D animated flow diagrams replace the 3D illustrations
- A3.1 + A3.3 — five tools become stacking 3D cards resolving into Insurvas, built on the Clepso problems-in/solutions-out pattern
- A8.3/A8.4 — roadmap photo shortened, darkened, text over it
- A2.1 — social proof band rebuilt to carry real credibility

**Small and unambiguous (do these first, they are cheap):**
- A6.4 — "Independent agent"/"Team" → "Agent workspace"/"Team workspace" (`landing-pricing.tsx:83`)
- A7.2 — remove the rule under the last FAQ row (`landing-faq.module.css:16`)
- A6.2 — remove the hatched ring on the recommended card (`landing-pricing.module.css:54`)
- A1.1 — drop "Complete" from the hero headline and re-break the line

**Needs design judgement:**
- A6.1 — pricing cards become selectable with animation
- A6.3 — pricing in light mode
- A9.1 — footer, again
- A1.2 — something behind the hero headline
- A0.1 — mobile responsiveness

**Copy:**
- A0.2 — cut text throughout
- A7.3 — rewrite the FAQ questions
- A1.1 — hero headline wording

**Deferred by Umar himself — do not build yet:**
- A1.4 — hero device cycling through app screens
- A11 — SEO and social copy

**Ask Umar before building:**
- A5.1 — confirm the final seven module names
- A1.3 — the logo redesign
- A10.1 — whether /pricing should stay a separate route

---

## Things I could not resolve

- **17:36** — *"This is one thing that is really good. It requires RSS."* "RSS" is almost
  certainly a mis-transcription; the surrounding context is the Clepso animation. I did not
  guess at what he meant.
- **00:29** — *"The P come 3"* appears in the raw transcript near the hero note. Nothing on
  screen explains it. Ignored.
- **A10.1** — *"What if the pricing is within?"* See above.
- **A5.1** — the seven module names are his first pass, spoken while thinking. Confirm them.

---

## Appendix — raw transcript

Unedited WhisperX `small` output, timestamps are source time. Mis-transcriptions noted at
the top of this document have **not** been corrected here. This covers the landing page
portion only (00:00 – 18:36); the BPO recruiting conversation that follows is not included.

```
[00:00] Still, it's not responsible mobile. So we need to look into that. And then this second and third section, if you see my screen. This will change eventually, but this makes some sense here.
[00:29] And this section is always looked for these grids. The title is the problem there on the here section. The P come 3. You see? I think so we will remove complete. I think so the operating system, I think so the operating system for life, life would be below and then I think so this will not be the complete text.
[00:58] The text needs to be reviewed. But you see the geometry? Yeah. See, I think this start, we can have something that goes behind this and it gets empowered. And then we have this screen. I have some ideas for this one as well. So the logo needs to be updated. This was like a PNG, right? Yeah. Yeah. Like just done fast.
[01:25] I thought if we could use this and animate and show different screens on this page, like use this as a as a as a separate screen and then show different screens. So it changes to inbound and then shows inbound how it works and then changes to dial it and then dial it and then.
[01:48] for callbacks, like this is a different option in the screen. But I think so we can do this later, but now it's fine. See, it animates for the second here, see? Yeah, yeah, like we can do it interactive. Like people can change it if they want themself or to be animated on its own. So I did this one and then I started from the bottom, right? So I had this idea like footer, it was a
[02:17] Bigger ones will try to make it compact. I think so still it doesn't look good. Also his journey image. I don't know if Ian or you more has done it, but I don't think it matches the learning page at all. I mean,
[02:47] We need to actually build something on top of this image and then- I like the idea. I like the idea to show in the show program, but not this image. It's a bit too large. So we need to find out some image that can get really short. But we really want to use some images because images can get rid of this stuff, right? Yes.
[03:15] So one thing that I actually saw, first, there's too much text. No one would read all of those texts. And the example images on the... Can you open it up? The above part is not done yet. So that's why I'm showing this. We started from the bottom. It's not from the top. From top, we have some ideas I'm gonna share.
[03:42] So this image, I think we need to put some more text here. So we need to cover this, like put more text here and make this short, like find out some shorter image. It's too much. It does take whole screen and it's not readable. So it's, yeah, it should be a, like, when I see like every, like you see hero, there is a whole, there is a screen that takes it. So when I go to this part,
[04:11] It doesn't take. So we need to cut this out. Just here, but if we cut it out, then this thing will not be there. So the whole purpose is to show this thing, this journey. Right? Yeah, the road. Because the road map is important because we will not find every feature right now in the chat and in the application. So if we want to hold them and show them what we are building next, maybe they still
[04:42] start some conversation or maybe we use this roadmap and try to get a contact now section here so people can contact and do their custom queries, right? Because that part is also missing. How people will contact us, right? Contact form is missing. But we need to build something around this idea where we show what we are building and what is our motive
[05:10] about this product, how we care about that product, what is our roadmap. And if they are interested in this idea and think that the tech we are building, they want to do something, but they want to get something customized for themselves. We'll try to engage them and help them fill a form or a query or something to get back to it. Image, we can use more images. I use this one particularly to show because this has like
[05:38] this journey and then it always also comes with a green it's a green image but it's too large that's why it just makes sense it just not readable but of course the second version and third version will try to get some some more images that will help and then more text here if we get more text here this will get filled
[06:02] So more text on the image and the less image will be. Right now, image is too much exposed. So there is no text on it. And then of course, if we have more text, we need to bring, like put more transparency. And then just move it back and give it a blackish look. But of course I have a green and green will resonate with the green on top. But we definitely, we cannot remove this section. We need to build this section and improve this design.
[06:31] So this is the section we will show our vision for the product, what we are building, and how we can make it customizable, or take queries from people who have some question about products, right? Before we actually, this is the last part of the page. So if they're not seeing any value, they're not getting connected, how will they be able to connect with us? So we need to connect that part. Then I think so, FAQs is the design is fine.
[07:00] We need to work on it. I think so we need to just remove the last line, this last line. And other than that, I think so it's fine enough. This needs to be changed. So these needs to be rewritten contact-wise. This one actually is, but do you guys think,
[07:29] The one you have? No, like this design that you have done is good. Just this one was selected with the lines. I don't know about it. And if there is no animation yet, it's not even selected. So we need to make it selected. And when someone selects, it shows this line and maybe change some color. I was not able to do that, but I was trying to make it more compact.
[07:58] So your version has a lot of text behind and just there. This text is really good, but we now need to find what options will be here. The option needs to be there and where they are coming from and these are just random and then the animation of this. So like your ones were animated, but they were not designed properly. So there is no animation here. So we need to put animation and someone selects
[08:28] particular one it will less come up and show up like this one got selected. This line we can even remove this. In the white version it just looks very different so we need to make it like with a different background here. But I think so this will work and this has two
[08:57] So this is important because someone is going to select a dependent agent. I think so we should do this agent agent and team. Agent workspace team workspace like kind of this. It will be much better than that later from the previous budget. These kind these these cards are really live. I mean it's good. Yeah, but we. But we need to make sure that these calls.
[09:26] these cards have very good information in the lead flow. So the first thing we have is like partnerships and lead, partnership and lead flow. So you can set up all your partnerships, get lead sources, and you have like a dialer and flow, take in bombs, communication with your partnerships, that's a part.
[09:55] So we need to focus on the main and things that we can add in that. And then the second part is basically you have outbound dialer and outbound dialer and management of your leads that you are importing that one. Third one we can do is like one main operation for submitting and interviewing clients. This could be the third option.
[10:23] The fourth option could be everything after your submission. So commission and book of business, automations, and like that, then the next one should be accounting and accounting, right? And the next one we could do is like retention. Yes, retention could be a good one. And the last one could be compliance. So of course these will be like more like,
[10:53] like a module each will be a part of like a module and a solution like a feature like this one is good actually to highlight the features and modules the section design is good but of course the content is too much and this side if we can bring with some other design or like I was thinking if we can do like flow diagrams small flow diagrams where they pass data and show the whole workflow that would pretty much very engaging
[11:24] Because in the retention, if I can see how retention works, like how retention works in service, if we can show it here, pretty much solid. Got you. Right? Yeah. So instead of like making them 3D, we can even have the 2D, but it's just one file shows up here. And then data flows from here to next one, but actually how retention is happening inside the service. And then it's responding to that.
[11:53] And very quick, like this is like a small kind of video, video card, like, but it's an animated video card. It's not actually a video. But it's, it's good. And then these sections are really important, right? Is you have, because the landing page is, you need to find audience who can relate to you, right? So this is basically,
[12:21] is you introduce yourself, right? There is a platform, but you don't introduce why this is platform. So this will introduce them. This one is like more like social proof, need to improve. This design is just a basic. So when someone lands there on landing page, he knows only as it's a complete OS, right? Operating system. How it is an operating system, like it's being built by someone. So you just build some credibility here, right?
[12:49] Yeah, it's being used by agents, internal team running for two hours or two years and stuff like that, right? Yeah. Once you have a credibility, now you come up why this, why this isn't sure. So you will put some problem statements there. Like, find defense teams and agents around the world, like they are using five different tools to do the same thing. And it's really hard to like get scalable.
[13:15] then we need to show like they have a CRM and they have a dialer and they have a spreadsheet. I was thinking like to make some like 3D cards here, they get stacked. They have stacked it and then in short, this here is getting it just replacing that four cards. So but I just don't have some time to just get this to a design. Did I have a design? Like we have like a CRM here, a dialer here,
[13:44] like a 3D card showing a dialogue there, and a CRM here, another spreadsheet for commission spreadsheet, policy spreadsheet, a compliance prayer, and like some of the other things like they choose as a rule in different segregated way. And then there is one you just show in Shorbas here, just taking them over. And then,
[14:13] we can see we have worked chaos from inside looks like we run like insurance agency for two years and we have seen we need to build some story here and we have seen all these problems and then we come up in our own system that can do all these things very basic like very basic introduction of insurance here right even if we don't do an introduction and just put the problem there so they can relate and then we put more more things like
[14:41] Now this idea is more about like having Clipso is on the one side, putting the problems and going through in service and then just coming out as a solutions, right? Yeah, so you want to like kind of take this design from Clipso, this one. And I discussed with Arten and said it doesn't make it make more sense. It make more sense because now you have like problems coming in.
[15:11] into and they're going through a system and get refined and getting as a solution. But this needs to be make up like in a way that this is more presentable. More presentable and more view. What I have right now is just in my head. It's only a concept, right? Design will make that story into realistic. And again, there is some space here that we need to fix, like build it more and get it done.
[15:39] this line here we need to remove so I think so the next iteration if you are going to work on it it will be um making more because I am just I'm just here to work or to take the Benjamin on on some few things so I will not be able to give some time but after the after the like the day I will be able to review so
[16:07] You pretty much have a good idea of how I am thinking and you can even come up with an improvised version into this. Yeah, I've got the feedback, got the concepts, so I'll work something around it. But both of them are, it's fine. It's fine, very basic. We need to check on few things. So we have a dedicated roadmap page. So we need to design this as if we have a mapping page, pricing page. What if the pricing is within?
[16:36] And then we have an external page. I think so there is one. So we need to animate these. And then just playing around with the problems. But the main scanner is, I think, so it's there. And we're going to keep this image, but come over like some. If you have a better image than that, we can use it. But we need to keep this image. It's just to make this energetic. See, if I'm using, I'm all seeing this. And if I come back and I see some image here, I will,
[17:06] stop. Oh, this is some image because image, like see, image stops you, just give you some energy. Because there is no energy on top, like energy here, but then you have text. And then of course, energy here, then you have text. So we need to put some energy landing page is more about grabbing attention. So we need to look into that how to grab like
[17:36] attention and let people stay there. Stay there forever. The more they stay, the more they'll learn about product, and maybe they can make their money to sign up. So this is one thing that is really good. It requires RSS. We need to find out how we can do this on here. Right? Yeah. After that. Yeah.
[18:05] Maybe they have some custom request or they have some question or because this gets us to people to interact and maybe send over some queries. Other than that, then so we are good. It's enough. Then we will work on SEO and then trying to write some copies around all these different sections for social media.
```
