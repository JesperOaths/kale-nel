alter table public.web_push_jobs
  add column if not exists display_ack_token_hash text,
  add column if not exists display_ack_expires_at timestamptz,
  add column if not exists display_acked_at timestamptz;

alter table public.web_push_jobs
  drop constraint if exists web_push_jobs_display_ack_token_hash_chk;

alter table public.web_push_jobs
  add constraint web_push_jobs_display_ack_token_hash_chk
  check (display_ack_token_hash is null or display_ack_token_hash ~ '^[0-9a-f]{64}$');

create or replace function public.prepare_web_push_display_ack_v814(
  job_id_input bigint,
  claim_token_input uuid,
  worker_id_input text,
  token_hash_input text,
  expires_in_seconds_input integer default 3600
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_hash text := lower(trim(coalesce(token_hash_input, '')));
  v_subscription_id bigint;
  v_expires_at timestamptz;
begin
  if v_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'DISPLAY_ACK_HASH_INVALID';
  end if;

  v_expires_at := now() + make_interval(secs => least(greatest(coalesce(expires_in_seconds_input, 3600), 60), 86400));

  update public.web_push_jobs
     set display_ack_token_hash = v_hash,
         display_ack_expires_at = v_expires_at,
         updated_at = now()
   where id = job_id_input
     and claim_token = claim_token_input
     and claimed_by = worker_id_input
     and status = 'claimed'
     and display_acked_at is null
   returning target_subscription_id into v_subscription_id;

  if v_subscription_id is null then
    raise exception 'DISPLAY_ACK_CLAIM_MISMATCH';
  end if;

  insert into public.web_push_job_attempts(job_id, worker_id, claim_token, stage, status)
  values (job_id_input, worker_id_input, claim_token_input, 'display_ack_prepare_v814', 'ok');

  return jsonb_build_object(
    'ok', true,
    'job_id', job_id_input,
    'subscription_id', v_subscription_id,
    'expires_at', v_expires_at
  );
end
$function$;

create or replace function public.ack_web_push_display_v814(
  job_id_input bigint,
  subscription_id_input bigint,
  display_token_input text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_job public.web_push_jobs%rowtype;
  v_token text := trim(coalesce(display_token_input, ''));
  v_hash text;
  v_now timestamptz := now();
begin
  if job_id_input is null or subscription_id_input is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_capability');
  end if;

  if v_token !~ '^[A-Za-z0-9_-]{32,128}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_capability');
  end if;

  v_hash := encode(public.digest(v_token, 'sha256'), 'hex');

  select * into v_job
    from public.web_push_jobs
   where id = job_id_input
   for update;

  if not found
     or v_job.target_subscription_id is distinct from subscription_id_input
     or v_job.display_ack_token_hash is null
     or v_job.display_ack_token_hash <> v_hash then
    return jsonb_build_object('ok', false, 'reason', 'invalid_capability');
  end if;

  if v_job.display_acked_at is not null then
    return jsonb_build_object(
      'ok', true,
      'job_id', v_job.id,
      'subscription_id', v_job.target_subscription_id,
      'display_acked_at', v_job.display_acked_at,
      'idempotent', true
    );
  end if;

  if v_job.display_ack_expires_at is null or v_job.display_ack_expires_at <= v_now then
    return jsonb_build_object('ok', false, 'reason', 'capability_expired');
  end if;

  update public.web_push_jobs
     set display_acked_at = v_now,
         updated_at = v_now
   where id = v_job.id;

  insert into public.web_push_job_attempts(job_id, worker_id, claim_token, stage, status)
  values (v_job.id, 'service_worker', null, 'display_ack_v814', 'ok');

  return jsonb_build_object(
    'ok', true,
    'job_id', v_job.id,
    'subscription_id', v_job.target_subscription_id,
    'display_acked_at', v_now,
    'idempotent', false
  );
end
$function$;

revoke all on function public.prepare_web_push_display_ack_v814(bigint,uuid,text,text,integer) from public, anon, authenticated;
grant execute on function public.prepare_web_push_display_ack_v814(bigint,uuid,text,text,integer) to service_role;

revoke all on function public.ack_web_push_display_v814(bigint,bigint,text) from public;
grant execute on function public.ack_web_push_display_v814(bigint,bigint,text) to anon, authenticated, service_role;
