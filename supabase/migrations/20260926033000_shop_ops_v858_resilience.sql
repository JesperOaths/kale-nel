-- v858 shop operations resilience hardening — 2026-09-26
-- Reproduces the live scheduler provenance/health and disposable telemetry self-test.
begin;

alter table public.shop_ops_scheduler_tokens_v847
  add column if not exists source text not null default 'legacy';

create index if not exists shop_ops_scheduler_tokens_v847_source_created_idx
  on public.shop_ops_scheduler_tokens_v847(source,created_at desc);

create or replace function public.shop_ops_mint_scheduler_token_v858(source_input text default 'unknown')
returns text
language plpgsql
security definer
set search_path to 'public','extensions'
as $$
declare
  v_token text;
  v_hash text;
  v_source text := left(regexp_replace(lower(coalesce(source_input,'unknown')),'[^a-z0-9_-]+','','g'),40);
begin
  if v_source = '' then v_source := 'unknown'; end if;
  delete from public.shop_ops_scheduler_tokens_v847
  where expires_at < now() - interval '2 days'
     or consumed_at < now() - interval '2 days';
  v_token := encode(extensions.gen_random_bytes(32),'hex');
  v_hash := encode(extensions.digest(v_token,'sha256'),'hex');
  insert into public.shop_ops_scheduler_tokens_v847(token_hash,expires_at,source)
  values(v_hash,now()+interval '5 minutes',v_source);
  return v_token;
end;
$$;
revoke all on function public.shop_ops_mint_scheduler_token_v858(text) from public,anon,authenticated;
grant execute on function public.shop_ops_mint_scheduler_token_v858(text) to service_role;

create or replace function public.shop_ops_scheduler_health_v858(admin_session_token_input text)
returns jsonb
language plpgsql
security definer
set search_path to 'public','cron'
as $$
declare
  sess record;
  j record;
  jr record;
  st public.shop_ops_state_v847%rowtype;
  db_created timestamptz;
  db_consumed timestamptz;
  gh_created timestamptz;
  gh_consumed timestamptz;
begin
  select * into sess from public._require_valid_admin_session(admin_session_token_input);
  if coalesce(sess.ok,false) is not true then
    return jsonb_build_object('ok',false,'error','invalid_admin_session');
  end if;

  select * into st from public.shop_ops_state_v847 where id=1;
  select jobid,jobname,schedule,active into j
  from cron.job where jobname='shop_ops_v847_db_fallback' limit 1;

  if j.jobid is not null then
    select status,start_time,end_time,return_message into jr
    from cron.job_run_details where jobid=j.jobid order by runid desc limit 1;
  end if;

  select max(created_at),max(consumed_at) into db_created,db_consumed
  from public.shop_ops_scheduler_tokens_v847 where source='database_cron';
  select max(created_at),max(consumed_at) into gh_created,gh_consumed
  from public.shop_ops_scheduler_tokens_v847 where source='github_actions';

  return jsonb_build_object(
    'ok',true,
    'database_fallback',jsonb_build_object(
      'configured',j.jobid is not null,'active',coalesce(j.active,false),'schedule',j.schedule,
      'last_cron_status',jr.status,'last_cron_start',jr.start_time,'last_cron_end',jr.end_time,
      'last_token_created',db_created,'last_token_consumed',db_consumed
    ),
    'github_actions',jsonb_build_object('last_token_created',gh_created,'last_token_consumed',gh_consumed),
    'operations',jsonb_build_object(
      'last_run_at',st.last_run_at,'last_error',st.last_error,'last_backup_at',st.last_backup_at,
      'last_cost_refresh_at',st.last_cost_refresh_at,'last_catalog_check_at',st.last_catalog_check_at,
      'last_order_check_at',st.last_order_check_at
    ),
    'healthy',
      coalesce(j.active,false)
      and coalesce(jr.status,'')='succeeded'
      and coalesce(st.last_error,'')=''
      and st.last_run_at > now()-interval '90 minutes'
      and st.last_backup_at > now()-interval '26 hours'
  );
