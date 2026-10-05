# Insurvas: business context after the 2026-10-02 leadership meeting

Written 2026-10-05 from the recorded meeting (transcript, 23 minutes). It is read against the code
on branch `redesign/foundations` and against [ROADMAP.md](ROADMAP.md).

This file records three things:
1. what the meeting decided or proposed;
2. where that changes the roadmap;
3. how far the product is from a paid launch.

Where the meeting contradicts the roadmap, the conflict is listed in §4 for a decision. It is not
silently resolved.

---

## 1. What the meeting said

### 1.1 Who we sell to: three dimensions, not one persona

The roadmap's customer is one persona: "Ray", an independent *life* agent. The meeting widens this
to three dimensions that a customer picks:

| Dimension | Values |
|---|---|
| **Who** (structure) | IMO / FMO · Agency · Independent agent |
| **Industry** (line of business) | Life · Health · Both |
| **Products** sold within it | Life: whole life, term life (and FE/IUL). Health: Medicare (several types), ACA/Obamacare, hospital indemnity, others |

Inside each structure there are **tiers**: Tier 1, Tier 2, Tier 3 and Enterprise. Each tier
unlocks a set of features. **The features stay the same across health and life and across
products.** Only the sales pipeline (stages, lead fields, application steps) differs by product.

**Why now:**
- From now until January, Medicare and ACA enrollment season puts an estimated 60–80% of the
  market's volume in health.
- The team has no health experience. The meeting's answer: offer health anyway, through
  customisation, and deepen it later.
- The analogy given: "Uber, but only for motorcycles" still has users, but leaves money on the table.

**Where the revenue is:** IMOs and FMOs are named as the 20% of buyers who bring 80% of revenue.
They are "big-time clients" the company wants to work with. The independent agent remains the
entry point who should be able to *grow on the platform*: from individual, to agency (upgrade the
subscription), to adding HR and recruiting.

### 1.2 Products we don't know yet: one generic, editable template

- Whole life and term life keep their deep, purpose-built flow (underwriting, quotes, application).
- **Every other product gets the same pre-made template.** It has one pipeline with the stages
  Lead → Contacted → Not contacted → Interested → Not interested → Sold → Charged back, and the
  customer can rename, add or remove stages and fields themselves (the GoHighLevel model).
- Positioning: "you can customise it yourself", not "this product is missing".
- Each product deepens over time, through research and through partners who sell it. The work is
  then "copy and paste in": build the customisable template once, then add products.

### 1.3 More ways to earn (on top of tiers)

| # | Idea | What it means |
|---|---|---|
| 1 | **Template store** | Pre-built templates, e.g. a retention add-on or a product-specific pipeline. They are bought, downloaded and imported into the CRM in one click. "Like Notion templates." |
| 2 | **Custom build-outs** | Pay to have a section customised, by our team or by certified partners. The HubSpot partner model: HubSpot earns either way. |
| 3 | **Workspace apps (in-app purchases)** | Dialer, AI bots, chat support and similar tools, bought separately. Some of today's features may move behind these. |
| 4 | **Department add-ons** (the Clio model) | HR, recruiting, IT, marketing, accounting and project management as add-on sections, so a customer runs the whole business here. Each department comes in two forms: a **workspace for human staff**, and an **AI agent**, billed on usage with a margin (e.g. $100 of model cost billed at about $150). |
| 5 | **In-app comparison pages** | "HubSpot vs Insurvas" per department, priced just under the standalone tool, so adding a section is cheaper than buying another subscription. |

The long-term vision, as stated: *"no matter if I'm an independent agent, an agency or an FMO,
I don't have to go anywhere else to run this business"*. That is the product that would make
Insurvas "the best product in insurance".

### 1.4 Support, feedback and going to market

- **Public support feed:** tickets and answers are visible to other users, anonymised, with a "do
  not post sensitive data" notice. This follows the HubSpot community model.
- **Suggestions with weight:** "if you built X, I'd buy 10 more seats". Count requests by segment,
  e.g. agencies in health versus FMOs in life.
- **An account manager** who talks to customers, takes suggestions and files tickets.
- **Go to market before feeling ready** ("if you feel ready, you're too late"). The best features
  will come from users complaining after launch.

### 1.5 Delivery status and next steps, as the team sees it

- The front end from getting a lead to submitting an application is described as **complete**.
- The next four back-office modules: **tracking with the carrier, commissions, accounting, policy
  management**.
- Still missing on the front end:
  - **lead sources from ads and websites:** Facebook and Google forms, affiliate agencies running
    social ads, website hook-ups;
  - **the real dialer** ("we have a solution, we just need to integrate").
- **Branding: "let's just not make it orange."** The designer (Alejandro) liked the product. A
  new **logo, font and colour palette** arrive next week, for the website and the app.

---

