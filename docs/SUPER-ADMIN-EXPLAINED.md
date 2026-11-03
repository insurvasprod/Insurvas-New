# The Super Admin side, explained simply

*Written 2026-09-21, from the Notion doc "Basic Idea Super Admin Side" (Document 2), the "SA-00
Super Admin build plan", and all 45 `SA-x.y` task rows in the Insurvas Sprint database — every one
read in full.*

No insurance knowledge assumed. No billing knowledge assumed. If you have read
[`MODULE-3-EXPLAINED.md`](MODULE-3-EXPLAINED.md), that one was about **Ray, the agent who pays us**.
This one is about **us, and the machine that decides what Ray is allowed to do**.

Companion plan: [`qa/SA-VERIFICATION-PLAN.md`](qa/SA-VERIFICATION-PLAN.md) — how each of these 45
tasks gets checked, and what is actually broken today.

---

## 1. The one-sentence version

**Ray pays us money every month, and in exchange a list of switches gets turned on for him — this
half of the software is the switchboard.**

That's it. Everything else is detail.

Think of a gym. The gym has rooms: weights, pool, sauna, squash court. Your membership card opens
some doors and not others. The **Super Admin side** is the office where somebody decides which
membership tiers exist, what each one costs, which doors each one opens, who's behind on their
payment, and whether the pool is closed today for cleaning.

The gym members never see the office. But every door they push on is answering a question the
office decided.

---

## 2. Who's in the story

Here's the mistake the doc is most insistent about: **"super admin" is not one person.** It's four
different jobs, and giving all four the same all-powerful login is, in the doc's words, *how
platforms leak customer data*.

| Who | Job title in code | What they actually do all day |
|---|---|---|
| **Nadia** | `super_admin` | Owns the company. Checks how much money is coming in, who's about to quit. Can do literally everything. Logs in twice a day. |
| **Tomas** | `support_agent` | Answers "why can't I see the retention tab?" all day. Needs to *look* at accounts. **Must not** see dollar amounts or change prices. |
| **Priya** | `billing_admin` | Failed payments, refunds, the two customers who insist on paying by bank transfer. Sees money. **Does not** see customers' policy data. |
| **Devon** | `platform_config` | Maintains the shared knowledge: the product list, the form templates, which compliance vendors are switched on. Sees **no** customer data at all. |

And the rule that makes this real rather than decorative:

> **The admin UI hiding a button is not a permission.**

If Tomas hides a button but can still get the same result by typing a URL or sending a request by
hand, then Tomas has that permission, whatever the screen looks like. The check has to happen on
the server, on every single request. This exact sentence comes back three more times in the tasks.

---

## 3. Words you need (and only these)

| Word | What it means, plainly |
|---|---|
| **Tenant** | One customer account. Usually one agent. All their data walled off from everyone else's. |
| **Plan** | A package we sell. `basic` $99, `pro` $249, `advance` $449. |
| **Feature** | One switch, with a name, like `outbound_dialing`. A plan is basically a list of switches. |
| **Meter** | Something we count and can cut off. Phone minutes. DNC lookups. Refills every month. |
| **Limit** | A ceiling that does *not* refill. Number of seats. Number of carriers. |
| **Entitlement** | The answer to "what is this customer allowed to do **right now**?" Worked out from plan + add-ons + whether they've paid. |
| **Subscription** | The link between one tenant and one plan, with a status and some dates. |
| **Add-on** | An extra you buy on top of a plan, which switches on more features. |
| **Coupon** | A discount code. |
| **Dunning** | The polite, escalating nagging you do when someone's card fails, before you cut them off. |
| **Audit log** | A permanent, unchangeable list of who did what. |
| **Impersonation** | Staff looking at the app *as* a customer, to debug. Powerful and dangerous. |
| **Kill switch** | "This feature is off for everybody right now." Different from an entitlement — see §5. |
| **Whop** | The company that actually takes the money. More on this in §6, because it changed a lot. |

---

## 4. The single most important idea: two planes

If you read one thing, read this. The doc says to draw it on a whiteboard on day one.

There are **two completely separate halves** of the system:

