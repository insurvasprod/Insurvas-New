# Settings defaults

Owner, 2026-11-03: "create something that is a default setting rather than to have an agent or
agency going and setting up hundreds things at a time."

This page has three parts: what a brand-new agency gets today in each Settings area (§1), the
proposed defaults and the one mechanism behind them (§2), and the owner's pick (§3, still open).

The inventory was taken from the code and read-only from the live database on 2026-11-03. Paths are
relative to the repo root.

---

## 1. Inventory: what a new agency gets today

### How an agency is created

- Self-serve sign-up (`app/api/public/signup/route.ts`) calls `self_serve_signup_with_auth`. The
  admin console calls `admin_create_tenant_with_billing`. Neither function seeds any settings.
- All seeding happens in two AFTER INSERT triggers on `tenants`:
  - `seed_dispositions_after_tenant_insert` (8 outcomes, their flows, 6 dialer outcomes);
  - `tenants_seed_pipelines`, which builds the "Sales pipeline" (`seed_general_pipeline`).
- **Plan type** is `plans.plan_type`: `individual`, `agency_no_teams`, `agency_with_teams`, or
  `management` (the IMO/FMO product).
- **Line of business** has no column. The only traces are `products.category` (life, health,
  retirement) and the sign-up answer `business_profiles.products_sold`. That answer uses its own
  words (life, health, medicare, annuities, property_casualty, supplemental) and nothing reads it
  except the setup-step recommender.

### Area by area

| Area | What a new agency gets | Stored in | Page when the agency has nothing of its own | Default concept today | Way back to the default today |
|---|---|---|---|---|---|
| Pipelines & outcomes | **Seeded rows** at tenant insert: "Sales pipeline" (10 stages), 14 dispositions, 14 outcome → stage rows | `tenant_pipelines`, `tenant_pipeline_stages`, `dispositions`, `pipeline_disposition_stages` | Never empty for a new agency | Same-name default + resolver ladder (`resolve_disposition_stage`) | Per outcome "↺ Default" only |
| Underwriting templates | **Platform rows**: Final Expense and Term Life (v1, published) | `sales_templates` kind `underwriting`, `tenant_id null` = platform | Platform row with a "Platform default" chip, "(Insurvas default)" on In use now, "Make it yours" | Yes: own → platform → FE fallback (`pickTemplate`) | Retire own version (the dialog says the Insurvas default returns) |
| Quotation templates | **Platform row**: Final Expense only | `sales_templates` kind `quotation` | Grid squares "On the default", "Insurvas vN", "Copy to my agency" | Yes: `pickQuotationTemplate` (same product → carrier → own → newest), FE fallback | Retire own version |
| Application field sets | **Platform row**: Final Expense only (13 required, 10 optional) | `sales_templates` kind `application_field_set` | "On the platform set" group; first edit copies it to a draft | Yes: `fieldSetFor` ladder, platform FE last | **"Go back to the platform set"** (`backToPlatform`) |
| Disclosures | **Platform rows**: REPLACEMENT_NOTICE, 1035_EXCHANGE (with rules) | `application_disclosures` (+ `_rules`), `tenant_id null` = platform | "Platform default" chip, "Insurvas vN in use", "Copy to my agency" | Yes: own code replaces platform code (`refreshDisclosures`) | Retire or delete own version |
| (call-script disclosures) | 51 states × `term_life` **placeholder** text, marked NOT COMPLIANCE-APPROVED, seeded by hand 2026-09-23 | `state_disclosures` (no tenant column; staff edit at /admin/state-disclosures) | Not a tenant setting | Platform-only | n/a |
| Quote & QA rules | **Code constants** `DEFAULT_SALES_SETTINGS` (band 0.5–15 per $1,000, buffer 3 days, ageing 5 days, welcome pack on, appointment check warns) | `tenant_sales_settings` (one jsonb row) | Every field shows the constant; hints say "Insurvas default X" | Yes: `resolveSalesSettings` fills each missing key | **"Use Insurvas defaults"** (draft only; Save writes the row) |
| Application stages | **Nothing.** No rows; the page pre-fills by stage name in the browser only | `tenant_application_stage_map` | Name-matched draft; unmatched states say "Doesn't move the card" | **None at runtime**: no row = the card never moves | None (Fill in → match names / clear) |
| Form templates | **Lazy copy**: the first read for a product copies the platform template (`templates.is_default`, else newest) into the agency | `templates` (platform) → `tenant_templates` + fields/stages/forms | "No form is set up yet … Ask Insurvas support" when no platform template exists | Yes: platform template per product (Term Life, Final Expense exist) | Per-question reset only |
| Lead posting | **Nothing**, and nothing can be seeded: a key needs a vendor and its secret is shown once | `tenant_vendor_post_keys` | "No vendors yet" / "No posting keys yet" + Connect | None | n/a |
| Dialing cadence | **Code + SQL constants**: waits 2 h, 1 d, 1 d, 2 d (weekend slot), 3 d, then 5 d; 7 attempts | `tenant_cadence_rules`, `tenant_cadence_limits` | "In force: Built-in", "Start from the built-in cadence" | Yes: `schedule_next_attempt` built-in ladder, TS twin `DEFAULT_CADENCE` | **"Clear and use the built-in cadence"** |
| Calling windows | **Platform rules** only: federal 08:00–21:00 lead-local, state rules, holidays | `tenant_calling_windows`, `tenant_calling_window_options`; platform `calling_window_state_rules` | "Empty: only the federal and state limits apply" | Yes: the federal + state floor; the agency can only narrow | **"Clear my narrowing"** |
| Products | **Nothing switched on.** No `tenant_products` rows; a missing row is off | `tenant_products` ∩ `plan_product_access` | Every product listed, switch off; other pages say "No product lines switched on" | None | n/a |

