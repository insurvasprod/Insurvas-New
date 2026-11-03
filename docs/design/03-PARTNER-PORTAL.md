# 03 · Partner portal (`/partner/*`)

10 pages. The portal a lead-supplying partner signs into.

Read [`00-FOUNDATION.md`](00-FOUNDATION.md) first.

## What makes this surface different

The reader is **not your customer** — they work for one of your customer's suppliers. Three
consequences that shape every page:

**1. Data boundary is the product.** A partner sees only their own organisation's leads and
messages. Never another partner's anything, never agent-only records. The layout should *show* this
boundary, not merely respect it: the shell states "Only your organization's records are visible",
Settings has a dedicated "Data boundary" card, and the pipeline says "Only leads submitted by
Harbor Group are shown". Keep all three. They are reassurance and they are also the honest
description of a restricted view.

**2. Most configuration is not theirs.** Products, form versions and submission caps are set by the
agent. The portal's job is to say so clearly and route the request — "Agent-managed controls",
"Message your agent" — rather than showing a disabled form. A disabled control implies *you could
have this*; a message link implies *ask the person who can*.

**3. Partner status gates writing.** `draft`, `paused` and `offboarded` restrict submission. The
shell already shows the status chip and a "Submissions restricted" warning. Every write control on
every page must respect it and say why.

## Roles

`partner_admin` gets Team review and Team access; `partner_user` does not. `section-page.tsx`
redirects a `partner_user` away from `/partner/team` and `/partner/team-review`. The sidebar hides
both. Do not render them disabled — for this reader they do not exist.

## Identity

Orange portal, same as the agent app. The shell root sets `portal-agent portal-partner`; the three
auth pages set only `portal-partner` and therefore miss dark mode — **defect D-07**, fixed in the
CSS, not the pages.

---

## 1. Partner sign-in — `/partner/login`

**Files:** `app/partner/login/page.tsx` (7), `components/partner/partner-login-form.tsx` (70)
**Mockup:** `43-partner-login.png` — authoritative. Generated set: the split shell with "Submit,
track, and coordinate—without crossing data boundaries."
**Gate:** none
**Data:** `POST /api/partner/auth/login`

**Purpose:** get a partner user into their organisation's workspace.

### Must do
- Email + password, visibility toggle, "Keep me signed in".
- One error message above submit. Never reveal whether the address exists.
- **"Received an invitation? Open the secure invite link from your email."** Keep it — a partner
  whose account does not exist yet will otherwise try to sign in and fail repeatedly.
- **"Agent sign in →"** cross-link. Agents and partners share a domain and land on the wrong form
  constantly; this link is worth more than it looks.
- Legal and support links.

### Controls
| Control | Destination / effect |
|---|---|
| Sign in | `POST /api/partner/auth/login` → `/partner` |
| Forgot password | `mailto:support@insurvas.com?subject=Partner%20password%20help` |
| Received an invitation? | `/partner/accept-invite` |
| Agent sign in → | `/app/login` |
| Privacy / Terms / Support | `/legal/*`, `mailto:` |

### Layout
Split shell, mirroring `/app/login`: form left on canvas, story panel right on near-black. The
story is four benefit rows — secure submission, live pipeline visibility, direct agent
communication, access limited to your organisation — plus a bordered lock block naming the
partner's own isolation. That final block is the differentiator from the agent story panel; keep it.

Story panel drops entirely below 1024px.

### Must not
- Say "Invalid password".
- Drop the agent cross-link.
- Let the dark panel out-compete the single orange submit.
- Forget `portal-agent` on the root (D-07).

---

## 2. Set partner password — `/partner/set-password`

**Files:** `app/partner/set-password/page.tsx` (6), `components/partner/partner-set-password-form.tsx` (122)
**Mockup:** `44-partner-set-password.png` — authoritative
**Gate:** token in the query string
**Data:** `GET <endpoint>?token=…`, then `POST`. Passes `endpoint="/api/partner/auth/set-password"`,
`loginPath="/partner/login"`.

**Purpose:** an invited partner user sets their first password.

### Must do
Everything in [`01-PUBLIC-AND-AUTH.md` § 8](01-PUBLIC-AND-AUTH.md), plus partner specifics:
- Context strip: Organization, Role, Invite expires.
- Five live requirements (≥ 12 chars, uppercase, lowercase, number, symbol) with a strength meter.
  **The list must match what the endpoint enforces.**
- Three states: form, "Password set", "Link no longer valid".
- Single-use notice, and what happens next: "After setup, you'll enter Harbor Group's isolated
  partner workspace." That sentence sets the expectation of a restricted view before they see one.
