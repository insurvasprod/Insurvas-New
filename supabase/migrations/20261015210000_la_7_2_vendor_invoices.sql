-- LA-7.2 (Notion sprint, Module 7 — Accounting) · lead cost and vendor invoice capture.
--
-- LA-2.1's campaign spend is a number someone typed: no date, no document, nothing a bank statement
-- reconciles to. An invoice is the document: who, how much, what for, which campaign — per LINE,
-- because one invoice routinely covers three campaigns — and whether it was paid.
--
--   approve → one cost_entry per line (lead_cost, negative, incurred_on = the line's period start,
--             else the invoice date), plus one for any tax on the invoice. Approval creates the cost.
--   paid    → sets paid_on on the invoice and its entries. Payment only records when money moved.
--   void    → reversing entries (LA-7.1); nothing is deleted.
--
-- Before approving, the invoice is compared with what WE counted for that source and period: deal
-- flow (LA-1), transfers rejected at the gate (LA-6.2), credits accepted (LA-2.19), list rows
-- bought (LA-2.2). A difference beyond the agency's tolerance FLAGS the invoice; it never blocks it
-- — the vendor may be right and our count the one missing something.
--
-- accounting_settings starts here with the tolerance; LA-7.9 adds the rest of the module's settings.
--
-- Additive. Rollback: drop function public.vendor_invoice_comparison(uuid, uuid), public.approve_vendor_invoice(uuid, uuid, uuid),
--   public.mark_vendor_invoice_paid(uuid, uuid, date, text, text, uuid), public.void_vendor_invoice(uuid, uuid, text, uuid);
--   alter table public.cost_entry drop constraint cost_entry_invoice_fk; drop table public.vendor_invoice_template,
--   public.vendor_invoice_line, public.vendor_invoice, public.accounting_settings; delete from storage.buckets where id = 'accounting-files';

-- ─── settings (LA-7.9 extends) ─────────────────────────────────────────────────────────────────
create table if not exists public.accounting_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  invoice_tolerance_cents bigint not null default 5000,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  constraint accounting_settings_tolerance check (invoice_tolerance_cents between 0 and 100000000)
);

-- ─── the documents ─────────────────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('accounting-files', 'accounting-files', false, 10485760, array['application/pdf', 'image/png', 'image/jpeg']::text[])
on conflict (id) do nothing;

-- ─── invoices ──────────────────────────────────────────────────────────────────────────────────
create table if not exists public.vendor_invoice (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  agency_id uuid,
  vendor_id uuid references public.tenant_lead_vendors(id) on delete restrict,
  partner_id uuid references public.partners(id) on delete restrict,
  invoice_number text not null,
  invoice_date date not null,
  period_start date,
  period_end date,
  due_date date,
  subtotal_cents bigint not null default 0,
  tax_cents bigint not null default 0,
  total_cents bigint not null default 0,
  status text not null default 'received',
  paid_on date,
  paid_method text,
  payment_reference text,
  document_path text,
  document_name text,
  note text,
  template_id uuid,
  comparison_json jsonb,
  difference_cents bigint,
  flagged boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  approved_by uuid,
  approved_at timestamptz,
  voided_by uuid,
  voided_at timestamptz,
  void_reason text,
  updated_at timestamptz not null default now(),
  constraint vendor_invoice_source check ((vendor_id is null) <> (partner_id is null)),
  constraint vendor_invoice_status check (status in ('draft', 'received', 'approved', 'paid', 'disputed', 'void')),
  constraint vendor_invoice_number check (char_length(btrim(invoice_number)) between 1 and 80),
  constraint vendor_invoice_money check (subtotal_cents >= 0 and tax_cents >= 0 and total_cents = subtotal_cents + tax_cents),
  constraint vendor_invoice_period check (period_start is null or period_end is null or period_end >= period_start),
  constraint vendor_invoice_method check (paid_method is null or paid_method in ('ach', 'card', 'cheque', 'wire', 'other')),
  constraint vendor_invoice_paid check ((status = 'paid') = (paid_on is not null) or (status = 'void' and voided_at is not null)),
  constraint vendor_invoice_void check ((status = 'void') = (voided_at is not null) and ((status = 'void') = (void_reason is not null))),
  constraint vendor_invoice_note check (note is null or char_length(note) <= 2000),
  constraint vendor_invoice_reference check (payment_reference is null or char_length(payment_reference) <= 200)
);
create unique index if not exists vendor_invoice_number_vendor on public.vendor_invoice (tenant_id, vendor_id, lower(invoice_number)) where vendor_id is not null;
create unique index if not exists vendor_invoice_number_partner on public.vendor_invoice (tenant_id, partner_id, lower(invoice_number)) where partner_id is not null;
create index if not exists vendor_invoice_tenant_idx on public.vendor_invoice (tenant_id, invoice_date desc);
create index if not exists vendor_invoice_status_idx on public.vendor_invoice (tenant_id, status);
create index if not exists vendor_invoice_vendor_idx on public.vendor_invoice (vendor_id) where vendor_id is not null;
create index if not exists vendor_invoice_partner_idx on public.vendor_invoice (partner_id) where partner_id is not null;

