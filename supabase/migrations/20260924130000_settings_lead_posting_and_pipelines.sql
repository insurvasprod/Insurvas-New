-- ---------------------------------------------------------------------------
-- Settings → Lead posting and Settings → Pipelines: the columns their boards show.
--
-- Additive and idempotent. The application reads every column below tolerantly, so it runs the
-- same before and after this file is applied; writes that need a column answer 503 until it is.
--
-- ── Lead posting ────────────────────────────────────────────────────────────
--
--   tenant_vendor_post_keys.campaign_id   A key may be bound to one of its vendor's campaigns.
--                                         Unbound keys keep today's behaviour: the post lands on
--                                         the vendor's accepting campaign. Bound keys land on that
--                                         campaign or are refused `campaign_not_accepting` — the
--                                         post route enforces it (lib/leadPost/service.ts).
--
--   tenant_vendor_post_keys.field_notes   A note per mapped field, keyed by OUR field name, shown
--                                         beside the field map. Text for people; it changes nothing
--                                         about how a post is read.
--
--   tenant_lead_post_log.key_id           Which key a post arrived on. The log had the vendor but
--                                         not the key, so "posts on this key" was not answerable
--                                         once a vendor had been rotated. Written by the post route
--                                         from now on; older rows stay null and are reported as the
--                                         vendor's, not guessed onto a key.
--
-- ── Pipelines ───────────────────────────────────────────────────────────────
--
--   tenant_pipeline_stages.description    One line saying what a stage means ("A human answered").
--
--   lead_queue (tenant_id, disposition_at) The "outcomes recorded against a disposition with no
--                                         stage" count reads the last 30 days of dispositions.
-- ---------------------------------------------------------------------------

-- ── posting keys ───────────────────────────────────────────────────────────
alter table public.tenant_vendor_post_keys
  add column if not exists campaign_id uuid references public.tenant_campaigns(id) on delete set null,
  add column if not exists field_notes jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.tenant_vendor_post_keys'::regclass
       and conname = 'tenant_vendor_post_keys_field_notes_is_object'
  ) then
    alter table public.tenant_vendor_post_keys
      add constraint tenant_vendor_post_keys_field_notes_is_object
      check (jsonb_typeof(field_notes) = 'object');
  end if;
end $$;

create index if not exists tenant_vendor_post_keys_campaign_idx
  on public.tenant_vendor_post_keys (campaign_id) where campaign_id is not null;

-- The tenant role reads this table column by column, so that the hash is never among them. The new
-- columns join the same list; service_role already holds table-wide rights.
-- Inside a block only so a parse-check run (which cannot add the columns) does not trip on it.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'tenant_vendor_post_keys' and column_name = 'field_notes') then
    grant select (campaign_id, field_notes) on public.tenant_vendor_post_keys to tenant_app;
  end if;
end $$;

-- ── the post log, per key ──────────────────────────────────────────────────
alter table public.tenant_lead_post_log
  add column if not exists key_id uuid references public.tenant_vendor_post_keys(id) on delete set null;

create index if not exists tenant_lead_post_log_key_idx
  on public.tenant_lead_post_log (tenant_id, key_id, received_at desc) where key_id is not null;

-- The rejection breakdown filters on tenant and window, then counts by reason.
create index if not exists tenant_lead_post_log_received_idx
  on public.tenant_lead_post_log (tenant_id, received_at desc, reason_code);

-- ── stage descriptions ─────────────────────────────────────────────────────
alter table public.tenant_pipeline_stages
  add column if not exists description text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.tenant_pipeline_stages'::regclass
       and conname = 'tenant_pipeline_stages_description_length'
  ) then
    alter table public.tenant_pipeline_stages
      add constraint tenant_pipeline_stages_description_length
      check (description is null or char_length(description) <= 200);
  end if;
end $$;

-- ── recent dispositions ────────────────────────────────────────────────────
create index if not exists lead_queue_disposition_at_idx
  on public.lead_queue (tenant_id, disposition_at desc) where disposition is not null;