- Return to partner sign in.

### Layout
Centred card, `max-w-xl`, `SECURE ACCOUNT SETUP` eyebrow. Context as a three-row key–value block on
`--portal-group`. Requirements panel with the strength meter as four segments, right-aligned to the
heading.

### Must not
- Show requirements only after a failed submit, or colour an unmet rule red before typing.
- Send the user to the agent login.
- Forget `portal-agent` on the root (D-07).

---

## 3. Accept partner invite — `/partner/accept-invite`

**Files:** `app/partner/accept-invite/page.tsx` (11), `components/partner/accept-partner-invite-form.tsx` (58)
**Mockup:** `42-partner-accept-invite.png` — authoritative
**Gate:** token in the query string
**Data:** `GET /api/partner/auth/accept-invite?token=…`, `POST` same

**Purpose:** an **existing** Insurvas user accepts access to an additional partner organisation.

Distinct from § 2: there is no new password. The reader already has an account and is confirming
with their **current** password that they want this extra membership.

### Must do
- Show what is being accepted **before** asking for the password: Organization, Role, Invited by,
  Invite expires. The reader may hold several memberships; they must see which one this is.
- Email field locked (with a lock glyph) — the invitation is bound to it.
- Current password + "Keep me signed in on this device".
- **"This one-time invitation grants access only to Harbor Group leads and messages. It cannot be
  forwarded."** This is the scope statement; keep it exactly this explicit.
- "Sign in with a different account" for the wrong-account case.
- Three states: form, "Access accepted", "Link no longer valid".

### Controls
| Control | Destination / effect |
|---|---|
| Accept partner access | `POST …/accept-invite` → `/partner` |
| Sign in with a different account | `/partner/login` |
| Go to partner sign in (accepted) | `/partner/login` |
| Partner Portal / Help | `/partner/login`, `mailto:` |

### Layout
Centred card, `max-w-xl`, `PARTNER INVITATION` eyebrow. Context block on `--portal-group` above
the fields. Scope statement with a shield glyph below the primary, separated by a rule.

### Must not
- Ask for a new password — this user has one.
- Let the email be edited.
- Accept without an explicit action.
- Forget `portal-agent` on the root (D-07).

---

## 4. Partner overview — `/partner`

**Files:** `app/partner/(portal)/page.tsx` (13), `components/partner/partner-portal-workspace.tsx` (1,489), `components/partner/partner-portal-overview.tsx` (96)
**Mockup:** `36-partner-dashboard.png` — authoritative
**Gate:** partner session
**Data:** `GET /api/partner/leads/pipeline?limit=3&offset=0`, `GET /api/partner/users`

**Purpose:** what this partner submitted, where it got to, and the three things they can do next.

