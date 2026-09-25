# Notifications and sound — a plan

**Drafted 2026-09-23.** Nothing below is built yet. It needs decisions in §7 before it should be.

## 1. What exists today

| | |
|---|---|
| Toasts | `sonner`, mounted in `app/layout.tsx` as `<Toaster position="top-right" />` — already the corner you asked for |
| Call sites | **407**: 165 `toast.success`, 238 `toast.error`, 4 `toast.warning`, 0 info |
| Sound | **none, anywhere** |
| Server-pushed alerts | `AGENT_ALERT_EVENTS`: `new_lead`, `handoff_offered`, `unclaimed_escalation`, `callback_due`, `mentioned`, `partner_message`, with per-event toggles in the alert centre |
| Audit vocabulary | **194 distinct actions** — the canonical list of things that happen |

So the position is right and the plumbing is there. What is missing is **meaning**: today a lead
importing and a licence expiring are the same green box, and a validation typo and a database
outage are the same red one.

## 2. The idea this plan is built on

**A sound that fires for everything is a sound nobody hears.** If saving a form chimes, people mute
the tab within a day, and then they also miss the dropped transfer. The scarce resource is not
screen space, it is the agent's attention — and sound spends it whether they agree or not.

So: **six treatments, not 194**. Most events get a toast and no sound at all.

## 3. The treatments

| Treatment | Sound | When | Toast |
|---|---|---|---|
| **`win`** | the ching — two rising notes, ~400ms | Money or a conversion. Application submitted, policy issued, deal closed, commission posted, vendor credit accepted. | Success, 6s, holds longer than the rest |
| **`arrive`** | soft single ping, ~150ms | Work has landed and someone must pick it up. New transfer, lead assigned to you, callback now due, partner message. | Info, 6s, clickable through to the thing |
| **`done`** | **silent** | Routine success. Saved, updated, imported, exported, rule created. The overwhelming majority. | Success, 3s |
| **`warn`** | low double-tick, ~250ms | Worked, but you should know. Sticky lead stayed put, import partly rejected, callback booked outside preferred hours, licence expiring soon. | Warning, 8s |
| **`block`** | flat low tone, ~300ms | Refused, and you must do something. Outside calling window, DNC suppressed, no disclosure published, not licensed in that state, plan limit reached. | Error, 10s, with the remedy in the text |
| **`fail`** | none — deliberately | Something broke and it is not the agent's fault. 500s, RPC unavailable, network. | Error, 10s, with a retry affordance |

`fail` is silent on purpose. A noise for a server fault trains people to feel guilty for
infrastructure, and it fires in bursts when something is properly wrong.

## 4. The rule that matters most: the dialer goes quiet

**While a call attempt is open, sound is suppressed except `block`.**

An agent is on the phone with a customer. A ching for a colleague's sale, audible down the line, is
worse than no notification at all. `block` survives because it is the one class that means *stop
talking to this person*.

The attempt is already tracked in `dialer-workspace.tsx`, so the gate is a single condition, not a
guess.

Two related rules:

- **Nothing plays before the first interaction.** Browsers block autoplay; the first sound after a
  page load is swallowed and the second is a surprise. Prime the audio context on the first click.
- **Never sound-only.** Every sound accompanies a toast. Sound is the second channel, never the
  first, and a muted agent loses nothing but speed.

## 5. The mapping, by area

### Leads and import

| Event | Treatment |
|---|---|
| Import committed, nothing rejected | `done` |
| Import committed **with rejections** — "212 imported, 18 dropped at scrub" | `warn` |
| Import failed before writing anything | `fail` |
| Import committed but the campaign could not be marked scrubbed (`servable: false`) | `warn` — these leads will not be served |
| Lead assigned **to you** | `arrive` |
| Lead assigned by you to someone else | `done` |
| Assignment refused — not licensed in that state | `block` |
| Sticky lead stayed with its current owner | `warn` |
| Duplicate detected on import | `warn` |

### Dialer and dispositions

