-- Performance pass (2026-10-20, SQL leftovers) · Partner chat: the newest messages of every channel in one call.
--
-- lib/partnerChat/service.ts getAgentChatChannels loads every channel the user can see (33 on the demo tenant)
-- and, per channel, read its newest 200 partner_messages and the user's partner_message_reads row — 66
-- PostgREST requests at once for one screen (~0.9 s of the page on the demo tenant).
--
--   partner_chat_latest_messages(tenant, user, channel ids, limit) → jsonb
--     { "<channel id>": { "messages": [ newest first, at most `limit` (default 200, 1–1000) ],
--                         "read_at":  that user's read_at for the channel, or null } }
--   Each message carries the columns the screen selected (id, channel_id, partner_id, work_item_id, message,
--   message_kind, card_type, card_payload, created_by, created_at, event_key). Messages that share a
--   created_at (cards written in one transaction) keep the order the PostgREST read gave them — the index's,
--   i.e. physical (ctid) order — so a thread shows them exactly as before. A channel id that is not
--   the tenant's comes back with no messages, as the tenant-filtered read did. One jsonb value, so PostgREST's
--   1,000-row cap never truncates it.
--
-- Access is unchanged: the app still decides which channels the user may see before it asks.
-- The app falls back to the per-channel reads while this is not applied (PGRST202 / 42883).
-- execute → service_role only.
--
-- Parity (demo tenant, rolled-back rehearsal as tenant_app with app.tenant_id + owner app.user_id): for every
-- channel the messages equal the PostgREST read (order by created_at desc, limit 200) row for row, and read_at
-- equals the maybeSingle() read, for two members.
--
-- Rollback: drop function public.partner_chat_latest_messages(uuid, uuid, uuid[], integer);

begin;

create or replace function public.partner_chat_latest_messages(
  p_tenant_id uuid,
  p_user_id uuid,
  p_channel_ids uuid[],
  p_limit integer default 200
)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
  select coalesce(jsonb_object_agg(ch.id::text, jsonb_build_object(
           'messages', coalesce((
             select jsonb_agg(to_jsonb(m) - 'tie_order' order by m.created_at desc, m.tie_order)
               from (select pm.id, pm.channel_id, pm.partner_id, pm.work_item_id, pm.message, pm.message_kind,
                            pm.card_type, pm.card_payload, pm.created_by, pm.created_at, pm.event_key,
                            pm.ctid as tie_order
                       from public.partner_messages pm
                      where pm.tenant_id = p_tenant_id and pm.channel_id = ch.id
                      order by pm.created_at desc, pm.ctid
                      limit least(greatest(coalesce(p_limit, 200), 1), 1000)) m), '[]'::jsonb),
           'read_at', (select r.read_at from public.partner_message_reads r
                        where r.tenant_id = p_tenant_id and r.channel_id = ch.id and r.user_id = p_user_id))),
         '{}'::jsonb)
    from (select distinct u.id from unnest(p_channel_ids) as u(id) where u.id is not null) ch;
$$;

revoke all on function public.partner_chat_latest_messages(uuid, uuid, uuid[], integer) from public, anon, authenticated, tenant_app;
grant execute on function public.partner_chat_latest_messages(uuid, uuid, uuid[], integer) to service_role;

-- ─── self-check ──────────────────────────────────────────────────────────────────────────────────
-- For the tenant with the most messages: every channel's newest messages and count match a direct read.
do $$
declare
  v_tenant uuid;
  v_channels uuid[];
  v_got jsonb;
  v_ch uuid;
  v_ref jsonb;
begin
  select m.tenant_id into v_tenant from public.partner_messages m group by m.tenant_id order by count(*) desc limit 1;
  if v_tenant is null then
    return;
  end if;
  select array_agg(c.id) into v_channels from public.partner_channels c where c.tenant_id = v_tenant;
  v_got := public.partner_chat_latest_messages(v_tenant, null, v_channels, 200);
  foreach v_ch in array coalesce(v_channels, '{}'::uuid[]) loop
    select coalesce(jsonb_agg(to_jsonb(x.id) order by x.created_at desc, x.ctid), '[]'::jsonb) into v_ref
      from (select m.id, m.created_at, m.ctid from public.partner_messages m
             where m.tenant_id = v_tenant and m.channel_id = v_ch
             order by m.created_at desc, m.ctid limit 200) x;
    if (select coalesce(jsonb_agg(e->'id'), '[]'::jsonb) from jsonb_array_elements(v_got->v_ch::text->'messages') e) is distinct from v_ref then
      raise exception 'perf: partner_chat_latest_messages differs for channel %', v_ch;
    end if;
  end loop;
end;
$$;

commit;

notify pgrst, 'reload schema';