### Must do
- Four counters: submitted today, in progress, converted, still open.
- Recent submissions (3) with customer, product, stage, submitted-by, time, outcome — and View all.
- Team access summary: active users, pending invitations, Manage team. **`partner_admin` only** —
  for a `partner_user` it renders as a disabled card with the reason ("Team access is managed by
  your partner admin"), which is the correct treatment here because the *concept* is theirs even
  though the action is not.
- Three quick-action cards: Submit leads, Track pipeline, Manage team.
- Help strip with Message agent.
- **"Showing data for <partner> only. You can only view and manage leads from your organization."**
  Keep it.
- A `Live · Updated just now` freshness indicator that is honest about when it last loaded.

### Controls
| Control | Destination |
|---|---|
| Submit a new lead / Submit a lead | `/partner/submit-lead` |
| View all | `/partner/pipeline` |
| Manage team | `/partner/team` (admin only) |
| Message agent | `/partner/messages` |
| Quick-action cards | their respective routes |

### Layout
`max-w-7xl`. `PARTNER WORKSPACE` eyebrow, `h1` "Partner operations", one line, then the freshness
chip and the single orange **Submit a new lead**. Four counter cards with the label above the value
and a muted glyph right. Two columns: recent submissions table left, team access right. Three
quick-action cards below at `lg:grid-cols-3`, each a link-arrow row. Help strip last.

### Must not
- Show another partner's data, or a platform-wide total.
- Make more than one control orange.
- Present the counters without saying what period they cover.

---

## 5. Submit a lead — `/partner/submit-lead`

**Files:** `app/partner/(portal)/submit-lead/page.tsx` (5), `partner-portal-workspace.tsx`
**Mockup:** `40-partner-submit-lead.png` — authoritative
**Gate:** partner session; writing restricted unless status is `active`
**Data:** `GET /api/partner/products`, `GET /api/partner/forms/:productCode`,
`GET/PUT /api/partner/forms/:productCode/draft`, `POST /api/partner/forms/:productCode/screen`,
`POST /api/partner/forms/:productCode` (submit)

**Purpose:** complete the **agent-approved** form for one product and submit a lead.

The most important page in this portal. It is where compliance is either captured or lost.

### Must do
- Product selector showing the **form version** (`Form v7`). Version is part of the record.
- **"Switching products clears entered answers."** Say it before the switch, not after — the form
  differs per product, so the warning must precede the loss.
- Sectioned progress: Contact → Customer → Coverage → Consent, with completed sections checked.
- Render only fields the agent enabled for this partner, in the agent's order, with the agent's
  required flags. The form is governed elsewhere; this page renders it.
- **Phone screening inline** — `POST …/screen` — showing `DNC/TCPA clear` or a block, next to the
  phone field. Screening before submission is why the form has a phone field at all, and phone
  cannot be removed from a lead form.
- **Submission readiness panel**, live: phone screened, required fields `n/m`, duplicate check,
  consent captured, plus product, form version and agency.
- **Consent is an explicit checkbox with the full statement visible**, and the captured timestamp
  recorded and shown. Never pre-ticked, never collapsed behind "terms".
- Draft autosave with an honest failure message ("Draft could not be saved") — a partner filling a
  long form must know if it is not being kept.
- Previous / Save draft / Submit lead.
- "Only submit leads with documented consent. Every submission is audit logged."
- When the partner is not `active`, disable submission and say why.

### Controls
| Control | Destination / effect |
|---|---|
| Product select | loads that form; warns about clearing |
| Section step | navigates within the form |
| Previous | previous section |
| Save draft | `PUT …/draft` |
| Phone blur | `POST …/screen` |
| Consent checkbox | records consent + timestamp |
| Submit lead | `POST …/:productCode` → confirmation |

### Layout
`max-w-7xl`. Header, product select with the version chip and "Final Expense also available"
beneath. Horizontal stepper. Two columns: form left (two-up fields at ≥ 1024px, full width below),
readiness panel right, sticky.

Readiness is a checklist of label → state chip, then a divider, then the record facts. It is the
page's conscience: green when a thing is genuinely satisfied, neutral when unknown, never green
by default.

Consent is its own bordered block at the end of the form, above the action row, at 14/400 and
genuinely readable.

### Must not
- Pre-tick consent, or reduce it below readable size.
- Submit without screening having run.
- Show a field the agent did not enable, or hide one they marked required.
- Switch products without warning first.
- Let the submit button be pressable twice.

---

## 6. Lead pipeline — `/partner/pipeline`

**Files:** `app/partner/(portal)/pipeline/page.tsx` (9), `components/partner/partner-lead-pipeline.tsx` (121)
**Mockup:** `38-partner-pipeline.png` — authoritative
**Gate:** partner session. Accepts `?closer_id=` from Team review.
**Data:** `GET /api/partner/leads/pipeline?<filters>`, `GET /api/partner/leads/:id`, export at `/api/partner/leads/export`

**Purpose:** follow every submitted lead through the agent's stages.

### Must do
- Board and Table views. Board columns: New, Claimed, Verification, Converted, each counted.
- Filters: product, stage, submitted-by, outcome, date range, plus search and Reset.
- Card/row → detail panel with **Submission** and **Timeline** tabs.
- **"Form as submitted"** — exactly what was sent, with "This information is shown exactly as
  submitted and cannot be edited in the partner portal." Both the content and the sentence matter:
  the partner must be able to prove what they sent, and must not be able to revise it afterwards.
- Timeline of agent-side events (submitted, screened, claimed, verification started) with actor and
  timestamp. This is the visibility the portal promises.
- Duplicate and Compliance chips on affected cards.
- Export CSV.
- Load-more pagination via `nextOffset`.
- Message agent from the detail panel.
- Honour `?closer_id=` as a filter.
- **"Only leads submitted by <partner> are shown. Updates refresh automatically."**
- Error state with Try again.

### Controls
| Control | Destination / effect |
|---|---|
| Board / Table | view switch |
| Search / Filters / Reset | re-fetch |
| Card or row | detail panel |
| Submission / Timeline | tab switch |
| Export CSV | `/api/partner/leads/export` |
| Load more | next page |
| Message agent | `/partner/messages` |
| Close (×) | closes the panel |

### Layout
`max-w-7xl`. Header with the freshness chip, the Board/Table segmented control and Export. Four
counter cards. Filter bar. Board columns min 280px with a tinted header carrying stage name and
count; the Converted column's tint is the one place green is used as a column colour. Detail panel
is a right rail ≥ 1280px.

"Form as submitted" is a read-only key–value block on `--portal-group` with a lock glyph — it must
be impossible to mistake for a form.

### Must not
- Allow editing a submission.
- Show a stage the agent has not exposed to partners.
- Show agent-internal notes.
- Render the empty state for a failed fetch.

---

## 7. Messages — `/partner/messages`

**Files:** `app/partner/(portal)/messages/page.tsx` (5), `components/partner/partner-chat-panel.tsx` (91)
**Mockup:** `37-partner-messages.png` — authoritative
**Gate:** partner session
**Data:** `GET/POST/PATCH /api/partner/chat`

**Purpose:** talk to the agent, and see automatic lead updates, in one place.

The partner-side mirror of [`02-AGENT-APP.md` § 6](02-AGENT-APP.md). Same rules.

### Must do
- Three panes: conversations, thread, details.
- **Automatic updates visually distinct and marked "cannot be edited"** — lead received, transfer
  claimed, stage changed, each with structured facts (product, state, lead id, timestamp).
- Send message; attachments with name and size.
- New conversation.
- **"If sending fails, your message stays in the box."** Keep it, and keep it true — this reader
  may be on poor connectivity and losing a typed message is the failure they will remember.
- Character counter against the limit.
- Details pane: agent org, support contact with email and phone, notifications, shared files,
  related leads each linking to `/partner/pipeline`.
- `Connected · Real-time updates enabled` status that reflects the actual socket state.

### Fix while you are here — D-12
Three controls here have no handler: `Details`, `Conversation members`, `⌄ Details panel`. Wire or
remove.

### Controls
| Control | Destination / effect |
|---|---|
| Conversation row | selects thread |
| Send message | `POST /api/partner/chat` |
| New conversation → Create | `POST …` |
| Attach files | local until send |
| Related lead | `/partner/pipeline` |
| Manage (notifications) | notification preferences |
| Details · Conversation members · ⌄ | **nothing — D-12** |

### Layout
Three columns ≥ 1280px. Automatic update: full-width tinted block with its own icon, the
"cannot be edited" caption and key–value facts. Human message: avatar, name, org, time, bubble on
`--portal-group`.

The composer is fixed at the bottom of the thread with the attachment chip row above the input, the
counter bottom-left and the orange Send bottom-right.

### Must not
- Style a system event as a typed message, or allow editing one.
- Drop a message on a failed send.
- Claim "Connected" when the socket is down.
- Leave a control that opens nothing.

---

## 8. Team access — `/partner/team`

**Files:** `app/partner/(portal)/team/page.tsx` (5), `components/partner/partner-team-workspace.tsx` (249)
**Mockup:** `41-partner-team.png` — authoritative
**Gate:** partner session + **`partner_admin`**; `section-page.tsx` redirects a `partner_user` to `/partner`
**Data:** `GET /api/partner/users`, `POST /api/partner/users`, `PATCH /api/partner/users/:id`, `POST /api/partner/users/:id/resend-invite`

**Purpose:** a partner admin invites and manages their own teammates.

### Must do
- Three counters: active members, pending invites, deactivated.
- Members & invitations table: member, email, role, status, last activity, actions. Searchable.
- Invite form: full name, work email, role, with the role explained ("Partner users can submit
  leads, track their organization's pipeline, and message the agent").
- Invitation expiry stated ("Invitations expire after 72 hours"), and Resend on a pending row.
- Deactivate / Reactivate — the label must match the row's current state. The generated mockups
  show one pair where a deactivated user's button still reads "Deactivate"; it must read
  "Reactivate".
- **Access rules panel:** only partner admins manage members; access is limited to this partner's
  data; **deactivation retains submission and message history.** The third rule is the one that
  makes deactivation safe to use.
- Every failure states that the user's input survives: "Could not send invitation. Your form is
  still available to try again." Keep that promise.

### Controls
| Control | Destination / effect |
|---|---|
| Send invitation | `POST /api/partner/users` |
| Resend | `POST …/:id/resend-invite` |
| Deactivate / Reactivate | `PATCH …/:id` |
| Search | local filter |
| Try again | re-fetch |

### Layout
`max-w-7xl`. Three counter cards with tinted glyphs (green active, amber pending, red deactivated).
Two columns: table left (~2fr), invite form + access rules right (~1fr). Status is a dot plus a
word. A pending row shows its expiry date under the last-activity cell — an invite is useless
without knowing when it dies.

### Must not
- Render for a `partner_user`.
- Delete a member. Deactivation retains history; deletion would destroy an audit trail.
- Show a Deactivate label on an already-deactivated row.
- Lose the invite form's contents on a failed submit.

---

## 9. Team review — `/partner/team-review`

**Files:** `app/partner/(portal)/team-review/page.tsx` (5), `components/partner/partner-team-review-workspace.tsx` (109)
**Mockup:** manifest row 45 — "Approved Team Review mockup". The generated set has a clean version.
**Gate:** partner session + **`partner_admin`**
**Data:** `GET /api/partner/leads/pipeline?<filters>`, `GET /api/partner/users`

**Purpose:** how this partner's own team is performing.

### Must do
- Date range with the two inputs labelled (`Review start date`, `Review end date`).
- Four metrics with period-over-period deltas: leads submitted, in progress, applications,
  conversion rate. **Every delta names its comparison window** ("vs previous 30 days") — an arrow
  alone is not a claim.
- Submission trend chart with a range selector and a labelled series.
- Team pulse: average response time, active members, pending follow-ups, and a team-activity bar
  ("3 of 4 members active this month" — the fraction must be shown, not just the percentage).
- Partner performance table per user: submitted, in progress, applications, conversion, last
  activity, View.
- Teammate detail panel: their metrics, recent activity, and **View pipeline →**
  `/partner/pipeline?closer_id=<id>`. That hand-off is the reason the page is useful — from a name
  to their actual leads in one click.
- Export report (`/api/partner/leads/export?limit=5000…`).

### Controls
| Control | Destination / effect |
|---|---|
| Date range | re-fetch |
| Export report | CSV download |
| Row / View | teammate panel |
| View pipeline → | `/partner/pipeline?closer_id=:id` |
| Close (×) | closes the panel |
| Try again | re-fetch |

### Layout
`max-w-7xl`. Four metric cards with deltas. Two columns: trend chart left (~2fr), team pulse right
(~1fr). Performance table full width below. Teammate panel as a right rail.

Chart: single orange series, soft fill, no gridline clutter, axis labels only where they earn their
space. One series — this is a trend, not a comparison.

### Must not
- Show a delta without its window.
- Compare this partner to another partner.
- Present a conversion rate without its denominator.
- Rank teammates publicly in a way the data cannot support — a 4-lead sample is not a ranking.

---

## 10. Partner settings — `/partner/settings`

**Files:** `app/partner/(portal)/settings/page.tsx` (5), `components/partner/partner-settings-workspace.tsx` (98), `components/partner/partner-notification-preferences.tsx` (69)
**Mockup:** `39-partner-settings.png` — authoritative
**Gate:** partner session (both roles)
**Data:** `GET /api/partner/settings`, `GET/PATCH /api/partner/notifications`

**Purpose:** what this partner controls, what their agent controls, and where their data stops.

### Must do
- **Your access** — the role and exactly what it permits, as a ticked list (submit leads, track
  submissions, message your agent, manage team members). The last item is only true for an admin.
- **Partner account** — status and what it means for submitting.
- **Agent-managed controls** — with a lock glyph, naming what the agent owns (approved products,
  forms, commercial terms) and routing the request: "Contact your agent to request changes."
- **Profile & notifications** — partner, partner id, contact, work email, all **read-only** (the
  agent owns the record), then notification preferences the partner *does* own: lead status
  updates, new messages, team invitation activity, timezone. Save.
- **Submission configuration** — a read-only table of product, form version, daily cap, monthly cap,
  managed by. Plus a "Need a configuration change?" block with Message your agent.
- **Security & sessions** — current browser, last signed in, and **Sign out other sessions**.
- **Data boundary** — "Only <partner> leads and messages are visible in your partner workspace.
  Other partners' leads and messages are not visible."
- Retry on failure.

### Controls
| Control | Destination / effect |
|---|---|
| Notification checkboxes + timezone | local until save |
| Save notification preferences | `PATCH /api/partner/notifications` |
| Message your agent / Message agent | `/partner/messages` |
| Sign out other sessions | session revocation |
| Retry | `GET /api/partner/settings` |

### Layout
`max-w-7xl`. Top row of three status cards (Your access · Partner account · Agent-managed
controls). Then two columns: profile & notifications left, submission configuration right. Bottom
row: security & sessions, data boundary.

**The read-only/editable distinction must be visible at a glance.** Read-only fields sit on
`--portal-group` with no border and no focus ring; editable controls get
`--color-control-border` and a white fill. A partner should never wonder why a field will not
accept typing.

### Must not
- Present an agent-managed value as editable.
- Hide the data-boundary statement — it is the portal's core promise.
- Put Save on a card that contains nothing savable.
- Show another partner's caps or products.
