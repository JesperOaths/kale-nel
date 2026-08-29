-- Production migration provenance backfill.
-- Already applied in Supabase as 20260829231158 / restore_safe_drinks_push_v661_diagnostics.
-- Recorded body below is copied from supabase_migrations.schema_migrations; do not rerun solely to reconcile repository history.

create or replace function public.get_drinks_push_phase_summary_v661(
  limit_input integer default 50,
  site_scope_input text default 'friends'::text
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_scope text := case when lower(coalesce(site_scope_input,'friends')) in ('family','familie') then 'family' else 'friends' end;
  v_limit integer := greatest(1, least(coalesce(limit_input,50), 200));
  v_drink_events integer := 0;
  v_pending integer := 0;
  v_active_push integer := 0;
  v_presence integer := 0;
  v_presence_recent integer := 0;
begin
  if to_regclass('public.drink_events') is not null then
    select count(*)::int,
           count(*) filter (where lower(coalesce(status,'')) in ('pending','open','waiting','queued','submitted','pending_verification','awaiting_verification','reviewing','under_review'))::int
      into v_drink_events, v_pending
      from public.drink_events
     where coalesce(site_scope,'friends') = v_scope;
  end if;

  if to_regclass('public.web_push_subscriptions') is not null then
    select count(*) filter (where coalesce(is_active,false))::int
      into v_active_push
      from public.web_push_subscriptions
     where coalesce(site_scope,'friends') = v_scope;
  end if;

  if to_regclass('public.active_web_push_presence') is not null then
    select count(*)::int,
           count(*) filter (where last_seen_at >= now() - interval '10 minutes')::int
      into v_presence, v_presence_recent
      from public.active_web_push_presence
     where coalesce(site_scope,'friends') = v_scope;
  end if;

  return jsonb_build_object(
    'ok', true,
    'version', 'v661-safe',
    'source', 'aggregate_only_no_subscription_secrets',
    'site_scope', v_scope,
    'limit', v_limit,
    'totals', jsonb_build_object(
      'drink_events', coalesce(v_drink_events,0),
      'pending_verifications', coalesce(v_pending,0),
      'active_push_subscriptions', coalesce(v_active_push,0),
      'presence_rows', coalesce(v_presence,0),
      'presence_seen_10m', coalesce(v_presence_recent,0)
    ),
    'recent_requests', '[]'::jsonb,
    'proof_notes', jsonb_build_array(
      'aggregate-only browser diagnostic',
      'subscription endpoints and key material are never returned',
      'raw presence/session rows are never returned'
    ),
    'sensitive_rows_redacted', true,
    'boundary', 'safe aggregate health only; privileged row diagnostics remain service-only'
  );
end;
$function$;

create or replace function public.get_drinks_pending_verification_summary_v661(
  limit_input integer default 50,
  site_scope_input text default 'friends'::text
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_base jsonb;
begin
  v_base := public.get_drinks_push_phase_summary_v661(limit_input, site_scope_input);
  return v_base || jsonb_build_object(
    'mode', 'pending_verifications',
    'recent_requests', '[]'::jsonb,
    'sensitive_rows_redacted', true
  );
end;
$function$;

create or replace function public.get_drinks_push_eligibility_summary_v661(
  limit_input integer default 50,
  site_scope_input text default 'friends'::text
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_base jsonb;
begin
  v_base := public.get_drinks_push_phase_summary_v661(limit_input, site_scope_input);
  return v_base || jsonb_build_object(
    'mode', 'eligibility',
    'push_rows', '[]'::jsonb,
    'presence_rows', '[]'::jsonb,
    'sensitive_rows_redacted', true,
    'eligibility_boundary', 'aggregate health only; endpoint, auth, p256dh, session and device rows are intentionally withheld'
  );
end;
$function$;

create or replace function public.admin_get_drinks_push_audit_v661(
  site_scope_input text default 'friends'::text
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_scope text := case when lower(coalesce(site_scope_input,'friends')) in ('family','familie') then 'family' else 'friends' end;
  v_summary jsonb;
begin
  v_summary := public.get_drinks_push_phase_summary_v661(25, v_scope);
  return jsonb_build_object(
    'ok', true,
    'version', 'v661-safe',
    'site_scope', v_scope,
    'safe_public_diagnostic', true,
    'tables', jsonb_build_object(
      'drink_events', to_regclass('public.drink_events') is not null,
      'drink_event_verifications', to_regclass('public.drink_event_verifications') is not null,
      'web_push_subscriptions', to_regclass('public.web_push_subscriptions') is not null,
      'active_web_push_presence', to_regclass('public.active_web_push_presence') is not null,
      'web_push_jobs', to_regclass('public.web_push_jobs') is not null,
      'web_push_action_tokens', to_regclass('public.web_push_action_tokens') is not null
    ),
    'summary', v_summary,
    'sensitive_rows_redacted', true,
    'boundary', 'catalog presence and aggregate counts only'
  );
end;
$function$;

revoke all on function public.get_drinks_push_phase_summary_v661(integer,text) from public;
revoke all on function public.get_drinks_pending_verification_summary_v661(integer,text) from public;
revoke all on function public.get_drinks_push_eligibility_summary_v661(integer,text) from public;
revoke all on function public.admin_get_drinks_push_audit_v661(text) from public;

grant execute on function public.get_drinks_push_phase_summary_v661(integer,text) to anon, authenticated, service_role;
grant execute on function public.get_drinks_pending_verification_summary_v661(integer,text) to anon, authenticated, service_role;
grant execute on function public.get_drinks_push_eligibility_summary_v661(integer,text) to anon, authenticated, service_role;
grant execute on function public.admin_get_drinks_push_audit_v661(text) to anon, authenticated, service_role;
