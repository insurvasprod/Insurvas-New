# A freshly imported list is attributed and undialable

> **FIXED 2026-09-23.** Option 1 was chosen: the import marks the campaign scrubbed, because the
> import does the scrub. Verified on a brand-new unscrubbed campaign — 3 leads imported, campaign
> auto-marked `scrubbed` with a timestamp, in `campaigns_servable`, and the Florida lead reads
> `allowed: true, reason: "ready"` on the dialer panel. No manual step. The six pre-existing
> campaigns were left `unscrubbed`, as they should be — they were never imported through this path.
>
> The mark lands **after** the commit so a crash fails closed (leads in, campaign unscrubbed,
> nothing served) rather than open (campaign advertising a scrub that never finished). A failed
> mark does not throw — the leads are already committed — it comes back as `servable: false` with
> a warning, so a screen can distinguish "imported" from "imported and the dialer will serve these".
>
> Guarded by `lib/agentTemplates/importMarksTheCampaignScrubbed.test.mjs`, which also pins the
> screening in place: the mark is only honest while the import still scrubs.
>
> The original finding follows.

**Found 2026-09-23**, by re-importing a list so that leads would carry a `campaign_id`. They do.
They then stopped being servable.

---

## The shape

`serve_next_lead` admits a lead when:

```sql
and (l.campaign_id is null
     or exists (select 1 from campaigns_servable cs where cs.id = l.campaign_id))
```

and `campaigns_servable` is:

```sql
select ... from public.tenant_campaigns
 where status = 'active' and scrub_status = 'scrubbed';
```

So an **unattributed** lead is served unconditionally, and an **attributed** one is served only if
its campaign is marked scrubbed.

Nothing in the application ever marks a campaign scrubbed.

Searched across `lib/` and `app/`: there is no write to `scrub_status` anywhere. The only SQL that
sets `'scrubbed'` is the suppression migration's own self-test and `20260913450000`'s recycling
path, reachable from the product only through `reactivate_nurture` — which recycles an existing
campaign's leads and is not part of importing a new list. `request_campaign_rescrub` is the
opposite of a key: it sets `unscrubbed`.

Measured on the live project: **all seven campaigns are `unscrubbed`, none has ever been scrubbed,
and `campaigns_servable` is empty tenant-wide.**

## Why it stayed invisible

Because 214,813 leads carry no `campaign_id` at all, they take the `campaign_id is null` branch and
are served normally. The dialer works. The gate has never bitten, because nothing has ever been
attributed.

Attribution is what exposes it — and attribution makes those leads **less** dialable than leaving
them unattributed, which is the opposite of what anyone would predict.

## What makes it a defect rather than a policy

The gate is correct: a list must be scrubbed against the suppression lists before it is dialled.
**The import already does that scrub.** The preflight screens every row and withholds the failures
— on this import it flagged `(202) 555-0101` as DNC and dropped it from the file before any lead
was written.

So the scrub happens and is never recorded. The gate fails closed on a list that passed it.

## Two options, and this is a product decision

1. **The import marks the campaign scrubbed**, because it did the scrub. Smallest change, matches
   what already happens, and makes attribution safe to turn on.
2. **A scrub action exists** on the campaign screen, run separately from import. More faithful to
   the "scrub is a distinct step" model the schema implies, and needs a screen.

Option 1 is what the code already earns. Option 2 is what the schema's four-state
`scrub_status` column was designed for. Picking between them is not a call to make from a QA pass.

## What was done in the meantime

The QA campaign created for this check was marked `scrubbed` directly, because the import had in
fact scrubbed it. `next_campaign_for_serving` then returned it. Nothing else was touched — the
other six campaigns are still `unscrubbed`, as found.

## A second, smaller defect found alongside

`campaign_serving_block_reason` asks `exists (... scrub_status = 'unscrubbed')`, which is true as
soon as one active campaign is unscrubbed. With the QA campaign scrubbed and serving, it still
returned:

> "This campaign has not been scrubbed against the suppression lists yet, so no leads can be served."

`next_campaign_for_serving` was returning a campaign at the same moment. The singular "This
campaign" is the tell — there is no campaign the sentence is about; it is a tenant-wide scan
wearing the grammar of a specific answer.

Fixed in `supabase/migrations/20260923110000_la_2_3_block_reason_only_when_blocked.sql`: say
nothing while anything is servable, give the partial case its own sentence, and assert that the
explanation and the serving gate cannot contradict each other. **Written, parses, not applied.**
