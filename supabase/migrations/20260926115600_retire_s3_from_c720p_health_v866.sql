create or replace function c720p_security.evaluate_push_health_v2()
returns jsonb
language plpgsql
security definer
set search_path to 'c720p_security', 'public'
as $function$
declare
  h c720p_security.health_latest%rowtype;
  p jsonb;
  stale boolean := true;
  drive_status text;
  drive_retry text;
  backup_age numeric;
  mail_status text;
  mail_errors int := 0;
  voice_bad text[] := array[]::text[];
  service_bad text[] := array[]::text[];
  k text;
  v text;
begin
  select * into h from c720p_security.health_latest where singleton=true;
  if found then
    p := coalesce(h.payload,'{}'::jsonb);
    stale := h.received_at < now()-interval '25 minutes';
  else
    p := '{}'::jsonb;
  end if;

  perform c720p_security.set_health_alert_v1(
    'c720p_heartbeat_stale', stale, 'high',
    case when found then 'C720P compact health heartbeat is stale.' else 'C720P compact health heartbeat has not reported yet.' end,
    jsonb_build_object('last_received_at',case when found then h.received_at else null end)
  );

  if not stale then
    drive_status := lower(coalesce(p#>>'{drive,status}',''));
    drive_retry := coalesce(p#>>'{drive,retry_after}','');
    perform c720p_security.set_health_alert_v1(
      'drive_upload_quota', drive_status in ('quota_exceeded','quota_backoff'), 'high',
      case when drive_retry<>'' then 'C720P camera archive uploads are blocked by Google Drive storage quota until the next retry window ('||drive_retry||').'
           else 'C720P camera archive uploads are blocked by Google Drive storage quota.' end,
      coalesce(p->'drive','{}'::jsonb)
    );
    perform c720p_security.set_health_alert_v1('drive_quota_exceeded',false,'high','Legacy Drive quota alert key.','{}'::jsonb);

    mail_status := lower(coalesce(p#>>'{mail,status}',''));
    begin
      mail_errors := jsonb_array_length(coalesce(p#>'{mail,account_errors}','[]'::jsonb));
    exception when others then mail_errors := 0;
    end;
    perform c720p_security.set_health_alert_v1(
      'inbox_triage_auth',
      mail_status in ('auth_required','degraded_auth','auth_error') or mail_errors>0,
      'medium',
      'C720P inbox triage needs Google OAuth re-authentication before Gmail summaries can resume.',
      coalesce(p->'mail','{}'::jsonb)
    );
    perform c720p_security.set_health_alert_v1('gmail_triage_degraded',false,'medium','Legacy Gmail triage alert key.','{}'::jsonb);

    foreach k in array array['10200','10300','10400','10701'] loop
      if coalesce((p#>>array['voice_ports',k])::boolean,false) is not true then
        voice_bad := array_append(voice_bad,k);
      end if;
    end loop;
    perform c720p_security.set_health_alert_v1(
      'voice_core_unavailable', cardinality(voice_bad)>0, 'medium',
      case when cardinality(voice_bad)>0 then 'C720P voice stack is missing listener(s): '||array_to_string(voice_bad,', ')||'.'
           else 'C720P core voice listeners are available.' end,
      jsonb_build_object('missing_ports',voice_bad,'voice_ports',coalesce(p->'voice_ports','{}'::jsonb))
    );

    begin backup_age := nullif(p#>>'{backup,latest_age_seconds}','')::numeric;
    exception when others then backup_age := null;
    end;
    perform c720p_security.set_health_alert_v1(
      'c720p_backup_stale', backup_age is null or backup_age > 172800, 'medium',
      case when backup_age is null then 'C720P backup age is unavailable.' else 'Latest C720P recovery backup is older than 48 hours.' end,
      coalesce(p->'backup','{}'::jsonb)
    );

    foreach k in array array[
      'c720p-agent-runner.service',
      'c720p-frontyard-security-new.service',
      'c720p-security-web.service',
      'c720p-security-tunnel.service',
      'c720p-openwakeword-v53e.service',
      'c720p-wyoming-satellite.service'
    ] loop
      v := coalesce(p#>>array['services',k],'unknown');
      if v <> 'active' then service_bad := array_append(service_bad,k||'='||v); end if;
    end loop;
    perform c720p_security.set_health_alert_v1(
      'c720p_critical_service_down', cardinality(service_bad)>0, 'high',
      case when cardinality(service_bad)>0 then 'One or more critical C720P services are not active.'
           else 'Critical C720P services are active.' end,
      jsonb_build_object('bad_services',service_bad,'services',coalesce(p->'services','{}'::jsonb))
    );
  end if;

  return jsonb_build_object(
    'ok',true,'heartbeat_stale',stale,'drive_status',drive_status,'mail_status',mail_status,
    'mail_account_errors',mail_errors,'voice_missing_ports',voice_bad,'bad_services',service_bad
  );
end;
$function$;