## 2. How the meeting maps onto the code today

| Meeting idea | State in the repo | Where |
|---|---|---|
| Product catalog with life and health | **Partial.** `products.category` is life · health · retirement. Seeded products: final expense, term, whole life, IUL, Medicare Advantage, annuity. **No ACA, Medicare Supplement, PDP or hospital indemnity.** | `supabase/migrations/0003_products.sql`, `lib/products/*`, admin `/admin/products` |
| Per-product template (fields + stages + form) | **Exists.** One global template per product code, versioned, admin-edited. A tenant applies a copy, one per product. | `0004_templates.sql`, `0009`/`0010`, `lib/agentTemplates/service.ts`, `components/app/template-settings.tsx` |
| Customer edits stages, names and fields | **Exists.** Pipelines and stages can be created, renamed, reordered and archived. Template fields, sections and show-when rules are editable. | `components/app/pipeline-settings.tsx`, `pipeline-stage-manager.tsx`, `/api/app/pipelines/**` |
| Customer chooses industry and products at signup | **Partial.** Onboarding asks `products_sold` (life/health/medicare/…), but it only changes hint text. It is **not** wired to `tenant_products` or to applying templates, and its words don't match the product codes. | `lib/signup/constants.ts`, `components/app/business-profile-form.tsx` |
| IMO / FMO / Agency / Independent structures | **Mostly missing.** `plan_type` has individual / agency_no_teams / agency_with_teams / management, but only `individual` is buildable. There is no hierarchy, downline or override model (LA-8 is unbuilt). | `lib/plans/constants.ts` |
| Tiers per structure (T1, T2, T3, Enterprise) | **Model exists.** Plans, features, meters and versions are all admin data, so a structure × tier matrix is configuration. Today there are three individual plans. | Super Admin plans |
| Template store (paid templates) | **Missing.** Templates have no price, listing or purchase. | — |
| Workspace apps and department add-ons | **Partial.** The add-on model grants features and meters and is billed, but only an admin can attach one. There is no tenant-facing store or self-purchase. | `20260911136000_sa_2_6_addons.sql`, `lib/addons/*` |
| AI agents billed on usage with a margin | **Partial.** Meters, usage totals and caps exist. **No AI provider** is chosen (backlog 206). | `lib/metering/*` |
| Lead sources: partner transfers, vendor POST API, CSV/XLSX, affiliate links | **Exist.** | `lib/transferInbox`, `app/api/post/[workspace]`, `app/app/(shell)/import`, `app/affiliate/[slug]` |
| Lead sources: website form embed, Facebook/Google lead ads, Zapier | **Missing.** | — |
| Real dialer / telephony | **Missing.** The dialer hands off through `tel:` links. A vendor is needed (backlog 208). | — |
| Public support feed, suggestions | **Missing in this repo.** Arden's support system may live in another repo; it isn't found here. | — |
| Rebrand (not orange) | **Cheap.** Colours are tokens in `app/globals.css` (light and dark blocks). The admin blue is in `app/admin/admin-plane.css`. The logo is two PNGs plus `components/shared/insurvas-logo.tsx`. The font is one `@import`. Email templates have their own hex values. The UI ratchet stops new hard-coded colours. | — |

**Good news for the health plan.** Section 1.2's generic template is mostly *data* on systems that
already exist:
- seed the missing health products, each with the generic template;
- wire onboarding's "what do you sell" choice to `tenant_products` and to applying templates.

The deep parts (quotes, applications, underwriting, draft dates) are life-specific and stay that
way, as the meeting proposes.

---

## 3. How far we are from launch

"Launch" here means a stranger signs up, pays, and uses the product without us in the room. It
depends on *whom* we launch to, so there are three answers.

### 3.1 Blockers for any paid launch (whatever the segment)

1. **Checkout does not work.**
   - Every plan maps to a placeholder Whop plan, so checkout returns 404 for everyone (backlog 195).
   - One plan is mapped at the wrong price (196).
   - Fix: create the real Whop plans and map them.
2. **Legal text is a placeholder.** The published Terms say they are "a working draft … not
   reviewed by a lawyer". A reviewed version must be published before real customers accept it.
   The admin Legal screen can publish it.
3. **Compliance disclosures are seeded placeholder text.** They must be replaced before calls are
   placed for real.
4. **Database health:**
   - it went over its storage quota and flipped to read-only (201);
   - NANO compute caused the 2026-09-30 outage (213);
   - opening the dialer hit a statement timeout on 2026-10-03.
5. **No email provider** (207). Trial reminders, invites and the welcome pack can't send.
6. **Rebrand.** The new palette, logo and font arrive next week. The work is mechanical and small
   (§2).
7. **A support channel.** The minimum is a monitored email and an account manager. The public
   ticket feed can follow.

Most of these are vendor setup and decisions rather than code.

