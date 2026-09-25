-- Point two tenant-plane foreign keys at this application's leads.
--
-- public.leads is the organizations-era CRM's lead table. This application's leads are in
-- public.agent_leads. Five tenant-plane tables carry a lead_id referencing the wrong one:
--
--   callbacks         lead_id NOT NULL, 0 rows        -- blocks every write. LA-1.22.
--   lead_sla_events   lead_id NOT NULL, 0 rows        -- blocks every write. LA-1.23.
--   lead_notes        lead_id NOT NULL, 2 rows        -- blocks every write. LA-1.21. NOT fixed here.
--   screening_audit   lead_id nullable, 0 non-null    -- latent: never written, so never fires
--   screening_results lead_id nullable, 0 non-null    -- latent: never written, so never fires
--
-- All three NOT NULL ones are declared in this repository as
-- `lead_id uuid not null references public.agent_leads(id) on delete cascade`, so the live shape is
-- not a design difference -- it is the same collision found in pipelines, verification_sessions and
-- disposition_flows, and the declaration never landed because these tables pre-date this
-- application.
--
-- This fixes the two that are empty. Repointing a foreign key revalidates every existing row, so an
-- empty table makes it a no-risk change and a populated one makes it a decision.
--
-- lead_notes is LEFT ALONE on purpose. It holds two rows whose lead_id references real
-- public.leads rows, so repointing would fail validation against them. Those rows belong to the
-- other lineage and are not this application's to move or delete. LA-1.21 has to choose between
-- repointing after relocating them and renaming to tenant_lead_notes as SA-3 did for invoices --
-- and that is a decision about another product's data, not a migration to write in passing.
-- Recorded in backlog 179.
--
-- The two screening columns are left as they are: nullable, never populated by this application, so
-- the constraint has never been exercised. Worth knowing they are wrong before something starts
-- writing them, which is why they are named here rather than only in the backlog.

alter table public.callbacks drop constraint if exists callbacks_lead_id_fkey;
alter table public.callbacks
  add constraint callbacks_lead_id_fkey
  foreign key (lead_id) references public.agent_leads(id) on delete cascade;

alter table public.lead_sla_events drop constraint if exists lead_sla_events_lead_id_fkey;
alter table public.lead_sla_events
  add constraint lead_sla_events_lead_id_fkey
  foreign key (lead_id) references public.agent_leads(id) on delete cascade;

do $$
declare
  wrong text;
begin
  select string_agg(c.conrelid::regclass::text, ', ') into wrong
    from pg_constraint c
   where c.contype = 'f'
     and c.confrelid = 'public.leads'::regclass
     and c.conrelid in ('public.callbacks'::regclass, 'public.lead_sla_events'::regclass);

  if wrong is not null then
    raise exception 'still pointing at the CRM leads table: %', wrong;
  end if;
end;
$$;