| Event | Treatment |
|---|---|
| Lead served | `arrive` — but suppressed if an attempt is already open |
| Outside the calling window | `block` |
| Number is on a DNC list | `block` |
| No disclosure published for that state and product | `block` |
| Dial recorded, disclosure confirmed | `done` |
| Disposition recorded — retry scheduled | `done` |
| Disposition recorded — **application submitted** | `win` |
| Callback booked | `done`, and `arrive` for the assignee if it is not you |
| Callback time already passed / unreal timezone | `block` |
| Lead exhausted, moved to nurture | `warn` |
| Number suppressed permanently | `warn` — irreversible, and it should feel like it |

### Compliance

| Event | Treatment |
|---|---|
| Disclosure published for N states | `done` |
| Disclosure withdrawn while live — dialing now blocked there | `warn` |
| DNC vendor unreachable, dialing blocked platform-wide | `block` |
| Consent certificate claimed | `done` |
| Consent certificate expired before claiming | `warn` |
| Posting key minted | `done`, with the key shown once |
| Posting key rotated | `warn` — the old one stops working |

### Appointments and calendar

| Event | Treatment |
|---|---|
| Appointment booked into your calendar by a setter | `arrive` |
| Appointment starting in 15 minutes | `arrive` |
| Double-booking refused by the exclusion constraint | `block` |
| Daily cap reached | `block` |
| Availability saved | `done` |

### Money and the book

| Event | Treatment |
|---|---|
| Policy issued | `win` |
| Commission posted | `win` |
| Vendor credit accepted | `win` |
| Chargeback or lapse detected | `warn` |
| Statement discrepancy found | `warn` |
| Invoice payment failed | `block` |

### Partners

| Event | Treatment |
|---|---|
| Partner submitted a lead | `arrive` |
| Partner message | `arrive` |
| Partner lead rejected at review | `done` for the reviewer |
| Partner paused | `warn` |

### Admin and platform

| Event | Treatment |
|---|---|
| Kill switch flipped off | `block` for every affected tenant |
| Plan limit reached | `block` |
| Trial ending in 3 days | `warn` |
| Maintenance scheduled | `warn` |
| Tenant suspended | `block` |

### System

| Event | Treatment |
|---|---|
| Any 5xx, RPC unavailable, network failure | `fail` |
| Session expired | `block` — with a sign-in link, not a bare "unauthorised" |

## 6. How it gets built

**A semantic layer, not 407 edits.** `lib/notify/` exports one function per treatment:

```ts
notify.win("Policy issued", { detail: "…", href: "/app/policies/123" });
notify.block("Outside the calling window", { detail: "It is 7:14am for this customer." });
```

Each wraps `toast.*`, picks the duration, and asks the sound layer to play. Existing call sites
migrate area by area; until one is migrated it keeps working exactly as it does now, because
`notify.done` is `toast.success` with a duration.

**The sound layer** (`lib/notify/sound.ts`) owns: the Web Audio context, priming on first
interaction, the mute preference, the dialer suppression gate, and a rate limiter — no more than one
sound every 2 seconds, so a bulk action cannot machine-gun.

**Sound files**: six short files, generated rather than sourced, so there is no licensing question
and they can be tuned. ~10KB total, preloaded.

**Preferences** sit with the existing alert-centre toggles, since that is already where an agent
goes to control interruptions: a master mute, plus per-treatment mute for `win` and `arrive`. Stored
per user, not per browser, so it follows them between machines.

## 7. What I need decided

1. **Is a chime during a live call acceptable at all?** §4 assumes no, and that is the single
   biggest design call here. If you want sound during calls, the whole shape changes.
2. **Should `win` fire for the whole team or only the person who did it?** A floor-wide ching for
   every sale is a real sales-floor pattern and a real distraction. I have assumed **personal
   only**, with team-wide as a later opt-in.
3. **Default on or off?** I would ship **on for `win` and `arrive`, off for the rest**, with the
   toggle discoverable on first fire.
