-- LA-1 follow-up: close direct RPC grants and avoid per-row tenant-context evaluation.

revoke all on function public.save_form_draft(uuid, uuid, uuid, text, uuid, integer, jsonb)
  from public, anon, authenticated, tenant_app;
grant execute on function public.save_form_draft(uuid, uuid, uuid, text, uuid, integer, jsonb)
  to service_role;

revoke all on function public.broadcast_la_1_15_floor_change()
  from public, anon, authenticated, tenant_app;

alter function public.render_disposition_note(text, text, text, text, text, text)
  set search_path = pg_catalog;

drop policy if exists partners_tenant_read on public.partners;
create policy partners_tenant_read on public.partners
  for select to tenant_app
  using (
    tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid
  );

drop policy if exists partner_terms_tenant_read on public.partner_terms;
create policy partner_terms_tenant_read on public.partner_terms
  for select to tenant_app
  using (
    exists (
      select 1
      from public.partners p
      where p.id = partner_terms.partner_id
        and p.tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid
    )
  );

drop policy if exists partner_users_tenant_read on public.partner_users;
create policy partner_users_tenant_read on public.partner_users
  for select to tenant_app
  using (
    exists (
      select 1
      from public.partners p
      where p.id = partner_users.partner_id
        and p.tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid
    )
  );

drop policy if exists affiliate_links_tenant_scoped on public.affiliate_links;
create policy affiliate_links_tenant_scoped on public.affiliate_links
  for all to tenant_app
  using (
    tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid
  )
  with check (
    tenant_id = nullif((select current_setting('app.tenant_id', true)), '')::uuid
  );
