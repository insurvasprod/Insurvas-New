-- ---------------------------------------------------------------------------
-- Settings → Lead posting: four more reasons a vendor post is refused.
--
-- The board's rejection meters read "No consent text", "Missing consent IP", "Unparseable date of
-- birth" and "State not licensed". The post path (lib/leadPost/service.ts) now refuses a post for
-- each of them, and records the refusal in tenant_lead_post_log under its own code so the meters
-- can count it:
--
--   missing_consent_text     no consent_text on the post (after the vendor's field map)
--   missing_consent_ip       no consent IP (consent_ip, or ip), or one that is not an IP address
--   invalid_date_of_birth    a date_of_birth that was sent but cannot be read as a real date
--   state_not_licensed       the agency holds no current licence in the lead's state
--
-- `reason_code` is a closed vocabulary (20260913320000), so the check constraint has to learn the
-- four codes. Until this file is applied the post path still refuses the post with the precise code
-- in its response, and falls back to the nearest older code for the log row (missing_required_field
-- or unknown_state) so the billing record is never lost.
--
-- A missing consent CERTIFICATE (TrustedForm, Jornaya) is still not a rejection: LA-2.6 says flag,
-- do not block. Consent text and the consent IP are the consent itself, not a certificate of it.
--
-- Idempotent: the constraint is dropped and re-added with the full list.
-- ---------------------------------------------------------------------------

alter table public.tenant_lead_post_log
  drop constraint if exists tenant_lead_post_log_reason_code_check;

alter table public.tenant_lead_post_log
  add constraint tenant_lead_post_log_reason_code_check check (reason_code in (
    'accepted',
    'duplicate',
    'suppressed_litigator',
    'suppressed_internal',
    'suppressed_dnc',
    'invalid_phone',
    'missing_required_field',
    'unknown_state',
    'campaign_not_accepting',
    'scrub_unavailable',
    'rate_limited',
    'unauthorised',
    'missing_consent_text',
    'missing_consent_ip',
    'invalid_date_of_birth',
    'state_not_licensed'
  ));

comment on constraint tenant_lead_post_log_reason_code_check on public.tenant_lead_post_log is
  'Closed vocabulary of post outcomes. Settings → Lead posting labels each one (lib/leadPost/types.ts REJECTION_LABELS).';

-- The licence check reads one (tenant_id, state) row per post; licenses_unique_state already
-- indexes exactly that, so no index is added here.
