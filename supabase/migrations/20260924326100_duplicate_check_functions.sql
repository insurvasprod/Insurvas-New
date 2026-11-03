-- /app/duplicates: matching that ignores merged-away contacts, merges that answer the review queue,
-- an undo that cannot lose a later merge, and the reads the redesigned page needs.
--
-- Depends on 20260924326000 (contact_duplicate_reviews, merge_log.source/review_id/review_snapshot,
-- agent_leads.contact_id).
--
-- 1. find_contact_duplicates (latest: 20260914220000). The alternate-phone branch read
--    contact_phones without asking whether the contact was still a record of its own, and the final
--    join did not ask either. A merged-away contact keeps its phone rows (merge copies them to the
--    survivor, it does not move them), so it matched on phone, won auto-merge, and merge_contacts
--    then refused it ("A merged contact cannot be merged again"): an orphan new contact and a 400,
--    which aborted a CSV import at that row. Both places now require merged_into_id is null.
--    Signature and scoring unchanged.
--
-- 2. merge_contacts (latest: 20260911103000, which carries the organization_id bridge; kept).
--    Gains p_review_id and p_source. The pair's pending review is resolved in the same transaction
--    as the merge. Every other pending review that named the merged-away contact is re-pointed to
--    the survivor (or, where the survivor already has that question open, closed by this merge),
--    and all of them are snapshotted into merge_log.review_snapshot so undo can restore them.
--    A new signature cannot be made with create or replace: the 5-argument function is dropped and
--    the 7-argument one created and granted exactly as before. The new arguments default, so a
--    5-argument named call still resolves.
--
-- 3. undo_contact_merge (latest: 20260911103000; signature unchanged). Undo restores from the
--    snapshots taken at merge time. When a later merge touched either contact, those snapshots are
--    stale: undoing the earlier merge overwrote the survivor with its pre-merge self, dropped every
--    phone and email the later merge had copied in, and left the later merge pointing at a record
--    that no longer held its data. Undo now locks both contacts and refuses, with the reason, while
--    a later merge that is still in place involves either of them. It also reopens the reviews the
--    merge resolved or re-pointed.
--
-- 4. New reads: contact_directory_page (server-side search and paging with the total, the lead
--    count and the open-review flag), contact_duplicate_stats (the four tiles), and
--    link_leads_to_contacts (sets agent_leads.contact_id on a confident match only).
--
-- All service_role only, security invoker, search_path pinned.

