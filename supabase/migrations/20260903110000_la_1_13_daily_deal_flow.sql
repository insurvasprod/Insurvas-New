-- LA-1.13: the daily deal-flow reporting fields and query indexes.
-- Money remains integer cents. worked_by is deliberately separate from disposition_by so a
-- future workflow can record who owned the work before the final disposition is selected.

alter table public.deal_flow
  add column if not exists carrier text,
  add column if not exists product_type text,
  add column if not exists monthly_premium_cents integer,
  add column if not exists face_amount_cents integer,
  add column if not exists draft_date date,
  add column if not exists worked_by uuid references public.users(id) on delete set null,
  add column if not exists manual_entry boolean not null default false;

alter table public.deal_flow drop constraint if exists deal_flow_money_nonnegative;
alter table public.deal_flow add constraint deal_flow_money_nonnegative check (
  (monthly_premium_cents is null or monthly_premium_cents >= 0)
  and (face_amount_cents is null or face_amount_cents >= 0)
);

create index if not exists deal_flow_tenant_date_idx
  on public.deal_flow (tenant_id, local_date desc, created_at desc);
create index if not exists deal_flow_tenant_partner_date_idx
  on public.deal_flow (tenant_id, partner_id, local_date desc);
create index if not exists deal_flow_tenant_status_date_idx
  on public.deal_flow (tenant_id, status, local_date desc);
create index if not exists deal_flow_tenant_worked_by_date_idx
  on public.deal_flow (tenant_id, worked_by, local_date desc);

update public.deal_flow d
set worked_by = coalesce(d.worked_by, d.disposition_by, q.owner_user_id)
from public.lead_queue q
where q.lead_id = d.lead_id and q.tenant_id = d.tenant_id;

create or replace function public.set_deal_flow_worked_by()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if new.worked_by is null then new.worked_by := new.disposition_by; end if;
  return new;
end;
$$;

drop trigger if exists deal_flow_set_worked_by on public.deal_flow;
create trigger deal_flow_set_worked_by before insert or update on public.deal_flow
for each row execute function public.set_deal_flow_worked_by();

revoke all on function public.set_deal_flow_worked_by() from public, anon, authenticated, tenant_app;