end;
$$;
revoke all on function public.shop_ops_scheduler_health_v858(text) from public,anon,authenticated;
grant execute on function public.shop_ops_scheduler_health_v858(text) to service_role;

create or replace function public.shop_telemetry_selftest_v858()
returns jsonb
language plpgsql
security definer
set search_path to 'public','extensions'
as $$
declare
  v_suffix text := replace(extensions.gen_random_uuid()::text,'-','');
  v_visitor text := '__shop_health_v_'||v_suffix;
  v_session text := '__shop_health_s_'||v_suffix;
  v_result jsonb;
  v_event_count integer := 0;
  v_session_count integer := 0;
  v_visitor_count integer := 0;
begin
  begin
    v_result := public.track_site_event(
      event_name => 'health_check',
      event_category => 'operations',
      event_label => 'disposable_telemetry_selftest',
      page_path => '/__shop_telemetry_health__',
      page_url => 'https://kalenel.nl/__shop_telemetry_health__',
      page_title => 'Disposable telemetry self-test',
      referrer_url => null,
      visitor_id => v_visitor,
      session_id => v_session,
      device_type => 'server_selftest',
      browser_name => 'operations',
      os_name => 'server',
      viewport_width => null,
      viewport_height => null,
      language_code => 'en',
      time_zone => 'Europe/Amsterdam',
      user_agent => 'Kalenel-Shop-Ops-Telemetry-Selftest/8.58',
      is_logged_in => false,
      player_name => null,
      is_admin => false,
      extra => jsonb_build_object('synthetic',true,'disposable',true,'version','v858')
    );
    select count(*) into v_event_count from public.site_visitor_events
      where visitor_id=v_visitor and session_id=v_session and event_name='health_check';
    select count(*) into v_session_count from public.site_visit_sessions where session_id=v_session;
    select count(*) into v_visitor_count from public.site_visitors where visitor_id=v_visitor;
    if coalesce((v_result->>'ok')::boolean,false) is not true
       or v_event_count <> 1 or v_session_count <> 1 or v_visitor_count <> 1 then
      raise exception 'telemetry self-test verification failed';
    end if;
    delete from public.site_visitor_events where visitor_id=v_visitor or session_id=v_session;
    delete from public.site_visit_sessions where session_id=v_session;
    delete from public.site_visitors where visitor_id=v_visitor;
    return jsonb_build_object(
      'ok',true,'tested_at',now(),'event_written',v_event_count=1,'session_written',v_session_count=1,
      'visitor_written',v_visitor_count=1,
      'cleanup_verified',
        not exists(select 1 from public.site_visitor_events where visitor_id=v_visitor or session_id=v_session)
        and not exists(select 1 from public.site_visit_sessions where session_id=v_session)
        and not exists(select 1 from public.site_visitors where visitor_id=v_visitor)
    );
  exception when others then
    return jsonb_build_object('ok',false,'tested_at',now(),'error',left(sqlerrm,300),'cleanup_verified',true);
  end;
end;
$$;
revoke all on function public.shop_telemetry_selftest_v858() from public,anon,authenticated;
grant execute on function public.shop_telemetry_selftest_v858() to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname='shop_ops_v847_db_fallback') then
    perform cron.unschedule('shop_ops_v847_db_fallback');
  end if;
end
$$;

select cron.schedule(
  'shop_ops_v847_db_fallback',
  '17 * * * *',
  $cron$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name='shop_ops_project_url_v847')
             || '/functions/v1/shop-ops-v847',
      headers := jsonb_build_object(
        'Content-Type','application/json',
        'apikey',(select decrypted_secret from vault.decrypted_secrets where name='shop_ops_publishable_key_v847'),
        'x-shop-ops-token',public.shop_ops_mint_scheduler_token_v858('database_cron')
      ),
      body := '{"action":"run"}'::jsonb,
      timeout_milliseconds := 15000
    ) as request_id;
  $cron$
);

commit;
