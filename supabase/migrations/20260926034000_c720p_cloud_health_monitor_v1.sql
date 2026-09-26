-- C720P cloud health monitor v1 — 2026-09-26
-- Read-only camera probes + authenticated device health ingest processing.
begin;

create schema if not exists c720p_security;

create table if not exists c720p_security.health_latest (
  singleton boolean primary key default true check (singleton),
  observed_at timestamptz not null default now(),
  received_at timestamptz not null default now(),
  source text not null default 'c720p',
  payload jsonb not null default '{}'::jsonb
);
create table if not exists c720p_security.probe_requests (
  request_id bigint primary key,
  camera text not null check (camera in ('s3','new')),
  requested_at timestamptz not null default now()
);
create table if not exists c720p_security.probe_latest (
  camera text primary key check (camera in ('s3','new')),
  requested_at timestamptz,
  observed_at timestamptz not null default now(),
  status_code integer,
  ok boolean not null default false,
  source_online boolean,
  payload jsonb not null default '{}'::jsonb,
  error text
);
create table if not exists c720p_security.health_alerts (
  alert_key text primary key,
  severity text not null check (severity in ('info','medium','high')),
  active boolean not null default true,
  message text not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  details jsonb not null default '{}'::jsonb
);
revoke all on c720p_security.health_latest,c720p_security.probe_requests,c720p_security.probe_latest,c720p_security.health_alerts from public,anon,authenticated;

create or replace function c720p_security.media_token_v1()
returns text
language plpgsql
security definer
set search_path='c720p_security','extensions','public'
as $$
declare
  secret text;
  pp text;
  sig text;
begin
  select hmac_secret into secret from c720p_security.control where singleton=true;
  if coalesce(secret,'')='' then raise exception 'missing security HMAC secret'; end if;
  pp := replace(replace(replace(
    regexp_replace(
      encode(convert_to(jsonb_build_object(
        'iat',extract(epoch from now())::bigint-120,
        'exp',extract(epoch from now())::bigint+180,
        'scope','c720p-security-media-v1'
      )::text,'utf8'),'base64'),
      '\s','','g'
    ),'+','-'),'/','_'),'=','');
  sig := replace(replace(replace(
    regexp_replace(
      encode(hmac(convert_to(pp,'utf8'),decode(secret,'hex'),'sha256'),'base64'),
      '\s','','g'
    ),'+','-'),'/','_'),'=','');
  return pp||'.'||sig;
end;
$$;
revoke all on function c720p_security.media_token_v1() from public,anon,authenticated;
grant execute on function c720p_security.media_token_v1() to service_role;

