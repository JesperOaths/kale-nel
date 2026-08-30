alter table public.web_push_jobs
  add column if not exists display_ack_claim_token uuid;

create schema if not exists web_push_private;
revoke all on schema web_push_private from public, anon, authenticated, service_role;
grant usage on schema web_push_private to anon, service_role;

create or replace function public.prepare_web_push_display_ack_v814(
  job_id_input bigint,
  claim_token_input uuid,
  worker_id_input text,
  token_hash_input text,
  expires_in_seconds_input integer default 900
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_hash text := lower(trim(coalesce(token_hash_input, '')));
  v_subscription_id bigint;
  v_expires_at timestamptz;
begin
  if job_id_input is null or claim_token_input is null or trim(coalesce(worker_id_input, '')) = '' then
    raise exception 'DISPLAY_ACK_CONTEXT_INVALID';
  end if;

  if v_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'DISPLAY_ACK_HASH_INVALID';
  end if;

  v_expires_at := now() + make_interval(secs => least(greatest(coalesce(expires_in_seconds_input, 900), 60), 3600));

  update public.web_push_jobs
     set display_ack_token_hash = v_hash,
         display_ack_claim_token = claim_token_input,
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

  return jsonb_build_object('ok', true, 'expires_at', v_expires_at);
end
$function$;

create or replace function public.record_web_push_provider_sent_v814(
  job_id_input bigint,
  claim_token_input uuid,
  worker_id_input text,
  provider_message_id_input text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_sub_id bigint;
  v_now timestamptz := now();
begin
  update public.web_push_jobs
     set sent_at = v_now,
         updated_at = v_now,
         error_stage = null,
         error_code = null,
         error_text = null,
         provider_message_id = provider_message_id_input
   where id = job_id_input
     and claim_token = claim_token_input
     and claimed_by = worker_id_input
     and display_ack_claim_token = claim_token_input
     and status in ('claimed', 'sent')
   returning target_subscription_id into v_sub_id;

  if v_sub_id is null then
    raise exception 'PROVIDER_SENT_CLAIM_MISMATCH';
  end if;

  insert into public.web_push_job_attempts(job_id, worker_id, claim_token, stage, status)
  values (job_id_input, worker_id_input, claim_token_input, 'provider_sent_v814', 'ok');

  update public.web_push_subscriptions
     set updated_at = v_now,
         last_success_at = v_now,
         last_error = null,
         failure_count = 0,
         is_active = true
   where id = v_sub_id
     and disabled_at is null;

  return jsonb_build_object('ok', true);
end
$function$;

create or replace function web_push_private.ack_web_push_display_v814(
  job_id_input bigint,
  subscription_id_input bigint,
  display_token_input text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
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

  v_hash := encode(extensions.digest(v_token, 'sha256'), 'hex');

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
    return jsonb_build_object('ok', true, 'idempotent', true);
  end if;

  if v_job.display_ack_expires_at is null or v_job.display_ack_expires_at <= v_now then
    return jsonb_build_object('ok', false, 'reason', 'capability_expired');
  end if;

  if v_job.status <> 'claimed'
     or v_job.claim_token is null
     or v_job.display_ack_claim_token is distinct from v_job.claim_token then
    return jsonb_build_object('ok', false, 'reason', 'invalid_capability');
  end if;

  update public.web_push_jobs
     set status = 'sent',
         display_acked_at = v_now,
         marked_at = v_now,
         updated_at = v_now,
         error_stage = null,
         error_code = null,
         error_text = null
   where id = v_job.id;

  insert into public.web_push_job_attempts(job_id, worker_id, claim_token, stage, status)
  values (v_job.id, coalesce(v_job.claimed_by, 'service_worker'), v_job.claim_token, 'display_ack_v814', 'ok');

  return jsonb_build_object('ok', true, 'idempotent', false);
end
$function$;

revoke all on function web_push_private.ack_web_push_display_v814(bigint,bigint,text) from public, anon, authenticated, service_role;
grant execute on function web_push_private.ack_web_push_display_v814(bigint,bigint,text) to anon, service_role;

create or replace function public.ack_web_push_display_v814(
  job_id_input bigint,
  subscription_id_input bigint,
  display_token_input text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $function$
  select web_push_private.ack_web_push_display_v814(job_id_input, subscription_id_input, display_token_input)
$function$;

revoke all on function public.prepare_web_push_display_ack_v814(bigint,uuid,text,text,integer) from public, anon, authenticated, service_role;
grant execute on function public.prepare_web_push_display_ack_v814(bigint,uuid,text,text,integer) to service_role;

revoke all on function public.record_web_push_provider_sent_v814(bigint,uuid,text,text) from public, anon, authenticated, service_role;
grant execute on function public.record_web_push_provider_sent_v814(bigint,uuid,text,text) to service_role;

revoke all on function public.ack_web_push_display_v814(bigint,bigint,text) from public, anon, authenticated, service_role;
grant execute on function public.ack_web_push_display_v814(bigint,bigint,text) to anon, service_role;
