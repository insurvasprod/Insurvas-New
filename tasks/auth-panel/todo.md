# The panel beside sign-in (owner, 12 Nov)

"I don't like the photo on the left. I want an animated one that suits Insurvas, that has to do
with what we are doing, has meaning, and at the same time looks really detailed, really real —
futuristic but modern, fancy. Research as much as possible, look at styles. Mockups first. And the
designs you do are usually too AI-sloppy, so I want something special."

Mockups only. Nothing is wired into the real auth screens:
**`/design/auth-art`** (development only), with each study against the photograph it replaces, at
the owner's 1536×826, beside the form.

## What is there now, and what is wrong with it

`auth-utah-road.webp` — a bought aerial of a mountain road near Salt Lake City, with a Ken Burns
drift on it (`.auth-photo-image`, globals.css).

- It is a **stock photograph**: anyone who paid for it has the same one.
- The road gestures at the brand's Data Highway idea, but it is a road in Utah. It says nothing
  about leads, calls, applications or commissions.
- The green of the forest is not a brand green, so the panel is the one surface the palette does
  not reach.
- A slow zoom is the cheapest motion there is, and it reads as a placeholder.

## The research, and what it ruled out

- **Login galleries** (SaaSUI, Tenet, Userpilot, Lapa): useful for layout convention, useless here
  — almost every brand panel in them is a flat gradient, a screenshot or a stock photograph. There
  was **nothing worth copying 100%**, which is the honest answer to that part of the brief.
- **Technique, from the WebGL side** (Codrops, three.js forum, clicktorelease's curl-noise
  studies): the long-exposure look is not drawn, it is **accumulated** — additive blending plus
  frame persistence, never clearing the canvas. That is the mechanism behind study A.
- **Insurtech identity work** (Ping, Clearcover, Protectivity, Insurity): the data-flow metaphor is
  live in the category and the palettes are going dark and premium, but **no one is using
  long-exposure light or engraving**. The field is open.
- **Category defaults to avoid:** the gradient blob, the smiling agent in a headset, and the
  predictable opposite (black plus mono type). All three are ruts.

## The three directions

Each is a real animation, running, in the brand's greens, and each means something specific.

**A · The Line.** A thirty-second exposure of the data highway. Every light is one lead; a lane is
a campaign. Most run past; a few slow, burn and stop — those issued — and leave a mark that stays
on the plate. Keeps the road the owner already approved and makes it the product's own.
*Mechanism:* the canvas is never cleared, so the tails are true accumulation; heads are one soft
sprite stamped thousands of times. *Risk:* light trails are a known move; it earns its keep through
the accumulation and the one event that matters, not through more lights.

**B · Guilloché.** The engraving off a policy document, with the machine still running. Guilloché
is the fine-line rosette on banknotes, bonds, share certificates and policies — the visual language
of a written promise, which is what this company sells, and the one tradition in this industry no
SaaS login has taken. *Mechanism:* the real curve, an epitrochoid, nested 62 deep; the interference
between those threads is what the eye reads as cut metal. An inking pass runs round one line every
few turns; a security-print rail and counterfoil ticks frame it. *Risk:* engraving can read as old
money rather than new software — the direction to look hardest at.

**C · The Floor.** The room the product runs, drawn as its own instrument. A lead arrives at the
left edge, is routed to a seat, the seat holds while the call is live; some end in a policy and a
token leaves for the ledger at the right, where it stacks. "Know what every lead cost you" as a
picture: one lead, one route, one seat, one line in the ledger. *Mechanism:* a small live
simulation, so no two visits are the same. *Risk:* the nearest to a dashboard, so the easiest to
make busy.

## Round 1 verdict (owner, 12 Nov)

**B · Guilloché and C · The Floor are out** — "they don't suit it at all". Not defended, not
reworked. The code is in the history; the chooser on the study page still carries them so the
pictures can be put side by side, but the direction is **A · The Line**.

**And the words were the other half of the problem:** "the text on the left, I don't know, it
doesn't look that good." He is right, and it is worth being precise about why:

- **Four voices stacked in a descending ladder** — caps kicker, headline, paragraph, rule,
  footnote. That is a wall, not a hierarchy.
- **The kicker is 52 characters of tracked uppercase**, which the eye reads as a grey bar rather
  than as a sentence.
- **The paragraph says the headline again**, in weaker words.
- **The rule above the last line makes a footer** inside a panel that has no footer.
- **All of it sits low and left**, exactly where the picture behind it is busiest.

