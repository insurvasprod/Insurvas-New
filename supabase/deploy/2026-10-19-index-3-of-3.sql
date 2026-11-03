do $bundle$ begin
  if to_regclass('supabase_migrations.schema_migrations') is not null then
    insert into supabase_migrations.schema_migrations (version, name) values ('20260929203100', 'm2_fresh_lead_serving_index') on conflict do nothing;
    insert into supabase_migrations.schema_migrations (version, name) values ('20260929203200', 'm2_fresh_zoned_lead_index') on conflict do nothing;
  end if;
end $bundle$;