create or replace function c720p_security.set_health_alert_v1(
  p_key text,p_active boolean,p_severity text,p_message text,p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path='c720p_security','public'
as $$
begin
  if p_active then
    insert into c720p_security.health_alerts(alert_key,severity,active,message,first_seen_at,last_seen_at,resolved_at,details)
    values(p_key,p_severity,true,p_message,now(),now(),null,coalesce(p_details,'{}'::jsonb))
    on conflict(alert_key) do update set
      severity=excluded.severity,active=true,message=excluded.message,last_seen_at=now(),resolved_at=null,details=excluded.details;
  else
    update c720p_security.health_alerts
    set active=false,last_seen_at=now(),resolved_at=coalesce(resolved_at,now())
    where alert_key=p_key and active=true;
  end if;
end;
$$;
revoke all on function c720p_security.set_health_alert_v1(text,boolean,text,text,jsonb) from public,anon,authenticated;
grant execute on function c720p_security.set_health_alert_v1(text,boolean,text,text,jsonb) to service_role;

create or replace function c720p_security.enqueue_status_probes_v1()
returns jsonb
language plpgsql
security definer
set search_path='c720p_security','net','public'
as $$
declare
  base text;
  tok text;
  s3id bigint;
  newid bigint;
begin
  select regexp_replace(tunnel_url,'/+$','') into base from c720p_security.control where singleton=true;
  if coalesce(base,'')='' then raise exception 'security tunnel is not registered'; end if;
  tok := c720p_security.media_token_v1();
  s3id := net.http_get(
    url:=base||'/s3/api/status',
    headers:=jsonb_build_object('X-C720P-Media-Token',tok),
    timeout_milliseconds:=12000
  );
  newid := net.http_get(
    url:=base||'/new/api/status',
    headers:=jsonb_build_object('X-C720P-Media-Token',tok),
    timeout_milliseconds:=12000
  );
  insert into c720p_security.probe_requests(request_id,camera,requested_at)
  values(s3id,'s3',now()),(newid,'new',now())
  on conflict(request_id) do nothing;
  return jsonb_build_object('ok',true,'s3_request_id',s3id,'new_request_id',newid);
end;
$$;
revoke all on function c720p_security.enqueue_status_probes_v1() from public,anon,authenticated;
grant execute on function c720p_security.enqueue_status_probes_v1() to service_role;

create or replace function c720p_security.collect_status_probes_v1()
returns jsonb
language plpgsql
security definer
set search_path='c720p_security','net','public'
as $$
declare
  rec record;
  body jsonb;
  src boolean;
  free_mb numeric;
  usage_pct numeric;
  processed int:=0;
  stale record;
begin
  for rec in
    select r.request_id,r.camera,r.requested_at,h.status_code,h.timed_out,h.error_msg,h.content_type,h.content,h.created
    from c720p_security.probe_requests r
    join net._http_response h on h.id=r.request_id
    order by r.requested_at
  loop
    body := '{}'::jsonb;
    if rec.status_code=200 and coalesce(rec.content_type,'') ilike 'application/json%' then
      begin body := rec.content::jsonb; exception when others then body := jsonb_build_object('parse_error',true); end;
    end if;
    src := case when body ? 'source_online' then coalesce((body->>'source_online')::boolean,false) else null end;
    free_mb := case when body ? 'disk_free_mb' then nullif(body->>'disk_free_mb','')::numeric else null end;
    usage_pct := case when body ? 'archive_usage_percent' then nullif(body->>'archive_usage_percent','')::numeric else null end;

    insert into c720p_security.probe_latest(camera,requested_at,observed_at,status_code,ok,source_online,payload,error)
    values(
      rec.camera,rec.requested_at,coalesce(rec.created,now()),rec.status_code,
      rec.status_code=200 and coalesce((body->>'ok')::boolean,false),
      src,body,
      coalesce(rec.error_msg,case when rec.status_code is distinct from 200 then 'HTTP '||coalesce(rec.status_code::text,'no response') else null end)
    )
    on conflict(camera) do update set
      requested_at=excluded.requested_at,observed_at=excluded.observed_at,status_code=excluded.status_code,
      ok=excluded.ok,source_online=excluded.source_online,payload=excluded.payload,error=excluded.error;

    perform c720p_security.set_health_alert_v1(
      rec.camera||'_tunnel_error',rec.status_code is distinct from 200,'high',
      upper(rec.camera)||' security relay returned '||coalesce(rec.status_code::text,'no HTTP response')||'.',
      jsonb_build_object('status_code',rec.status_code,'error',rec.error_msg,'requested_at',rec.requested_at)
    );
    perform c720p_security.set_health_alert_v1(
      rec.camera||'_source_offline',rec.status_code=200 and src is false,'high',
      upper(rec.camera)||' camera source is offline behind the C720P security relay.',body
    );
    if free_mb is not null then
      perform c720p_security.set_health_alert_v1(
        'c720p_disk_low',free_mb < 1600,case when free_mb < 1000 then 'high' else 'medium' end,
        'C720P camera storage has only '||round(free_mb)||' MB free.',
        jsonb_build_object('disk_free_mb',free_mb,'camera',rec.camera,'retention_reserve_mb',1600,'hard_recording_floor_mb',900)
      );
    end if;
    if usage_pct is not null then
      perform c720p_security.set_health_alert_v1(
        rec.camera||'_archive_over_quota',usage_pct > 100,case when usage_pct > 125 then 'high' else 'medium' end,
        upper(rec.camera)||' local camera archive is at '||round(usage_pct,1)||'% of its configured quota.',
        jsonb_build_object('archive_usage_percent',usage_pct,'archive_used_mb',body->'archive_used_mb','archive_quota_mb',body->'archive_quota_mb')
      );
    end if;

    delete from c720p_security.probe_requests where request_id=rec.request_id;
    processed:=processed+1;
  end loop;

  for stale in select camera,observed_at from c720p_security.probe_latest loop
    perform c720p_security.set_health_alert_v1(
      stale.camera||'_probe_stale',stale.observed_at < now()-interval '30 minutes','high',
      upper(stale.camera)||' security health probe is stale.',
      jsonb_build_object('last_observed_at',stale.observed_at)
    );
  end loop;
  delete from c720p_security.probe_requests where requested_at < now()-interval '2 hours';
  return jsonb_build_object('ok',true,'processed',processed);
end;
$$;
revoke all on function c720p_security.collect_status_probes_v1() from public,anon,authenticated;
grant execute on function c720p_security.collect_status_probes_v1() to service_role;

create or replace function c720p_security.process_device_health_v1()
returns trigger
language plpgsql
security definer
set search_path='c720p_security','public'
as $$
declare
  drive_status text := lower(coalesce(new.payload#>>'{drive,status}',''));
  drive_retry text := coalesce(new.payload#>>'{drive,retry_after}','');
  mail_status text := lower(coalesce(new.payload#>>'{mail,status}',''));
  backup_age numeric;
  missing_voice int := 0;
  failed_services int := 0;
begin
  perform c720p_security.set_health_alert_v1(
    'drive_upload_quota',drive_status in ('quota_exceeded','quota_backoff'),'high',
    case when drive_retry<>'' then 'C720P camera archive uploads are blocked by Google Drive storage quota until the next retry window ('||drive_retry||').' else 'C720P camera archive uploads are blocked by Google Drive storage quota.' end,
    coalesce(new.payload->'drive','{}'::jsonb)
  );
  perform c720p_security.set_health_alert_v1(
    'inbox_triage_auth',mail_status in ('auth_required','degraded_auth'),'medium',
    'C720P inbox triage needs Google OAuth re-authentication before Gmail summaries can resume.',
    coalesce(new.payload->'mail','{}'::jsonb)
  );
  begin
    backup_age := nullif(new.payload#>>'{backup,latest_age_seconds}','')::numeric;
  exception when others then backup_age := null;
  end;
  perform c720p_security.set_health_alert_v1(
    'c720p_backup_stale',backup_age is not null and backup_age > 172800,'medium',
    'C720P local system backup is older than 48 hours.',coalesce(new.payload->'backup','{}'::jsonb)
  );
  select count(*) into missing_voice
  from jsonb_each_text(coalesce(new.payload->'voice_ports','{}'::jsonb)) x
  where lower(x.value) not in ('true','1','open');
  perform c720p_security.set_health_alert_v1(
    'c720p_voice_listener_missing',missing_voice > 0,'high',
    missing_voice||' C720P voice listener port'||case when missing_voice=1 then ' is' else 's are' end||' unavailable.',
    coalesce(new.payload->'voice_ports','{}'::jsonb)
  );
  select count(*) into failed_services
  from jsonb_each_text(coalesce(new.payload->'services','{}'::jsonb)) x
  where lower(x.value) not in ('active','activating');
  perform c720p_security.set_health_alert_v1(
    'c720p_core_service_failure',failed_services > 0,'high',
    failed_services||' monitored C720P core service'||case when failed_services=1 then ' is' else 's are' end||' not active.',
    coalesce(new.payload->'services','{}'::jsonb)
  );
  return new;
end;
$$;
revoke all on function c720p_security.process_device_health_v1() from public,anon,authenticated;

drop trigger if exists c720p_health_latest_process_v1 on c720p_security.health_latest;
create trigger c720p_health_latest_process_v1
after insert or update on c720p_security.health_latest
for each row execute function c720p_security.process_device_health_v1();

create or replace function c720p_security.admin_health_v1(admin_session_token_input text)
returns jsonb
language plpgsql
security definer
set search_path='c720p_security','public'
as $$
declare
  sess record;
  probes jsonb;
  alerts jsonb;
  dev jsonb := null;
  dev_observed timestamptz := null;
begin
  select * into sess from public._require_valid_admin_session(admin_session_token_input);
  if coalesce(sess.ok,false) is not true then
    return jsonb_build_object('ok',false,'error','invalid_admin_session');
  end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.camera),'[]'::jsonb) into probes
  from (
    select camera,observed_at,status_code,ok,source_online,
           payload->'archive_used_mb' as archive_used_mb,payload->'archive_quota_mb' as archive_quota_mb,
           payload->'archive_usage_percent' as archive_usage_percent,payload->'disk_free_mb' as disk_free_mb,
           payload->'last_event_at' as last_event_at,error
    from c720p_security.probe_latest
  ) x;
  select coalesce(jsonb_agg(to_jsonb(a) order by case a.severity when 'high' then 1 when 'medium' then 2 else 3 end,a.alert_key),'[]'::jsonb)
  into alerts
  from (
    select alert_key,severity,message,first_seen_at,last_seen_at,details
    from c720p_security.health_alerts where active=true
  ) a;
  select payload,observed_at into dev,dev_observed from c720p_security.health_latest where singleton=true;
  return jsonb_build_object(
    'ok',true,'generated_at',now(),'probes',probes,'alerts',alerts,
    'device_health',dev,'device_observed_at',dev_observed,'healthy',jsonb_array_length(alerts)=0
  );
end;
$$;
revoke all on function c720p_security.admin_health_v1(text) from public,anon,authenticated;
grant execute on function c720p_security.admin_health_v1(text) to service_role;

create or replace function public.admin_c720p_health_v858(admin_session_token_input text)
returns jsonb
language sql
security definer
set search_path to 'public','c720p_security'
as $$
  select c720p_security.admin_health_v1(admin_session_token_input);
$$;
revoke all on function public.admin_c720p_health_v858(text) from public,anon,authenticated;
grant execute on function public.admin_c720p_health_v858(text) to service_role;

do $$
begin
  if exists(select 1 from cron.job where jobname='c720p_security_status_probe_v1') then perform cron.unschedule('c720p_security_status_probe_v1'); end if;
  if exists(select 1 from cron.job where jobname='c720p_security_status_collect_v1') then perform cron.unschedule('c720p_security_status_collect_v1'); end if;
end $$;
select cron.schedule('c720p_security_status_probe_v1','*/10 * * * *',$$select c720p_security.enqueue_status_probes_v1();$$);
select cron.schedule('c720p_security_status_collect_v1','* * * * *',$$select c720p_security.collect_status_probes_v1();$$);

commit;