create table if not exists public.vendor_invoice_line (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  invoice_id uuid not null references public.vendor_invoice(id) on delete restrict,
  position integer not null default 0,
  description text not null,
  campaign_id uuid references public.tenant_campaigns(id) on delete restrict,
  lead_type text not null,
  quantity integer not null default 0,
  unit_price_cents bigint not null default 0,
  amount_cents bigint not null,
  period_start date,
  period_end date,
  created_at timestamptz not null default now(),
  constraint vendor_invoice_line_type check (lead_type in ('live_transfer', 'data_list', 'aged_lead', 'direct_mail', 'other')),
  constraint vendor_invoice_line_money check (quantity >= 0 and unit_price_cents >= 0 and amount_cents >= 0),
  constraint vendor_invoice_line_description check (char_length(btrim(description)) between 1 and 300),
  constraint vendor_invoice_line_period check (period_start is null or period_end is null or period_end >= period_start)
);
create index if not exists vendor_invoice_line_invoice_idx on public.vendor_invoice_line (invoice_id, position);
create index if not exists vendor_invoice_line_campaign_idx on public.vendor_invoice_line (campaign_id) where campaign_id is not null;

-- A monthly invoice from the same source is the same shape every month: number, date, quantity.
create table if not exists public.vendor_invoice_template (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  vendor_id uuid references public.tenant_lead_vendors(id) on delete cascade,
  partner_id uuid references public.partners(id) on delete cascade,
  name text not null,
  lines_json jsonb not null default '[]'::jsonb,
  tax_cents bigint not null default 0,
  active boolean not null default true,
  last_used_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vendor_invoice_template_source check ((vendor_id is null) <> (partner_id is null)),
  constraint vendor_invoice_template_name check (char_length(btrim(name)) between 1 and 120),
  constraint vendor_invoice_template_lines check (jsonb_typeof(lines_json) = 'array' and jsonb_array_length(lines_json) between 1 and 20),
  constraint vendor_invoice_template_tax check (tax_cents >= 0)
);
create index if not exists vendor_invoice_template_tenant_idx on public.vendor_invoice_template (tenant_id);

-- The ledger's invoice column now points at a real invoice (invoices are never deleted).
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cost_entry_invoice_fk' and conrelid = 'public.cost_entry'::regclass) then
    alter table public.cost_entry add constraint cost_entry_invoice_fk foreign key (invoice_id) references public.vendor_invoice(id) on delete restrict;
  end if;
end;
$$;

-- ─── what may change, and when ─────────────────────────────────────────────────────────────────
-- Approval, payment and voiding move money in the ledger, so only their writers below may make
-- those moves (a transaction-local flag they set and clear). Once approved, the invoice's money,
-- source, dates and lines are history.
create or replace function public.vendor_invoice_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_writer boolean := coalesce(current_setting('app.vendor_invoice_writer', true), '') = 'on';
  v_ok boolean;
