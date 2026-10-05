# LA-6: Compliance completion

**Module 6.** Consent and DNC are on **Basic**; the litigation packet is on **Advanced**. See the [roadmap](../roadmap/ROADMAP.md).

> Ray's insurance policy against a lawsuit. Sold as software, bought as fear.

**Phase gate:** one click produces a complete, correct litigation packet for a contact. Every paid add-on is enforced on the server.

**Already built:**
- DNC/TCPA suppression and exemptions.
- Vendor scrubs (DncScrub, TCPA Litigator, Blacklist Alliance) that refuse to dial when the vendor is down.
- The consent locker, with TrustedForm and Jornaya evidence.
- The appointment and licence vault.
- State disclosure scripts.

**Missing:**
- The litigation packet.
- Call recording.
- `partner_portal` enforcement.
- Correct gating on the consent-claim route.
- Real disclosure wording: all 51 states are seeded with placeholder text.

**Legal target:** prior express written consent and the state mini-TCPA statutes, not the vacated FCC one-to-one rule. Design so that rule could come back.

**Status of this file:** written from the product docs and the 2026-10-02 code map; re-verify paths at the start of the phase.

---

## LA-6.1: Litigation packet

**Goal:** one button, one contact, one zip containing:
- every call attempt and disposition;
- every consent certificate;
- every DNC and TCPA scrub result with its timestamp;
- messages, partner-chat lines and notes;
- the signed application and submission confirmation;
- an index PDF.

When a demand letter arrives, Ray's lawyer has it in ten minutes.

**Scope:**
- A server route that assembles the zip from the existing stores: consent locker, scrub results, call attempts, partner chat, application confirmations.
- The zip is streamed, with a manifest and sha256 of each file.
- Feature `litigation_packet`, owner only.

**Acceptance:**
- The packet holds exactly that contact's records, never another tenant's or another contact's.
- The manifest lists every item with its source and timestamp.
- Generating a packet is audited.
- Recordings are included when LA-6.2 exists.

## LA-6.2: Call-recording storage and retention

**Blocked on:** a telephony vendor decision (roadmap, §5).

**Scope:**
- Recording objects are attached to call attempts.
- Retention by state: 90 days included, 3 years as a paid add-on (pending counsel).
- In two-party-consent states, the disclosure must be on the recording.

**Acceptance:**
- Retention runs as a scheduled job, and deletions are logged.
- Playback is owner and producer only; the bookkeeper role never hears recordings.

## LA-6.3: Enforce the `partner_portal` add-on

**Today:** nothing in `app/` or `lib/` checks `partner_portal`. `/partner` works for any tenant that can create partner users (`publisher_records`, i.e. Advanced), so the $99 add-on sells something already included.

**Scope:**
- The partner-plane login and every `/api/partner/*` route check that the owning tenant is entitled to `partner_portal`.
- The in-app `/app/partner-portal` item becomes a real page: invite partners and see portal usage.

**Acceptance:**
- A tenant without the add-on cannot have its partners log in, and gets a clear notice.
- Turning the add-on on or off takes effect on the next request.
- Tests cover both sides.

## LA-6.4: Gate and copy fixes

- `app/api/app/compliance/consent/claim/route.ts` is gated on `lead_import`; gate it on `consent_locker`, keeping any intended overlap explicit.
- `app/api/app/scorecard/route.ts` has no feature gate; add one, or remove the route, since the page only redirects.

**Acceptance:** the API-policy registry test and the money-routes test stay green with the corrected keys.

## LA-6.5: Replace the placeholder disclosures

**Blocked on:** counsel-approved wording.

**Scope:**
- `/admin/state-disclosures` gets a per-state "approved" flag.
- The dialer refuses a live call in a state whose disclosure isn't approved, behind a kill switch so demos keep working.

**Acceptance:**
- No `[PLACEHOLDER` text can reach a live call once the switch is on.
- The switch state is audited.
