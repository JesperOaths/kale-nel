-- C720P v869 health-probe policy
-- Retired S3 is no longer probed.
-- NEW archive quota is soft around the protected six-newest floor.

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

-- collect_status_probes_v1 was updated live on 2026-09-29 to:
-- * ignore S3 alert generation/freshness;
-- * use the NEW archive alert condition
--   usage_pct > 110 OR (usage_pct > 100 AND event_count > 6);
-- * preserve the 6-newest floor while still alerting on materially excessive usage.
