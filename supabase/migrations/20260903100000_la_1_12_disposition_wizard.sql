-- LA-1.12: one tenant vocabulary, configurable disposition walks, and atomic call close.
-- The catalog is tenant data. The code never branches on partner type or a plan to invent a
-- second vocabulary; flows, nodes, and options are read from these tables.

alter table public.lead_queue drop constraint if exists lead_queue_status_check;
alter table public.lead_queue add constraint lead_queue_status_check
  check (status in ('unclaimed', 'claimed', 'completed', 'closed', 'dropped'));

alter table public.agent_leads
  add column if not exists callback_subtype text
    check (callback_subtype is null or char_length(btrim(callback_subtype)) between 1 and 120);

alter table public.deal_flow
  add column if not exists status text not null default 'partial'
    check (status in ('partial', 'completed', 'dropped')),
  add column if not exists call_result text,
  add column if not exists notes text,
  add column if not exists disposition_at timestamptz,
  add column if not exists disposition_by uuid references public.users(id) on delete set null;

create table if not exists public.dispositions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  disposition_key text not null check (disposition_key ~ '^[a-z][a-z0-9_]{1,79}$'),
  label text not null check (char_length(btrim(label)) between 1 and 120),
  counts_as_work_completed boolean not null default false,
  closes_as text not null default 'completed' check (closes_as in ('completed', 'dropped')),
  is_active boolean not null default true,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, disposition_key)
);

create table if not exists public.disposition_flows (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  stage_id uuid not null references public.pipeline_stages(id) on delete restrict,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  is_active boolean not null default true,
  root_node_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, stage_id)
);

create table if not exists public.disposition_nodes (
  id uuid primary key default gen_random_uuid(),
  flow_id uuid not null references public.disposition_flows(id) on delete cascade,
  node_key text not null check (node_key ~ '^[a-z][a-z0-9_]{1,79}$'),
  label text not null check (char_length(btrim(label)) between 1 and 160),
  prompt text not null check (char_length(btrim(prompt)) between 1 and 2000),
  node_type text not null check (node_type in ('choice', 'multi_select', 'free_text')),
  field_key text,
  note_template text check (note_template is null or char_length(note_template) <= 2000),
  next_node_id uuid,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (flow_id, node_key),
  unique (flow_id, id)
);

alter table public.disposition_flows
  add constraint disposition_flows_root_node_fk
  foreign key (root_node_id) references public.disposition_nodes(id) on delete set null;
alter table public.disposition_nodes
  add constraint disposition_nodes_next_node_fk
  foreign key (flow_id, next_node_id) references public.disposition_nodes(flow_id, id) on delete set null;

create table if not exists public.disposition_options (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references public.disposition_nodes(id) on delete cascade,
  option_key text not null check (option_key ~ '^[a-z][a-z0-9_]{1,79}$'),
  label text not null check (char_length(btrim(label)) between 1 and 160),
  next_node_id uuid,
  disposition_key text,
  note_template text check (note_template is null or char_length(note_template) <= 2000),
  sort_order integer not null default 0 check (sort_order >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (node_id, option_key)
);

create table if not exists public.disposition_walks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  work_item_id uuid not null references public.lead_queue(id) on delete cascade,
  lead_id uuid not null references public.agent_leads(id) on delete cascade,
  flow_id uuid not null references public.disposition_flows(id) on delete restrict,
  user_id uuid not null references public.users(id) on delete restrict,
  status text not null default 'open' check (status in ('open', 'completed')),
  current_node_id uuid,
  final_disposition_key text,
  composed_note text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (tenant_id, work_item_id),
  check ((status = 'open' and completed_at is null) or (status = 'completed' and completed_at is not null))
);

alter table public.disposition_walks
  add constraint disposition_walks_current_node_fk
  foreign key (flow_id, current_node_id) references public.disposition_nodes(flow_id, id) on delete set null;

