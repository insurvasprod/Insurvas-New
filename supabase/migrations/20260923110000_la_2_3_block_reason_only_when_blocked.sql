-- LA-2.3 · the empty-queue explanation fires when the queue is not empty.
--
-- `campaign_serving_block_reason` exists for a good reason, stated in its own migration: "The gate
-- is useless if the dialer can only report 'no leads' — an agent staring at an empty queue needs to
-- know it is a scrub, not a drought."
--
-- But every branch asks `exists (... status = 'active' and scrub_status = <bad>)`, which is true as
-- soon as ONE active campaign is in that state. A tenant with six active campaigns, five unscrubbed
-- and one scrubbed, is served from the scrubbed one — and told:
--
--     "This campaign has not been scrubbed against the suppression lists yet, so no leads can be
--      served."
--
-- Observed on the live project 2026-09-23: `next_campaign_for_serving` returned a campaign and this
-- function simultaneously claimed nothing could be served. The singular "This campaign" makes it
-- worse, because there is no campaign the sentence is about — it is a tenant-wide scan wearing the
-- grammar of a specific answer.
--
-- An agent who reads it goes looking for a scrub that is not blocking them, while the actual reason
-- their queue is short is something else entirely.
--
-- The fix is the guard the function never had: say nothing when anything is servable. A reason for
-- an empty queue is only a reason while the queue is empty. The wording also stops pretending to be
-- about one campaign, and the partial case — some servable, some not — gets its own sentence,
-- because "you are only seeing part of your inventory" is a different fact from "you are blocked".

create or replace function public.campaign_serving_block_reason(p_tenant_id uuid)
returns text
language sql
stable
security definer
set search_path to 'public'
as $function$
  select case
    when not exists (select 1 from tenant_campaigns where tenant_id = p_tenant_id) then
      'No campaigns exist yet.'
    when not exists (select 1 from tenant_campaigns where tenant_id = p_tenant_id and status = 'active') then
      'Every campaign is paused, draft or exhausted.'

    -- The guard. `campaigns_servable` is the same view the serving query filters on, so this asks
    -- the question the agent is actually asking: is anything being served at all.
    when exists (select 1 from campaigns_servable where tenant_id = p_tenant_id) then
      case
        when exists (
          select 1 from tenant_campaigns
           where tenant_id = p_tenant_id and status = 'active'
             and scrub_status in ('unscrubbed', 'scrubbing', 'failed')
        ) then
          'Some active campaigns are still being scrubbed, so you are seeing leads from the scrubbed ones only.'
        else null
      end

    -- Nothing is servable. Now the scrub states are the reason, and they are reported in the order
    -- that tells the reader what to do: a failure needs attention, a run in progress needs waiting,
    -- and never-scrubbed needs starting.
    when exists (select 1 from tenant_campaigns where tenant_id = p_tenant_id and status = 'active' and scrub_status = 'failed') then
      'Scrubbing failed for at least one active campaign. Dialing is blocked until it succeeds.'
    when exists (select 1 from tenant_campaigns where tenant_id = p_tenant_id and status = 'active' and scrub_status = 'scrubbing') then
      'Scrubbing is still running. Dialing starts when it finishes.'
    when exists (select 1 from tenant_campaigns where tenant_id = p_tenant_id and status = 'active' and scrub_status = 'unscrubbed') then
      'No active campaign has been scrubbed against the suppression lists yet, so no leads can be served.'
    else null
  end;
$function$;

revoke all on function public.campaign_serving_block_reason(uuid) from public, anon, authenticated;
grant execute on function public.campaign_serving_block_reason(uuid) to tenant_app, service_role;

-- ── the contradiction, asserted absent ─────────────────────────────────────
--
-- The property is a relationship between two functions, so it is checked as one: if a campaign is
-- being served, the explanation for an empty queue must not claim the queue is blocked.
do $$
declare
  v_tenant uuid;
  v_reason text;
  v_served uuid;
begin
  for v_tenant in
    select distinct tenant_id from tenant_campaigns where status = 'active'
  loop
    v_served := public.next_campaign_for_serving(v_tenant);
    v_reason := public.campaign_serving_block_reason(v_tenant);

    if v_served is not null and v_reason is not null and v_reason ilike '%no leads can be served%' then
      raise exception
        'tenant % is being served campaign % and was still told no leads can be served', v_tenant, v_served;
    end if;

    -- And the other direction, which is the worse one: a blocked tenant told nothing at all leaves
    -- an agent staring at an empty dialer with no explanation, which is the defect the original
    -- function was written to prevent.
    if v_served is null and v_reason is null
       and exists (select 1 from tenant_campaigns where tenant_id = v_tenant and status = 'active') then
      raise exception 'tenant % is serving nothing and was given no reason why', v_tenant;
    end if;
  end loop;

  raise notice 'LA-2.3: the empty-queue explanation and the serving gate now agree';
end $$;