```
┌─────────────────────────────────────────────────────────┐
│  CONTROL PLANE          "the business of the platform"  │
│  admin.insurvas.com                                     │
│  Plans · prices · features · invoices · admin users     │
│  ~tens of rows. Changes rarely. OUR STAFF only.         │
└─────────────────────────────────────────────────────────┘
              │
              │  sends DOWN:  "here's what you're allowed to do"
              │  reads UP:    "here's how many minutes they used"
              ▼
┌─────────────────────────────────────────────────────────┐
│  TENANT PLANE           "the customer's business"       │
│  app.insurvas.com                                       │
│  Leads · calls · policies · commissions                 │
│  ~millions of rows. Changes constantly. CUSTOMERS only. │
└─────────────────────────────────────────────────────────┘
```

Three things follow, and they're the reason the codebase is shaped the way it is:

**One — information flows one way.** The office sends rules down to the gym floor. Nothing on the
gym floor ever rewrites a membership price. The only thing that travels back up is usage counts.

**Two — the two halves use different front doors.** Different web address, different login,
different cookie. An admin session must never accidentally *become* a customer session. If staff
want to see the app as a customer, that's an explicit, logged, time-limited handshake — never a
shared cookie.

**Three — the word `tenant_id` means two different things.** On the control-plane tables it's just
a reference, like a customer number on an invoice. On the tenant-plane tables it **is the security
wall**. Confusing the two is how one customer ends up seeing another's commissions.

---

## 5. The four ideas that shape everything else

### Idea 1 — Build it as data, never as code

> *"If launching a new plan requires a deploy, we have built it wrong."*

Nadia should be able to invent a new plan on a Tuesday afternoon — name it, price it, tick fourteen
features, publish it — and have a customer buy it ten minutes later, with no programmer involved.

That means the list of features is a **table in the database**, not a list in the source code. Same
for plans, prices, products, email wording, and which vendors are switched on. The phrase "requires
no deploy" appears in the acceptance criteria of *eight separate tasks*. It's the house style.

### Idea 2 — "Didn't pay for it" and "it's broken right now" are different things

This one sounds pedantic and absolutely is not. Two switches can both hide a feature, for
completely different reasons:

| | **Entitlement** | **Kill switch** |
|---|---|---|
| Means | "You didn't pay for this" | "This is off for everyone right now" |
| Customer sees | An upgrade offer | Nothing, or "temporarily unavailable" |
| Scope | One customer | Everybody |
| Decided by | Their plan | Nadia, directly |

And the order matters: **kill switch is checked first.** If dialing is killed platform-wide because
the DNC vendor got hacked, it's off even for the customer on the most expensive plan. Showing them
an "upgrade to unlock" message would be a lie *and* an insult.

### Idea 3 — Suspend the doing, preserve the seeing

The rule that appears in more tasks than any other:

> **A suspended customer can always still read their own book of business.**

Ray hasn't paid. Fine — he can't make calls, can't import statements, can't start applications.
But he can still open his list of policies and see the commissions he earned over three years.

Why this matters: that data is *his life's work*. Locking him out of looking at it because his card
expired is the kind of thing a customer tells forty other agents about. Take away the doing. Never
take away the seeing.

### Idea 4 — One object is the whole contract between the two halves

The agent app is **never allowed** to look up a plan, a price, or a subscription. It reads exactly
one blob of JSON and obeys it:

```json
{
  "tenant_id": "t_8812",
  "plan_code": "pro",
  "status": "active",
  "features": ["book_of_business", "statement_ingestion", "applications"],
  "meters": { "tcpa_checks": { "included": 2000, "used": 1104, "hard_cap": true } },
  "limits": { "max_seats": 1 }
}
```

That's the **entitlement**. The doc's point: this single constraint lets the two halves be built by
two people who barely speak to each other — *which, on a team of one or two, is exactly what you
need*.

---

## 6. The plot twist: Whop

The original plan was "we'll pretend to be Stripe for now, and wire up the real thing later." Then
on **2026-08-29** a decision landed that rewrote five tasks: **Whop is the payment platform.**

Whop is an outside company that handles the money. And the consequence is bigger than it sounds:

> **Whop owns billing. We mirror it.**

Before: *we* decide Ray owes $249, *we* charge his card, *we* chase him if it fails.
After: **Whop** charges Ray, and **tells us what happened**. We react.

What that changed, concretely:

