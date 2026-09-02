-- v816: make the live Shopify/Printify catalog eligible for refresh every two minutes.
-- The Edge Function remains the only upstream fetch owner. This cron job only marks
-- the private cache stale; the next authenticated shop catalog request performs the
-- actual source refresh, avoiding secret duplication and needless network traffic.

create extension if not exists pg_cron with schema pg_catalog;

grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

do $$
declare
  existing_job bigint;
begin
  for existing_job in
    select jobid from cron.job where jobname = 'shop_catalog_mark_stale_v816'
  loop
    perform cron.unschedule(existing_job);
  end loop;
end
$$;

select cron.schedule(
  'shop_catalog_mark_stale_v816',
  '*/2 * * * *',
  $cron$
    update public.shop_catalog_sync_state
    set next_refresh_at = now()
    where id = 1;
  $cron$
);
