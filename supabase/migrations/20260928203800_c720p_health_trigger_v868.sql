create or replace function c720p_security.process_device_health_v1()
returns trigger
language plpgsql
security definer
set search_path to 'c720p_security', 'public'
as $function$
begin
  perform c720p_security.evaluate_push_health_v2();

  -- v868 compatibility cleanup: these keys came from the superseded
  -- pre-v866 device-health evaluator and must not be recreated.
  perform c720p_security.set_health_alert_v1(
    'c720p_core_service_failure', false, 'high',
    'Legacy C720P core-service alert key.', '{}'::jsonb
  );
  perform c720p_security.set_health_alert_v1(
    'c720p_voice_listener_missing', false, 'high',
    'Legacy C720P voice-listener alert key.', '{}'::jsonb
  );
  perform c720p_security.set_health_alert_v1(
    's3_source_offline', false, 'high',
    'S3 recorder retired; legacy source-offline alert key.', '{}'::jsonb
  );

  return new;
end;
$function$;

select c720p_security.evaluate_push_health_v2();
