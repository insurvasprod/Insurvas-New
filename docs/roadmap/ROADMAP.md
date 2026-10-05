# Insurvas: completion roadmap

Written 2026-10-02 from:
- the Notion docs *Basic Idea Individual Agent Side* and *Basic Idea Super Admin Side* (the latter is rewritten in full in [SUPER-ADMIN-EXPLAINED.md](../SUPER-ADMIN-EXPLAINED.md));
- the Notion Module 1–3 docs and the *Insurvas Sprint* board;
- two strategy briefs: *The Persistency Thesis* and *Four Tiers, One Ledger*;
- the repo's own audits ([SA](../qa/SA-ACCEPTANCE-AUDIT-2026-09-21.md), [LA-0…2](../qa/LA-ACCEPTANCE-AUDIT-2026-09-22.md), [LA-3](../la3/ACCEPTANCE-AUDIT.md)).

Below are the four views of the product (CEO, PM, UX, engineering), where the build stands, and the order in which the rest gets built. The per-phase task files are linked at the end.

---

## 1. What we are building, and for whom (CEO view)

> **Read with [BUSINESS-CONTEXT.md](BUSINESS-CONTEXT.md) (2026-10-05).** The 2026-10-02 leadership
> meeting widened the customer to three dimensions: IMO/FMO · agency · independent; life · health;
> products. It names IMOs and FMOs as the revenue, puts health in scope for this enrollment season
> through a generic editable template, adds a template store, workspace apps and department add-ons
> with AI agents, and drops the orange brand. Several points below conflict with that. They are
> listed as decisions in BUSINESS-CONTEXT §4 and are not yet resolved here.

**The customer** is an independent life-insurance agent, the persona "Ray":
- licensed in 5–25 states and appointed with 6–15 carriers;
- writes 8–40 policies a month and spends $2,000–15,000 a month on leads;
- sells mostly Final Expense to people aged 58–80, plus some Term.

His tools today are GoHighLevel, three Google Sheets, a separate dialer and nine carrier portals. The second customer is the small agency of 2–15 producers: Ray, eighteen months from now. Design for it, but don't build it first.

**Not our customer:** brand-new agents (no book, high churn), large IMOs and carriers (procurement cycles), and property & casualty agents.

**The thesis:** Ray thinks he is in a sales business; he is actually in a *persistency* business. With 2026 lead costs:
- a policy that survives its first year earns about **+$220**;
- one that lapses in month 4 costs about **−$1,040**, because the advance is clawed back and the lead spend is lost.

So one early lapse wipes out roughly 26 good sales, and Ray finds out 3–9 months later, on line 34 of a carrier PDF.

**The product's job, in one sentence:** *show Ray his money in real time, and warn him before a policy dies instead of after.*

**The wedge and the moat.**
- We lead with commission reconciliation, not CRM. The activation moment is a screen that says **"You appear to be owed $3,412"** after his first statement is processed.
- An agent will cancel a CRM. He won't cancel the only place his statements, chargebacks and renewals are reconciled.
- The growth loop: Ray screenshots the "owed" screen and the lead-source scorecard and sends them to other agents.

**Pricing:**
- The code keeps its plan codes. The names customers see change to the docs' names, and that change is data only.
- Every plan has a 14-day trial with a card on file, and there is no free tier.
- Usage is metered only where it has a real cost (dialer minutes, DNC lookups, statement pages, SMS, e-sign).
- Meters show live usage and stop at the cap.

| Code | Customer-facing name | Price | What it is |
|---|---|---|---|
| `basic` | **Ledger** | $99/mo | Book of business, statements, commission ledger, discrepancies, appointment vault. No CRM. |
| `pro` | **Basic** | $249/mo | Ledger plus inbound, outbound, sell (quote, apply, draft-date optimiser) and compliance basics |
| `advance` | **Advanced** | $449/mo | Basic plus retention, insight (true CPA, persistency), partners and payouts, accounting, litigation packet |
| *(new)* `agency` | **Agency** | $799/mo + $79/seat | Advanced plus team, hierarchy and overrides, splits, team QA; assistant seats at $29 |

**Principles we hold:**
- Never lock a customer out of his own book: suspension takes away the *doing* and keeps the *seeing*.
- Never take a percentage of commission.
- Every price, plan and feature is data the Super Admin edits, never a deploy.

## 2. The map of the product (PM view)