-- ── 1. find_contact_duplicates ─────────────────────────────────────────────
create or replace function public.find_contact_duplicates(
  p_tenant_id uuid,
  p_name_search text,
  p_dob date default null,
  p_phone text default null,
  p_address_search text default null,
  p_address_hash text default null,
  p_limit integer default 20
)
returns table (
  contact_id uuid,
  household_id uuid,
  first_name text,
  last_name text,
  dob date,
  primary_phone text,
  state text,
  custom_fields jsonb,
  address_line1 text,
  city text,
  postal_code text,
  score numeric,
  confidence text,
  matched_on text[]
)
language sql stable security invoker set search_path = public
as $$
with candidate_ids as materialized (
  select c.id, true as phone_match
  from public.contacts c
  where c.tenant_id = p_tenant_id
    and c.merged_into_id is null
    and p_phone is not null
    and c.primary_phone = p_phone

  union all

  select cp.contact_id, true as phone_match
  from public.contact_phones cp
  join public.contacts pc
    on pc.id = cp.contact_id
   and pc.tenant_id = p_tenant_id
   and pc.merged_into_id is null
  where p_phone is not null
    and cp.tenant_id = p_tenant_id
    and cp.phone = p_phone

  union all

  select c.id, false as phone_match
  from public.contacts c
  where c.tenant_id = p_tenant_id
    and c.merged_into_id is null
    and p_dob is not null
    and c.dob = p_dob

  union all

  select c.id, false as phone_match
  from public.contacts c
  join public.households h
    on h.id = c.household_id
   and h.tenant_id = p_tenant_id
  where c.tenant_id = p_tenant_id
    and c.merged_into_id is null
    and p_address_hash is not null
    and h.address_hash = p_address_hash

  union all

  select c.id, false as phone_match
  from public.contacts c
  where c.tenant_id = p_tenant_id
    and c.merged_into_id is null
    and nullif(p_name_search, '') is not null
    and c.name_search % p_name_search

  union all

  select c.id, false as phone_match
  from public.contacts c
  join public.households h
    on h.id = c.household_id
   and h.tenant_id = p_tenant_id
  where c.tenant_id = p_tenant_id
    and c.merged_into_id is null
    and nullif(p_address_search, '') is not null
    and h.address_search % p_address_search
), deduped_ids as materialized (
  select id, bool_or(phone_match) as phone_match
  from candidate_ids
  group by id
), candidates as (
  select
    c.id as contact_id,
    c.household_id,
    c.first_name,
    c.last_name,
    c.dob,
    c.primary_phone,
    c.state,
    c.custom_fields,
    h.address_line1,
    h.city,
    h.postal_code,
    (
      (case when p_phone is not null and (c.primary_phone = p_phone or ids.phone_match)
            then 0.35 else 0 end) +
      (case when p_dob is not null and c.dob = p_dob then 0.25 else 0 end) +
      (case when p_address_hash is not null and h.address_hash = p_address_hash then 0.20 else 0 end) +
      (case when nullif(p_name_search, '') is not null
            then greatest(similarity(coalesce(c.name_search, ''), p_name_search), 0) * 0.40 else 0 end) +
      (case when nullif(p_address_search, '') is not null and h.address_search is not null
            then greatest(similarity(h.address_search, p_address_search), 0) * 0.20 else 0 end)
    )::numeric as raw_score,
    array_remove(array[
      case when p_phone is not null and (c.primary_phone = p_phone or ids.phone_match)
           then 'phone' end,
      case when p_dob is not null and c.dob = p_dob then 'dob' end,
      case when p_address_hash is not null and h.address_hash = p_address_hash then 'address' end,
      case when nullif(p_name_search, '') is not null
             and similarity(coalesce(c.name_search, ''), p_name_search) >= 0.45 then 'name' end
    ], null) as matched_on
  from deduped_ids ids
  join public.contacts c
    on c.id = ids.id
   and c.tenant_id = p_tenant_id
   and c.merged_into_id is null
  left join public.households h
    on h.id = c.household_id
   and h.tenant_id = p_tenant_id
), filtered as (
  select *, round(raw_score, 4) as rounded_score
  from candidates
  where raw_score >= 0.45
)
select contact_id, household_id, first_name, last_name, dob, primary_phone, state, custom_fields,
       address_line1, city, postal_code, rounded_score,
       case when rounded_score >= 0.78 then 'high' when rounded_score >= 0.60 then 'medium' else 'low' end,
       matched_on
from filtered
order by rounded_score desc, contact_id
limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;

revoke all on function public.find_contact_duplicates(uuid, text, date, text, text, text, integer)
  from public, anon, authenticated, tenant_app;
grant execute on function public.find_contact_duplicates(uuid, text, date, text, text, text, integer)
  to service_role;

-- ── 2. merge_contacts ──────────────────────────────────────────────────────
drop function if exists public.merge_contacts(uuid, uuid, uuid, jsonb, uuid);

create or replace function public.merge_contacts(
  p_tenant_id uuid, p_kept_id uuid, p_merged_id uuid,
  p_field_choices jsonb, p_merged_by uuid,
  p_review_id uuid default null, p_source text default 'manual'
)
returns uuid
language plpgsql security invoker set search_path = public
as $$
declare
  v_organization_id uuid;
  kept public.contacts%rowtype;
  merged public.contacts%rowtype;
  review public.contact_duplicate_reviews%rowtype;
  log_id uuid;
  kept_phones jsonb;
  merged_phones jsonb;
  kept_emails jsonb;
  merged_emails jsonb;
  v_reviews jsonb;
  v_review_id uuid;
  item jsonb;