### Three treatments, using only the words already there

Switchable on the same page, against any of the pictures.

**1 · One sentence.** The kicker and the paragraph go; what is left is the claim and the one line
that makes it credible. Two voices instead of four, with the accent serif on *lead* — the landing
page's own move (BRAND.md interpretation 9), which ties the door to the page it came from.

**2 · Lead line above.** The same information inverted: the small line first, out of uppercase, the
claim under it, nothing below. The quietest of the three.

**3 · Top set.** The words move up under the logo and the picture takes the whole lower half, so
the two stop competing for the same ground. The paragraph survives as one quiet line at the foot.
The strongest composition of the three — the art finally gets a clean stage.

## Round 2 (owner, 12 Nov)

Two corrections. **"I cannot see the artifact"** — the studies only existed on a dev server, which
had stopped; they are now a published page that opens anywhere and can be sent to Keller:
**https://claude.ai/artifact/Tux5xh988377QSKGGc1M5m** (private until shared from its Share menu).
And **"drop the Guilloché and the floor" meant two new ideas**, not only the type work.

Both rejected studies were in the wrong register for him. Reading the three verdicts together:
A worked because it is **cinematic** — dark, deep, light arriving out of the distance, photographic.
B failed as **ornament**, C failed as a **diagram**. So the two new ones stay in A's register and
change the subject and the camera instead of the style.

**B · The Territory** — a city at night from height, drifting. Every window is a household: the
market the floor works, and the scale of it is the point. One window at a time takes the light — a
policy written — holds, then lets go. Camera: high above, looking down. Scale: vast.

**C · The Room** — the floor itself, at eye height, late. Rows of screens going back into the haze,
the near ones thrown out of focus by a long lens, one flaring as a call connects. "Built by people
who ran the floor" is already the line on this panel; this is that line as a picture. Camera:
inside, human height. Scale: intimate.

All three carry **3 · Top set**, the words treatment he picked: the claim at the top under the
logo, the picture taking the lower half, the paragraph as one quiet line at the foot.

**Two things that cost a round each, worth remembering.** Both new scenes first collapsed into a
thin band on the horizon: the ground has to drop away as `camH / z`, not as a fraction of the
scale. And the city was a grey dusting until the windows were drawn as crisp one-pixel lights — a
soft sprite scaled down to a pixel throws away nearly all of its light.

## State

- [x] Researched; nothing found worth copying outright, and that is recorded above
- [x] Three studies built and running at `/design/auth-art`
- [x] 47 design tests, typecheck and lint clean. The chooser is `ViewTabs` (§8), the type is in the
      stylesheet (type scale), no component names a colour (§9)
- [x] Round 1: **B and C rejected**; A · The Line stands unless he says otherwise
- [x] Three treatments for the words built, after the same complaint
- [x] Words: **3 · Top set** chosen
- [x] Round 2: two new pictures built, and the studies published where he can actually see them
- [ ] **Owner picks the picture** from the published page
- [ ] Then port the winner into the repo (the design route still holds round 1) and wire it in
- [ ] Then: wire the chosen one into `AuthPhotoPanel`, decide the reduced-motion still, check it on
      a phone and in light mode, and measure the cost of running it behind a form

## Open, once a direction is chosen

- Whether the panel keeps the "Pause motion" control (it should).
- Whether sign-up's five steps keep the same art or a quieter variant — the step summaries already
  take that panel over.
- The still frame for `prefers-reduced-motion`: each study draws one held frame today, but which
  frame is a design decision, not a default.

## Round 3 (owner, 12 Nov)

**A · The Line is out too.** Three rejections now, and together they say something useful: the
owner does not want a *metaphor*. Guilloché was ornament, The Floor was a diagram, The Line was an
abstraction — light standing in for leads. What survived both rounds are the two studies that are
**real places**: a city from the air, and the floor itself.

So the replacement is a third real place, at the one scale the other two do not cover — close
enough to touch.

**A · The Window** — rain on the glass of a high floor, the city thrown out of focus behind it.
Inside is the floor: dry, lit, working. Outside is the market, in the dark. Between them is the
weather, which is the reason the industry exists. Vast / human / macro is now the set.

Two things it cost:

- **A drop has to be a lens, not a dot.** It samples the scene behind it and turns it over; that
  inversion is the whole reason a raindrop reads as water rather than as a bead of paint.
