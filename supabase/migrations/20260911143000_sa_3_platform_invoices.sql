-- SA-3.2/3.3 · Platform invoices, under a name that is free
--
-- `public.invoices` and `public.invoice_lines` are already taken, by the organizations-era CRM,
-- and their shape is incompatible in every way that matters: `organization_id` rather than
-- `tenant_id`, `invoice_number` rather than `number`, an approval workflow rather than SaaS
-- billing, and `total_amount numeric(12,2)` — a decimal, which SA-00 forbids outright: "Money is
-- integer cents. Never floats, never decimals."
--
-- The collision was silent. `lib/invoices/queries.ts` destructured only `data` and never checked
-- `error`, so an app-shaped select that fails with `column invoices.number does not exist`
-- produced an empty array, and `/api/admin/invoices` answered 200 with `invoices: []`. The screen
-- would have reported "no invoices" forever, including after real invoices existed. That error
-- handling is fixed in the same change as this migration.
--
-- Resolution chosen: rename the SaaS tables rather than move the CRM's. It touches nothing outside
-- this repository, and the names are honest — these are the PLATFORM's invoices, billed to a
-- tenant for their subscription, not the agency's invoices to its own customers.
--
-- Note for whoever writes SA-3.2's billing functions: four historical migrations
-- (`0017_period_billing.sql`, `20260831062000_…`, `20260903240000_…`, `20260903300000_…`) still
-- name `public.invoices` inside function and trigger bodies. None of those functions exists in the
-- database, so nothing is broken today, but they must be superseded to target
-- `public.platform_invoices` before they are applied — otherwise they would aim at the CRM's table.

-- --------------------------------------------------------------------------
-- Enums
-- --------------------------------------------------------------------------

do $$ begin
  create type public.invoice_status as enum ('draft', 'issued', 'paid', 'overdue', 'void', 'uncollectible');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.invoice_kind as enum ('subscription', 'custom');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.invoice_line_kind as enum ('plan', 'addon', 'overage', 'discount', 'setup_fee', 'credit');
exception when duplicate_object then null; end $$;

-- --------------------------------------------------------------------------
-- platform_invoices
-- --------------------------------------------------------------------------

create table if not exists public.platform_invoices (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null,
  subscription_id       uuid,
  number                text not null,
  kind                  public.invoice_kind not null default 'subscription',
  status                public.invoice_status not null default 'draft',
  currency              text not null default 'USD',
  subtotal_cents        integer not null default 0,
  discount_cents        integer not null default 0,
  tax_cents             integer not null default 0,
  total_cents           integer not null default 0,
  period_start          timestamptz,
  period_end            timestamptz,
  issued_at             timestamptz,
  due_at                timestamptz,
  paid_at               timestamptz,
  voided_at             timestamptz,
  void_reason           text,
  reason                text,
  provider              text,
  provider_invoice_id   text,
  provider_payment_id   text,
  provider_total_cents  integer,
  pay_online_url        text,
  reconciliation        text not null default 'pending',
  created_at            timestamptz not null default now(),
  created_by            uuid
);

comment on table public.platform_invoices is
  'SA-3.2 · What the PLATFORM bills a tenant for their subscription. Distinct from public.invoices, '
  'which belongs to the organizations-era CRM and bills an agency''s own customers.';

comment on column public.platform_invoices.reconciliation is
  'Whether our total agrees with the provider''s: pending | matched | mismatched. A mismatch is a '
  'money discrepancy and must stay visible rather than being reconciled away silently.';

do $$ begin
  alter table public.platform_invoices add constraint platform_invoices_tenant_id_fkey
    foreign key (tenant_id) references public.tenants (id);
exception when duplicate_object or undefined_table then null; end $$;

do $$ begin
  alter table public.platform_invoices add constraint platform_invoices_subscription_id_fkey
    foreign key (subscription_id) references public.subscriptions (id);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.platform_invoices add constraint platform_invoices_number_key unique (number);
exception when duplicate_table or duplicate_object then null; end $$;

-- Integer cents only, never negative, and the total must be the sum of its parts. An invoice whose
-- total disagrees with its own arithmetic is the one bug in billing nobody forgives.
do $$ begin
  alter table public.platform_invoices add constraint platform_invoices_amounts_sane check (
    subtotal_cents >= 0 and discount_cents >= 0 and tax_cents >= 0 and total_cents >= 0
    and total_cents = subtotal_cents - discount_cents + tax_cents
  );
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.platform_invoices add constraint platform_invoices_currency_usd check (currency = 'USD');
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.platform_invoices add constraint platform_invoices_reconciliation_values
    check (reconciliation in ('pending', 'matched', 'mismatched'));
exception when duplicate_object then null; end $$;