begin
  if p_kept_id = p_merged_id then raise exception 'Choose two different contacts'; end if;
  if coalesce(p_source, 'manual') not in ('manual', 'auto') then
    raise exception 'Unknown merge source';
  end if;
  v_organization_id := coalesce(
    (select source_organization_id from public.tenants where id = p_tenant_id),
    p_tenant_id
  );
  perform pg_advisory_xact_lock(hashtextextended(
    p_tenant_id::text || ':' || least(p_kept_id::text, p_merged_id::text) || ':' ||
    greatest(p_kept_id::text, p_merged_id::text), 0
  ));
  select * into kept from public.contacts
  where id = p_kept_id and tenant_id = p_tenant_id for update;
  select * into merged from public.contacts
  where id = p_merged_id and tenant_id = p_tenant_id for update;
  if kept.id is null or merged.id is null then
    raise exception 'Both contacts must belong to this tenant';
  end if;
  if kept.merged_into_id is not null or merged.merged_into_id is not null then
    raise exception 'A merged contact cannot be merged again';
  end if;

  if p_review_id is not null then
    select * into review from public.contact_duplicate_reviews
    where id = p_review_id and tenant_id = p_tenant_id for update;
    if review.id is null then
      raise exception 'That match is no longer in the review queue';
    end if;
    if review.status <> 'pending' then
      raise exception 'Someone has already resolved this match';
    end if;
    if least(review.contact_id, review.candidate_id) <> least(kept.id, merged.id)
       or greatest(review.contact_id, review.candidate_id) <> greatest(kept.id, merged.id) then
      raise exception 'That match is for a different pair of contacts';
    end if;
  end if;

  -- Every open question that names the contact about to disappear. Locked, then snapshotted, so
  -- undo can put each one back exactly as it was.
  perform 1 from public.contact_duplicate_reviews r
  where r.tenant_id = p_tenant_id and r.status = 'pending'
    and (r.contact_id = merged.id or r.candidate_id = merged.id)
  for update;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at, r.id), '[]'::jsonb) into v_reviews
  from public.contact_duplicate_reviews r
  where r.tenant_id = p_tenant_id and r.status = 'pending'
    and (r.contact_id = merged.id or r.candidate_id = merged.id);
  v_review_id := coalesce(p_review_id, (
    select r.id from public.contact_duplicate_reviews r
    where r.tenant_id = p_tenant_id and r.status = 'pending'
      and least(r.contact_id, r.candidate_id) = least(kept.id, merged.id)
      and greatest(r.contact_id, r.candidate_id) = greatest(kept.id, merged.id)
    limit 1
  ));

  select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) into kept_phones
  from public.contact_phones p where p.contact_id = kept.id;
  select coalesce(jsonb_agg(to_jsonb(p)), '[]'::jsonb) into merged_phones
  from public.contact_phones p where p.contact_id = merged.id;
  select coalesce(jsonb_agg(to_jsonb(e)), '[]'::jsonb) into kept_emails
  from public.contact_emails e where e.contact_id = kept.id;
  select coalesce(jsonb_agg(to_jsonb(e)), '[]'::jsonb) into merged_emails
  from public.contact_emails e where e.contact_id = merged.id;
  insert into public.merge_log (
    tenant_id, kept_id, merged_id, field_choices, kept_snapshot, merged_snapshot,
    kept_phones, merged_phones, kept_emails, merged_emails, merged_by,
    source, review_id, review_snapshot
  ) values (
    p_tenant_id, kept.id, merged.id, coalesce(p_field_choices, '{}'::jsonb),
    to_jsonb(kept), to_jsonb(merged), kept_phones, merged_phones,
    kept_emails, merged_emails, p_merged_by,
    coalesce(p_source, 'manual'), v_review_id, v_reviews
  ) returning id into log_id;
  update public.contacts set
    first_name = case when p_field_choices->>'first_name' = 'merged' then merged.first_name else kept.first_name end,
    last_name = case when p_field_choices->>'last_name' = 'merged' then merged.last_name else kept.last_name end,
    dob = case when p_field_choices->>'dob' = 'merged' then merged.dob else kept.dob end,
    primary_phone = case when p_field_choices->>'primary_phone' = 'merged' then merged.primary_phone else kept.primary_phone end,
    state = case when p_field_choices->>'state' = 'merged' then merged.state else kept.state end,
    household_id = case when p_field_choices->>'household_id' = 'merged' then merged.household_id else kept.household_id end,
    name_search = case
      when p_field_choices->>'first_name' = 'merged' or p_field_choices->>'last_name' = 'merged'
      then lower(regexp_replace(trim(
        case when p_field_choices->>'first_name' = 'merged' then merged.first_name else kept.first_name end || ' ' ||
        case when p_field_choices->>'last_name' = 'merged' then merged.last_name else kept.last_name end
      ), '[^a-zA-Z0-9]+', '', 'g'))
      else kept.name_search
    end,
    custom_fields = case when p_field_choices->>'custom_fields' = 'merged' then merged.custom_fields else kept.custom_fields end
  where id = kept.id;
  for item in select value from jsonb_array_elements(merged_phones) loop
    insert into public.contact_phones (
      organization_id, tenant_id, contact_id, phone, type, is_primary
    ) values (
      v_organization_id, p_tenant_id, kept.id, item->>'phone',
      coalesce(item->>'type', 'other'), coalesce((item->>'is_primary')::boolean, false)
    ) on conflict (contact_id, phone) do nothing;
  end loop;
  for item in select value from jsonb_array_elements(merged_emails) loop
    insert into public.contact_emails (
      organization_id, tenant_id, contact_id, email, is_primary
    ) values (
      v_organization_id, p_tenant_id, kept.id, lower(item->>'email'),
      coalesce((item->>'is_primary')::boolean, false)
    ) on conflict (contact_id, email) do nothing;
  end loop;
  update public.contacts set merged_into_id = kept.id where id = merged.id;

  -- The pair itself: answered by this merge.
  update public.contact_duplicate_reviews set
    status = 'merged', merge_id = log_id, resolved_at = now(), resolved_by = p_merged_by
  where tenant_id = p_tenant_id and status = 'pending'
    and least(contact_id, candidate_id) = least(kept.id, merged.id)
    and greatest(contact_id, candidate_id) = greatest(kept.id, merged.id);
  -- A question about the merged-away contact is now a question about the survivor. Where the
  -- survivor already has that same question open, this row is closed by the merge instead.
  update public.contact_duplicate_reviews r set
    status = 'merged', merge_id = log_id, resolved_at = now(), resolved_by = p_merged_by
  where r.tenant_id = p_tenant_id and r.status = 'pending'
    and (r.contact_id = merged.id or r.candidate_id = merged.id)
    and exists (
      select 1 from public.contact_duplicate_reviews o
      where o.tenant_id = p_tenant_id and o.status = 'pending' and o.id <> r.id
        and least(o.contact_id, o.candidate_id) = least(kept.id, case when r.contact_id = merged.id then r.candidate_id else r.contact_id end)
        and greatest(o.contact_id, o.candidate_id) = greatest(kept.id, case when r.contact_id = merged.id then r.candidate_id else r.contact_id end)
    );
  update public.contact_duplicate_reviews set
    contact_id = case when contact_id = merged.id then kept.id else contact_id end,
    candidate_id = case when candidate_id = merged.id then kept.id else candidate_id end
  where tenant_id = p_tenant_id and status = 'pending'
    and (contact_id = merged.id or candidate_id = merged.id);
  return log_id;