4. **How far to take the migration?** All 407 call sites is a large mechanical change. I would do
   the dialer, import, assignments and compliance first — the screens where the distinction earns
   its keep — and leave the rest on `done`/`fail` defaults.

## 8. Suggested order

1. `lib/notify/` with the six treatments, all silent. Migrate the dialer and import. **No sound
   ships yet** — this alone fixes "everything is the same green box".
2. Sound layer, priming, mute preference, dialer suppression. Ship with `win` and `arrive` only.
3. The remaining four sounds, plus the alert-centre preference UI.
4. Migrate the remaining call sites by area.

Each step is useful alone and none of them blocks the next.

---

## 9. Step 1 — built and verified, 2026-09-23

Decisions taken (§7 is now answered): **no sound during a live call**, **personal only**,
**`win` and `arrive` on by default**, everything else opt-in.

Shipped:

- `lib/notify/index.ts` — the six treatments, each with its own duration and sonner kind.
- `lib/notify/sound.ts` — the sound seam, **deliberately silent**. `playFor` is a no-op, but every
  notification already routes through it and `shouldSound` is already consulted, so the rules are
  exercised from day one. Step 2 changes this one function and nothing else.
- `components/app/dialer-workspace.tsx` — 21 toasts migrated, 0 raw `toast.` left. The
  call-suppression gate is wired here, driven by whether an attempt is open.
- `components/app/lead-import-workspace.tsx` — 6 toasts migrated, 0 raw `toast.` left.
- `lib/notify/treatments.test.mjs` — 8 assertions, 3 verified by mutation.

Verified in the browser, not only in tests: `/app/dialer` renders, and submitting a one-character
search produced a live toast — top-right, `data-type="error"` — through `notify.block`.

Why the gate ships before the sound: if it were wired up alongside the audio, the first time anyone
found out it was wrong would be with a customer on the line.

Remaining, for steps 2–4: **384 raw `toast` call sites across 88 files** — 220 in `components/app`,
129 in `components/admin`, 22 in `components/partner`, 8 in `lib`. Migrating them is step 4 and is
mechanical only in the typing; each one is a judgement about what the event *means*, which is the
entire point. A blanket `toast.error` → `notify.fail` would reproduce today's problem in new words.

---

## 10. Step 2 — built and verified, 2026-09-23

The layer now makes a noise, and is the only thing in the product that decides whether it should.

### The conflict this had to resolve first

There was already a sound system. `PortalFeedbackBridge` watches the DOM for toasts and plays a
tone based on the sonner `data-type`. It cannot honour the vocabulary, because the treatments do
not survive the trip into the DOM:

| treatment | `data-type` | what the bridge would play | the rule |
|---|---|---|---|
| `win` | success | success tone | correct, by accident |
| `done` | success | **success tone** | must be silent |
| `fail` | error | **failure tone** | must be silent |
| `arrive` | info | **nothing** (`ignoreDefaultToasts`) | should sound |
| `block` | error | failure tone | correct, but not during calls — it knows nothing about calls |

`win` and `done` are indistinguishable to it. So two systems cannot both decide, and an observer
can never be the one that does.

**Resolution:** toasts raised through `notify` carry `NOTIFY_OWNED_CLASS` and the bridge skips
them. The bridge keeps serving the partner plane and the ~384 call sites not yet migrated, and its
responsibility shrinks to nothing as step 4 proceeds. No regression anywhere, and a boundary that
is visible in the markup.

### What shipped

- **The policy is a pure function.** `decideSound(treatment, ctx)` holds every rule and returns
  *why*, not just yes/no. Pulled out of the player because the player needs an `AudioContext`, and
  rules that need a browser to verify are rules that stop being verified.
- **Gate order is load-bearing and asserted.** The rate limiter runs *last*, so a sound nobody was
  allowed to hear cannot consume the window and silence a compliance `block` 200ms later.
- **Four voices**, generated, no files: `win` is the "ching-ching" — two bell strikes with a 2.76
  partial, the only bright sound in the product; `arrive` soft and rising; `warn` falling a
  semitone; `block` low and firm, the one that survives a live call.
