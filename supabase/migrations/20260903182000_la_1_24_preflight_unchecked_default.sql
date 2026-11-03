-- LA-1.24: existing leads must not appear as a confirmed new household before
-- the pre-flight has actually run.
alter table public.agent_leads
  alter column preflight_status set default 'not_checked';

update public.agent_leads
set preflight_status = 'not_checked',
    preflight_result = jsonb_build_object(
      'status', 'not_checked',
      'policyMatchingIncluded', false,
      'policyMatchingNote', 'Policy matching is not included yet; this check covers prior leads and contacts only.',
      'checkedAt', null,
      'matches', jsonb_build_array()
    )
where preflight_checked_at is null
  and preflight_status = 'new_household';
