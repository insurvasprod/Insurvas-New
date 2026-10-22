# Reviewer guide

For colleagues reviewing Insurvas for the first time. What's here: how to get in, which accounts
exist, what is switched off on purpose, and what to try first. The full findings from the QA pass are
in [QA-PASS-2026-10-22.md](QA-PASS-2026-10-22.md).

## Getting it running

```bash
npm install
```

```bash
npm run dev
```

The app runs on http://localhost:3000, and `.env.local` (from the repo owner) points it at the
shared Supabase project. **That project is production.** Create your own test accounts and work only
inside them. Don't edit catalog data (plans, carriers, disclosures) in the admin console without
asking.

- Landing page: `/` · Pricing: `/pricing` · Sign up: `/signup`
- Agent app: `/app` · Sign in: `/app/login`
- Insurvas staff console: `/admin`

## Accounts

Ask the repo owner for the password. It isn't written down here.

| Account | What it is |
| --- | --- |
| `qa.agent.b.1022@insurvas.test` | **Independent agent** on Advanced (every module, 1 seat). Has 8 imported leads, a vendor and campaign, a callback, an open application, a hand-entered policy and a contact. Start here. |
| `qa.agent.a.1022@insurvas.test` | Agent who moved up to **Agency · 1–50 seats** to get a team. Owner of the workspace below. |
| `qa.member.1.1022@insurvas.test` | Producer on agent A's team. |
| `qa.member.2.1022@insurvas.test` | Assistant on agent A's team, **deactivated** (shows what a removed member sees). |

To make your own account, sign up at `/signup` with any `@insurvas.test` address. Then:

1. **Verify the email.** Mail is switched off locally (see below), so no email arrives. Print the link
   the email would have carried:
   ```bash
   node --env-file=.env.local scripts/qa-verification-link.mjs you@insurvas.test
   ```
   Open the printed link. Each link works once and lasts 24 hours.
2. **Business profile**, then **checkout**. Stop at checkout and don't press "Continue to secure
   checkout": that opens the real payment provider.
3. **Get your plan without paying.** Someone with an admin-console login opens `/admin` › Tenants ›
   your workspace › Subscription & billing, presses **Switch to manual billing**, then **Assign a
   plan**. Your next page load in `/app` lands on the dashboard.

## Switched off on purpose

| What | State | What you'll see |
| --- | --- | --- |
| **Payments** | Whop checkout is never reached in testing. Plans are assigned by staff (above). | Pricing, checkout and Settings › Plan & billing pages render; nothing is charged. |
| **Email** | `EMAIL_DELIVERY_MODE` isn't `smtp`, so mail is recorded but not sent. | "We sent a link" screens; the row is in the `email_log` table with `status = skipped`. Invite links appear in the invite API response (and Resend invite issues a new one). |
| **Telephony** | No phone provider keys. | "Click to call" logs a click-to-call attempt; the call itself isn't placed. Everything around it (disclosure, outcomes, callbacks, routing) works. |
| **State disclosures** | Seeded with placeholder text. | The dialer shows "[PLACEHOLDER — NOT COMPLIANCE-APPROVED …]". It must be replaced before any live call. |
| **Legal documents** | Draft versions. | Sign-up and accept-terms screens say the documents are drafts. |

## What to try first (about 20 minutes as agent B)

1. **Leads › List import**: upload a small CSV (first name, last name, phone, state). Map columns, pick
   the campaign, review, import. The review screen accounts for every row.
2. **Leads › Vendors & campaigns**: the campaign must be **Active** to dial.
3. **Settings › States & licences**: a lead is only served in a state the agency holds a live licence
   for (agent B has Florida).
4. **Settings › Dispositions**: each call outcome moves the lead to a stage. A brand-new workspace
   starts with none mapped, so map them before judging the pipeline.
5. **Today › Dialer**: Serve next lead → Click to call → I read this disclosure → Start call → choose
   an outcome. Try "Callback scheduled" (books a callback) and "No answer" (moves the lead).
6. **Leads › Lead workspace**: see where each lead now sits, and its stage history.
7. **Book › Policies**, **Duplicate check** (contacts), **Commissions**, **Accounting**, **Compliance**:
   open each and add one record.

## Known gaps (see the QA report for the full list)

- The three **Agency** plans have no products attached in the catalog, so List import fails for any
  Agency workspace (agent A). Needs a catalog decision.
- A single-seat plan (Advanced and below) has no Settings › Team & access. To try team features,
  use agent A.
- Pages can be slow on the dev server, especially the first visit to each page while it compiles.