end;
$$;

revoke all on function public.merge_contacts(uuid, uuid, uuid, jsonb, uuid, uuid, text)
  from public, anon, authenticated, tenant_app;
grant execute on function public.merge_contacts(uuid, uuid, uuid, jsonb, uuid, uuid, text)
  to service_role;

-- ── 3. undo_contact_merge ──────────────────────────────────────────────────
create or replace function public.undo_contact_merge(p_tenant_id uuid, p_merge_id uuid)
returns uuid
language plpgsql security invoker set search_path = public
as $$
declare
  v_organization_id uuid;
  log_row public.merge_log%rowtype;
  later public.merge_log%rowtype;
  item jsonb;
begin
  v_organization_id := coalesce(
    (select source_organization_id from public.tenants where id = p_tenant_id),
    p_tenant_id
  );
  select * into log_row from public.merge_log
  where id = p_merge_id and tenant_id = p_tenant_id for update;
  if log_row.id is null then raise exception 'Merge not found'; end if;
  if log_row.reversed_at is not null then raise exception 'This merge was already undone'; end if;

  -- Lock both contacts BEFORE asking about later merges. merge_contacts locks the same rows, so a
  -- merge that commits while this waits is visible to the check below rather than overwritten.
  perform 1 from public.contacts
  where tenant_id = p_tenant_id and id in (log_row.kept_id, log_row.merged_id)
  order by id
  for update;
  select * into later from public.merge_log m
  where m.tenant_id = p_tenant_id and m.reversed_at is null and m.id <> log_row.id
    and m.merged_at >= log_row.merged_at
    and (m.kept_id in (log_row.kept_id, log_row.merged_id) or m.merged_id in (log_row.kept_id, log_row.merged_id))
  order by m.merged_at desc
  limit 1;
  if later.id is not null then
    raise exception 'Undo the later merge first. One of these contacts was merged again afterwards, and undoing this one now would lose that merge.';
  end if;

  update public.contacts set
    first_name = log_row.kept_snapshot->>'first_name',
    last_name = log_row.kept_snapshot->>'last_name',
    dob = nullif(log_row.kept_snapshot->>'dob', '')::date,
    primary_phone = log_row.kept_snapshot->>'primary_phone',
    state = log_row.kept_snapshot->>'state',
    household_id = nullif(log_row.kept_snapshot->>'household_id', '')::uuid,
    name_search = log_row.kept_snapshot->>'name_search',
    custom_fields = log_row.kept_snapshot->'custom_fields'
  where id = log_row.kept_id and tenant_id = p_tenant_id;
  update public.contacts set
    first_name = log_row.merged_snapshot->>'first_name',
    last_name = log_row.merged_snapshot->>'last_name',
    dob = nullif(log_row.merged_snapshot->>'dob', '')::date,
    primary_phone = log_row.merged_snapshot->>'primary_phone',
    state = log_row.merged_snapshot->>'state',
    household_id = nullif(log_row.merged_snapshot->>'household_id', '')::uuid,
    name_search = log_row.merged_snapshot->>'name_search',
    custom_fields = log_row.merged_snapshot->'custom_fields',
    merged_into_id = null
  where id = log_row.merged_id and tenant_id = p_tenant_id;
  delete from public.contact_phones where contact_id in (log_row.kept_id, log_row.merged_id);
  for item in select value from jsonb_array_elements(log_row.kept_phones) loop
    insert into public.contact_phones (
      id, organization_id, tenant_id, contact_id, phone, type, is_primary
    ) values (
      (item->>'id')::uuid, v_organization_id, p_tenant_id, log_row.kept_id,
      item->>'phone', coalesce(item->>'type', 'other'),
      coalesce((item->>'is_primary')::boolean, false)
    );
  end loop;
  for item in select value from jsonb_array_elements(log_row.merged_phones) loop
    insert into public.contact_phones (
      id, organization_id, tenant_id, contact_id, phone, type, is_primary
    ) values (
      (item->>'id')::uuid, v_organization_id, p_tenant_id, log_row.merged_id,
      item->>'phone', coalesce(item->>'type', 'other'),
      coalesce((item->>'is_primary')::boolean, false)
    );
  end loop;
  delete from public.contact_emails where contact_id in (log_row.kept_id, log_row.merged_id);
  for item in select value from jsonb_array_elements(log_row.kept_emails) loop
    insert into public.contact_emails (
      id, organization_id, tenant_id, contact_id, email, is_primary
    ) values (
      (item->>'id')::uuid, v_organization_id, p_tenant_id, log_row.kept_id,
      lower(item->>'email'), coalesce((item->>'is_primary')::boolean, false)
    );
  end loop;
  for item in select value from jsonb_array_elements(log_row.merged_emails) loop
    insert into public.contact_emails (
      id, organization_id, tenant_id, contact_id, email, is_primary
    ) values (
      (item->>'id')::uuid, v_organization_id, p_tenant_id, log_row.merged_id,
      lower(item->>'email'), coalesce((item->>'is_primary')::boolean, false)
    );
  end loop;

  -- Put every question the merge answered or re-pointed back as it was: open, and about the
  -- contacts it was originally about. A row someone has since dismissed stays dismissed.
  for item in select value from jsonb_array_elements(coalesce(log_row.review_snapshot, '[]'::jsonb)) loop
    update public.contact_duplicate_reviews r set
      contact_id = (item->>'contact_id')::uuid,
      candidate_id = (item->>'candidate_id')::uuid,
      status = 'pending', merge_id = null, resolved_at = null, resolved_by = null
    where r.id = (item->>'id')::uuid and r.tenant_id = p_tenant_id
      and (r.status = 'pending' or (r.status = 'merged' and r.merge_id = log_row.id))
      and not exists (
        select 1 from public.contact_duplicate_reviews o
        where o.tenant_id = p_tenant_id and o.status = 'pending' and o.id <> r.id
          and least(o.contact_id, o.candidate_id) = least((item->>'contact_id')::uuid, (item->>'candidate_id')::uuid)
          and greatest(o.contact_id, o.candidate_id) = greatest((item->>'contact_id')::uuid, (item->>'candidate_id')::uuid)
      );
  end loop;

  update public.merge_log set reversed_at = now() where id = log_row.id;
  return log_row.id;
