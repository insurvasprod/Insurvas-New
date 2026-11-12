# Landing page review call, 11 Nov 2026 — Artin Ahmeti

**Source:** `C:\Users\Admin\Videos\2026-11-11 16-18-08.mp4` (5:26, 1280×720, Zoom screen recording).
**Room:** "Artin Ahmeti's Personal Meeting Room". **Present:** Rion Reqica (sharing), Artin Ahmeti
(reviewing, running the call), Olti, Admin Team, Rinor.
**Shared screen:** `localhost:3000` — the landing page as it stands on `redesign/landing-feature-cards`
with the four uncommitted rounds applied (feature cards, hover invite, leaks journey, card sheen).

**Transcription:** WhisperX large-v3, English, run locally. **Frames:** one every 4 s at 1024px
(82 frames) to anchor each remark to what was on screen.

**Speaker labels are inferred** from the content (who asks, who answers, who says "we can work
something out") cross-checked against Zoom's "Talking:" overlay, which lags a second or two at
hand-offs. Where a line could belong to either person it is marked *(uncertain)*.

This is a different call from Keller's 10 Nov review (`tasks/landing-feature-cards/transcript.md`).
Artin was on that call too — the 10 Nov transcript's "Arne" is almost certainly Artin.

---

## Full transcript

### 00:00 — "What it does" feature cards (card 05/07 Accounting on screen)

> **Rion:** …that was just a little bit more space to the card, to the point that it might still
> make a small difference of were people paying attention to the card better. So it just looks
> better in my opinion.
>
> **Artin:** Got you. Yeah, that's actually a really good idea of making these more… it looks more
> like a headline, like something that they should pay attention to. So that's one of the things
> that I noticed. And can you go up?

*On screen 00:00–00:28:* the sticky feature-card stack. Card **05 / 07 Accounting — "Profit is a
number, not a guess."** with the three points and the **More info +** button, its 3D workflow panel
counting a live Profit & loss figure; at 00:16 card **04 / 07 Commissions — "Know you got paid
right."** is sliding over it, both cards visible mid-cover.

### 00:30 — The hero laptop: an invite in the corners

*Rion scrolls to the top. On screen: the hero, "The operating system for life insurance sales
teams.", the two CTAs, and the laptop cycling real app pages.*

> **Rion:** You mean here?
>
> **Artin:** Yeah. I do like the way that you put it, the floating button that essentially tries to
> make people play around with the dashboard. But there should also be something in the corners at
> the top — so top right and top left of the corners — indicating that, hey, something's going on
> here. Something that it… **[00:58]** not necessarily fades away instantly, because I think that
> would drive all of the attention from the hero section straight to the dashboard, so people
> actually know that this is something they can play around with and essentially just spend more
> time here. And it would probably make a better adjustment.
>
> **Rion:** Like, for here it would cover the logo. **[01:24]** But we can work something out about
> that — but from the right corner, yeah, basically we can put something that is more noticeable and
> people can basically see that you can interact with the pages here.
>
> **Artin:** Yeah, and I don't mean that it has to cover any part of the dashboard. It's just
> something, maybe like a — I don't know — like a **curved arrow with an animation**, that it's
> starting from a position and then pointing to the dashboard, or something like that.

*On screen 00:30–01:50:* the laptop cycles Book of Business → Policies, Carrier sync, Retention
cases, Accounting → Profit & loss, Partners → Publishers, Compliance, Settings → Team, Agency,
Inbound floor, Dialer. The floating page-switch control Artin calls "the floating button" is the
laptop's own sidebar; the top-left corner he is pointing at is where the app's Insurvas logo sits,
which is why Rion pushes back on that corner.

### 01:53 — The tooltip idea (already built)

> **Artin:** No, I have an idea. So whenever you hover inside the dashboard, on the mouse cursor,
> you can make a short text — "click it". Whenever the mouse hovers towards one of the dashboards…
>
> **Rion:** You mean like a tooltip?
>
> **Artin:** Tool what?
>
> **Rion:** **[02:21]** Like a tooltip. So whenever he hovers around something, it displays a small
> message at the top of the cursor.
>
> **Artin:** Oh wait. Like… yeah, similar, yeah, exactly, exactly.
>
> **Rion:** Like even right now — yeah, it follows up the…
>
> **Artin:** Okay, okay, that's good, that's good. Yeah, just some small changes here and there, I
> would say. Other than that, I think it looks pretty, pretty good.

*On screen 02:16–02:50:* the page reloads to the top and the **"← Pick a page to explore"** chip
appears over the laptop and follows the cursor as Rion moves it — the hover invite built on 10 Nov
(`tasks/landing-hover-invite/`, uncommitted). Artin accepts it on sight as the thing he was
describing.

### 02:51 — The navigation bar (the one real complaint)

> **Artin:** And one thing that I also had mentioned before is going to be the navigation bar. It
> just looks too unorganized to me, I don't know. It's just a lot of stuff going on there, and it
> doesn't look the best, I would say. One thing you could do is maybe **remove one of the sections**
> — like, I don't know, maybe a roadmap **[03:20]** or something like that. And also try to make
> them **more neatly placed**. Maybe just **reduce the distance between these sections** — but at
> the point that it's still readable. It looks good, but it also looks more neat. Because to me, it
> is OK, I would say, it just doesn't feel… **[03:48]** at its best, I don't know. It's just
> something off about it. And I'm pretty sure it's about all of these sections being placed in this
> way that they are right now.
>
> **Rion:** Yeah, we can work something out and change how basically the nav bar is looking right now.

*On screen:* the floating header over the hero — **Insurvas logo · Home · Who it's for · Features ·
Pricing · Roadmap · FAQ · [theme toggle] · Sign In · Start free trial**. Six links spread across the
bar with `justify-evenly` ([site-header.tsx:37](components/public/site-header.tsx:37)).

### 04:04 — What else changed this round

> **Artin:** Yeah. Did we make any other changes here?
>
> **Rion:** **[04:15]** Like, for here, actually — I don't think so, just work with the animations.
> Like even this kind of glowing in the back is added for the dark mode. But other than that, no.
> Mostly I've worked on the \[other\] stuff on Power Policies. While here right now, probably I'll
> do these fixes as well **[04:44]** and check with you later if something else is missing or needs
> to be added.

*On screen 04:15–04:55:* Rion scrolls down through "What's broken today" ("A CRM, a dialer, two
spreadsheets and a prayer" → the Insurvas tile → the solved cards), "Built for the way insurance is
*really* sold.", the FAQ ("Do you charge per lead?"), the Roadmap band ("See what we are building
next."), then back up through the feature cards (06/07 Retention, 05/07 Accounting).

### 04:48 — Sign-off and Google Analytics

> **Artin:** Yeah, cool. Overall, I think it looks pretty good. There's going to be some stuff that
> we will add. **I will give you the code for Google Analytics** — that's something that we plan to
> incorporate in all of our products, so we can monitor who's spending how much time in which
> section, what are some **[05:12]** insights that we can get from all of these visitors to our
> page. But yeah, that's pretty much it. All right then — \[Rinor\], would you like to go next?

*On screen 04:56:* a new tab opens, "Insurvas · Know what every lead…". At 05:18 the share stops and
the Zoom gallery returns.

---

## What Artin asked for, on top of what we already had

| # | Ask | His words | Where it lands | New? |
|---|---|---|---|---|
| 1 | **Corner cues on the hero laptop.** A marker in the top-right (and ideally top-left) corner of the device saying "something is going on here", so a visitor knows the screen is interactive before touching it. | "there should also be something in the corners at the top, so top right and top left of the corners, indicating that, hey, something's going on here" | `landing-device.tsx` / `landing-device.module.css` | **Yes** |
| 2 | **The cue must persist, not blink out.** It should not fade away instantly — it has to hold long enough to pull attention from the hero to the dashboard and keep people there. | "not necessarily fades away instantly, because I think that would drive all of the attention from the hero section straight to the dashboard… and essentially just spend more time here" | same | **Yes** |
| 3 | **Nothing may cover the dashboard.** The cue sits outside or on the chrome, never over the screen content. Top-left is contested because it would cover the app logo — Rion offered the right corner and Artin agreed in principle. | "I don't mean that it has to cover any part of the dashboard" | same | **Yes** |
| 4 | **Shape suggestion: an animated curved arrow** that starts from a position and points at the dashboard. Offered as an example, not a mandate. | "like a curved arrow with an animation that it's starting from a position and then pointing to the dashboard" | same | **Yes** |
| 5 | **Trim the nav bar — drop a section.** Six links is "a lot of stuff going on". He named Roadmap as the candidate, unprompted and twice-hedged ("maybe", "or something like that"). | "maybe remove one of the sections, like, I don't know, maybe a roadmap" | `components/public/site-header.tsx` | **Yes** |
| 6 | **Tighten and tidy the nav spacing.** Reduce the distance between the links so they read as a neat group, while staying readable. The current `justify-evenly` spread across a `max-w-2xl` bar is the thing that feels "off" to him. | "try to make them more neatly placed… just reduce the distance between these sections, but at the point that it's still readable" | same | **Yes** |
| 7 | **Google Analytics on the page.** He will supply the tracking code. Goal: time-on-section per visitor across all their products. | "I will give you the code for Google Analytics… so we can monitor who's spending how much time in which section" | new; blocked on him sending the ID | **Yes — blocked on him** |

## What he confirmed we already had right

- **The feature-card taglines read as headlines.** The elevator-pitch copy built from Keller's
  10 Nov call landed: "that's actually a really good idea of making these more… it looks more like a
  headline, like something that they should pay attention to."
- **The extra breathing room around each card** was Rion's call and Artin accepted it without
  changes.
- **The hover invite chip is exactly the tooltip he was reaching for.** He described it from
  scratch, did not know the word "tooltip", saw it working live and closed it with "okay, that's
  good, that's good." It needs no change — but note it is the *cursor-following* half; the *corner*
  half (items 1–4) is what he still wants on top of it.
- **The page as a whole:** "Other than that, I think it looks pretty, pretty good." / "Overall, I
  think it looks pretty good."

## Not raised at all

He scrolled past, or sat through, every other uncommitted round without comment: the card light
sweep, the lengthened leaks journey with its aura and gate burst, the Life & Health band, the trust
band, the roadmap band, pricing, FAQ, contact and the footer. Silence here is not approval of the
detail — he was reviewing the hero and the cards — but nothing in those sections drew a complaint.

## Open questions for Artin

1. **Roadmap out of the nav — does it stay reachable?** `/roadmap` is a real page and the landing
   page has a Roadmap band linking to it. Dropping the nav link hides the page from the header but
   the band still points at it. Confirm that is what he means, or whether he wants a different link
   dropped (FAQ and "Who it's for" are both in-page anchors and cheaper to lose).
2. **Corner cue: both corners or just the right?** He said both, Rion objected that the left covers
   the logo, and the thread ended on "we can work something out". Treat the right corner as settled
   and the left as still open.
3. **How long should the corner cue hold?** "Not instantly" is the only constraint given. Needs a
   number — the hover chip currently stops showing once the visitor has interacted.
4. **Google Analytics:** waiting on the measurement ID, and on whether a consent banner is needed
   for the regions they market to.
