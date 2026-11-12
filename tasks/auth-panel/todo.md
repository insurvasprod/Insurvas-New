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