- **SA-3.5 was cancelled outright.** It was the whole nagging ladder — email on day 3, firmer email
  on day 7, suspend on day 15. Whop already does that. Building ours too would mean *two systems
  chasing the same customer on two different schedules with two sets of emails*, which is worse
  than either one alone.
- **Invoices stopped being instructions and became receipts.** We no longer say "pay this". Whop has
  already collected before we hear about it. So our invoice is born **already paid**, and its real
  job is to **double-check Whop's arithmetic against ours**. If the two disagree, that's flagged
  `mismatched` and shouted into the log.
- **We never touch a card.** Checkout happens on Whop's own page. The acceptance criterion is
  literally *"no card field exists anywhere in our codebase"* — and it was checked by searching the
  source, not just assumed.

That last one isn't squeamishness. Handling raw card numbers drags a compliance burden onto a
one-developer team that, in the doc's words, *would swallow the roadmap*.

**And it's why the adapter layer was worth building.** All the billing code talks to one interface
and never names a provider — so swapping the entire payment company cost a few files instead of a
rewrite. That's the single best architectural decision in the whole module.

---

## 7. The journey, first thing to last

Here's the actual life of a customer, start to finish, with the task that owns each step.

```
①  Stranger lands on the pricing page                        SA-5.1
        (prices read live from the database — nothing hardcoded)
②  Picks a plan, types 4 fields, creates an account          SA-5.1
③  Ticks "I agree to the terms" (never pre-ticked)           SA-5.4
④  Verifies their email                                      SA-5.1
⑤  Enters a card on WHOP's page, not ours                    SA-5.2
        → trial starts, entitlement built before they land
⑥  Uses the product for 14 free days                         SA-5.3
        (reminders on day 10 and 13, built from their own data)
⑦  Day 15: Whop charges the card                             SA-5.2
⑧  Whop tells us "payment.succeeded"                         SA-3.1
⑨  We mark the invoice paid, switch the subscription on,
   and rebuild the entitlement IMMEDIATELY                    SA-3.4
⑩  Ray works. Every dial burns a meter credit.                SA-2.5
⑪  Month 4: his card expires. Whop retries for 5 days.        SA-3.4
        → we set him to past_due: FULL access, with a banner
⑫  Whop gives up → read-only. He can still see his book.      SA-2.8
⑬  He fixes the card → full access back, no admin involved.   SA-3.4
```

Two moments in that list deserve staring at.

**Step ⑨ — "rebuild the entitlement immediately."** Not in a minute. Not on next login. The doc is
blunt: *nothing feels more broken than paying for something and not getting it for ten minutes.*

**Step ⑪ — `past_due` means full access.** This is a deliberate reversal of the obvious. A declined
card usually clears the next day. Cutting someone off on the first failure punishes them for their
bank's glitch. Read-only doesn't start until Whop has actually given up.

---

## 8. The screens

About 35–40 of them. Most are boring lists and forms. The doc is honest that only four deserve real
design time: **the plan editor, the dunning queue, the statement queue, and the entitlement
engine.** The rest is CRUD.

### The money screens (Nadia and Priya)
| Screen | What it answers |
|---|---|
| **Revenue dashboard** | Is the business working? Recurring revenue, who's leaving, where signups fall out |
| **Invoice list** | Who's been billed, who paid, and — after Whop — *where our arithmetic disagrees with theirs* |
| **Invoice detail** | Exactly what one bill was for, printable |
| **Credit notes** | Refunds and credits, with the two-person approval queue |
| **Trials in flight** | Which free trials are going to convert, and which need a phone call today |

### The customer screens (Tomas)
| Screen | What it answers |
|---|---|
| **Users list** | Everyone on the platform, searchable, with counts at the top |
| **User detail** | One person: their details, their role, their login history |
| **Subscriptions** | Who's on what plan, in what state |

### The switchboard screens (Nadia)
| Screen | What it answers |
|---|---|
| **Plan list** | Every package we sell, its price, how many people are on it |
| **Plan editor + feature picker** | **The heart of the whole system.** Tick boxes → decide what customers see |
| **Add-ons** | Extras sellable on top of any plan |
| **Coupons & offers** | Discounts, one-off or campaign-wide |