end;
$$;

revoke all on function public.undo_contact_merge(uuid, uuid) from public, anon, authenticated, tenant_app;
grant execute on function public.undo_contact_merge(uuid, uuid) to service_role;

-- ── 4a. contact_directory_page ─────────────────────────────────────────────
-- One page of active contacts, newest first, with the total that matched. p_query is the raw
-- search text (LIKE wildcards already escaped by the caller); p_name_query is the same text
-- normalized the way name_search is; p_digits is its digits, for phone search.
create or replace function public.contact_directory_page(
  p_tenant_id uuid,
  p_query text default null,
  p_name_query text default null,
  p_digits text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  contact_id uuid,
  first_name text,
  last_name text,
  dob date,
  primary_phone text,
  state text,
  custom_fields jsonb,
  household_id uuid,
  address_line1 text,
  city text,
  household_state text,
  postal_code text,
  created_at timestamptz,
  lead_count bigint,
  open_review boolean,
  total_count bigint
)
language sql stable security invoker set search_path = public
as $$
with matched as (
  select c.id, c.first_name, c.last_name, c.dob, c.primary_phone, c.state, c.custom_fields,
         c.household_id, h.address_line1, h.city, h.state as household_state, h.postal_code, c.created_at
  from public.contacts c
  left join public.households h
    on h.id = c.household_id
   and h.tenant_id = p_tenant_id
  where c.tenant_id = p_tenant_id
    and c.merged_into_id is null
    and (
      nullif(p_query, '') is null
      or (nullif(p_name_query, '') is not null and c.name_search like '%' || p_name_query || '%')
      or (nullif(p_digits, '') is not null and (
            c.primary_phone like '%' || p_digits || '%'
            or exists (
              select 1 from public.contact_phones cp
              where cp.tenant_id = p_tenant_id and cp.contact_id = c.id and cp.phone like '%' || p_digits || '%'
            )))
      or exists (
        select 1 from public.contact_emails e
        where e.tenant_id = p_tenant_id and e.contact_id = c.id and e.email ilike '%' || p_query || '%'
      )
      or h.city ilike '%' || p_query || '%'
      or h.address_line1 ilike '%' || p_query || '%'
      or h.postal_code ilike p_query || '%'
      or c.state = upper(p_query)
      or c.custom_fields::text ilike '%' || p_query || '%'
    )
), page as (
  select m.*, count(*) over () as total_count
  from matched m
  order by m.created_at desc, m.id desc
  limit least(greatest(coalesce(p_limit, 25), 1), 100)
  offset greatest(coalesce(p_offset, 0), 0)
)
select
  p.id, p.first_name, p.last_name, p.dob, p.primary_phone, p.state, p.custom_fields,
  p.household_id, p.address_line1, p.city, p.household_state, p.postal_code, p.created_at,
  (
    with recursive absorbed(id) as (
      select p.id
      union all
      select c2.id from public.contacts c2 join absorbed a on c2.merged_into_id = a.id
      where c2.tenant_id = p_tenant_id
    )
    select count(*) from public.agent_leads l
    where l.tenant_id = p_tenant_id and l.contact_id in (select id from absorbed)
  ) as lead_count,
  exists (
    select 1 from public.contact_duplicate_reviews r
    where r.tenant_id = p_tenant_id and r.status = 'pending'
      and (r.contact_id = p.id or r.candidate_id = p.id)
  ) as open_review,
  p.total_count
