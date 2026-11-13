-- Tune Rush S21 cached multiplayer transport (narrow extension, preserves Solo).
-- The phone alone grants host role and produces bounded MP3 clue bytes.
-- Existing worker secret hashes, queues, rate limits and room credentials remain intact.
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
    and p_result #>> '{body,state,phase}'='playing'
    and p_result #>> '{body,state,clipAudio}' like 'data:audio/mpeg;base64,%'
    and length(p_result #>> '{body,state,clipAudio}')<=1466700
    and exists (
      select 1 from public.tunerush_s21_relay_jobs j
      where j.id=p_id and j.status='claimed'
        and (
          (p_result #>> '{body,state,source}'='persistent-library'
            and (j.request_payload->>'command'='state'
             or (j.request_payload->>'command'='action'
                 and j.request_payload #>> '{data,op}'='clue')))
          or
          (j.request_payload->>'command'='multiplayer'
            and j.request_payload #>> '{data,action}' in ('play','replay','state')
            and p_result #>> '{body,state,role}'='host'
            and p_result #>> '{body,state,phase}'='playing'
            and p_result #>> '{body,state,audio,source}' like 'cached:%')
        )
    ),false))
 then raise exception 'Invalid game result' using errcode='22023'; end if;
 update public.tunerush_s21_relay_jobs
 set response_payload=p_result,status='done',finished_at=now()
 where id=p_id and status='claimed';
 get diagnostics v_count = row_count;
 return jsonb_build_object('ok',v_count=1);
end;$function$


CREATE OR REPLACE FUNCTION public.tunerush_s21_mp_submit_v1(p_action text, p_code text, p_hash text, p_data jsonb, p_poll_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_id uuid; v_busy int;
begin
 if p_poll_hash is null or p_poll_hash !~ '^[a-f0-9]{64}$'
 or p_code is null or upper(trim(p_code)) !~ '^[A-HJ-NP-Z2-9]{6}$'
 or p_hash is null or p_hash !~ '^[a-f0-9]{64}$'
 or p_action not in ('create','state','join','settings','start','next','random_cue','play',
                     'replay','pause','resume','buzz','steal','expire','forfeit','answer','skip','finish')
 or p_data is null or jsonb_typeof(p_data)<>'object'
 or length(p_data::text)>2800
 then raise exception 'Invalid S21 multiplayer request' using errcode='22023'; end if;
 select count(*) into v_busy from (
   select id from public.tunerush_s21_relay_jobs
   where status in ('queued','claimed') and created_at>now()-interval '5 minutes'
   limit 31
 ) waiting;
 if v_busy>=30 then raise exception 'S21 queue is busy' using errcode='P0001'; end if;
 v_id:=gen_random_uuid();
 insert into public.tunerush_s21_relay_jobs(id,poll_hash,request_payload)
 values (
   v_id,p_poll_hash,
   jsonb_build_object('command','multiplayer','token',null,
    'data',jsonb_build_object('action',p_action,'code',upper(trim(p_code)),
                              'hash',p_hash,'data',p_data))
 );
 return jsonb_build_object('id',v_id::text);
end
$function$