### The Configuration Center (Devon) — one hub, ten rooms
```
Configuration Center
├─ Payments             which provider, sandbox or live, keys   SA-4.2
├─ Offers & discounts   campaigns that apply themselves         SA-4.4
├─ Products             Final Expense, Term Life, …             SA-4.5
├─ Templates            starter lead fields + pipelines         SA-4.6
├─ Compliance sources   which DNC vendors are switched on       SA-4.8
├─ Credits & limits     what a top-up pack costs, who's low     SA-4.9
├─ Features             global kill switches                    SA-4.10
├─ Email                mail server, sender, wording            SA-4.11
├─ System               maintenance mode, announcements         SA-4.12
└─ Advanced             raw settings, for keys with no home     SA-4.1
```

The design rule for that hub: **adding a new room must be one route registration, with no change to
the hub itself.** Otherwise every new setting becomes a change to a shared page, and shared pages
that everyone edits are where bugs go to live.

### And the audit log
Append-only. Searchable by who, what, when. The doc's warning: *an audit log nobody can query is a
log nobody uses* — so **building the search screen is part of the job**, not a follow-up.

---

## 9. All 45 tasks in plain words

### SA-0 · Foundation — "nothing else is safe without this"

| Task | In plain words |
|---|---|
| **0.1** Admin auth + roles | Staff can log in, with a phone code (2FA) required for **everyone, including the founder**. Four roles, checked on the server. |
| **0.2** Tenant & user data model | The spine: many customers on one database, none able to see another. Which customer you are comes **from your session, never from something the browser sent**. |
| **0.3** Audit log | A permanent record of every consequential action, which **nobody can edit or delete — not even the founder**. |
| **0.4** Hardening follow-ups | Six honest loose ends noticed while building the above. Not a ticket to build — a holding pen so they aren't forgotten. |

SA-0.4 is worth a look precisely because it's a list of things somebody chose to write down rather
than quietly skip. The best one: **deactivating an admin doesn't kick them out.** Their existing
session keeps working for up to 12 hours, because the per-request check only reads the session
token and never re-asks the database whether the account is still active.

### SA-1 · User administration — five screens

| Task | In plain words |
|---|---|
| **1.1** Users list & counts | One screen, every user, searchable in seconds. Counts computed **from the database**, not from the rows currently on screen. |
| **1.2** Create user | Make an account for someone without them signing up. They get an invite link, valid 72 hours. **We never type their password.** |
| **1.3** Edit user & change role | Fix a name, change what they can do. A tenant must **always have at least one owner** — demoting the last one is blocked. |
| **1.4** User state | Four states, and the difference between two of them is the whole task. |
| **1.5** Login activity | Who logged in, when, from where. Flags an account logging in from 4+ places in a day — that's a shared password. |

**The four states, because people get these wrong:**

| State | Can log in? | Do we still bill for the seat? |
|---|---|---|
| `active` | Yes | Yes |
| `inactive` | No | **No** — they left, the seat is freed |
| `suspended` | No, and told why | **Yes** — the seat is still theirs |
| `deleted` | No | No — 7 days to change your mind, then gone |

*Inactive* is administrative: they left the company. *Suspended* is disciplinary: they're in
trouble. Same visible effect, opposite billing consequence, and support will use the wrong one
unless the screen explains it.

One more: a suspended person gets **"Your account has been suspended. Contact your administrator"**
— not a generic wrong-password error. And any state change **kills their open session immediately**,
not whenever it happens to expire.

### SA-2 · Subscriptions — the engine room

This is the deepest and most important module. Eight tasks.

| Task | In plain words |
|---|---|
| **2.1** Feature catalog | The master list of every switch — 28 of them, in 9 groups. A table, so adding one needs no deploy. |
| **2.2** Plan CRUD | Create plans without a programmer. **Versioned:** raise the price and existing customers keep the old one until you move them. |
| **2.3** Feature picker | **"One page. The super admin ticks boxes. Those ticks decide exactly what the agent sees."** |
| **2.4** Pricing | Monthly / quarterly / yearly. USD only. **Always whole cents, never decimals.** |
| **2.5** Limits & credits | Seats and carriers (ceilings). Minutes and lookups (refill monthly). Warn at 80%, block at 100%. |
| **2.6** Add-ons | Sell an extra without inventing a whole new plan. Feeds the same entitlement — **no second system**. |
| **2.7** Assign / change / cancel | Put a customer on a plan. Upgrade applies **now**; downgrade waits for period end. |
| **2.8** Entitlement engine | **"The single most important task in the build."** |

