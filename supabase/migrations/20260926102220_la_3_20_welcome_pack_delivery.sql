-- LA-3.20 — welcome pack delivery state the application shows.
--
--   tenant_welcome_packs  +4 columns
--     send_note      why an email did not go out (no email on file, auto-send off, a locked fact
--                    missing, mail delivery disabled) — shown on the application, never a secret
--     pdf_version    1 for the pack generated on submit; +1 each time an accepted counteroffer
--                    reissues it (LA-3.26). Each version is its own object, so no PDF is altered.
--     reissued_at    when the latest version was generated after the first
--     generated_at   when the current PDF was written
--     sent_version   which pdf_version the client was emailed; an automatic send happens once per
--                    attempt, and only an agent's explicit "send the updated pack" mails a later one
--
-- The one-row-per-attempt constraint (tenant_welcome_packs_once_per_attempt) stays: a resubmission
-- to another carrier is a new attempt and so a new row, and the old attempt's row is untouched.
--
-- Down:
--   alter table public.tenant_welcome_packs drop column send_note, drop column pdf_version,
--     drop column reissued_at, drop column generated_at, drop column sent_version;

alter table public.tenant_welcome_packs
  add column if not exists send_note text check (send_note is null or char_length(send_note) <= 500),
  add column if not exists pdf_version integer not null default 1 check (pdf_version > 0),
  add column if not exists reissued_at timestamptz,
  add column if not exists generated_at timestamptz,
  add column if not exists sent_version integer check (sent_version is null or sent_version > 0);

-- Nothing deletes a welcome pack: it is the record of what the client was told.
revoke delete, truncate on public.tenant_welcome_packs from service_role, tenant_app, anon, authenticated;

-- ── checks ──────────────────────────────────────────────────────────────────
do $$
begin
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'tenant_welcome_packs'
         and column_name in ('send_note', 'pdf_version', 'reissued_at', 'generated_at', 'sent_version')) <> 5 then
    raise exception '20260926102220: the welcome pack delivery columns are missing';
  end if;
  if has_table_privilege('service_role', 'public.tenant_welcome_packs', 'DELETE') then
    raise exception '20260926102220: welcome packs can be deleted';
  end if;
end $$;