### What this means for a new agency

Most areas already work with no setup, because they fall back to an Insurvas-wide value. Five gaps
stop a new agency working:

1. **Products: nothing is sold.** `assertSoldProduct` refuses new leads, campaigns and deals until
   the owner switches a product on. Every product picker is empty. This blocks everything else.
2. **Application stages: cards never move.** With no map, a lead's card stays where it is as its
   application goes from quoted to issued. The Sales pipeline also has no Quoted, Application
   started, Pending requirements, Issued or Lost stage, so name matching finds only Submitted.
3. **Only Final Expense and Term Life have Insurvas templates.** Whole Life, IUL, Medicare
   Advantage and Annuity fall back to the *Final Expense* health questions, quote inputs and field
   set. That is wrong for a health or annuity agency.
4. **Call-script disclosures exist only for Term Life, and are placeholder text.** A Final Expense
   lead has no script for its state. That is a compliance question, not a defaults question (see
   §2.4).
5. **No page says, in one consistent way, which values are Insurvas defaults.** Each page has its
   own wording ("Platform default", "Insurvas default", "Built-in", "On the default", "Empty: only
   the federal and state limits apply"), and the way back is different on every page or missing.

---

## 2. Proposal

### 2.1 One mechanism: Insurvas defaults that apply until the agency changes them

**Recommended.** Every area reads its value through a fallback: the agency's own value if it has
one, otherwise the Insurvas default. The default is not copied into the agency. "Reset to default"
removes or retires the agency's own value, so the Insurvas default applies again.

Why this one:

- **The codebase already does it in 9 of the 12 areas.** Templates, field sets, disclosures, QA
  rules, cadence, calling windows and form templates all resolve own → platform already. Three
  pages already have a way back: field sets ("Go back to the platform set"), cadence ("Clear and use
  the built-in cadence") and calling windows ("Clear my narrowing").
- **Insurvas can improve a default for everyone.** When the platform Term Life questions change, an
  agency that never edited them gets the new version. With a seed at sign-up, all 611 agencies would
  hold a frozen copy and need a backfill every time.
- **Existing agencies keep what they have.** Their own rows already win over the default, so
  nothing changes for them.
- **Reset is cheap and safe.** It retires or removes the agency's own row. Retired versions stay,
  because applications keep the wording and questions they were given.

**Two areas cannot follow this rule and keep seeded rows:**

- **Pipelines & outcomes** must be real rows, because leads point at stage ids. These are already
  seeded at tenant insert. Reset here is narrower (§2.3).
- **Products** are a choice the agency must own. The proposal is a one-time switch-on at sign-up
  from the sign-up answer, with no reset (§2.3).

**The alternative**, a one-time seed at sign-up plus a "Reset to default" that re-copies, is what
Pipelines already does. It is not recommended for the rest: it needs a backfill for 611 agencies and
it freezes every agency on today's wording.

### 2.2 How a default is shown on every page

One shared piece, used the same way on every page, with no notice card (owner rule 2026-11-02):

- **An "Insurvas default" chip** (`StatusChip` tone `info`) beside a value, row or template that is
  the default. The current wording varies by page ("Platform default", "Built-in", "On the
  default"); all become "Insurvas default". Where a whole page is on defaults, the chip sits once on
  the title line.
- **"Reset to default"** is one action in the page's ⋯ menu (or the title line where the page has
  no menu). It is shown only when the agency has changed something. It opens the standard
  `ConfirmDialog`, which names what goes back and says the agency's old versions are kept.
- **Defaults that need legal review** carry a second chip, "Needs review" (tone `warning`), with an
  (i) that says "Insurvas wording, not legal advice. Have your compliance lead or counsel approve it
  before you use it on calls." It applies to disclosures, calling windows and any script text.

The chip and the reset action go into one shared component (`components/app/settings/defaults.tsx`:
`DefaultChip`, `ResetToDefault`), so every page says it the same way.

### 2.3 The default for each area

| Area | Default | Why it is a sensible start for a US life/health agency | Reset to default |
|---|---|---|---|
| **Products** | At sign-up, switch on the products the agency said it sells, within its plan: life → Final Expense + Term Life; health or medicare → Medicare Advantage; annuities → Annuity. If the answer is missing or matches nothing in the plan, switch on Final Expense + Term Life. | These are the two products Insurvas has complete templates for, and the most common telesales life products. | None. It is the agency's choice; the page marks the switched-on products "From sign-up" until the owner changes one. |
| **Pipelines & outcomes** | Today's seed: the Sales pipeline, 10 stages, 14 outcomes and where each goes. **Add 4 stages** so the application states have somewhere to land: Quoted (open), Application started (open), Pending requirements (open), Issued (won), Lost (lost). | It already matches the dialer's outcomes; the added stages let application progress move cards with no setup. | "Reset outcome routing": removes the pipeline's own outcome rows, so the same-name default applies. Stages and leads are never deleted. |
| **Application stages** | A runtime default: when a pipeline has no map, a state moves the card to the stage with its default name (Quoted, Application started, Submitted, Pending requirements, Issued, Lost). This is the page's existing name match, moved to the server. | The STATUS-MODEL names are the same ones the pipeline seed will carry, so a new agency's cards follow applications on day one. | Removes the pipeline's saved map, so the name match applies again. |
| **Underwriting templates** | Today's Insurvas FE and Term Life templates. **Add** Whole Life, IUL, Medicare Advantage and Annuity platform templates, so no line falls back to Final Expense questions. | Each line gets questions written for it. The Medicare and annuity ones are suitability-heavy and need review. | Retire the agency's own published versions for that product, so the Insurvas one is in use again. Existing per-carrier copies are kept unless the owner picks them. |
| **Quotation templates** | Today's FE template. **Add** Term Life (face amount, term length, tobacco, health class), Whole Life, IUL, Medicare Advantage, Annuity. | The Quote step asks what each line actually needs instead of FE's inputs. | Retire the agency's own versions for that square. |
| **Application field sets** | Today's FE set. **Add** Term Life, Whole Life, IUL, Medicare Advantage and Annuity general sets. | Carriers ask for broadly the same items within a line; one general set per line covers a new agency. | Already exists ("Go back to the platform set"); renamed "Reset to default" for consistency. |
| **Disclosures** | Today's two Insurvas documents (Replacement notice, 1035 exchange). **Add**, as drafts marked Needs review, a Medicare Advantage TPMO disclaimer and an annuity suitability acknowledgement. | Replacement is the most common life disclosure; Medicare and annuity sales have their own required notices. | Retire the agency's own version of that code, so the Insurvas version applies. |
| **Quote & QA rules** | Today's constants. No change. | Already reasonable and already resolved per key. | Already exists ("Use Insurvas defaults"); renamed and given the confirm. Reset deletes the saved row instead of saving the constants, so future default changes reach the agency. |
| **Form templates** | Today's lazy copy of the platform template. **Fix the quirk** where an agency with nothing switched on gets Term Life applied. | Already works; the Products default (above) makes the quirk rare. | "Reset to default": re-apply the current Insurvas template for the product over the agency's copy, after a confirm. Leads already captured keep their data. |
| **Lead posting** | None. A key needs a vendor and its secret is shown once. The page keeps its "Connect a vendor" empty state. | Nothing sensible can be pre-made. | None. |
| **Dialing cadence** | Today's built-in ladder (2 h, 1 d, 1 d, 2 d, 3 d, then 5 d; 7 attempts). No change. | Spreads 7 attempts over two weeks, within common carrier and state expectations. | Already exists; renamed "Reset to default". |
| **Calling windows** | Today's federal 08:00–21:00 (lead-local) and state rules. **Add** an agency default of **09:00–20:00 lead-local, no Sundays, no federal holidays**, marked Needs review. | Narrower than the federal limit on both ends, which keeps clear of stricter state "mini-TCPA" rules. Dialing stays inside the state rules either way. | Already exists ("Clear my narrowing"); renamed. Reset goes back to the Insurvas default narrowing, not to "no narrowing". |

### 2.4 How plan type and product line change the defaults

- **Product line (from the Products default)** decides which templates, field sets, quotation
  templates and disclosures the agency sees. These are already per product, so no extra rule is
  needed. A health or Medicare agency gets the Medicare Advantage set; a life agency gets FE and
  Term.
- **Plan type** changes very little, because settings are agency-wide:
  - **Individual (solo):** same defaults. Team pages are already hidden in solo mode.
  - **Agency (with or without teams):** same defaults.
  - **IMO/FMO (`management`):** same defaults. Products follow `plan_product_access`, so an IMO plan
    with more products switches on what was asked for within it.
- **Plan products** cap everything: a default never switches on a product the plan does not
  include.

### 2.5 Compliance-sensitive text (needs the owner's or counsel's review)

None of the following is legal advice, and none of it ships as final:

- the Medicare Advantage TPMO disclaimer and the annuity suitability acknowledgement (new);
- the call-script disclosures in `state_disclosures`, which are still the 2026-09-23 placeholder and
  exist only for Term Life. **Not changed by this work.** Insurvas staff own them at
  /admin/state-disclosures, and they must be replaced before telephony goes live;
- the 09:00–20:00 calling window default.

Each carries the "Needs review" chip, and the new disclosure documents are seeded as **drafts**, not
published, so nothing reaches an application until someone at Insurvas publishes them.

### 2.6 What it takes

- **Migration files (written, not applied; the owner pastes them):**
  - new platform rows in `sales_templates` (underwriting, quotation, field sets for 4–5 lines) and
    in `application_disclosures` (2 drafts);
  - the 5 extra stages in `seed_general_pipeline`, for new agencies only. Existing agencies are
    not touched, because their stage list is theirs;
  - Products switch-on at sign-up, read from `business_profiles.products_sold` once the profile is
    saved;
  - the calling-window default as a platform setting read when the agency has no row.
- **Code:** the shared `DefaultChip` + `ResetToDefault`, each page wired to them, a server-side
  name-match fallback for Application stages, and the form-template quirk fix.
- **Not touched:** Accounting, Retention and Compliance settings (a sibling session owns them).

---

## 3. Owner's pick

Picked by the owner on 2026-11-03:

1. **Mechanism: Insurvas defaults that apply until the agency changes them** (recommended). Reset
   retires or removes the agency's own value.
2. **Products: from the sign-up answer.** First picked "leave them off", then changed the same day:
   "whatever they select on sign up, they will be automatically added", for agencies and individual
   agents. Life → every life product (Final Expense, Term, Whole Life, IUL); health or medicare →
   Medicare Advantage; annuities → Annuity; within the plan. Property & casualty and supplemental
   have no catalogue product, so they switch nothing on. No answer → nothing (no FE + Term fallback).
3. **Templates for every catalogue line, marked Needs review** (recommended). Whole Life, IUL,
   Medicare Advantage and Annuity get Insurvas underwriting, quotation and field-set templates, and
   Term Life gets the missing quotation template and field set. The Medicare and annuity
   disclosures are unpublished drafts.
4. **Calling windows: 09:00–20:00 lead-local, no Sundays, no federal holidays** (recommended),
   marked Needs review.

---

## 4. What was built (2026-11-03, uncommitted)

One shared piece, `components/app/settings/defaults.tsx`: `DefaultChip` ("Insurvas default", info
tone), `ReviewChip` ("Needs legal review", warning tone, for compliance-sensitive defaults) and
`ResetToDefault` (button + the standard `ConfirmDialog`). No notice cards.

| Area | Marked as default | Reset to default | Where it acts |
|---|---|---|---|
| Underwriting templates | Chip on Insurvas rows and in "In use now" | Group line, when the agency's own general template is live: retires its live versions for that line | `templates-data.ts` `resetToDefault`, `underwriting.tsx` |
| Quotation templates | Chip on squares and pairs on the Insurvas template; "On your default" otherwise | Pair ⋯ on the every-carrier row: same retire | `quotation.tsx` |
| Application field sets | Chip on Insurvas sets; group "On the Insurvas default" | Existing "Go back to the platform set", renamed | `field-sets.tsx` |
| Disclosures | Chip + Needs legal review on Insurvas wording | ⋯ "Reset to default…" (retire) when Insurvas has the same code | `disclosures.tsx` |
| Quote & QA rules | "All Insurvas defaults" chip while every rule is the default | Saves the defaults for these rules only (welcome pack and AI untouched) | `preferences.tsx` |
| Application stages | Chip on a pipeline with no saved map | Fill in › "Reset to default" (clears the map; Save applies) | `pipeline-sync.tsx`; server default in `stageSyncService.ts` |
| Pipelines & outcomes | "Insurvas default routing" chip on the all-in-one pipeline | Puts the 14 standard outcomes back on their stages (draft; Save applies) | `pipelines-outcomes.tsx`, `outcomesBoard.ts` |
| Form templates | Chip until the agency publishes its own version | Loads the Insurvas form's questions and parts into the draft; publish as usual | `template-settings.tsx`, `GET /api/app/templates/default` |
| Dialing cadence | "In force: Insurvas default" + chip | Renamed "Clear and use the built-in cadence", now confirmed | `cadence-settings.tsx` |
| Calling windows | Chip + Needs legal review | Removes the agency's hours and switches (`PUT scope: "reset"`) | `calling-window-settings.tsx`, `lib/callingWindow/*` |
| Products | — (the agency's own choice) | — | Sign-up switches products on: `lib/products/applySignupProducts.ts` |
| Lead posting | — (nothing can be pre-made) | — | — |

Two behaviour changes worth knowing:

- **Application stages now has a runtime default.** A pipeline with no saved map moves the card to
  the stage carrying the state's name. So "clear the map" now means "back to the default", not
  "stop moving cards".
- **Form templates no longer copy Term Life into an agency that sells nothing.** The page shows
  "No products switched on yet" with a link to Products instead.

### Migrations (LIVE 2026-11-03, pasted by the owner and verified read-only)

| File | What | Who it changes |
|---|---|---|
| `20261103100000_calling_window_insurvas_default.sql` | `calling_window_insurvas_default()`; `tenant_can_dial_now` falls back to 9:00–20:00, no Sundays, no federal holidays when the agency has no row | **About 608 agencies without their own row narrow at once.** 3 agencies have their own hours, 2 their own switches. Telephony is not live. |
| `20261103110000_sales_pipeline_application_stages.sql` | `seed_general_pipeline` gains Quoted, Application started, Pending requirements, Issued, Lost | New agencies only |
| `20261103120000_platform_templates_every_line.sql` | 14 Insurvas templates (named "… · needs review") + 2 draft disclosures | Agencies on the fallback: any line without its own template now gets its own Insurvas one instead of Final Expense's |

Each restated function carries a guard that refuses to replace a body that has changed since it was
read (2026-11-03). Until 20261103100000 is applied, the Calling windows page keeps its old
"Clear my narrowing" and shows no default chip.

### Still open

- Every "needs review" template, both draft disclosures and the calling-window hours need the
  owner's or counsel's review. The call-script `state_disclosures` are still the 2026-09-23
  placeholder and exist for Term Life only; this work does not touch them.
- The draft disclosures have no rules yet; staff add them when publishing.
- `custom.medicare_number` is a custom field, so it is not masked like the SSN.