- **It must sample a second canvas.** Reading the canvas it is being drawn into forces a read-back
  of the destination per drop: 17fps. The city now renders to its own buffer and the drops sample
  that — **59-61fps** for all three studies on the owner's GPU.
- The droplets a sliding drop leaves were sharing an array with the standing drops and, once it was
  capped, evicting them oldest-first, so the glass became vertical streaks with the beads gone.
  Two different things, two lists.

## Round 4 — the brief, finally understood (owner, 12 Nov)

"The window doesn't have anything to do with Insurvas, it's so bad." Then: **"you should make a
theme that suits what we have done till now, everything in this SaaS."**

That is the brief that was under all four rejections, and it was not "invent a world". Every
rejected study invented one — an engraving, a floor plan, a highway, a rainy window — and each had
to argue its way back to the product. The two that survived were the two that are literally the
business: the market, and the room.

**The answer was already in the repo.** The landing page's life-and-health band runs a fluid
gradient that was tuned against the reference and signed off this week. Put the same field on the
door and the front page and the sign-in are visibly the same software — no seam to cross, and no
new idea to defend.

**A · House style** — the landing band's field in the panel's proportion. The same shader, ported
from `components/marketing/wave-gradient.tsx`: four colours walked by a noise field warped by
itself twice, sliding across the frame and morphing as it goes. The ramp is held back over the
words — at the **top** here, since Top set puts them there — so white type keeps its contrast while
the light moves around it. Drawn at 0.6 of the screen's pixels; **61fps** behind the form.

The Territory and The Room stay on the page as the alternatives, renumbered B and C. The Window is
gone.

**The lesson worth keeping:** on a product with an established visual language, a new surface
inherits it. Four rounds went into learning that the owner wanted the house style and not a concept.

## Wired in (owner: "yes, wire it in", 12 Nov)

**A · House style is live on the real sign-in and sign-up.**

- The field is now a **shared component**: `components/marketing/wave-gradient.tsx` moved to
  `components/shared/wave-field.tsx` as `<WaveField look="then" | "now" | "auth" />`. One shader,
  two surfaces — the repo's own rule is to extend the shared component once rather than copy it.
- The only change to the picture the landing already shows is that the **height of the hold**
  (the block over which the ramp is capped so white type keeps its contrast) became a uniform
  instead of a constant. The landing passes the constant it already had, so **its output is
  unchanged** — checked by rendering the band again after the move.
- The `auth` look: a shade larger in its own units because the panel is tall where the band is
  wide, the hold up at 0.26 because Top set puts the words at the top, and **no pointer parallax**
  — a form is a place people type, not a place they wave the mouse about.
- `auth-photo-panel.tsx` draws the field instead of the photograph, and the words are Top set: the
  claim under the logo, the field taking the lower half, the one supporting line at the foot. The
  caps kicker is out of uppercase; the rule and the footnote are gone.
- **Pause** now stops the loop rather than a CSS animation. Under reduced motion the field draws
  one frame and holds it, and the pause control is hidden (verified: two captures 2.5s apart are
  byte-identical).

**Checked:** 50 design tests, typecheck and lint clean; the door at 1536x826 and 390x844 with no
horizontal overflow; the landing band re-rendered and unchanged; **60fps** on the door.

**Left alone on purpose:** `public/marketing/auth-utah-road.webp` and its line in
`public/marketing/README.md` are untracked work from the Codex session, and nothing of mine
references the photograph any more. Deleting it is the owner's call, not mine.

## The audit (owner, 12 Nov: "compact, professional, same layout on every step, no scrolling")

Read-only, measured in the browser at 1536×826 and 1366×768, not judged from screenshots.
Published: https://claude.ai/artifact/5fd7a1qh6EG5ybP8TzpddV

| Screen | Heading top | Body height | Column | Scrolls below |
|---|---|---|---|---|
| Agent sign-in | 269 | 287 | 472 | <540 |
| Step 1 · your account | 294 | 336 | 472 | <540 |
| Step 1 · confirm email | 242 | 439 | 472 | <540 |
| Step 2 · plan | 224 | 475 | 611 | 666 |
| Step 3 · about you | 174 | 576 | 611 | 646 |
| All done | 398 | 128 | 472 | <540 |
| **spread** | **224px** | **448px** | **139px** | |

