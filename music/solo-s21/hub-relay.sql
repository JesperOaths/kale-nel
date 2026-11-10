-- Outbound transport failover; the S21 remains the sole game authority.
-- Register the hub worker hash separately through the private admin connection.

CREATE OR REPLACE FUNCTION public.tunerush_s21_claim_v1(p_worker_secret text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_claimed jsonb; v_worker_id text;
begin
 if p_worker_secret is null or p_worker_secret !~ '^[a-f0-9]{64}$'
 then raise exception 'Worker not authorized' using errcode='28000'; end if;
 select id into v_worker_id from public.tunerush_s21_relay_workers
 where id in ('s21-solo','c720p-transport')
 and secret_hash=encode(sha256(convert_to(p_worker_secret,'UTF8')),'hex');
 if v_worker_id is null
 then raise exception 'Worker not authorized' using errcode='28000'; end if;
 update public.tunerush_s21_relay_workers set seen_at=now() where id=v_worker_id;
 -- Prefer the reliable hub connection while its phone health check is fresh.
 if v_worker_id='s21-solo' and exists (
   select 1 from public.tunerush_s21_relay_workers
   where id='c720p-transport' and seen_at>now()-interval '20 seconds'
 ) then return jsonb_build_object('jobs','[]'::jsonb); end if;
 -- A timed-out mutation may already have committed on the phone.
 -- Expire it with a reload instruction; never replay a guess or clue.
 update public.tunerush_s21_relay_jobs
 set status='done',finished_at=now(),
     response_payload=jsonb_build_object('ok',false,'error',
       'The game connection was interrupted. Reload to check your saved game before retrying.')
 where status='claimed' and claimed_at<now()-interval '65 seconds'
   and request_payload->>'command'<>'state';
 update public.tunerush_s21_relay_jobs set status='queued',claimed_at=null
 where status='claimed' and claimed_at<now()-interval '65 seconds'
   and request_payload->>'command'='state';
 delete from public.tunerush_s21_relay_jobs
 where created_at<now()-interval '20 minutes'
 or (status='done' and finished_at<now()-interval '90 seconds');
 with available as (
   select id from public.tunerush_s21_relay_jobs
   where status='queued' order by created_at
   limit 1 for update skip locked
 ), claimed as (
   update public.tunerush_s21_relay_jobs j
   set status='claimed',claimed_at=now()
   from available a where j.id=a.id
   returning j.id,j.request_payload
 )
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'request',request_payload)),'[]'::jsonb)
 into v_claimed from claimed;
 return jsonb_build_object('jobs',v_claimed);
end;$function$;


CREATE OR REPLACE FUNCTION public.tunerush_s21_complete_v1(p_worker_secret text, p_id uuid, p_result jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_count int;
begin
 if p_worker_secret is null or p_worker_secret !~ '^[a-f0-9]{64}$'
 or not exists (select 1 from public.tunerush_s21_relay_workers
 where id in ('s21-solo','c720p-transport') and secret_hash=encode(sha256(convert_to(p_worker_secret,'UTF8')),'hex'))
 then raise exception 'Worker not authorized' using errcode='28000'; end if;
 if p_id is null or p_result is null or jsonb_typeof(p_result)<>'object'
 or length(p_result::text)>1500000
 or (length(p_result::text)>12000 and not coalesce(
    p_result->>'ok'='true'
    and p_result #>> '{body,state,source}'='persistent-library'
    and p_result #>> '{body,state,phase}'='playing'
    and p_result #>> '{body,state,clipAudio}' like 'data:audio/mpeg;base64,%'
    and length(p_result #>> '{body,state,clipAudio}')<=1466700
    and exists (
      select 1 from public.tunerush_s21_relay_jobs j
      where j.id=p_id and j.status='claimed'
        and (j.request_payload->>'command'='state'
          or (j.request_payload->>'command'='action'
              and j.request_payload #>> '{data,op}'='clue'))
    ),false))
 then raise exception 'Invalid game result' using errcode='22023'; end if;
 update public.tunerush_s21_relay_jobs
 set response_payload=p_result,status='done',finished_at=now()
 where id=p_id and status='claimed';
 get diagnostics v_count = row_count;
 return jsonb_build_object('ok',v_count=1);
end;$function$;


CREATE OR REPLACE FUNCTION public.tunerush_s21_health_v1()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_seen timestamptz;
begin
 select max(seen_at) into v_seen from public.tunerush_s21_relay_workers where id in ('s21-solo','c720p-transport');
 return jsonb_build_object('online',v_seen is not null and v_seen>now()-interval '25 seconds',
                           'seen_at',v_seen,'transport','s21-rpc-v1');
end;$function$;