Three details from this module that are better than they look:

**Grandfathering (2.2).** Raise the Advance price and it becomes version 4; the 88 people on
version 3 stay there. If you skip this, *the first price change breaks trust with every existing
customer at once.*

**The preview panel (2.3).** Next to the checkboxes, a live picture of the menu the agent will
actually get. It exists to catch **"I forgot to tick Applications and now nobody can sell"** before
it ships. And the criterion has teeth: *the preview must match what the agent sees, exactly.*

**Idempotency keys on usage (2.5).** Fancy word, simple idea: if the same "Ray used 4 minutes"
message arrives twice, count it once. And **never delete a usage event** — corrections are new
negative events, because the events are the evidence in a billing dispute.

**Three enforcement points (2.8), and only one of them is real:**

| Where | If you skip it |
|---|---|
| 1. Hide the menu item | Cosmetic only |
| 2. Block the URL | User pastes a link, sees a broken page |
| 3. **Reject it on the server** | **Security hole.** Dev tools gets you free features. |

The doc says it plainly for whoever builds it: *hiding a menu item is not security. The API check is
the only real one.*

### SA-3 · Billing — nine tasks, one cancelled

| Task | In plain words |
|---|---|
| **3.1** Payment adapter | One interface, so the payment company can be swapped without touching billing. **This is what made the Whop switch cheap.** |
| **3.2** Invoice generation | Turn a payment into a receipt with correct lines. Numbered with **no gaps, ever**. |
| **3.3** Invoice screens | See who's been billed; open any one bill. |
| **3.4** Payment → auto-activate | **The most important ticket in SA-3.** Whop says "paid" → subscription on, entitlement rebuilt, no human involved. |
| ~~**3.5** Dunning ladder~~ | **Cancelled.** Whop already nags people. Two systems nagging is worse than one. |
| **3.6** Coupons | Discounts that stop themselves after N periods. |
| **3.7** Manual invoice | Bill someone an arbitrary amount — the two customers who pay by bank transfer. |
| **3.8** Refunds & credit notes | Give money back. **Over $500 needs two people.** |
| **3.9** Revenue dashboard | Is the business working? |

**Why invoice numbers have no gaps, and why that ruled out the obvious tool.** Postgres has a
counter built in (`SEQUENCE`) and it's deliberately *outside* transactions — so a failed invoice
burns its number and leaves a hole. An auditor reads a hole as **concealment**. So the counter is a
row updated inside the invoice's own transaction; if the invoice rolls back, so does its number.
Someone tested this with a deliberately failing invoice, which is the part that makes it true.

**"Immutability is a privilege, not a convention."** You can't edit an issued invoice — not because
the code politely declines, but because the database has the permission **revoked**. Corrections are
credit notes. That's an accounting rule, not a preference.

**The $500 rule, and a conflict somebody noticed.** The spec said "over $500, `super_admin`". It
*also* said "the requester can never approve their own". Those contradict: a `super_admin`
requesting $600 would be approving their own. Resolved as **over $500 always needs two people,
whatever your role** — because the other reading lets a single stolen founder login empty the bank
account, which is the exact thing the rule exists to stop. It's enforced twice: in the route *and*
as a database constraint, so no code path can route around it.

**What SA-3.9 found the moment it first rendered.** This is the best argument for dashboards in the
whole document. The screen went live and immediately revealed two real problems:
- Payments weren't being recorded at all — **$447 had been collected and the `payments` table was
  empty**, because the recording line sat after an early exit for "tenant has no subscription".
- **A customer who bought through Whop got no subscription on our side.** So: revenue $0, active
  customers 0, no plan breakdown — and the entitlement engine had nothing to resolve, meaning
  *a paying customer would have got no features*.

And the screen said so, in words, instead of showing a healthy-looking zero. That's the correct
behaviour and it's worth copying: **a dashboard that can't measure something must say it can't,
not print 0.**

### SA-4 · Configuration — twelve tasks