**The finding that matters: the heading moves 224px between steps.** The panel's claim is anchored
(90px from the top, 134px tall, every screen); the form beside it is vertically centred, so where
the eye lands depends on how much content the step happens to have. That is what "the layout is not
the same" means, and one change fixes all six: anchor the step body to one top edge and let it grow
downward.

Also: the column measure changes under the reader (472 on the form steps, 611 on plan and profile);
"all done" is 128px of content in an 826px window; the plan and profile steps have the least scroll
headroom (666px and 646px) while the rest survive below 540px.

Scale (0 unusable → 4 no material defects in the inspected scope): layout & responsive **2**,
implementation integrity **3**, theming **3**, accessibility **3** (one unlabelled input on
"About you"), performance **3** (60fps with the field, reduced motion holds a frame).

**Not inspected, and not scored:** tab order inside the form, screen-reader announcements, the
payment step (no dev variant), touch on hardware, and the worst-case contrast of white type over
the field on this panel specifically.

- [ ] Anchor the step body to one top edge across all six (P1)
- [ ] Label the input on "About you" (P1)
- [ ] Rebuild "all done": it is the first second of ownership and it is nearly empty (P1)
- [ ] One column measure; the plan step gets a denser grid rather than a wider column (P2)
- [ ] Budget every step to the same height so the scroll headroom is even (P2)
- [ ] Confirm-email: the mailbox shortcuts outweigh the primary path (P2)

### P1 done: the step body is anchored, not centred

`app/globals.css`, the one rule that was `margin-block: auto` on `[data-auth-body]`. It now starts
at a fixed `--auth-anchor` (`clamp(16px, 10vh, 104px)`) and grows downward, with `margin-bottom:
auto` keeping the legal links at the foot. A door with no progress bar reserves its space
(`--auth-steps-space: 49px`) so the heading lands with the steps' headings rather than 49px above
them.

Measured at 1536×826, heading top:

| | before | after |
|---|---|---|
| Agent sign-in | 269 | **168** |
| Step 1 · your account | 294 | **168** |
| Step 1 · confirm email | 242 | **168** |
| Step 2 · plan | 224 | **168** |
| Step 3 · about you | 174 | **168** |
| All done | 398 | **168** |
| spread | **224px** | **0px** |

The shipped `/app/login` measures 168 too, and 162 at 1366×768; neither scrolls.

**The honest trade:** anchoring pushes tall content down, so the profile step now scrolls below
706px of viewport height where it used to survive to 646px (the plan step is unchanged at 666px).
At the owner's 826 there is 120px of headroom and at 1366×768 there is 62px. The remedy is not a
higher anchor — it is the next item, budgeting every step to one height. The owner's 2026-10-27
"all of them in the center" is superseded and the reason is recorded in the rule itself.

### P1 done: the state combobox has a name

`components/app/state-picker.tsx` takes a `label` prop and puts it on `aria-label`; the About-you
form passes "Primary State". Its visible label is a `FieldLabel`, which is not tied to the input,
so a screen reader announced the control with no name. The field beside it ("Agency name") already
carried an `aria-label`, so this follows that convention rather than inventing a second one.
Verified: **0 unlabelled controls** on sign-in, step 1, and both About-you variants.

### P1 withdrawn: "all done is nearly empty"

**That finding was wrong, and the mistake is worth recording.** What `/design/auth` draws for "all
done" is a stub — one heading and one line, written to exercise the layout. The real screen is
`app/app/welcome/page.tsx`: the activation moment, with what the first statement says the agency is
owed, the carrier-file upload beside a labelled sample, and the forwarding address. It needs a
session and a read statement to render, so it was never inspected, and it should have been reported
as not inspected instead of scored through its stand-in.

**The lesson for the next audit:** two of the six screens on that page are stand-ins. Anything the
showcase draws is checked against the route it mirrors before it is judged.

### Next, in order

- [ ] One column measure (472 on the form steps, 611 on plan and profile) — P2, the other half of
      "the same layout on every step"
- [ ] Budget every step to one height; the profile step scrolls below 706px where the rest survive
      past 540px — P2
- [ ] Confirm-email hierarchy: the mailbox shortcuts outweigh the primary path, and the two
      recovery actions sit at opposite ends — P2
- [ ] Inspect the real welcome screen once there is a session with a read statement

### P2 partly done: evening the step heights

Measured first, which changed the answer. The step bodies at 1536×826 were 128 / 287 / 336 / 439 /
475 / **576**, and the profile step was the one that scrolled first (below 706px of viewport).