from page p
order by p.created_at desc, p.id desc;
$$;

revoke all on function public.contact_directory_page(uuid, text, text, text, integer, integer)
  from public, anon, authenticated, tenant_app;
grant execute on function public.contact_directory_page(uuid, text, text, text, integer, integer)
  to service_role;

-- ── 4b. contact_duplicate_stats ────────────────────────────────────────────
-- "This month" is the calendar month in p_timezone (the agency's, from agency_profiles), or UTC
-- when none is given or Postgres does not know the zone. The zone used is returned.
-- undoable_this_month applies undo_contact_merge's own rule, so the tile never promises an undo the
-- button would refuse.
create or replace function public.contact_duplicate_stats(p_tenant_id uuid, p_timezone text default null)
returns table (
  active_contacts bigint,
  household_count bigint,
  pending_reviews bigint,
  oldest_pending_at timestamptz,
  merged_this_month bigint,
  undone_this_month bigint,
  undoable_this_month bigint,
  month_start timestamptz,
  month_timezone text,
  flagged_contacts bigint
)
language plpgsql stable security invoker set search_path = public
as $$
declare
  v_tz text := coalesce(nullif(trim(p_timezone), ''), 'UTC');
  v_start timestamptz;
begin
  begin
    v_start := date_trunc('month', now() at time zone v_tz) at time zone v_tz;
  exception when invalid_parameter_value then
    v_tz := 'UTC';
    v_start := date_trunc('month', now() at time zone 'UTC') at time zone 'UTC';
  end;
  return query
  select
    (select count(*) from public.contacts c where c.tenant_id = p_tenant_id and c.merged_into_id is null),
    (select count(distinct c.household_id) from public.contacts c
      where c.tenant_id = p_tenant_id and c.merged_into_id is null and c.household_id is not null),
    (select count(*) from public.contact_duplicate_reviews r where r.tenant_id = p_tenant_id and r.status = 'pending'),
    (select min(r.created_at) from public.contact_duplicate_reviews r where r.tenant_id = p_tenant_id and r.status = 'pending'),
    (select count(*) from public.merge_log m where m.tenant_id = p_tenant_id and m.merged_at >= v_start),
    (select count(*) from public.merge_log m where m.tenant_id = p_tenant_id and m.merged_at >= v_start and m.reversed_at is not null),
    (select count(*) from public.merge_log m
      where m.tenant_id = p_tenant_id and m.merged_at >= v_start and m.reversed_at is null
        and not exists (
          select 1 from public.merge_log l
          where l.tenant_id = p_tenant_id and l.reversed_at is null and l.id <> m.id
            and l.merged_at >= m.merged_at
            and (l.kept_id in (m.kept_id, m.merged_id) or l.merged_id in (m.kept_id, m.merged_id))
        )),
    v_start,
    v_tz,
    (select count(distinct x.id) from (
      select r.contact_id as id from public.contact_duplicate_reviews r where r.tenant_id = p_tenant_id and r.status = 'pending'
      union all
      select r.candidate_id from public.contact_duplicate_reviews r where r.tenant_id = p_tenant_id and r.status = 'pending'
    ) x);
end;
$$;

revoke all on function public.contact_duplicate_stats(uuid, text) from public, anon, authenticated, tenant_app;
grant execute on function public.contact_duplicate_stats(uuid, text) to service_role;

-- ── 4c. link_leads_to_contacts ─────────────────────────────────────────────
-- Sets agent_leads.contact_id where the lead's best match is one the contact flow would auto-merge:
-- high confidence, both dates of birth present and equal, and the phone or the address also equal
-- (lib/contacts/matchPolicy.ts, isConfidentMatch). Anything less links nothing. Never creates a
-- contact and never overwrites a link. p_items carries the values already normalized by the
-- caller exactly as createContact normalizes them, so both paths score identically.
create or replace function public.link_leads_to_contacts(p_tenant_id uuid, p_items jsonb)
returns integer
language plpgsql security invoker set search_path = public
as $$
declare
  v_count integer := 0;
begin
  if jsonb_typeof(coalesce(p_items, '[]'::jsonb)) <> 'array' then
    raise exception 'Items must be an array';
  end if;
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) > 500 then
    raise exception 'Link at most 500 leads at a time';
  end if;
  with items as (
    select (i->>'lead_id')::uuid as lead_id,
           nullif(i->>'name_search', '') as name_search,
           nullif(i->>'dob', '')::date as dob,
           nullif(i->>'phone', '') as phone,
           nullif(i->>'address_hash', '') as address_hash,
           nullif(i->>'address_search', '') as address_search
    from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) i
  ), best as (
    select it.lead_id, m.contact_id
    from items it
    cross join lateral (
      select d.contact_id, d.dob, d.confidence, d.matched_on
      from public.find_contact_duplicates(p_tenant_id, it.name_search, it.dob, it.phone, it.address_search, it.address_hash, 5) d
      order by d.score desc, d.contact_id
      limit 1
    ) m
    where it.dob is not null
      and it.name_search is not null
      and m.confidence = 'high'
      and m.dob = it.dob
      and ('phone' = any(m.matched_on) or 'address' = any(m.matched_on))
  )
  update public.agent_leads l set contact_id = b.contact_id
  from best b
  where l.tenant_id = p_tenant_id and l.id = b.lead_id and l.contact_id is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.link_leads_to_contacts(uuid, jsonb) from public, anon, authenticated, tenant_app;
