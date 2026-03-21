-- gejast v50 rest grants + email worker alignment
-- Run AFTER:
--   1) gejast_v32_secure_activation.sql
--   2) gejast_v47_frontend_alignment_patch.sql

create extension if not exists pgcrypto;

-- Keep the pending view deterministic for workers.
create or replace view public.outbound_email_jobs_pending as
select *
from public.outbound_email_jobs
where job_status = 'queued'
order by created_at asc, id asc;

comment on view public.outbound_email_jobs_pending
is 'Queued outbound email jobs in send order for a worker or edge function.';

create or replace function public.claim_next_outbound_email_job()
returns public.outbound_email_jobs
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  job_row public.outbound_email_jobs;
begin
  select *
    into job_row
    from public.outbound_email_jobs
   where job_status = 'queued'
   order by created_at asc, id asc
   for update skip locked
   limit 1;

  if not found then
    return null;
  end if;

  update public.outbound_email_jobs
     set job_status = 'processing',
         last_error = null,
         updated_at = now()
   where id = job_row.id
  returning * into job_row;

  return job_row;
end;
$$;

comment on function public.claim_next_outbound_email_job()
is 'Atomically claims the next queued outbound email job for a sender worker.';

create or replace function public.mark_outbound_email_job_result(
  job_id_input bigint,
  success_input boolean,
  provider_message_id_input text default null,
  last_error_input text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  updated_job public.outbound_email_jobs;
begin
  update public.outbound_email_jobs
     set job_status = case when success_input then 'sent' else 'failed' end,
         provider_message_id = case when success_input then nullif(trim(provider_message_id_input), '') else provider_message_id end,
         last_error = case when success_input then null else nullif(trim(last_error_input), '') end,
         sent_at = case when success_input then coalesce(sent_at, now()) else sent_at end,
         updated_at = now()
   where id = job_id_input
   returning * into updated_job;

  if not found then
    raise exception 'Outbound email job niet gevonden';
  end if;

  return jsonb_build_object(
    'ok', true,
    'job_id', updated_job.id,
    'job_status', updated_job.job_status,
    'sent_at', updated_job.sent_at,
    'provider_message_id', updated_job.provider_message_id,
    'last_error', updated_job.last_error
  );
end;
$$;

comment on function public.mark_outbound_email_job_result(bigint,boolean,text,text)
is 'Marks a claimed outbound email job as sent or failed after provider delivery.';

create or replace function public.retry_outbound_email_job(
  admin_session_token text,
  job_id_input bigint
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  admin_row record;
  job_row public.outbound_email_jobs;
begin
  select * into admin_row
  from public._require_valid_admin_session(admin_session_token);

  if coalesce(admin_row.ok, false) is not true then
    raise exception 'Ongeldige admin-sessie';
  end if;

  update public.outbound_email_jobs
     set job_status = 'queued',
         last_error = null,
         provider_message_id = null,
         sent_at = null,
         updated_at = now()
   where id = job_id_input
   returning * into job_row;

  if not found then
    raise exception 'Outbound email job niet gevonden';
  end if;

  return jsonb_build_object(
    'ok', true,
    'job_id', job_row.id,
    'job_status', job_row.job_status
  );
end;
$$;

comment on function public.retry_outbound_email_job(text,bigint)
is 'Allows admin to re-queue a failed or stuck outbound email job.';

-- Lock down direct table access while still exposing safe RPCs.
revoke all on public.outbound_email_jobs from public, anon, authenticated;
revoke all on public.outbound_email_jobs_pending from public, anon, authenticated;

grant select, update on public.outbound_email_jobs to service_role;
grant select on public.outbound_email_jobs_pending to service_role;

grant execute on function public.claim_next_outbound_email_job() to service_role;
grant execute on function public.mark_outbound_email_job_result(bigint,boolean,text,text) to service_role;

-- Frontend RPCs are called with the publishable key, so anon/authenticated need EXECUTE.
do $$
declare
  f record;
begin
  for f in
    select format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid)) as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'get_gejast_homepage_state',
        'get_activation_link_context',
        'activate_player_from_email_link',
        'create_player_activation_link',
        'admin_queue_activation_email',
        'retry_outbound_email_job'
      )
  loop
    execute 'grant execute on function ' || f.sig || ' to anon';
    execute 'grant execute on function ' || f.sig || ' to authenticated';
    execute 'grant execute on function ' || f.sig || ' to service_role';
  end loop;
end $$;