| # | Module | What it does | State today |
|---|---|---|---|
| — | Super Admin control plane | Plans, features, prices, billing (Whop), tenants, configuration | 36 of 44 SA tasks pass. Gaps: SA-4.11 email templates, SA-6.1 job monitor, SA-6.3 export and deletion (all need DDL) |
| 0 | Agent foundation | Shell, roles, dashboard, carrier library, appointment vault, dedupe | Built (LA-0) |
| 1 | Acquisition: inbound | Partner intake, transfers, verification, dispositions, Agent Floor | Built (LA-1) |
| 2 | Acquisition: outbound | Lists, scrub gate, cadence, queue, dialer, callbacks, vendor scorecard | Built (LA-2). The dialer hands calls to the phone through `tel:` links; there is **no telephony** yet |
| 3 | Sell | Underwriting, quotes, application, draft-date optimiser, QA, submission, after-submit | Built (LA-3). The AI assistant (3.3) is blocked on decision 4 |
| 4 | **Book of Business** | Policies, statements, ledger, discrepancies, persistency | **About 40%.** CSV only, exact match only; no discrepancy engine or page, no persistency, no "owed" figure → [LA-4](../la4/TASKS.md) |
| 5 | Retention | Lapse scoring, chargeback radar, payment repair, win-back | A manual lapse board, with no score → [LA-5](../la5/TASKS.md) |
| 6 | Compliance | Consent, DNC, recordings, litigation packet | Consent locker, DNC/TCPA and appointment vault are built. No recording or litigation packet → [LA-6](../la6/TASKS.md) |
| 7 | Accounting and partners | Payout runs, disputes, P&L, tax, true CPA | True CPA and vendor returns are built. No payouts, P&L or tax → [LA-7](../la7/TASKS.md) |
| 8 | Configuration | Products, forms, rules, templates, sales settings | Built |
| — | Agency tier | Seats, hierarchy, overrides, splits, team QA | Not started (`max_seats` is 1; agency plan types are not buildable) → [LA-8](../la8/TASKS.md) |
| — | UX platform | One design standard, data-driven navigation, enforced rules | Partly in place → [UX](../ux/TASKS.md) |

**Modules 4–8 and Agency have no sprint tasks anywhere, in the repo or in Notion.** The task files linked here are the first definition of that work, so paste them into the Notion board.

## 3. The order, and the gate for each phase

Each phase is something that can be sold on its own, with a gate that has to be passed before the next one starts (from the Persistency Thesis).

1. **LA-4 Book of Business (the money spine).**
   - *Gate:* a real CSV or XLSX carrier statement produces an "owed to you" figure that a person can trace to the arithmetic, plus a printable dispute letter.
   - This completes the Ledger tier.
2. **UX platform**, interleaved with every phase.
   - *Gate:* a new module page needs only data plus its own page file, and the UI-rule offender counts only go down.
3. **LA-5 Retention.**
   - *Gate:* on seeded history, the radar flags policies before they lapse.
   - This is what makes Advanced worth $449: "one prevented lapse is $1,040".
4. **LA-6 Compliance completion.**
   - *Gate:* one click produces a complete litigation packet for a contact.
   - The `partner_portal` add-on is actually enforced.
5. **LA-7 Accounting and partners.**
   - *Gate:* an agent pays a publisher through the platform, and the P&L shows cost per issued policy against cost per *persisting* policy.
6. **LA-8 Agency.**
   - *Gate:* a 3-producer agency runs on one tenant with overrides and splits.
   - Assistants never see money.
7. **Platform leftovers** (SA-4.11, SA-6.1, SA-6.3, Whop plan mapping, data hygiene).
   - These run in parallel whenever DDL can be applied.

## 4. How we keep it easy to adjust and able to grow (UX and engineering view)

- **Everything that varies is data.** Plans, features, menu items, settings sections, templates, carriers and rules are already stored as data. The remaining hand-written maps (sidebar module grouping, the settings-tab switch) become data in the [UX phase](../ux/TASKS.md).
- **One design standard.** [UI-CONSISTENCY.md](../design/UI-CONSISTENCY.md) is the rule. The rules are:
  - one `PageHeader`;
  - lists use `TableCard` + `DataToolbar`, with figures in a `StatStrip`;
  - buttons are 36px;
  - no explainer cards.
- It will be enforced by tests, not by review.
- **Gates enforced in three places, always:**
  - the menu (cosmetic);
  - `guardPage` (no broken page on a pasted URL);
  - `requireFeature` on the API (the only real security).
- Every API route is registered in `agentApiPolicy.ts`, and a test fails the build if one isn't.
- **Tenant isolation:** `tenant_id` on every table, RLS as the backstop, the tenant always taken from the session, and service-role queries always filtered by tenant.
- **Money is role-gated:** owner, producer (own policies only) and bookkeeper see it; assistants never do.

## 5. Open decisions

These are recorded in [backlog.md](../backlog.md) as entries 206–213.

1. **AI / document provider:** needed for PDF statements, LA-3.3 and the AI half of LA-3.13.
2. **HTTP email provider with bounce webhooks:** needed for LA-3.20 and SA-4.11.
3. **Telephony vendor:** needed for the real dialer, screen pop, call recording and the litigation packet.
4. **Chrome Web Store publishing** of the carrier extension.
5. **Is persistency a Ledger feature or Advanced only?** Today `cohort_persistency` is on Advanced only.
6. **Grace period before "never paid":** proposed at 45 days after issue.
7. **Does "suspended can still read" cover a suspended agency (tenant), or only a suspended subscription?** Today a tenant suspension locks everyone out.
8. **Database compute:** the NANO instance caused the 2026-09-30 outage; Micro or above is recommended.

## 6. Task files

| Phase | File |
|---|---|
| LA-4 Book of Business | [docs/la4/TASKS.md](../la4/TASKS.md) |
| UX platform | [docs/ux/TASKS.md](../ux/TASKS.md) |
| LA-5 Retention | [docs/la5/TASKS.md](../la5/TASKS.md) |
| LA-6 Compliance completion | [docs/la6/TASKS.md](../la6/TASKS.md) |
| LA-7 Accounting and partners | [docs/la7/TASKS.md](../la7/TASKS.md) |
| LA-8 Agency | [docs/la8/TASKS.md](../la8/TASKS.md) |