grant execute on function public.link_leads_to_contacts(uuid, jsonb) to service_role;

-- ── asserted against whatever this database holds ─────────────────────────
do $$
declare
  v_def text;
begin
  select pg_get_functiondef('public.find_contact_duplicates(uuid, text, date, text, text, text, integer)'::regprocedure) into v_def;
  if position('pc.merged_into_id is null' in v_def) = 0 then
    raise exception 'find_contact_duplicates still matches merged-away contacts on an alternate phone';
  end if;
  if to_regprocedure('public.merge_contacts(uuid, uuid, uuid, jsonb, uuid)') is not null then
    raise exception 'the five-argument merge_contacts is still defined';
  end if;
  if to_regprocedure('public.merge_contacts(uuid, uuid, uuid, jsonb, uuid, uuid, text)') is null then
    raise exception 'merge_contacts(…, p_review_id, p_source) is missing';
  end if;
  select pg_get_functiondef('public.undo_contact_merge(uuid, uuid)'::regprocedure) into v_def;
  if position('Undo the later merge first' in v_def) = 0 then
    raise exception 'undo_contact_merge has no guard against a later merge';
  end if;
  if position('organization_id' in v_def) = 0 then
    raise exception 'undo_contact_merge lost the organization_id bridge';
  end if;
  select pg_get_functiondef('public.merge_contacts(uuid, uuid, uuid, jsonb, uuid, uuid, text)'::regprocedure) into v_def;
  if position('organization_id' in v_def) = 0 then
    raise exception 'merge_contacts lost the organization_id bridge';
  end if;
  if to_regprocedure('public.contact_directory_page(uuid, text, text, text, integer, integer)') is null
     or to_regprocedure('public.contact_duplicate_stats(uuid, text)') is null
     or to_regprocedure('public.link_leads_to_contacts(uuid, jsonb)') is null then
    raise exception 'a duplicate-check read function is missing';
  end if;
  if has_function_privilege('tenant_app', 'public.merge_contacts(uuid, uuid, uuid, jsonb, uuid, uuid, text)', 'execute')
     or has_function_privilege('tenant_app', 'public.link_leads_to_contacts(uuid, jsonb)', 'execute')
     or has_function_privilege('tenant_app', 'public.contact_directory_page(uuid, text, text, text, integer, integer)', 'execute') then
    raise exception 'the tenant plane can execute a service-only contact function';
  end if;
end $$;