| Task | In plain words |
|---|---|
| **4.1** Settings store | One typed place for platform settings, so no number is buried in code. |
| **4.2** Payment provider screen | Sandbox or live, keys, "test connection". Switching is **a key and a URL, never a deploy**. |
| **4.3** Configuration Center hub | The shell the other nine plug into. |
| **4.4** Offers | Campaigns that apply themselves to whoever qualifies. |
| **4.5** Product catalog | Final Expense, Term Life, Whole Life, IUL, Medicare Advantage, Annuity. |
| **4.6** Product templates | Build "Term Life — standard" **once**: its lead fields, its pipeline stages, its form. |
| **4.7** Agent picks a template | The agent chooses one and gets a working workspace instead of an empty one. |
| **4.8** Compliance vendors | Which DNC checkers exist and which are on. |
| **4.9** Credit packs & usage monitor | What a top-up costs, who's about to run out. |
| **4.10** Kill switches | Turn any feature off for everyone, in one click. |
| **4.11** Email configuration | Where email comes from and what it says — **editable without a deploy**. |
| **4.12** Maintenance mode | Put the platform read-only for a deploy without anyone losing work. |

**Templates are copied, not linked (4.6 / 4.7).** When Ray applies "Term Life — standard", he gets
**his own editable copy**. He renames a stage; nothing happens to the platform template or to any
other agent. The alternative — a live link — means one edit by Devon silently rearranges 300
agents' pipelines.

**The rule in 4.8 that does not bend:**

> If **every** DNC vendor is off or unreachable, outbound dialing is **blocked** platform-wide, and
> the agent is told why.

Because calling a Do-Not-Call number costs **$500–$1,500 per call**. There is no business reason and
no customer request that justifies letting one dial through unchecked. And turning off the last
vendor must show a confirmation that **names that consequence** — not a generic "are you sure?".

**The margin indicator in 4.9** is a small idea worth stealing: the screen shows what a lookup costs
us next to what we charge, and **turns red if you're selling below cost**. You cannot mis-price by
accident if the screen won't let you do it quietly.

**Maintenance mode has three levels (4.12)**, not one: banner only · read-only · locked. And
read-only must return **a clear human message on a write, not a 500**. Admin sessions bypass all
three, so the platform can be checked while it's locked.

### SA-5 · How customers actually arrive — four tasks

| Task | In plain words |
|---|---|
| **5.1** Pricing page & signup | A stranger can sign up with **nobody at Insurvas involved**. Four fields, no more. |
| **5.2** Hosted checkout | Card entered on Whop's page. **No card field exists in our code.** |
| **5.3** Trial management | See every trial, spot the ones that won't convert, step in. |
| **5.4** Terms acceptance | Which version of the terms each person agreed to, and when. |

**Business questions come *after* verification, not before (5.1).** Name, email, password, phone —
that's the signup form. NPN, states, products, volume all get asked after they've verified their
email and are already invested. Asking nine questions up front loses people who would have paid.

**"Half of all 'I didn't get the email' tickets are typos."** So the verification screen shows the
address back to them, with a resend button. One sentence of product thinking that saves a support
queue.

**A record stores a version, never a boolean (5.4).** If you record "accepted the terms" and look up
the current version when reading, then publishing v2 **silently re-dates every historical
acceptance** — which is the exact failure the table exists to prevent. This one is subtle, and
someone caught it.

**And a deliberate escape hatch.** Publishing new terms interrupts every customer until they accept.
So there's one function that can **only remove** that interruption — never change text, never delete
a record — because without it, a mistaken publish locks every paying customer out with no recovery
short of editing the database by hand. It needs a written reason and it's logged.

**The trial reminders are built backwards, on purpose (5.3).** Reminders are offsets from the trial's
**end**, not its start. That makes "extending a trial pushes the charge date *and every reminder*"
true **by construction** rather than by somebody remembering to move them all.

### SA-6 · Ops & safety — three tasks, all still `Planned`

| Task | In plain words |
|---|---|
| **6.1** Job monitor | The money moves through scheduled jobs. **Somebody must be told when one dies.** |
| **6.2** Rate limiting | Stop a script hammering the login page. |
| **6.3** Data export & deletion | One button gives a customer everything they own; another removes it. |

**SA-6.1 contains the best single insight in the module:**

> Alert when a job **fails** — and equally when a job **did not run at all**.
>
> *A job that silently stops being scheduled looks identical to a healthy one if you only watch for
> errors.*

