-- LA-1.8: affiliate links reuse the partner intake pipeline and keep attribution on every row.

create table if not exists public.affiliate_links (
  id uuid default gen_random_uuid() not null,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  partner_id uuid not null references public.partners(id) on delete restrict,
  slug text not null,
  campaign text,
  is_active boolean default true not null,
  click_count bigint default 0 not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint affiliate_links_pkey primary key (id),
  constraint affiliate_links_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{2,79}$'),
  constraint affiliate_links_campaign_length check (campaign is null or length(btrim(campaign)) between 1 and 200),
  constraint affiliate_links_click_count_check check (click_count >= 0)
);

create unique index if not exists affiliate_links_slug_uidx on public.affiliate_links(slug);
create index if not exists affiliate_links_tenant_partner_idx on public.affiliate_links(tenant_id, partner_id, created_at desc);
create index if not exists affiliate_links_active_slug_idx on public.affiliate_links(slug) where is_active;

alter table public.agent_leads add column if not exists affiliate_link_id uuid references public.affiliate_links(id) on delete set null;
alter table public.agent_leads add column if not exists affiliate_campaign text;
alter table public.lead_queue add column if not exists affiliate_link_id uuid references public.affiliate_links(id) on delete set null;
alter table public.lead_queue add column if not exists affiliate_campaign text;
alter table public.deal_flow add column if not exists affiliate_link_id uuid references public.affiliate_links(id) on delete set null;
alter table public.deal_flow add column if not exists affiliate_campaign text;

create index if not exists agent_leads_affiliate_link_idx on public.agent_leads(affiliate_link_id, created_at desc) where affiliate_link_id is not null;
create index if not exists lead_queue_affiliate_link_idx on public.lead_queue(affiliate_link_id, created_at desc) where affiliate_link_id is not null;
create index if not exists deal_flow_affiliate_link_idx on public.deal_flow(affiliate_link_id, created_at desc) where affiliate_link_id is not null;

drop trigger if exists affiliate_links_touch_updated_at on public.affiliate_links;
create trigger affiliate_links_touch_updated_at before update on public.affiliate_links
for each row execute function public.touch_partner_updated_at();

alter table public.affiliate_links enable row level security;
revoke all on public.affiliate_links from public, anon, authenticated;
grant select, insert, update on public.affiliate_links to tenant_app;
grant select, insert, update, delete on public.affiliate_links to service_role;

drop policy if exists affiliate_links_tenant_scoped on public.affiliate_links;
create policy affiliate_links_tenant_scoped on public.affiliate_links
for all to tenant_app
using (tenant_id = (nullif(current_setting('app.tenant_id', true), '')::uuid))
with check (tenant_id = (nullif(current_setting('app.tenant_id', true), '')::uuid));

create or replace function public.record_affiliate_link_click(p_slug text)
returns table (
  id uuid,
  tenant_id uuid,
  partner_id uuid,
  slug text,
  campaign text,
  click_count bigint,
  partner_name text,
  partner_status text,
  partner_timezone text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  link_row public.affiliate_links%rowtype;
begin
  update public.affiliate_links link
     set click_count = link.click_count + 1,
         updated_at = now()
   where link.slug = lower(btrim(p_slug))
     and link.is_active
     and exists (
       select 1 from public.partners partner
        where partner.id = link.partner_id
          and partner.partner_type = 'affiliate'
          and partner.status = 'active'
     )
  returning * into link_row;

  if not found then return; end if;
  return query
  select link_row.id, link_row.tenant_id, link_row.partner_id, link_row.slug, link_row.campaign,
         link_row.click_count, partner.name, partner.status::text, partner.timezone
    from public.partners partner
   where partner.id = link_row.partner_id;
end;
$$;

revoke all on function public.record_affiliate_link_click(text) from public, anon, authenticated, tenant_app;
grant execute on function public.record_affiliate_link_click(text) to service_role;
