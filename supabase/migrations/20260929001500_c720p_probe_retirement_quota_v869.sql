-- C720P v869 health-probe policy
-- Retired S3 is no longer probed.
-- NEW archive quota remains soft around the protected six-newest floor.

create or replace function c720p_security.enqueue_status_probes_v1()
returns jsonb
language plpgsql
security definer
set search_path to 'c720p_security','net','public'
as $function$
declare
  base text;
  tok text;
  newid bigint;
begin
  select regexp_replace(tunnel_url,'/+$','') into base
  from c720p_security.control where singleton=true;
  if coalesce(base,'')='' then raise exception 'security tunnel is not registered'; end if;
  tok := c720p_security.media_token_v1();

  newid := net.http_get(
    url:=base||'/new/api/status',
    headers:=jsonb_build_object('X-C720P-Media-Token',tok),
    timeout_milliseconds:=12000
  );
  insert into c720p_security.probe_requests(request_id,camera,requested_at)
  values(newid,'new',now())
  on conflict(request_id) do nothing;

  perform c720p_security.set_health_alert_v1('s3_source_offline',false,'high','S3 camera retired; source probe disabled.','{"retired":true}'::jsonb);
  perform c720p_security.set_health_alert_v1('s3_tunnel_error',false,'high','S3 camera retired; tunnel probe disabled.','{"retired":true}'::jsonb);
  perform c720p_security.set_health_alert_v1('s3_probe_stale',false,'high','S3 camera retired; probe freshness no longer applies.','{"retired":true}'::jsonb);

  return jsonb_build_object('ok',true,'new_request_id',newid,'s3_retired',true);
end;
$function$;

create or replace function c720p_security.collect_status_probes_v1()
returns jsonb
language plpgsql
security definer
set search_path to 'c720p_security','net','public'
as $function$
declare
  rec record;
  body jsonb;
  src boolean;
  free_mb numeric;
  usage_pct numeric;
  event_count int;
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
    event_count := case when body ? 'event_count' then nullif(body->>'event_count','')::int else null end;

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

    if rec.camera <> 's3' then
      perform c720p_security.set_health_alert_v1(
        rec.camera||'_tunnel_error',
        rec.status_code is distinct from 200,
        'high',
        upper(rec.camera)||' security relay returned '||coalesce(rec.status_code::text,'no HTTP response')||'.',
        jsonb_build_object('status_code',rec.status_code,'error',rec.error_msg,'requested_at',rec.requested_at)
      );
      perform c720p_security.set_health_alert_v1(
        rec.camera||'_source_offline',
        rec.status_code=200 and src is false,
        'high',
        upper(rec.camera)||' camera source is offline behind the C720P security relay.',
        body
      );
    end if;

    if free_mb is not null then
      perform c720p_security.set_health_alert_v1(
        'c720p_disk_low',
        free_mb < 1600,
        case when free_mb < 1000 then 'high' else 'medium' end,
        'C720P camera storage has only '||round(free_mb)||' MB free.',
        jsonb_build_object('disk_free_mb',free_mb,'camera',rec.camera,'retention_reserve_mb',1600,'hard_recording_floor_mb',900)
      );
    end if;

    if usage_pct is not null then
      perform c720p_security.set_health_alert_v1(
        rec.camera||'_archive_over_quota',
        usage_pct > 110 or (usage_pct > 100 and coalesce(event_count,0) > 6),
        case when usage_pct > 125 then 'high' else 'medium' end,
        upper(rec.camera)||' local camera archive is at '||round(usage_pct,1)||'% of its configured quota.',
        jsonb_build_object(
          'archive_usage_percent',usage_pct,
          'archive_used_mb',body->'archive_used_mb',
          'archive_quota_mb',body->'archive_quota_mb',
          'event_count',event_count,
          'protected_recent_floor',6,
          'soft_quota_tolerance_percent',110
        )
      );
    end if;

    delete from c720p_security.probe_requests where request_id=rec.request_id;
    processed:=processed+1;
  end loop;

  for stale in
    select camera,observed_at from c720p_security.probe_latest where camera <> 's3'
  loop
    perform c720p_security.set_health_alert_v1(
      stale.camera||'_probe_stale',
      stale.observed_at < now()-interval '30 minutes',
      'high',
      upper(stale.camera)||' security health probe is stale.',
      jsonb_build_object('last_observed_at',stale.observed_at)
    );
  end loop;

  perform c720p_security.set_health_alert_v1('s3_source_offline',false,'high','S3 camera retired.','{"retired":true}'::jsonb);
  perform c720p_security.set_health_alert_v1('s3_tunnel_error',false,'high','S3 camera retired.','{"retired":true}'::jsonb);
  perform c720p_security.set_health_alert_v1('s3_probe_stale',false,'high','S3 camera retired.','{"retired":true}'::jsonb);

  delete from c720p_security.probe_requests where requested_at < now()-interval '2 hours';
  return jsonb_build_object('ok',true,'processed',processed,'s3_retired',true);
end;
$function$;