No errors, no alerts, no invoices, and nobody finds out for a month. That's why a High-priority
task sits last in the plan — and the SA-00 plan itself flags that as *the one resequencing worth
arguing about*, since SA-6.1 guards work that goes live six weeks earlier.

**SA-6.2's quietest requirement is a timing one.** "Invalid email or password" for both a wrong
password *and* an email that doesn't exist — **and the same response time for both**. If the real
account takes 200ms and the fake one takes 20ms, you've just built an email-address checker for
whoever's measuring.

**SA-6.3 says the honest thing about deletion.** Invoices and payments are **anonymised, not
purged** — names replaced, records kept — because tax law outranks a deletion request. And the
customer *should be told that plainly* rather than promised total erasure. A deletion certificate
names exactly what was kept and why.

---

## 10. Rules that never bend

Collected from the locked decisions and the acceptance criteria. Break any of these and something
real breaks.

1. **Hiding a button is not a permission.** The server check is the only one that counts.
2. **Suspension never removes read access to your own book of business.**
3. **Money is integer cents.** Never floats. Never decimals.
4. **Issued invoices are immutable.** Corrections are credit notes.
5. **Invoice numbers are sequential with no gaps** — a gap reads as concealment.
6. **Refunds over $500 need two people, and the requester can never be one of them.**
7. **No card number, CVV or expiry ever reaches our servers, logs or database.**
8. **2FA is mandatory for every admin account, including the founder.**
9. **If every DNC vendor is off, dialing is blocked.** No exceptions.
10. **Kill switches are evaluated before entitlements.**
11. **Templates are copied, not linked.**
12. **The audit log cannot be edited or deleted by anyone**, including `super_admin`.
13. **The entitlement is rebuilt before the API call returns** — not eventually.
14. **Tenant scope comes from the session, never from a request parameter.**
15. **Login must not reveal whether an email exists** — same message, same timing.
16. **Adding a plan, a price, a product, a feature or an email's wording requires no deploy.**

---

## 11. What they deliberately decided *not* to build

This list matters as much as the features, because each line is a cost somebody chose to accept with
their eyes open.

| Not built | What it costs you |
|---|---|
| **Impersonation** | Support debugs from the customer's *description* only. Expect slow resolution on "my screen looks wrong". |
| **Tenant detail screen + health score** | No single account view, and **no early warning that a customer is about to quit**. The user list is the only lens. |
| **Seat enforcement** | `max_seats` exists and nothing checks it. Adding users neither bills nor blocks. |
| **Support notes** | Customer context lives in people's heads and inboxes. They repeat their story four times. |
| **Sales tax** | Fine until there's real revenue in a taxing state. **Don't hand-roll it** — use a tax service. |
| **Multi-currency** | USD only. |
| **Tenant API keys & webhooks** | No programmatic publisher integration. |
| **Statement processing queue** | The doc calls this *"the highest-volume support issue in the product, guaranteed"* — and it's out of phase. |