- **One AudioContext per tab.** The old bridge built and closed one per sound, which on Safari
  leaks hardware contexts until playback stops entirely.
- **Priming** on the first gesture (`NotifySoundPrimer`, `once: true`, listeners removed).
- **The existing per-user do-not-disturb, mute and volume now govern the whole product**, not just
  the alert centre — otherwise a muted agent still hears the dialer.

### Verified in the browser, with Web Audio instrumented

With the legacy bridge **deliberately switched fully on**, so it would fire if the boundary leaked:

1. Defaults: a `block` toast produced **zero tones**. Ours refused (opt-in); the bridge stood aside
   despite being enabled and seeing a `data-type="error"`. Toast carried `notify-owned`.
2. Opted into `block`: exactly `[261.63, 196]` — our tone — and **none** of the bridge's
   `[293.66, 220]`.
3. Five events in 600ms produced **one** sound; the next after the window reopened played normally.

16 new guards, 24 total with step 1, all passing. Four mutations verified: reordering the rate
limiter, exempting `block` from mute, removing the bridge skip, and dulling `win` each fail.

### Deliberately not done

`warn` and `block` are implemented but **off by default**, per the decision recorded in §7. `block`
being opt-in means the call-gate exception is currently moot in a default install — worth revisiting
when telephony is live, but it is a product decision, not a defect, so it stays as decided.

Step 3 is the preference UI that makes those toggles reachable without the console.

---

## 11. Step 3 — built and verified, 2026-09-23

The four sounds were already implemented in step 2, so step 3 is what makes them choosable: a
preference panel, and storage that follows a person between machines.

### What shipped

- **`lib/notify/treatments.ts`** — the vocabulary, with no React, no sonner, no Web Audio and no
  `server-only`. The treatment list is now a database constraint and a server-side default as well
  as a browser concern, and a server module importing it from `./sound` (which is `"use client"`)
  would pass `tsc` and fail only at `next build`. That trap has been sprung in this codebase before.
- **`NotificationSoundSettings`** — one row per audible treatment, each with a plain-English
  explanation and a **preview button**. Nobody can choose between four sounds they have never heard
  from a list of adjectives, and a sound you cannot audition is one you switch off.
- **Migration `20260923180000`** — one additive `sound_treatments jsonb` column, with check
  constraints limiting it to the four audible treatments and to booleans. `done` and `fail` are
  refused by the database, by the endpoint, and by the UI, in three independent places.
- **The duplicate control is gone.** `PortalSoundControls` carried its own mute, do-not-disturb and
  volume in localStorage, rendered *directly beneath* the server-stored mute, do-not-disturb and
  volume in the same panel. Two sets of switches with the same names governing different things is
  worse than either alone. The agent plane now has one set; the partner plane, still served by the
  legacy bridge, keeps its own.

### "No opinion" is not "off"

A missing key means *use the default*, and is stored as an absent key rather than `false`. If an
untouched treatment wrote `false`, changing a default later would reach nobody who had ever opened
the panel — and opening a panel is not consent to freeze every default inside it.

### The pending-migration path, which is the current one

The column is written but **not yet applied**, so this is not a hypothetical branch — it is what
runs today, and it was verified as such:

- `GET /api/app/notifications` → **200**. A missing column cannot take the alert centre down.
- `PATCH` → **200**, and the other settings still save. Refusing to store someone's do-not-disturb
  because a column is pending would be the wrong trade.
- `PATCH` with `{ done: true }` → **400**. A silent treatment is refused at the edge.
- The response carries `soundTreatmentsPersisted: false`, and the panel says so in plain words.

One real bug was found and fixed here: the server answers `{}` when it has nowhere to store the
choices, and the localStorage mirror would have read that as "nobody chose anything" and wiped the
local setting **on every poll, every 2.5 seconds**. `setServerSoundSettings` now takes
`treatmentsAreAuthoritative`, and the panel reads from the same store the sound layer reads from, so
what it shows and what plays can never disagree.

