-- Owner 2026-10-28: a submission confirmation (screenshot or the carrier's PDF) can be up to 25 MB.
-- The app's limit is MAX_CONFIRMATION_BYTES in lib/applications/afterSubmitRules.ts; the bucket's own
-- limit was 10 MB (20260926100700_la_3_15_submissions.sql) and would refuse anything larger.

update storage.buckets
   set file_size_limit = 26214400
 where id = 'application-confirmations';

do $$
begin
  if (select file_size_limit from storage.buckets where id = 'application-confirmations') is distinct from 26214400 then
    raise exception 'application-confirmations is not at 25 MB';
  end if;
end $$;