create table if not exists public.disposition_walk_steps (
  id uuid primary key default gen_random_uuid(),
  walk_id uuid not null references public.disposition_walks(id) on delete cascade,
  sequence integer not null check (sequence >= 0 and sequence <= 100),
  node_id uuid not null references public.disposition_nodes(id) on delete restrict,
  answer jsonb not null default 'null'::jsonb,
  option_key text,
  note_fragment text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (walk_id, sequence)
);

create table if not exists public.tenant_do_not_call (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  phone_digits text not null check (phone_digits ~ '^[0-9]{10}$'),
  lead_id uuid references public.agent_leads(id) on delete set null,
  added_by uuid references public.users(id) on delete set null,
  reason text not null default 'Agent selected Do not call' check (char_length(btrim(reason)) between 1 and 500),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists tenant_do_not_call_active_phone_idx
  on public.tenant_do_not_call (tenant_id, phone_digits) where is_active;
create index if not exists disposition_flows_tenant_idx on public.disposition_flows (tenant_id, stage_id);
create index if not exists disposition_nodes_flow_order_idx on public.disposition_nodes (flow_id, sort_order, created_at);
create index if not exists disposition_options_node_order_idx on public.disposition_options (node_id, sort_order, created_at);
create index if not exists disposition_walks_tenant_status_idx on public.disposition_walks (tenant_id, status, updated_at desc);
create index if not exists disposition_walk_steps_walk_idx on public.disposition_walk_steps (walk_id, sequence);
create index if not exists tenant_do_not_call_tenant_idx on public.tenant_do_not_call (tenant_id, created_at desc);

create or replace function public.touch_disposition_updated_at()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists dispositions_touch_updated_at on public.dispositions;
create trigger dispositions_touch_updated_at before update on public.dispositions for each row execute function public.touch_disposition_updated_at();
drop trigger if exists disposition_flows_touch_updated_at on public.disposition_flows;
create trigger disposition_flows_touch_updated_at before update on public.disposition_flows for each row execute function public.touch_disposition_updated_at();
drop trigger if exists disposition_nodes_touch_updated_at on public.disposition_nodes;
create trigger disposition_nodes_touch_updated_at before update on public.disposition_nodes for each row execute function public.touch_disposition_updated_at();
drop trigger if exists disposition_options_touch_updated_at on public.disposition_options;
create trigger disposition_options_touch_updated_at before update on public.disposition_options for each row execute function public.touch_disposition_updated_at();
drop trigger if exists disposition_walks_touch_updated_at on public.disposition_walks;
create trigger disposition_walks_touch_updated_at before update on public.disposition_walks for each row execute function public.touch_disposition_updated_at();
drop trigger if exists disposition_walk_steps_touch_updated_at on public.disposition_walk_steps;
create trigger disposition_walk_steps_touch_updated_at before update on public.disposition_walk_steps for each row execute function public.touch_disposition_updated_at();
drop trigger if exists tenant_do_not_call_touch_updated_at on public.tenant_do_not_call;
create trigger tenant_do_not_call_touch_updated_at before update on public.tenant_do_not_call for each row execute function public.touch_disposition_updated_at();

create or replace function public.seed_default_disposition_flow_for_stage(p_tenant_id uuid, p_stage_id uuid)
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
declare
  v_flow_id uuid;
  v_root_id uuid;
begin
  if not exists (select 1 from public.pipeline_stages s join public.pipelines p on p.id = s.pipeline_id where s.id = p_stage_id and p.tenant_id = p_tenant_id and not s.is_archived) then
    return;
  end if;
  insert into public.disposition_flows (tenant_id, stage_id, name)
  values (p_tenant_id, p_stage_id, 'Default call outcome')
  on conflict (tenant_id, stage_id) do update set is_active = true
  returning id into v_flow_id;
  if v_flow_id is null then select id into v_flow_id from public.disposition_flows where tenant_id = p_tenant_id and stage_id = p_stage_id; end if;
  insert into public.disposition_nodes (flow_id, node_key, label, prompt, node_type, sort_order)
  values (v_flow_id, 'outcome', 'Call outcome', 'What was the outcome of the call?', 'choice', 0)
  on conflict (flow_id, node_key) do update set label = excluded.label, prompt = excluded.prompt;
  select id into v_root_id from public.disposition_nodes where flow_id = v_flow_id and node_key = 'outcome';
  update public.disposition_flows set root_node_id = v_root_id where id = v_flow_id;
  insert into public.disposition_options (node_id, option_key, label, disposition_key, note_template, sort_order)
  select v_root_id, d.disposition_key, d.label, d.disposition_key, '{{client_name}} — {{disposition_label}}.', d.sort_order
  from public.dispositions d where d.tenant_id = p_tenant_id and d.is_active
  on conflict (node_id, option_key) do update set label = excluded.label, disposition_key = excluded.disposition_key, note_template = excluded.note_template, sort_order = excluded.sort_order;
end;
$$;

create or replace function public.seed_default_disposition_flows(p_tenant_id uuid)
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_stage record;
begin
  for v_stage in select s.id from public.pipeline_stages s join public.pipelines p on p.id = s.pipeline_id where p.tenant_id = p_tenant_id and not s.is_archived loop
    perform public.seed_default_disposition_flow_for_stage(p_tenant_id, v_stage.id);
  end loop;
end;
$$;

create or replace function public.seed_default_dispositions(p_tenant_id uuid)
returns void language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  insert into public.dispositions (tenant_id, disposition_key, label, counts_as_work_completed, closes_as, sort_order)
  values
    (p_tenant_id, 'application_submitted', 'Application submitted', true, 'completed', 10),
    (p_tenant_id, 'sent_to_underwriting', 'Sent to underwriting', true, 'completed', 20),
    (p_tenant_id, 'callback_scheduled', 'Callback scheduled', false, 'completed', 30),
    (p_tenant_id, 'did_not_qualify', 'Did not qualify', false, 'completed', 40),
    (p_tenant_id, 'no_payment_method', 'No payment method', false, 'completed', 50),
    (p_tenant_id, 'not_interested', 'Not interested', false, 'completed', 60),
    (p_tenant_id, 'do_not_call', 'Do not call', false, 'completed', 70),
    (p_tenant_id, 'call_dropped', 'Call dropped', false, 'dropped', 80)
  on conflict (tenant_id, disposition_key) do update set label = excluded.label, counts_as_work_completed = excluded.counts_as_work_completed, closes_as = excluded.closes_as, sort_order = excluded.sort_order, is_active = true;
  perform public.seed_default_disposition_flows(p_tenant_id);
end;
$$;

create or replace function public.seed_dispositions_after_tenant_insert()
returns trigger language plpgsql security definer set search_path = public, pg_catalog as $$
begin
  perform public.seed_default_dispositions(new.id);
  return new;
end;
$$;

drop trigger if exists seed_dispositions_after_tenant_insert on public.tenants;
create trigger seed_dispositions_after_tenant_insert after insert on public.tenants
for each row execute function public.seed_dispositions_after_tenant_insert();

drop trigger if exists seed_disposition_flow_after_stage_insert on public.pipeline_stages;
create or replace function public.seed_disposition_flow_after_stage_insert()
returns trigger language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_tenant_id uuid;
begin
  select tenant_id into v_tenant_id from public.pipelines where id = new.pipeline_id;
  if v_tenant_id is not null and not new.is_archived then perform public.seed_default_disposition_flow_for_stage(v_tenant_id, new.id); end if;
  return new;
end;
$$;
create trigger seed_disposition_flow_after_stage_insert after insert on public.pipeline_stages
for each row execute function public.seed_disposition_flow_after_stage_insert();

do $$ declare v_tenant_id uuid; begin
  for v_tenant_id in select id from public.tenants loop perform public.seed_default_dispositions(v_tenant_id); end loop;
end $$;

create or replace function public.is_tenant_phone_suppressed(p_tenant_id uuid, p_phone_digits text)
returns boolean language sql security definer set search_path = public, pg_catalog as $$
  select exists (select 1 from public.tenant_do_not_call where tenant_id = p_tenant_id and phone_digits = p_phone_digits and is_active);
$$;

create or replace function public.render_disposition_note(p_template text, p_client_name text, p_carriers text, p_field_label text, p_disposition_label text, p_answer text)
returns text language plpgsql immutable as $$
begin
  return replace(replace(replace(replace(replace(coalesce(p_template, ''), '{{client_name}}', coalesce(p_client_name, 'Customer')), '{{carriers}}', coalesce(p_carriers, 'Not specified')), '{{field_label}}', coalesce(p_field_label, 'Answer')), '{{disposition_label}}', coalesce(p_disposition_label, '')), '{{answer}}', coalesce(p_answer, ''));
end;
$$;

create or replace function public.start_disposition_walk(p_tenant_id uuid, p_work_item_id uuid, p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_item public.lead_queue; v_flow public.disposition_flows; v_walk public.disposition_walks;
begin
  select q.* into v_item from public.lead_queue q where q.id = p_work_item_id and q.tenant_id = p_tenant_id and q.owner_user_id = p_user_id and q.status in ('claimed','completed','dropped') for update;
  if not found then raise exception 'DISPOSITION_OWNER_REQUIRED'; end if;
  select f.* into v_flow from public.disposition_flows f where f.tenant_id = p_tenant_id and f.stage_id = v_item.stage_id and f.is_active;
  if not found then raise exception 'DISPOSITION_FLOW_NOT_FOUND'; end if;
  select w.* into v_walk from public.disposition_walks w where w.tenant_id = p_tenant_id and w.work_item_id = p_work_item_id for update;
  if not found then
    insert into public.disposition_walks (tenant_id, work_item_id, lead_id, flow_id, user_id, current_node_id)
    values (p_tenant_id, p_work_item_id, v_item.lead_id, v_flow.id, p_user_id, v_flow.root_node_id) returning * into v_walk;
  else
    if v_walk.flow_id <> v_flow.id then raise exception 'DISPOSITION_FLOW_CHANGED'; end if;
    update public.disposition_walks set user_id = p_user_id, updated_at = now() where id = v_walk.id returning * into v_walk;
  end if;
  return jsonb_build_object('walk_id', v_walk.id, 'flow_id', v_walk.flow_id, 'current_node_id', v_walk.current_node_id, 'status', v_walk.status, 'final_disposition_key', v_walk.final_disposition_key);
end;
$$;

create or replace function public.record_disposition_answer(
  p_tenant_id uuid, p_work_item_id uuid, p_user_id uuid, p_walk_id uuid, p_node_id uuid,
  p_sequence integer, p_answer jsonb, p_option_key text default null
)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_item public.lead_queue; v_walk public.disposition_walks; v_node public.disposition_nodes; v_option public.disposition_options;
  v_next_node uuid; v_note_template text; v_disposition_key text; v_client text; v_carriers text; v_answer_text text; v_note text;
begin
  if p_sequence < 0 or p_sequence > 100 then raise exception 'DISPOSITION_SEQUENCE_INVALID'; end if;
  select q.* into v_item from public.lead_queue q where q.id = p_work_item_id and q.tenant_id = p_tenant_id and q.owner_user_id = p_user_id and q.status in ('claimed','completed','dropped') for update;
  if not found then raise exception 'DISPOSITION_OWNER_REQUIRED'; end if;
  select w.* into v_walk from public.disposition_walks w where w.id = p_walk_id and w.tenant_id = p_tenant_id and w.work_item_id = p_work_item_id for update;
  if not found then raise exception 'DISPOSITION_WALK_NOT_FOUND'; end if;
  select n.* into v_node from public.disposition_nodes n where n.id = p_node_id and n.flow_id = v_walk.flow_id;
  if not found then raise exception 'DISPOSITION_NODE_NOT_FOUND'; end if;
  if v_node.node_type = 'choice' then
    if p_option_key is null then raise exception 'DISPOSITION_OPTION_REQUIRED'; end if;
    select o.* into v_option from public.disposition_options o where o.node_id = v_node.id and o.option_key = p_option_key;
    if not found then raise exception 'DISPOSITION_OPTION_NOT_FOUND'; end if;
    v_next_node := v_option.next_node_id; v_disposition_key := v_option.disposition_key; v_note_template := v_option.note_template;
  else
    if v_node.node_type = 'multi_select' and jsonb_typeof(coalesce(p_answer, 'null'::jsonb)) <> 'array' then raise exception 'DISPOSITION_MULTI_SELECT_REQUIRED'; end if;
    if v_node.node_type = 'free_text' and (jsonb_typeof(coalesce(p_answer, 'null'::jsonb)) <> 'string' or char_length(p_answer #>> '{}') > 2000) then raise exception 'DISPOSITION_TEXT_INVALID'; end if;
    v_next_node := v_node.next_node_id; v_note_template := v_node.note_template;
  end if;
  select coalesce(nullif(btrim(l.values->>'full_name'), ''), nullif(btrim(concat_ws(' ', l.values->>'first_name', l.values->>'last_name')), ''), 'Customer'), coalesce(nullif(l.values->>'carrier', ''), nullif(l.values->>'preferred_carrier', ''), 'Not specified') into v_client, v_carriers from public.agent_leads l where l.id = v_item.lead_id and l.tenant_id = p_tenant_id;
  v_answer_text := case when jsonb_typeof(coalesce(p_answer, 'null'::jsonb)) = 'array' then (select string_agg(value, ', ') from jsonb_array_elements_text(p_answer)) else coalesce(p_answer #>> '{}', '') end;
  v_note := public.render_disposition_note(v_note_template, v_client, v_carriers, v_node.label, null, v_answer_text);
  delete from public.disposition_walk_steps where walk_id = v_walk.id and sequence >= p_sequence;
  insert into public.disposition_walk_steps (walk_id, sequence, node_id, answer, option_key, note_fragment) values (v_walk.id, p_sequence, v_node.id, coalesce(p_answer, 'null'::jsonb), p_option_key, v_note);
  update public.disposition_walks set status = 'open', completed_at = null, final_disposition_key = null, composed_note = null, current_node_id = v_next_node, user_id = p_user_id, updated_at = now() where id = v_walk.id;
  return jsonb_build_object('walk_id', v_walk.id, 'sequence', p_sequence, 'current_node_id', v_next_node, 'terminal_disposition_key', v_disposition_key, 'note_fragment', v_note);
end;
$$;

create or replace function public.complete_disposition(
  p_tenant_id uuid, p_work_item_id uuid, p_user_id uuid, p_walk_id uuid, p_disposition_key text, p_callback_subtype text default null
)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_item public.lead_queue; v_walk public.disposition_walks; v_disposition public.dispositions; v_stage_id uuid; v_note text; v_phone text; v_customer text; v_partner_id uuid; v_status text; v_dnc_added boolean := false;
begin
  select q.* into v_item from public.lead_queue q where q.id = p_work_item_id and q.tenant_id = p_tenant_id and q.owner_user_id = p_user_id and q.status in ('claimed','completed','dropped') for update;
  if not found then raise exception 'DISPOSITION_OWNER_REQUIRED'; end if;
  select w.* into v_walk from public.disposition_walks w where w.id = p_walk_id and w.tenant_id = p_tenant_id and w.work_item_id = p_work_item_id for update;
  if not found then raise exception 'DISPOSITION_WALK_NOT_FOUND'; end if;
  if v_walk.current_node_id is not null then raise exception 'DISPOSITION_WALK_INCOMPLETE'; end if;
  select d.* into v_disposition from public.dispositions d where d.tenant_id = p_tenant_id and d.disposition_key = p_disposition_key and d.is_active;
  if not found then raise exception 'DISPOSITION_NOT_FOUND'; end if;
  if p_callback_subtype is not null and char_length(btrim(p_callback_subtype)) > 120 then raise exception 'CALLBACK_SUBTYPE_INVALID'; end if;
  select string_agg(nullif(btrim(s.note_fragment), ''), ' ' order by s.sequence) into v_note from public.disposition_walk_steps s where s.walk_id = v_walk.id;
  select l.values->>'phone', coalesce(nullif(btrim(l.values->>'full_name'), ''), nullif(btrim(concat_ws(' ', l.values->>'first_name', l.values->>'last_name')), ''), 'Customer') into v_phone, v_customer from public.agent_leads l where l.id = v_item.lead_id and l.tenant_id = p_tenant_id for update;
  select sd.stage_id into v_stage_id from public.stage_dispositions sd join public.pipeline_stages ps on ps.id = sd.stage_id where sd.tenant_id = p_tenant_id and sd.disposition_key = p_disposition_key and ps.pipeline_id = v_item.pipeline_id and not ps.is_archived limit 1;
  v_stage_id := coalesce(v_stage_id, v_item.stage_id);
  v_status := v_disposition.closes_as;
  update public.agent_leads set stage_id = v_stage_id, callback_subtype = case when p_disposition_key = 'callback_scheduled' then nullif(btrim(p_callback_subtype), '') else null end, updated_at = now() where id = v_item.lead_id and tenant_id = p_tenant_id;
  update public.lead_queue set status = v_status, disposition = v_disposition.disposition_key, disposition_at = now(), disposition_by = p_user_id, stage_id = v_stage_id, updated_at = now() where id = v_item.id and tenant_id = p_tenant_id;
  update public.active_calls set ended_at = coalesce(ended_at, now()), updated_at = now() where work_item_id = v_item.id and tenant_id = p_tenant_id and ended_at is null;
  update public.deal_flow set status = case when v_status = 'dropped' then 'dropped' else 'completed' end, call_result = v_disposition.disposition_key, notes = nullif(v_note, ''), disposition_at = now(), disposition_by = p_user_id, pipeline_id = v_item.pipeline_id, stage_id = v_stage_id, updated_at = now() where lead_id = v_item.lead_id and tenant_id = p_tenant_id;
  select partner_id into v_partner_id from public.lead_queue where id = v_item.id and tenant_id = p_tenant_id;
  if v_partner_id is not null then insert into public.partner_messages (tenant_id, partner_id, work_item_id, message, created_by) values (p_tenant_id, v_partner_id, v_item.id, v_customer || ': ' || v_disposition.label, p_user_id); end if;
  if p_disposition_key = 'do_not_call' then
    v_phone := right(regexp_replace(coalesce(v_phone, ''), '[^0-9]', '', 'g'), 10);
    if v_phone !~ '^[0-9]{10}$' then raise exception 'DO_NOT_CALL_PHONE_REQUIRED'; end if;
    insert into public.tenant_do_not_call (tenant_id, phone_digits, lead_id, added_by) values (p_tenant_id, v_phone, v_item.lead_id, p_user_id) on conflict (tenant_id, phone_digits) where is_active do update set lead_id = excluded.lead_id, added_by = excluded.added_by, updated_at = now();
    v_dnc_added := true;
  end if;
  update public.disposition_walks set status = 'completed', completed_at = now(), final_disposition_key = v_disposition.disposition_key, composed_note = nullif(v_note, ''), current_node_id = null, user_id = p_user_id, updated_at = now() where id = v_walk.id;
  insert into public.audit_log (actor_type, actor_id, action, target_type, target_id, metadata) values ('tenant', p_user_id, 'tenant.dispositioned', 'lead_queue', v_item.id::text, jsonb_build_object('leadId', v_item.lead_id, 'dispositionKey', v_disposition.disposition_key, 'status', v_status, 'stageId', v_stage_id, 'dncAdded', v_dnc_added));
  return jsonb_build_object('work_item_id', v_item.id, 'lead_id', v_item.lead_id, 'status', v_status, 'disposition_key', v_disposition.disposition_key, 'label', v_disposition.label, 'stage_id', v_stage_id, 'note', v_note, 'dnc_added', v_dnc_added);
end;
$$;

alter table public.dispositions enable row level security;
alter table public.disposition_flows enable row level security;
alter table public.disposition_nodes enable row level security;
alter table public.disposition_options enable row level security;
alter table public.disposition_walks enable row level security;
alter table public.disposition_walk_steps enable row level security;
alter table public.tenant_do_not_call enable row level security;

drop policy if exists dispositions_tenant_scoped on public.dispositions;
create policy dispositions_tenant_scoped on public.dispositions for all to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid) with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
drop policy if exists disposition_flows_tenant_scoped on public.disposition_flows;
create policy disposition_flows_tenant_scoped on public.disposition_flows for all to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid) with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
drop policy if exists disposition_nodes_tenant_scoped on public.disposition_nodes;
create policy disposition_nodes_tenant_scoped on public.disposition_nodes for all to tenant_app using (exists (select 1 from public.disposition_flows f where f.id = flow_id and f.tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)) with check (exists (select 1 from public.disposition_flows f where f.id = flow_id and f.tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid));
drop policy if exists disposition_options_tenant_scoped on public.disposition_options;
create policy disposition_options_tenant_scoped on public.disposition_options for all to tenant_app using (exists (select 1 from public.disposition_nodes n join public.disposition_flows f on f.id = n.flow_id where n.id = node_id and f.tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)) with check (exists (select 1 from public.disposition_nodes n join public.disposition_flows f on f.id = n.flow_id where n.id = node_id and f.tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid));
drop policy if exists disposition_walks_tenant_scoped on public.disposition_walks;
create policy disposition_walks_tenant_scoped on public.disposition_walks for all to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid) with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);
drop policy if exists disposition_walk_steps_tenant_scoped on public.disposition_walk_steps;
create policy disposition_walk_steps_tenant_scoped on public.disposition_walk_steps for all to tenant_app using (exists (select 1 from public.disposition_walks w where w.id = walk_id and w.tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid)) with check (exists (select 1 from public.disposition_walks w where w.id = walk_id and w.tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid));
drop policy if exists tenant_do_not_call_tenant_scoped on public.tenant_do_not_call;
create policy tenant_do_not_call_tenant_scoped on public.tenant_do_not_call for all to tenant_app using (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid) with check (tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid);

revoke all on public.dispositions, public.disposition_flows, public.disposition_nodes, public.disposition_options, public.disposition_walks, public.disposition_walk_steps, public.tenant_do_not_call from anon, authenticated, public;
grant select, insert, update on public.dispositions, public.disposition_flows, public.disposition_nodes, public.disposition_options, public.disposition_walks, public.disposition_walk_steps, public.tenant_do_not_call to tenant_app;
grant select, insert, update on public.dispositions, public.disposition_flows, public.disposition_nodes, public.disposition_options, public.disposition_walks, public.disposition_walk_steps, public.tenant_do_not_call to service_role;
revoke all on function public.seed_default_disposition_flow_for_stage(uuid, uuid), public.seed_default_disposition_flows(uuid), public.seed_default_dispositions(uuid), public.seed_dispositions_after_tenant_insert(), public.seed_disposition_flow_after_stage_insert(), public.touch_disposition_updated_at(), public.is_tenant_phone_suppressed(uuid, text), public.render_disposition_note(text, text, text, text, text, text), public.start_disposition_walk(uuid, uuid, uuid), public.record_disposition_answer(uuid, uuid, uuid, uuid, uuid, integer, jsonb, text), public.complete_disposition(uuid, uuid, uuid, uuid, text, text) from public, anon, authenticated, tenant_app;
grant execute on function public.start_disposition_walk(uuid, uuid, uuid), public.record_disposition_answer(uuid, uuid, uuid, uuid, uuid, integer, jsonb, text), public.complete_disposition(uuid, uuid, uuid, uuid, text, text), public.is_tenant_phone_suppressed(uuid, text) to service_role;
