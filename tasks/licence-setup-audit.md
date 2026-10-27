# Contracting licence and NPN setup audit

Scope: source and migration history only. No database was queried or changed.

## Finding

The current checkout does **not** require a recorded licence or NPN to save a carrier appointment.
The manager's recording describes a blocker seen in the deployed demo; that state is not reproduced in
these source paths. The warning in the current Settings UI is informational and explicitly says the
appointment can still be recorded.

## Setup writes and constraints

- `app/api/app/appointment-vault/appointments/route.ts` validates appointment rows and calls
  `saveAppointments`; it has no licence or NPN check.
- `lib/appointments/schemas.ts` requires carrier, state, status and dates for an appointment. It does
  not require a `licenses` row or an NPN.
- `lib/appointments/service.ts` saves through `save_appointments_with_details` (or the legacy
  `save_appointments` RPC when that migration is pending). The RPC inserts/updates `appointments`
  and does not inspect `licenses`.
- `20260901090000_la_0_5_appointment_contract_level_vault.sql` makes an appointment require a
  tenant, carrier, two-letter state, status and effective date. The only matching uniqueness rule is
  `(tenant_id, carrier_id, state, effective_from)`; there is no licence foreign key or NPN column.
- The `licenses` table separately requires a state, licence number and expiry **when creating a
  licence record**. That is a valid-record constraint, not a prerequisite for selecting/saving
  appointments. Do not weaken it or delete existing records.
- NPN is already nullable for business identity (`20260924100000_agency_profile_legal_identity.sql`)
  and producer profile (`20260924200000_personal_producer_licence_numbers.sql`).
  `20261026200000_signup_npn_optional.sql` explicitly drops `NOT NULL` from the legacy
  `business_profiles.npn` column; its format check still applies when a value is supplied.

## Selling and routing eligibility — preserve

- `lib/appointments/eligibility.ts` uses a live tenant carrier contract, a currently valid
  carrier/state appointment, and a current state licence for `canWriteReasonFromVault`.
- `20261026400000_remove_eo_and_ce.sql` deliberately keeps those three checks in
  `can_write_with_grace`/`can_write_reason`; the E&O and CE requirements were the removed rules.
- Assignment and dialer migrations continue to check licence state and expiry before routing work
  (for example `20260923130000_la_2_24_eligibility_reads_the_appointments_we_keep.sql`,
  `20260925702000_agent_licence_expiry.sql`, and the current `20261026400000` gate).
- `components/app/settings/carriers-settings.tsx` allows state/carrier appointments to be saved
  without a licence and shows a warning that it must be recorded before selling. The checkbox is
  disabled only during save, not by missing licence/NPN.

## Decision and remaining work

- No schema migration is justified by the current checkout: it would be a no-op for setup and could
  accidentally weaken a real selling/assignment gate.
- Keep NPN and licence records intact. Keep live eligibility checks intact.
- Preserve the missing-licence hint as a setup/selling distinction; the contracting redesign can
  make it a quieter, actionable status instead of a blocking-looking warning.
- Before implementation, reconcile the deployed demo's behavior with this branch. The browser build
  was previously identified as mismatched, so source findings do not prove deployed behavior.

## Evidence limit

This review read migrations and source callers but did not replay migrations or inspect a live schema.
SQL definitions prove the checked-in contract only. Confirm the intended production schema through
the approved non-production migration workflow before any future licensing migration.