begin
  if tg_op = 'DELETE' then
    raise exception 'An invoice is never removed; void it instead.' using errcode = 'P0001';
  end if;
  if new.status is distinct from old.status then
    v_ok := (old.status, new.status) in (('draft', 'received'), ('received', 'disputed'), ('disputed', 'received'), ('received', 'draft'))
         or (v_writer and (old.status, new.status) in (('draft', 'approved'), ('received', 'approved'), ('disputed', 'approved'), ('approved', 'paid'),
                                                         ('draft', 'void'), ('received', 'void'), ('disputed', 'void'), ('approved', 'void'), ('paid', 'void')));
    if not v_ok then
      raise exception 'An invoice cannot go from % to %.', old.status, new.status using errcode = 'P0001';
    end if;
  end if;
  if old.status in ('approved', 'paid', 'void') and (
       new.vendor_id is distinct from old.vendor_id or new.partner_id is distinct from old.partner_id
    or new.invoice_number is distinct from old.invoice_number or new.invoice_date is distinct from old.invoice_date
    or new.period_start is distinct from old.period_start or new.period_end is distinct from old.period_end
    or new.subtotal_cents is distinct from old.subtotal_cents or new.tax_cents is distinct from old.tax_cents
    or new.total_cents is distinct from old.total_cents or new.comparison_json is distinct from old.comparison_json
    or new.difference_cents is distinct from old.difference_cents or new.flagged is distinct from old.flagged
    or new.approved_by is distinct from old.approved_by or new.approved_at is distinct from old.approved_at
    or new.tenant_id is distinct from old.tenant_id) then
    raise exception 'An approved invoice is history: void it and enter it again.' using errcode = 'P0001';
  end if;
  if old.status = 'void' and new.status = 'void' and (new.voided_at is distinct from old.voided_at or new.void_reason is distinct from old.void_reason) then
    raise exception 'A voided invoice stays as it was voided.' using errcode = 'P0001';
  end if;
  if (new.paid_on is distinct from old.paid_on or new.paid_method is distinct from old.paid_method or new.payment_reference is distinct from old.payment_reference)
     and not (v_writer and old.status = 'approved' and new.status = 'paid') then
    raise exception 'Payment is recorded by marking the invoice paid.' using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists vendor_invoice_guard on public.vendor_invoice;
create trigger vendor_invoice_guard before update or delete on public.vendor_invoice
  for each row execute function public.vendor_invoice_guard();

create or replace function public.vendor_invoice_line_guard()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_status text;
  v_tenant uuid;
begin
  select i.status, i.tenant_id into v_status, v_tenant from public.vendor_invoice i where i.id = coalesce(new.invoice_id, old.invoice_id);
  if v_status is null or v_status not in ('draft', 'received', 'disputed') then
    raise exception 'The lines of an approved or voided invoice are history.' using errcode = 'P0001';
  end if;
  if tg_op = 'UPDATE' and new.invoice_id is distinct from old.invoice_id then
    raise exception 'A line stays on its invoice.' using errcode = 'P0001';
  end if;
  if tg_op <> 'DELETE' then
    if new.tenant_id is distinct from v_tenant then
      raise exception 'A line belongs to its invoice''s agency.' using errcode = 'P0001';
    end if;
    if new.campaign_id is not null and not exists (select 1 from public.tenant_campaigns c where c.id = new.campaign_id and c.tenant_id = v_tenant) then
      raise exception 'Campaign % is not in this agency.', new.campaign_id using errcode = 'P0001';
    end if;
    return new;
  end if;
  return old;
end;
$$;
drop trigger if exists vendor_invoice_line_guard on public.vendor_invoice_line;
create trigger vendor_invoice_line_guard before insert or update or delete on public.vendor_invoice_line
  for each row execute function public.vendor_invoice_line_guard();

