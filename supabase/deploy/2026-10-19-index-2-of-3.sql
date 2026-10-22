create index concurrently if not exists agent_leads_fresh_zoned_idx
  on public.agent_leads (tenant_id)
  where lead_state = 'fresh' and dial_timezone is not null;
