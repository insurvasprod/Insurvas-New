-- LA-1.16 corrective migration: avoid the PL/pgSQL record/table-alias collision
-- that made LA-1.12 disposition completion fail when it tried to write its card.
create or replace function public.normalize_partner_disposition_card()
returns trigger
security definer
set search_path = public, pg_catalog
as $$
declare
  queue_row record;
  disposition_label text;
  display_name text;
begin
  if new.work_item_id is null or new.message_kind <> 'text' or new.event_key is not null then
    return new;
  end if;

  select lq.partner_id, lq.disposition, lq.disposition_by, lq.status, al.values
    into queue_row
  from public.lead_queue lq
  join public.agent_leads al on al.id = lq.lead_id and al.tenant_id = lq.tenant_id
  where lq.id = new.work_item_id and lq.tenant_id = new.tenant_id;

  if queue_row.disposition is null
     or queue_row.disposition_by is distinct from new.created_by
     or queue_row.status not in ('completed', 'dropped') then
    return new;
  end if;

  select d.label
    into disposition_label
  from public.dispositions d
  where d.tenant_id = new.tenant_id and d.disposition_key = queue_row.disposition
  limit 1;

  display_name := coalesce(
    nullif(btrim(queue_row.values->>'full_name'), ''),
    nullif(btrim(concat_ws(' ', queue_row.values->>'first_name', queue_row.values->>'last_name')), ''),
    'Customer'
  );
  new.message_kind := 'system_card';
  new.card_type := case when queue_row.disposition = 'call_dropped' then 'call_dropped' else 'call_outcome' end;
  new.event_key := 'disposition:' || new.work_item_id::text || ':' || queue_row.disposition;
  new.card_payload := jsonb_build_object('customer', display_name, 'disposition', coalesce(disposition_label, queue_row.disposition));
  new.message := display_name || ': ' || coalesce(disposition_label, queue_row.disposition);
  return new;
end;
$$ language plpgsql;

revoke all on function public.normalize_partner_disposition_card() from public, anon, authenticated, tenant_app;
