create index concurrently if not exists agent_leads_fresh_serving_idx
  on public.agent_leads (tenant_id, campaign_id, (upper(values->>'state')), created_at, id)
  where lead_state = 'fresh';