-- ─── invoiced vs what we counted ───────────────────────────────────────────────────────────────
-- Per line. The window is the line's period, else the invoice's, else the invoice date's month.
--   live transfers — accepted: deal-flow rows from that partner (or vendor, or the line's campaign);
--                    rejected: LA-6.2 rejects for that partner (they never became leads);
--   data lists / aged leads — records bought on list imports for that campaign (or vendor);
--   credits — LA-2.19 claims accepted or partly accepted for that vendor (and campaign).
-- Our amount = accepted × the line's unit price − credits. (The spec's worked example does not add
-- up — 63 × $90 is $5,670, not $5,940 — so the count is priced at the line's own unit price.)
-- Direct mail and "other" lines cannot be counted and say so (countable = false).
create or replace function public.vendor_invoice_comparison(p_tenant_id uuid, p_invoice_id uuid)
returns table (line_id uuid, campaign_id uuid, lead_type text, invoiced_quantity integer, invoiced_cents bigint, unit_price_cents bigint,
               period_from date, period_to date, countable boolean, accepted integer, rejected integer, recorded integer,
               credited_count integer, credited_cents bigint, our_count integer, our_cents bigint, difference_cents bigint)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  i public.vendor_invoice;
  l record;
  v_from date;
  v_to date;
  v_acc integer;
  v_rej integer;
  v_cc integer;
  v_cents bigint;
begin
  select * into i from public.vendor_invoice where id = p_invoice_id and tenant_id = p_tenant_id;
  if not found then
    raise exception 'vendor_invoice_comparison: invoice % is not in this agency', p_invoice_id using errcode = 'P0002';
  end if;
  for l in select * from public.vendor_invoice_line x where x.invoice_id = i.id order by x.position, x.created_at loop
    v_from := coalesce(l.period_start, i.period_start, date_trunc('month', i.invoice_date)::date);
    v_to := coalesce(l.period_end, i.period_end, (date_trunc('month', i.invoice_date) + interval '1 month - 1 day')::date);
    v_acc := 0; v_rej := 0; v_cc := 0; v_cents := 0;
    if l.lead_type = 'live_transfer' then
      select count(*)::int into v_acc from public.deal_flow d
       where d.tenant_id = p_tenant_id and d.local_date between v_from and v_to
         and case when l.campaign_id is not null then d.campaign_id = l.campaign_id
                  when i.partner_id is not null then d.partner_id = i.partner_id
                  else d.vendor_id = i.vendor_id end;
      if i.partner_id is not null and to_regclass('public.transfer_verdict') is not null then
        execute 'select count(*)::int from public.transfer_verdict v where v.tenant_id = $1 and v.partner_id = $2 and v.verdict = ''reject''
                   and v.evaluated_at >= $3::timestamptz and v.evaluated_at < ($4 + 1)::timestamptz'
          into v_rej using p_tenant_id, i.partner_id, v_from, v_to;
      end if;
    elsif l.lead_type in ('data_list', 'aged_lead') then
      select coalesce(sum(b.records_purchased), 0)::int into v_acc from public.agent_lead_import_batches b
       where b.tenant_id = p_tenant_id and b.created_at >= v_from::timestamptz and b.created_at < (v_to + 1)::timestamptz
         and case when l.campaign_id is not null then b.campaign_id = l.campaign_id else b.vendor_id = i.vendor_id end;
    end if;
    if i.vendor_id is not null and l.lead_type in ('live_transfer', 'data_list', 'aged_lead') then
      select coalesce(sum(c.lead_count), 0)::int, coalesce(sum(c.amount_credited_cents), 0)::bigint into v_cc, v_cents from public.lead_claims c
       where c.tenant_id = p_tenant_id and c.vendor_id = i.vendor_id and c.status in ('accepted', 'partial')
         and c.resolved_at >= v_from::timestamptz and c.resolved_at < (v_to + 1)::timestamptz
         and (l.campaign_id is null or c.campaign_id = l.campaign_id);
    end if;
    line_id := l.id; campaign_id := l.campaign_id; lead_type := l.lead_type;
    invoiced_quantity := l.quantity; invoiced_cents := l.amount_cents; unit_price_cents := l.unit_price_cents;
    period_from := v_from; period_to := v_to;
    countable := l.lead_type in ('live_transfer', 'data_list', 'aged_lead');
    accepted := v_acc; rejected := v_rej; recorded := v_acc + v_rej;
    credited_count := v_cc; credited_cents := v_cents;
    our_count := greatest(v_acc - v_cc, 0);
    our_cents := case when countable then v_acc::bigint * l.unit_price_cents - v_cents else l.amount_cents end;
    difference_cents := our_cents - l.amount_cents;
    return next;
  end loop;
end;
$$;

-- ─── approve: the cost is created ──────────────────────────────────────────────────────────────
create or replace function public.approve_vendor_invoice(p_tenant_id uuid, p_invoice_id uuid, p_by uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  i public.vendor_invoice;
  l record;
  v_lines integer;
  v_sum bigint;
  v_cmp jsonb;
  v_diff bigint;
  v_tol bigint;
  v_entries integer := 0;
  v_counterparty uuid;
  v_type text;
begin
  select * into i from public.vendor_invoice where id = p_invoice_id and tenant_id = p_tenant_id for update;
  if not found then
    raise exception 'approve_vendor_invoice: invoice % is not in this agency', p_invoice_id using errcode = 'P0002';
  end if;
  if i.status not in ('draft', 'received', 'disputed') then
    raise exception 'approve_vendor_invoice: a % invoice cannot be approved', i.status using errcode = '22023';
  end if;
  select count(*)::int, coalesce(sum(amount_cents), 0)::bigint into v_lines, v_sum from public.vendor_invoice_line where invoice_id = i.id;
  if v_lines = 0 then
    raise exception 'approve_vendor_invoice: an invoice needs at least one line' using errcode = '22023';
  end if;
  if v_sum <> i.subtotal_cents then
    raise exception 'approve_vendor_invoice: the lines add up to % cents but the subtotal is % cents', v_sum, i.subtotal_cents using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb), coalesce(sum(c.difference_cents) filter (where c.countable), 0)::bigint
    into v_cmp, v_diff from public.vendor_invoice_comparison(p_tenant_id, i.id) c;
  select coalesce((select s.invoice_tolerance_cents from public.accounting_settings s where s.tenant_id = p_tenant_id), 5000) into v_tol;

  v_counterparty := coalesce(i.vendor_id, i.partner_id);
  v_type := case when i.vendor_id is not null then 'vendor' else 'partner' end;
  for l in select * from public.vendor_invoice_line where invoice_id = i.id and amount_cents > 0 order by position, created_at loop
    perform public.record_cost_entry(p_tenant_id, jsonb_build_object(
      'agency_id', i.agency_id, 'entry_type', 'lead_cost', 'amount_cents', -l.amount_cents,
      'incurred_on', coalesce(l.period_start, i.invoice_date), 'counterparty_type', v_type, 'counterparty_id', v_counterparty,
      'campaign_id', l.campaign_id,
      'vendor_id', coalesce(i.vendor_id, (select c.vendor_id from public.tenant_campaigns c where c.id = l.campaign_id)),
      'partner_id', i.partner_id, 'invoice_id', i.id,
      'description', left(l.description || ' — invoice ' || i.invoice_number, 500)), p_by);
    v_entries := v_entries + 1;
  end loop;
  if i.tax_cents > 0 then
    perform public.record_cost_entry(p_tenant_id, jsonb_build_object(
      'agency_id', i.agency_id, 'entry_type', 'lead_cost', 'amount_cents', -i.tax_cents, 'incurred_on', i.invoice_date,
      'counterparty_type', v_type, 'counterparty_id', v_counterparty, 'vendor_id', i.vendor_id, 'partner_id', i.partner_id, 'invoice_id', i.id,
      'description', left('Tax on invoice ' || i.invoice_number, 500)), p_by);
    v_entries := v_entries + 1;
  end if;

  perform set_config('app.vendor_invoice_writer', 'on', true);
  update public.vendor_invoice
     set status = 'approved', approved_by = p_by, approved_at = now(), comparison_json = v_cmp, difference_cents = v_diff,
         flagged = abs(v_diff) > v_tol
   where id = i.id;
  perform set_config('app.vendor_invoice_writer', '', true);
  return jsonb_build_object('entries', v_entries, 'difference_cents', v_diff, 'flagged', abs(v_diff) > v_tol, 'tolerance_cents', v_tol);
end;
$$;

-- ─── paid: when the money moved, nothing else ──────────────────────────────────────────────────
create or replace function public.mark_vendor_invoice_paid(p_tenant_id uuid, p_invoice_id uuid, p_paid_on date, p_method text, p_reference text, p_by uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  i public.vendor_invoice;
  v_ids uuid[];
  v_n integer;
begin
  select * into i from public.vendor_invoice where id = p_invoice_id and tenant_id = p_tenant_id for update;
  if not found then
    raise exception 'mark_vendor_invoice_paid: invoice % is not in this agency', p_invoice_id using errcode = 'P0002';
  end if;
  if i.status <> 'approved' then
    raise exception 'mark_vendor_invoice_paid: only an approved invoice is paid (this one is %)', i.status using errcode = '22023';
  end if;
  if p_paid_on is null then
    raise exception 'mark_vendor_invoice_paid: a payment date is required' using errcode = '22023';
  end if;
  select coalesce(array_agg(e.id), '{}') into v_ids from public.cost_entry e
   where e.tenant_id = p_tenant_id and e.invoice_id = i.id and e.reverses_entry_id is null;
  v_n := public.mark_cost_entries_paid(p_tenant_id, v_ids, p_paid_on);
  perform set_config('app.vendor_invoice_writer', 'on', true);
  update public.vendor_invoice set status = 'paid', paid_on = p_paid_on, paid_method = nullif(btrim(p_method), ''), payment_reference = nullif(btrim(p_reference), '')
   where id = i.id;
  perform set_config('app.vendor_invoice_writer', '', true);
  return v_n;
end;
$$;

-- ─── void: reversing entries, nothing deleted ──────────────────────────────────────────────────
create or replace function public.void_vendor_invoice(p_tenant_id uuid, p_invoice_id uuid, p_reason text, p_by uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  i public.vendor_invoice;
  e record;
  v_n integer := 0;
begin
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'void_vendor_invoice: say why the invoice is void' using errcode = '22023';
  end if;
  select * into i from public.vendor_invoice where id = p_invoice_id and tenant_id = p_tenant_id for update;
  if not found then
    raise exception 'void_vendor_invoice: invoice % is not in this agency', p_invoice_id using errcode = 'P0002';
  end if;
  if i.status = 'void' then
    raise exception 'void_vendor_invoice: the invoice is already void' using errcode = '22023';
  end if;
  for e in select c.id from public.cost_entry c
            where c.tenant_id = p_tenant_id and c.invoice_id = i.id and c.reverses_entry_id is null
              and not exists (select 1 from public.cost_entry r where r.reverses_entry_id = c.id) loop
    perform public.reverse_cost_entry(p_tenant_id, e.id, 'Invoice ' || i.invoice_number || ' voided: ' || btrim(p_reason), p_by);
    v_n := v_n + 1;
  end loop;
  perform set_config('app.vendor_invoice_writer', 'on', true);
  update public.vendor_invoice set status = 'void', voided_by = p_by, voided_at = now(), void_reason = left(btrim(p_reason), 500) where id = i.id;
  perform set_config('app.vendor_invoice_writer', '', true);
  return v_n;
end;
$$;

-- ─── access ────────────────────────────────────────────────────────────────────────────────────
alter table public.accounting_settings enable row level security;
alter table public.vendor_invoice enable row level security;
alter table public.vendor_invoice_line enable row level security;
alter table public.vendor_invoice_template enable row level security;
drop policy if exists accounting_settings_read on public.accounting_settings;
create policy accounting_settings_read on public.accounting_settings for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
drop policy if exists vendor_invoice_read on public.vendor_invoice;
create policy vendor_invoice_read on public.vendor_invoice for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
drop policy if exists vendor_invoice_line_read on public.vendor_invoice_line;
create policy vendor_invoice_line_read on public.vendor_invoice_line for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
drop policy if exists vendor_invoice_template_read on public.vendor_invoice_template;
create policy vendor_invoice_template_read on public.vendor_invoice_template for select to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);

revoke all on public.accounting_settings, public.vendor_invoice, public.vendor_invoice_line, public.vendor_invoice_template from public, anon, authenticated;
revoke insert, update, delete, truncate on public.accounting_settings, public.vendor_invoice, public.vendor_invoice_line, public.vendor_invoice_template from tenant_app;
grant select on public.accounting_settings, public.vendor_invoice, public.vendor_invoice_line, public.vendor_invoice_template to tenant_app;
-- The app edits drafts and templates directly; an invoice is never deleted (void it), and nothing is truncated.
revoke delete, truncate on public.vendor_invoice from service_role;
revoke truncate on public.accounting_settings, public.vendor_invoice_line, public.vendor_invoice_template from service_role;
grant select, insert, update on public.accounting_settings, public.vendor_invoice to service_role;
grant select, insert, update, delete on public.vendor_invoice_line, public.vendor_invoice_template to service_role;

revoke all on function public.vendor_invoice_guard() from public, anon, authenticated;
revoke all on function public.vendor_invoice_line_guard() from public, anon, authenticated;
revoke all on function public.vendor_invoice_comparison(uuid, uuid) from public, anon, authenticated, tenant_app;
revoke all on function public.approve_vendor_invoice(uuid, uuid, uuid) from public, anon, authenticated, tenant_app;
revoke all on function public.mark_vendor_invoice_paid(uuid, uuid, date, text, text, uuid) from public, anon, authenticated, tenant_app;
revoke all on function public.void_vendor_invoice(uuid, uuid, text, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.vendor_invoice_comparison(uuid, uuid) to service_role;
grant execute on function public.approve_vendor_invoice(uuid, uuid, uuid) to service_role;
grant execute on function public.mark_vendor_invoice_paid(uuid, uuid, date, text, text, uuid) to service_role;
grant execute on function public.void_vendor_invoice(uuid, uuid, text, uuid) to service_role;