create index if not exists platform_invoices_tenant_idx on public.platform_invoices (tenant_id, created_at desc);
create index if not exists platform_invoices_status_idx on public.platform_invoices (status);
create index if not exists platform_invoices_overdue_idx on public.platform_invoices (due_at) where status = 'issued';
create index if not exists platform_invoices_mismatch_idx on public.platform_invoices (reconciliation) where reconciliation = 'mismatched';

-- --------------------------------------------------------------------------
-- platform_invoice_lines
-- --------------------------------------------------------------------------

create table if not exists public.platform_invoice_lines (
  id            uuid primary key default gen_random_uuid(),
  invoice_id    uuid,
  position      integer not null default 0,
  kind          public.invoice_line_kind not null,
  label         text not null,
  quantity      integer not null default 1,
  unit_cents    integer not null default 0,
  amount_cents  integer not null default 0,
  included_qty  integer,
  created_at    timestamptz not null default now()
);

comment on table public.platform_invoice_lines is
  'SA-3.2 · One line per charge. SA-2.6 requires an add-on to appear as its OWN line rather than '
  'being folded into the plan charge, so a customer can see what they are paying for.';

do $$ begin
  alter table public.platform_invoice_lines add constraint platform_invoice_lines_invoice_id_fkey
    foreign key (invoice_id) references public.platform_invoices (id) on delete cascade;
exception when duplicate_object then null; end $$;

-- A discount line is negative; everything else is positive. Both are integer cents.
do $$ begin
  alter table public.platform_invoice_lines add constraint platform_invoice_lines_amount_sign check (
    case when kind in ('discount', 'credit') then amount_cents <= 0 else amount_cents >= 0 end
  );
exception when duplicate_object then null; end $$;

create index if not exists platform_invoice_lines_invoice_idx
  on public.platform_invoice_lines (invoice_id, position);

-- --------------------------------------------------------------------------
-- Issued invoices are immutable (SA-00: "Issued invoices are immutable. Corrections are credit
-- notes."). Enforced in the database, because a correction made by editing history is the kind of
-- thing that is only discovered during an audit.
-- --------------------------------------------------------------------------

create or replace function public.prevent_issued_invoice_mutation()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'invoice_immutable: an invoice that has been issued cannot be deleted'
        using errcode = 'check_violation';
    end if;
    return old;
  end if;

  if old.status = 'draft' then
    return new;  -- A draft is still being assembled.
  end if;

  -- After issue, only the lifecycle may move: payment, voiding, provider reconciliation. The
  -- money and the identity are fixed.
  if new.tenant_id is distinct from old.tenant_id
     or new.number is distinct from old.number
     or new.subtotal_cents is distinct from old.subtotal_cents
     or new.discount_cents is distinct from old.discount_cents
     or new.tax_cents is distinct from old.tax_cents
     or new.total_cents is distinct from old.total_cents
     or new.currency is distinct from old.currency
     or new.issued_at is distinct from old.issued_at then
    raise exception 'invoice_immutable: an issued invoice cannot be edited — raise a credit note'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

drop trigger if exists platform_invoices_immutable on public.platform_invoices;
create trigger platform_invoices_immutable
  before update or delete on public.platform_invoices
  for each row execute function public.prevent_issued_invoice_mutation();

create or replace function public.prevent_issued_invoice_line_mutation()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_status public.invoice_status;
begin
  select i.status into v_status
    from public.platform_invoices i
   where i.id = coalesce(new.invoice_id, old.invoice_id);

  if v_status is not null and v_status <> 'draft' then
    raise exception 'invoice_immutable: the lines of an issued invoice cannot be changed'
      using errcode = 'check_violation';
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists platform_invoice_lines_immutable on public.platform_invoice_lines;
create trigger platform_invoice_lines_immutable
  before insert or update or delete on public.platform_invoice_lines
  for each row execute function public.prevent_issued_invoice_line_mutation();

-- --------------------------------------------------------------------------
-- Access
-- --------------------------------------------------------------------------

alter table public.platform_invoices enable row level security;
alter table public.platform_invoice_lines enable row level security;

drop policy if exists platform_invoices_service_role_only on public.platform_invoices;
create policy platform_invoices_service_role_only on public.platform_invoices
  for all to service_role using (true) with check (true);

drop policy if exists platform_invoice_lines_service_role_only on public.platform_invoice_lines;
create policy platform_invoice_lines_service_role_only on public.platform_invoice_lines
  for all to service_role using (true) with check (true);

revoke all on public.platform_invoices, public.platform_invoice_lines
  from public, anon, authenticated, tenant_app;
grant select, insert, update, delete on public.platform_invoices to service_role;
grant select, insert, update, delete on public.platform_invoice_lines to service_role;