**The auth screens are already running a compact rhythm at the owner's size.** `@media (max-height:
900px)` in globals.css (owner, 2026-10-27, "step 4 did not fit") already pulls the heading margin to
14px, the field gap to 12px, the plan cards and dividers in. There is very little padding left to
take out, which is why the win here is small and honest rather than large:

| | before | after |
|---|---|---|
| About you, body | 576 | **562** |
| About you, scrolls below | 706 | **686** |
| Plan, scrolls below | 666 | 666 |

The gain came from the profile form's own field grid (`gap-5` → `gap-x-5 gap-y-4`), not from the
shared rhythm. **Two edits I made to the shared rhythm were no-ops and were reverted**:
`AuthHeading`'s `mb-6` and `authControl`'s `mt-1.5` are both overridden by that media block, so
changing the Tailwind class changed nothing — the computed margin stayed at 14px. Worth knowing
before anyone tries to tune auth spacing from the components again: **the rhythm lives in
globals.css, not in the classes.**

The two heavy steps are now within 20px of each other (686 and 666) and the rest survive past 540,
so no single step is the outlier any more. At 1536×826 the worst step has 140px of headroom; at
1366×768, 82px.

**To go further, one of these, and both are decisions rather than cleanups:**
- Controls at 40px with a mouse, keeping 44px on touch. 44px is UI-CONSISTENCY §13, owner
  2026-10-27, justified as "the screens people use on a phone" — the pointer query would keep that
  reason intact. Worth roughly 20-25px on the profile step and a little on every screen.
- Restructure the profile step's fields so it is not the tallest screen by 87px.

---

## Round: the door's clean-up, and one named control height (12 Nov)

The owner, on the shipped `/app/login`: the top-right "Create an account" had to go, the
"Partner portal" button "looks bad there", the pause-motion button "we dont need that", and the
line to its left "looks really bad".

**What went, and why each was right to go:**
- **The top-right way in.** It was the same link that already sits under the form, where a door's
  other ways in belong. Two of them meant the first thing on the page competed with the form.
  `.auth-photo-top` is gone from `auth-layout.tsx` and the stylesheet.
- **The pause control.** `prefers-reduced-motion: reduce` already holds the field on one frame
  (`wave-field.tsx` line 266) — that is the accommodation, and it is system-wide. The button only
  added a second, visible one, parked over the artwork. The panel no longer keeps `paused` state.
- **The foot line.** "Leads, calls, applications and commissions, connected in one workspace" said
  the claim again in smaller type, across the busiest part of the field. The panel is now two
  voices: the line that says what this is, and the claim.
- **The shade's foot** came down from .5 to .3 with it: it was carrying that line's contrast, and
  with no words down there it was a dark band over the brightest part of the field.
- **The partner door** got its question back ("Partner or affiliate? Partner portal") on its own
  line under "New to Insurvas?". Bare beside "Create an account" it read as a second thing to do
  here, which it is not — it is a different audience's door.

### The control height, approved and shipped

One class, `auth-h`, defined once in globals.css: **44px, and 40px under `@media (pointer: fine)`**.
44 stays the standard (§13: the screens people use on a phone); a mouse has no thumb to allow for.
Unlayered, so it outranks any size utility the base `Button` carries.

The stricter ratchet found more than the eight files I expected: `authShell.test.mjs` now fails any
auth screen that spells a height itself, which turned up **21 controls across 9 further files**
(verify-email, welcome, set-password, suspended, verification-failed and the three partner forms,
plus `password-field`). All now take the named height. `min-h-11` is untouched everywhere — those
are touch floors on checkbox rows and the volume chips, not control heights.

| at 1536×826 | before | after |
|---|---|---|
| heading y, all six screens | 168 | **150** (the top link's row went with it) |
| confirm email, scrolls below | 566 | **526** |
| About you, scrolls below | 686 | **666** |
| About you, body | 562 | **552** |
| plan, scrolls below | 666 | 666 (plan cards, not controls) |

Four of the six screens now survive below 480px of viewport. 114 design tests, typecheck and lint
on the touched files all pass.

**Still open (P2, from the audit):** one column measure (472 on the form steps vs 611 on
plan/profile); the confirm-email hierarchy (the mailbox shortcuts outweigh the primary path, and
the two recovery actions sit at opposite ends). The real welcome screen still needs a session to
inspect — the showcase entry is a stub.

---

## Round: the licence map ships (13 Nov)

The owner asked for a component in place of the claim in the middle of the panel — "find a good
component, search websites that you can find components, a really good one with animations that
suits us". Three were built into the real door and shown: an **activity ledger** (Magic UI's
Animated List, restyled as the workspace's own rows), the **licence map**, and a **flow diagram**
(Animated Beam). He picked the map, then took it through four rounds.

**What each round changed, and why:**

1. **"better designed, more detailed, more realistic."** The first map was a hand-drawn 50-point
   outline with a uniform dot grid. Replaced with real census boundaries projected in Albers conic
   equal area (29.5°/45.5° parallels), Alaska at 36% and Hawaii enlarged as insets, 4,762 dots on a
   hex lattice. Delaware, Rhode Island and DC are sampled finer or they vanish — a licence map that
   quietly drops a state is worse than no map.
2. **"glassy parts for each state... the logo in the middle taking over."** Dots became polygons:
   2,753 outline points, each state a pane with a gradient down its height, a lit edge and one
   sheen across the top-left. The sheen is what makes it read as glass rather than paint.
3. **"the lines feel weird."** Six curves all bowing the same way round read as a pinwheel. They
   went straight, then — "like connections from satellite" — became arcs that lift perpendicular to
   their own run and always on the upper side of it, over a dashed ground track. **The ground track
   is what sells the height**; without it an arc is just a curve.
4. **"the logo in that circle, I don't know why."** Measured rather than guessed: the isotype's ink
   fills **97% of its box across and only 81% down**. It is a landscape mark, so a round badge could
   only clip its width or strand it vertically. The disc went; it has its own shadow over a soft
   ground shaped like the mark.

**Two things that were wrong and measurable, both found by looking at a 2× crop rather than the
page:**
- The link gradient ran the full length of the finished line, so while the head was still near the
  mark everything drawn sat in the transparent end of it: six white dots and no lines. It runs
  along the drawn part now.
- A link that stopped dead on a state's border left a stub for a state that starts close by
  (Texas). It carries on in until it is a length worth drawing and stops the moment the ray would
  leave again; far states are already past that length.

### What shipped

| | |
|---|---|
| `lib/geo/us-states.json` | 36KB, 51 states, precomputed — no mapping library on the page |
| `components/shared/licence-map.tsx` | the canvas: base, glass, the fill front, the links |
| `components/shared/wave-field.tsx` | a new `"map"` look: the same shader driven deep |
| `components/portal/auth-photo-panel.tsx` | the map where the claim was; summaries untouched |
| `app/globals.css` | `.licence-map` block, `--map-*` tokens, an even shade behind the map |

**No invented data anywhere.** Every state is lit, because an agent holds as many licences as they
write in — which is also what killed the last sample figure on this panel. The readout is 51 ·
states + DC · license your agents wherever they write.

Verified on the shipped `/app/login` and on the sign-up steps at 1536×826: no page scroll, the
plan step keeps its summary panel, **the form column is byte-for-byte unchanged** (owner: "change
only that left part"). 114 design tests, typecheck and lint pass.

**Still open (P2, from the audit):** one column measure (472 on the form steps vs 611 on
plan/profile); the confirm-email hierarchy. The real welcome screen still needs a session.

### After it shipped: the links went straight (13 Nov)

Three shapes were tried on the same day, in this order, and the owner rejected the first two:
**curves** bowing one way round ("they feel weird"), then **arcs** lifting off the map over a
dashed ground track ("like connections from satellite" — his own ask, which he then disliked on
the panel), then the arcs **flattened to a tenth of the run**, which still read as curved. They are
straight runs now.

Worth keeping: a straight run and its ground track are the same line, so the dashed track went with
the bow — leaving it would have drawn a dashed line underneath a solid one. What carries a link now
is the signal travelling it with a bright head, the ring where it touches down, and the state
answering. That was always the part doing the work; the curve was decoration on top of it.

### And the readout went too (13 Nov)

"Remove this text as well, it looks bad." The line under the map — **51 · states + DC · license
your agents wherever they write** — is gone, the figure with it: struck through on his screenshot
was the caption, but a bare 51 has no referent once the words beside it leave, and it would have
read as something left behind rather than something kept.

That is every word off this panel now: the kicker, the claim, the foot line, the pause button, the
top-right way in, and finally the readout. What is left is the logo and the map. Worth noting how
the whole sequence went — each piece of text looked fine until the one next to it was removed, and
the panel reads better after every one.