Verified in the browser: toggling a treatment took effect immediately and **survived two polls**,
and the `win` preview played `1318.51 → 3639.09`, `1760 → 4857.6` — the fundamental and its 2.76
bell partial.

10 new guards, 35 across the three suites, all passing. Typecheck and ESLint clean.

### Found in passing, not fixed

`components/app/agent-alert-center.tsx` is **mounted nowhere**. It is a near-duplicate of
`useAgentAlertFeed` — its own poll, its own toast logic, its own settings state — superseded by the
top bar when the hook was extracted, and left behind. It was updated here only so it still compiles.
Deleting it is a separate change.

### Still open

The migration needs applying before these choices follow anyone between machines. Until then the
panel tells the truth about that rather than pretending to save.

---

## 12. Step 4 — complete, 2026-09-23

All 384 remaining call sites migrated across 87 files. With step 1's 27, every toast in the product
now goes through the vocabulary, and `sonner` is imported in exactly one file.

### What the split actually was

| treatment | sites | |
|---|---|---|
| `block` | 161 | the server refused, or the input is wrong — **the reader has to do something** |
| `done` | 148 | routine success |
| `fail` | 57 | infrastructure; not the reader's doing |
| `arrive` | 10 | work has landed on someone |
| `warn` | 5 | it worked, with a caveat |
| `win` | 3 | money |

The number that matters is the first two rows of errors: **219 identical red boxes became 161
blocks and 57 fails.** Three quarters of what the product called "an error" was something the person
could fix, shown in the same colour as a database outage.

### Classified by structure, not by wording

A blanket rename would have reproduced the problem in new words. The signal that worked was
structural:

- nearest preceding `catch` → the call threw → `fail`
- nearest preceding `!response.ok` → the server answered and refused → `block`

Wording was used only where structure said nothing (37 sites), and only to separate validation
("Enter a valid…", "Choose a customer") from load failures.

Two passes were needed. The first was line-based and reported three
`toast.success("Could not archive carrier")` sites — alarming, and wrong: this codebase writes whole
functions on one line, so every call on a line was attributed the line's first string literal. The
second pass works on character offsets.

### The seven judgement calls

Recorded as explicit overrides rather than inferred, because each is a claim about meaning:

- **The three alert feeds** (`toast(alert.title)`) → `arrive`. A new lead, a handoff offered, a
  callback due — the literal definition of the treatment, and invisible to the classifier because
  the message is a variable. The biggest miss of the automatic pass.
- **Transfer claimed** (×2) → `arrive`. Work that just became yours.
- **Partner lead submitted** → `win`. The partner plane's conversion; it is what they are paid for.
- **"N could not be assigned"** → `warn`. It fires straight after "M of N assigned". Saying that in
  red tells someone their bulk action died when most of it worked.

### Two defects this surfaced, both fixed

1. **The alert feed would have played two sounds per alert.** It called `playAlertSound` through the
   legacy player *and* now raised `notify.arrive`, which plays through the new one — two systems,
   two mute rules, one event. The legacy call is gone; `notify`'s rate limiter does the coalescing
   `coalesceAlertBatch` was doing by hand.
2. **The legacy bridge became a lying control.** Once every toast is notify-owned,
   `PortalFeedbackBridge` can never match anything — leaving a `MutationObserver` on `document.body`
   with `subtree: true` paying for every DOM change in the app to reach a `continue`, and
   `PortalSoundControls` gating it as a switch wired to nothing. Both are now unmounted, and the
   partner plane has the real sound panel (local-only, and it says so).

### Verified

`npm run build` compiles and generates 244 pages — the only check that catches the client/server
boundary, which `tsc` does not. ESLint clean across `components app lib`. 35 guards pass, including
two new ones: sonner is reachable only through the vocabulary, and the DOM-observing bridge is
mounted nowhere. In the browser, a migrated call site (`notify.done("Alert settings saved")`) renders
top-right carrying `notify-owned`.

### The plan is complete

Steps 1–4 are done. The remaining work is not part of this plan: apply migration `20260923180000`
so per-treatment choices follow people between machines.