The two I'd argue about: **the health score** (it's the difference between phoning a customer before
they leave and reading about it afterwards) and **the statement queue** (the doc predicts it will be
the biggest support burden, and there's no tool for it).

---

## 12. Still undecided

From the doc's own open-questions list, plus what the tasks left open:

1. **One database with two schemas, or two databases?** Leaning: one database, `control.` and `app.`
   schemas. *Splitting later is easier than merging later.*
2. **Does impersonation need customer consent** for read-only, or only for write?
3. **Sales tax** — which service, and which states do we register in?
4. **Data retention after cancellation** — 12 months proposed. Needs a lawyer.
5. **Is the partner portal a third plane, or a restricted tenant role?** Bigger than it looks.
6. **Meter allowances per plan.** How many minutes and lookups do `basic` / `pro` / `advance`
   include? **Nothing pins this anywhere, and enforcement reads it.** Prices were left blank for the
   same reason and have since been decided; this one hasn't.
7. **The seeded Terms and Privacy Policy are a draft** and say so. Two sections read "to be
   determined by counsel". Replacing them is a publish, not a code change.
8. **Does `payment.failed` fire on every Whop retry, or once?** The handler is safe either way, but
   the docs don't say and the sandbox hasn't been asked.

---

## 13. The build order, and the one argument in it

```
WEEK  1-2   Admin login · tenant model · audit log · settings store · config hub
WEEK  3-4   The five user-management screens                       ══ M1 ships ══
WEEK  5-8   Features → plans → picker → prices → limits → subs → add-ons
            → ENTITLEMENT ENGINE                                   ══ M2 ships ══
WEEK  9-12  Payment adapter → invoices → screens → record payment
            → coupons → manual invoices                            ══ M3 ships ══
WEEK 13-16  Products → templates → compliance vendors → credits
            → kill switches → email → offers → maintenance         ══ M4 ships ══
WEEK 17-20  Pricing page → terms → checkout → trials → refunds
            → revenue dashboard                                    ══ M5 ships ══
WEEK 21-22  Job monitor → data export → rate limiting              ══ M6 ships ══
```

**Two plans on day one, not four.** *"Four plans means four support burdens, three untested price
points and a pricing page nobody can read."* Add the third when there's something in it worth
paying more for.

**And the resequencing worth arguing about:** SA-6.1, the job monitor, sits in week 21 and guards
work that goes live in week 12. Invoicing runs on a schedule. If it dies quietly, nobody is billed
and nobody notices for a month. It belongs next to SA-3.2.

---

## 14. The gates — how you know a module is actually done

A gate is an **observable outcome**, not a shipped screen. That distinction is the whole point.

| Gate | What must be true |
|---|---|
| **1** after M1 | Two customers on one database. From A's session, **every** route returns nothing for B's data — proven by a test that runs automatically. A suspended user can't log in and is told why. |
| **2** after M2 | Nadia invents a new plan, ticks a different set of boxes, assigns a customer — and that customer sees exactly those modules, **with no deploy**. A hand-crafted request to a route outside their plan returns 403. |
| **3** after M3 | A test customer misses a payment, walks the whole ladder, gets suspended, **can still read their book**, then pays — and regains full access **with no admin action**. |
| **4** after M4 | Devon builds a Term Life template; a brand-new agent picks it and lands in a configured workspace. Separately, disabling the last DNC vendor blocks dialing platform-wide **with a message that says why**. |
| **5** after M5 | A stranger goes from pricing page to working product **with nobody at Insurvas touching anything**. On day 15 the card is charged. |
| **6** after M6 | Killing the invoice job alerts within five minutes. **Preventing it from being scheduled at all also alerts.** A full export downloads and re-imports cleanly. |

Notice how many of them say "with no deploy", "with no admin action", "with nobody touching
anything". That's the theme: **the platform has to run itself**, because there's one person running
it.

---

## 15. The five ways this goes wrong

Straight from the doc, because it's unusually candid.

1. **The entitlement engine becomes a tangle.** Feature keys checked four ways, menus hardcoded,
   plan logic sprinkled everywhere. *Fix:* one catalog, one `requireFeature()`, one menu as data,
   and a check that fails the build if a feature key is never referenced.
2. **Billing and reality drift apart.** Our database says active, the provider says cancelled.
   *Fix:* the provider wins, reconcile nightly, alert on mismatch. **Do not let a customer be the
   one who discovers it.**
3. **Support can't help without seeing money.** Then either support is useless or everyone gets full
   access. *Fix:* design support screens around **what actually gets asked** — none of which needs
   dollar amounts.
4. **Configuration becomes a second product.** The carrier library and form templates are a real
   ongoing job. *Fix:* budget a part-time insurance person from month one. **This is a staffing
   decision, not an engineering one**, and pretending otherwise means it silently lands on an
   engineer who can't do it.
5. **Impersonation gets abused — or just looks like it might have been.** One unexplained access
   destroys trust in a business built on someone's commission data. *Fix:* every safeguard, and
   especially **show the customer their own access log**.

---

## 16. If you remember only six things

1. **Two planes.** The office and the gym floor. Information flows down; only usage counts flow
   back up. Get this wrong and it's expensive to undo.
2. **One JSON object is the whole contract.** The agent app reads the entitlement and obeys it. It
   never asks about plans or prices.
3. **Hiding a button is not security.** Only the server check counts. It's said four times because
   it gets skipped.
4. **Suspend the doing, preserve the seeing.** Never lock someone out of looking at their own work.
5. **Build it as data.** If launching a plan needs a programmer, it's built wrong. Eight separate
   tasks say "no deploy".
6. **Alert on the job that didn't run**, not just the one that failed. Silence and health look
   identical if you only watch for errors.
