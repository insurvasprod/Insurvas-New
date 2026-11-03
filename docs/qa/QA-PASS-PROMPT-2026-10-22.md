# Prompt: full manual QA pass, individual agent, modules 1–8

Paste everything below the line into a new Claude Code session in this repo.

---

Tomorrow I'm giving colleagues access to this repo and the running app so they can review it. Before
then, walk the whole product by hand, the way a brand-new independent agent would, from the landing
page through every module (LA-1 to LA-8). Fix what's broken as you go, and leave a report plus a
short guide so a newcomer can find their way without help.

Think like a QA tester the whole time. Don't stop at "does it work". Also ask whether someone who has
never seen the app would know what to do on each screen.

## Ground rules

- **Browser:** use the built-in browser against the dev server that's already running on :3000
  (`preview_start {name: "dev-attach"}`). Don't start a second server, and don't run `npm run build`.
- **Payments: none.** Visit the pricing, checkout and billing pages and check they render and explain
  themselves, but stop before anything reaches Whop or any other provider. Never submit card details
  or start a real checkout. To give the new account its plan and modules without paying, find the
  no-payment path the code already has (a trial, a 100% coupon, or a super-admin plan or entitlement
  grant). Use it, and write down which one you used. If no clean path exists, stop and ask me.
- **Accounts:** sign up for real through the UI. Use `@insurvas.test` addresses for every agent and
  member account. Keep the credentials in a scratch file, never in chat.
- **Email/SMTP:** `.env.local` has SMTP settings, but `EMAIL_DELIVERY_MODE` is not `smtp`, so mail
  is currently switched off. Before turning it on, ask me which real inbox to use for one delivery
  test. Then run `npm run email:test -- <that inbox>` and send one invite and one verification code
  to that inbox. Every other email (all `.test` addresses) should be verified from the email
  delivery log, not a real mailbox. Report whether the codes and links in those emails work, expire
  and reject reuse.
- **Live data:** the dev server talks to the real Supabase project. Create only your own new test
  tenants, and change rows that belong to them only. Everything else is read-only. At the end, list
  every tenant, user and lead you created so they can be removed. Don't delete anything without
  asking me.
- **House rules (they're in memory; reread them):** check the module's Notion tasks and docs before
  changing anything; follow `docs/design/UI-CONSISTENCY.md`; never click by fallback on live pages
  (use the exact text from the source and fail if it's missing); run node tools from PowerShell;
  treat migrations as something I apply by pasting them (write the file, rehearse the whole file
  rolled back, hand it over).

## The walk

Record each step as pass / fail / confusing, with a screenshot for every fail or confusing result.

1. **First impression.** Landing page → pricing → sign-up. Is it clear which plan an independent
   agent should pick and what they get? Check broken links, layout at phone width, and console errors.
2. **Sign up as an individual agent.** Account → email verification code (including a wrong code,
   an expired code and resend) → set password → accept terms → onboarding. Then sign out, sign
   back in, and run forgot-password.
3. **Get every module** using the no-payment path above. Confirm that every module and feature in
   the navigation opens and none shows a locked or empty gate by mistake.
4. **Team.** Invite two new members with different roles. Check that the invite email arrives (log
   or real inbox), accept the invites, set passwords, and confirm each member sees only what their
   role allows. Then revoke one member and confirm they lose access.
5. **Modules 1–8, every feature.** Use the Notion Module docs as the checklist of what each module
   should do. At a minimum, cover:
   - **Leads:** CSV import, including a bad file, duplicates and missing columns → lead list →
     assignment.
   - **Outbound:** dialer queue → call screen → scripts and rebuttals → disposition → the lead lands
     in the pipeline stage that disposition maps to. Telephony keys aren't configured, so test
     everything up to the actual call and report what a reviewer will hit.
   - **Inbound:** screening → verification → handoff/transfer to another agent.
   - **Pipelines:** move leads between stages and between pipelines, check callbacks and
     appointments, and confirm the history records each move.
   - **Applications/policies,** the book, carrier file imports, retention and win-back, compliance
     (consent, complaints, deletions, evidence), accounting/pay, scorecards, and every Settings tab.
   - For every create/edit/delete form: empty submit, bad input, very long input, and a refresh
     halfway through.
6. **Isolation.** Sign up a second independent agent, B, and give them a few leads, a policy and a
   contact. From agent A, try to reach B's data every way you can: search, lists, exports, direct
   URLs with B's record IDs, and the `/api/app/*` endpoints with B's IDs swapped in. Every attempt
   must come back empty or 403/404. Also run `npm run verify:tenant-isolation`. Any leak is a
   stop-everything bug: fix it first and tell me straight away.
7. **Newcomer pass.** Go back over the screens that were marked confusing. Fix what a label, an
   empty state or a clearer default solves. List the bigger ones for me rather than redesigning
   them.

## Fixing

Fix bugs as you find them. Keep each fix small, re-test that step in the browser, and note it in
the report. Anything that needs a migration, a product decision or a missing third-party key goes in
the report as "needs owner". Don't build around it.

## Deliverables

- `docs/qa/QA-PASS-2026-10-22.md`: every step with pass/fail/confusing, screenshots, the fixes made,
  what's still open (severity-ranked), and the cleanup list.
- `docs/qa/REVIEWER-GUIDE.md`: one page for my colleagues covering how to get in, which test
  accounts exist, what is intentionally not wired (payments, telephony, mail mode) and what to try
  first.
- Don't commit. Tell me what changed so I can review it.
