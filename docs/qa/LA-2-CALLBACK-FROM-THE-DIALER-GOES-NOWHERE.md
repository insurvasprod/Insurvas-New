# A callback scheduled from the dialer is never scheduled

**Found 2026-09-23**, while confirming that `callback_scheduled` routes to its dedicated pipeline.
It does. The lead then disappears.

## What happens

An agent on the dialer presses **callback scheduled**. The UI is a plain button — one of seven —
and it posts `{ disposition: "callback_scheduled" }` to
`/api/app/dialer/attempt/{id}/disposition`. There is no time picker and no time in the payload.

The call history table then shows, under **Next step**:

> Callback scheduled

Nothing backs that up. Measured on the live project immediately after doing it to a Texas lead:

```
tenant_callbacks on this tenant:                   0
a callback for that lead:                          NONE
her work item:        status=completed  disposition=callback_scheduled
her lead:             lead_state=working  next_dial_after=null
```

## Why the lead is then unreachable

`serve_next_lead` has six tiers. The lead qualifies for none of them:

| Tier | Requires | Lead has |
|---|---|---|
| 2 callback | a `tenant_callbacks` row, and `lead_queue.status = 'unclaimed'` | no callback row, status `completed` |
| 4 retry | `lead_state = 'retry'` and a due `next_dial_after` | state `working`, timer null |
| 5 fresh | `lead_state = 'fresh'` | state `working` |
| 6 nurture | `lead_state = 'nurture'` and a due timer | state `working`, timer null |

And the Callbacks screen reads `tenant_callbacks`, which has no row for it. So the lead is on no
queue, no board and no screen. It is not lost data — the lead record is intact and searchable —
but nothing will ever surface it again on its own.

## The two paths differ

| | creates a callback? |
|---|---|
| `complete_disposition_with_callback` — the **wizard**, from the lead workspace | **yes**: takes `p_callback_local`, `p_customer_timezone`, `p_assigned_to`, validates the time is in the future and the timezone is real, then inserts `tenant_callbacks` + `callback_history` + an audit row |
| `complete_existing_dial_disposition` — the **dialer** | **no**: sets `lead_state = 'working'`, completes the work item, and stops |

The dialer's endpoint cannot create one even in principle — it accepts no time, and
`tenant_callbacks.scheduled_at_utc` is not nullable. The missing piece is the input, not the write.

## A separate finding: tier 2 can never fire

Worth recording because it looks like the safety net and is not.

Tier 2 requires `lead_queue.status = 'unclaimed'`. The wizard sets that status from the
disposition's own `closes_as`, and the column is `check (closes_as in ('completed', 'dropped'))` —
`'unclaimed'` is not a permitted value. Measured across all eight dispositions on this tenant:

```
application_submitted  completed     did_not_qualify   completed
call_dropped           dropped       do_not_call       completed
callback_scheduled     completed     no_payment_method completed
not_interested         completed     sent_to_underwriting completed

any disposition that leaves the work item 'unclaimed':  NONE
```

So no dispositioned work item is ever `unclaimed`, and tier 2 is unreachable on **every** path,
including the wizard's. That is not a bug in itself: the Callbacks screen is the working surface,
offering reschedule, cancel, complete, a `tel:` link and "Open lead". Callbacks are not meant to
come back through the dialer queue. But tier 2 reads as though they are, and anyone reasoning about
the queue from that code will be wrong.

## Options, and this needs a decision

1. **Give the dialer a callback time.** The disposition endpoint takes `callback_local` and
   `customer_timezone` when the disposition is `callback_scheduled`, and routes to the existing
   `complete_disposition_with_callback` instead of the dialer's own function. The UI needs a time
   picker. Most faithful to what the button already claims, and it reuses validation that exists.

2. **Refuse it without a time.** The endpoint rejects `callback_scheduled` unless a time is
   supplied. Smallest change, and it stops the silent loss immediately, but the button breaks until
   the UI catches up.

3. **Take the button off the dialer.** Callbacks are booked from the lead workspace wizard, which
   already works. Honest, and the least work, but it moves the agent off the dialer mid-call.

Option 1 is what the screen already promises. Option 2 is what should happen first either way,
because today the failure is silent.

## Not addressed here

Whether tier 2 should be removed or made reachable. It is dead rather than wrong, and changing the
serving query is a bigger decision than this finding needs.
