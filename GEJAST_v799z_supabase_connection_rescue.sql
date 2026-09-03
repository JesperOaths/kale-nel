-- GEJAST_v799z_supabase_connection_rescue.sql
-- Bounded operational recovery for the 2026-09-03 Supabase connection starvation incident.
-- Retry marker: official restart path enabled 2026-09-03.
-- 1) Stop the known runaway cron job 1.
-- 2) Cancel only long-running client queries.
-- 3) Terminate only stale idle-in-transaction client sessions.
-- 4) Reload PostgREST config.

select cron.alter_job(job_id := 1, active := false)
where exists (
  select 1 from cron.job where jobid = 1 and active
);

select pg_cancel_backend(pid)
from pg_stat_activity
where pid <> pg_backend_pid()
  and datname = current_database()
  and backend_type = 'client backend'
  and state = 'active'
  and now() - query_start > interval '30 seconds'
  and usename not in ('supabase_admin','supabase_storage_admin','pgbouncer');

select pg_terminate_backend(pid)
from pg_stat_activity
where pid <> pg_backend_pid()
  and datname = current_database()
  and backend_type = 'client backend'
  and state = 'idle in transaction'
  and now() - state_change > interval '60 seconds'
  and usename not in ('supabase_admin','supabase_storage_admin','pgbouncer');

notify pgrst, 'reload config';
select now() as repaired_at;