### 3.2 Launching to independent life agents (closest)

- **What's built:** inbound, outbound (without telephony), sell, book of business (statements,
  ledger, discrepancies, the "owed to you" figure, persistency) and the UX platform. LA-4 was
  verified live on 2026-10-03.
- **Distance:** the §3.1 blockers, plus a real dialer *if* outbound is part of the offer. Ledger
  and Basic can launch with the `tel:` hand-off; telephony is an upgrade.
- **Not built** (sold later as the higher tiers): retention scoring (LA-5), litigation packet and
  recording (LA-6), payouts/P&L/tax (LA-7).

### 3.3 Launching for health this season

- **Dates (official CMS dates; confirm current-year details):**
  - Medicare Annual Enrollment runs **15 Oct – 7 Dec**;
  - ACA Open Enrollment runs **1 Nov – 15 Jan**.
- **Generic health template (§1.2):** achievable quickly on the existing template and pipeline
  system:
  - seed ACA, Medicare Supplement, PDP and hospital indemnity;
  - apply the generic stages;
  - wire the onboarding choice.
- **Medicare sales carry compliance the life flow doesn't.** These rules need confirming with
  compliance counsel before we market to Medicare agents:
  - CMS rules for third-party marketing organisations require **recording of sales and enrollment
    calls**, which needs telephony;
  - a **Scope of Appointment**, generally 48 hours before a sales appointment;
  - stricter marketing-material rules.
- **Honest read:** a generic CRM pipeline for health agents is possible inside this season.
  "Medicare-compliant selling in Insurvas" is not, until telephony with recording exists.

### 3.4 Launching to IMOs, FMOs and agencies

- **Not close.** It needs LA-8 (seats, hierarchy, overrides, splits, team QA) *plus* an IMO/FMO
  layer above agencies: downlines, contracting, visibility rules, production roll-ups.
- The meeting calls these the most valuable customers, so this is the largest piece of
  unscheduled work.

---

## 4. Decisions the meeting creates (conflicts with the roadmap)

**Decided 2026-10-05 (Rinor):**
- **Decision 1 is (a).** Clear the launch blockers and launch to independent life agents first.
  Health comes next. Agency + IMO/FMO is the next big build after that.
- **Decision 2 is "not yet".** The generic health template waits. Don't seed the health products
  or wire onboarding to them until it is picked up again.

Decisions 3–8 are still open.

1. **Which segment launches first?**
   - The roadmap says: the independent life agent first; "large IMOs … not our customer".
   - The meeting says: IMOs and FMOs are the revenue, and health is this season's volume.
   - Options: (a) launch independent life now and add generic health in parallel, with IMO/FMO
     as the next build; or (b) pivot the next phase to Agency + IMO.
2. **Health this season.** Ship the generic health template now (CRM only, no Medicare selling
   claims)? Or wait for telephony with recording?
3. **Pricing shape.**
   - The roadmap has Ledger $99 / Basic $249 / Advanced $449 / Agency $799 + $79 a seat.
   - The meeting describes Tier 1–3 + Enterprise *per structure* (Independent, Agency, IMO/FMO).
   - Both fit the plan model, but the matrix and prices need setting.
4. **What moves behind add-ons?** The meeting suggests the dialer, AI bots and chat support become
   paid workspace apps, and that some current features may move too. Which ones, and does that
   change what each tier includes?
5. **Template store and partner build-outs.** Who builds paid templates, how they are priced, and
   whether outside partners can sell them. Revenue share?
6. **Department add-ons and AI agents.**
   - Which departments come first (recruiting and HR for growing agencies?).
   - The AI provider (already open as backlog 206).
   - The margin.
7. **Brand.** The new palette replaces orange. Does the admin console keep its separate blue?
   That was the earlier "user decision 1".
8. **Support.** Where does Arden's support system live, and does it become the public ticket feed?

---

## 5. Suggested order, if (1a) is chosen

1. **Now (1–2 weeks, mostly setup):**
   - real Whop plans;
   - email provider;
   - database compute and storage;
   - lawyer-reviewed Terms;
   - real disclosures;
   - apply the new brand when it lands.
2. **In parallel, small:**
   - generic health products and template;
   - onboarding "industry + products" wired to `tenant_products` and template apply;
   - website-form embed and a Facebook/Google lead-ads connector, the missing lead sources.
3. **Telephony vendor and integration.** This unlocks the real dialer, recording, Medicare
   compliance and the litigation packet.
4. **Agency + IMO/FMO structures** (LA-8 and an IMO layer). This unlocks the biggest customers.
5. **Monetisation layer:**
   - a tenant-facing add-on and template store (the add-on model exists);
   - then department add-ons and AI agents on the metering that exists.
6. **LA-5 Retention, LA-6, LA-7**, as tier features.
