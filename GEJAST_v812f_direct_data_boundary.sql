-- GEJAST v812f: direct data / internal RPC boundary hardening.
-- SQL-only release. Prepared against production on 2026-08-18 and re-grounded on 2026-08-21.
-- Apply once through the tracked Supabase migration path only after explicit authorization.
-- service_role and function-owner privileges are intentionally untouched.

begin;

-- The browser application is RPC-owned. Client roles must not mutate base tables directly.
revoke insert, update, delete, truncate on all tables in schema public from public, anon, authenticated;
alter default privileges in schema public revoke insert, update, delete, truncate on tables from public, anon, authenticated;

-- Sequences are backend implementation details, never browser API.
revoke usage, select, update on all sequences in schema public from public, anon, authenticated;
alter default privileges in schema public revoke usage, select, update on sequences from public, anon, authenticated;

-- Sensitive RLS-off stores must not be directly readable through PostgREST.
-- Ordinary public gameplay/stat source-table SELECT grants are deliberately preserved for
-- compatibility with legacy SECURITY INVOKER read RPCs.
do $v812f$
declare r record;
begin
  for r in
    select n.nspname, c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r','p')
      and (
        c.relname like 'admin\_%' escape '\'
        or c.relname ~* '(session|activation|claim|email|invite|token)'
        or c.relname in (
          'allowed_usernames','available_names','hidden_site_names',
          'active_web_push_presence','web_push_delivery_queue','web_push_job_attempts',
          'native_push_jobs','match_change_log',
          'scope_quarantine_boerenbridge_matches','scope_quarantine_game_match_summaries'
        )
      )
  loop
    execute format('revoke select on table %I.%I from public, anon, authenticated', r.nspname, r.relname);
  end loop;
end
$v812f$;

-- Earlier v813 hardening already removed client EXECUTE from SECURITY DEFINER underscore
-- helpers. Do not revoke every remaining underscore helper: several safe SECURITY INVOKER
-- read RPCs depend on normalization/read helpers. The one remaining client-executable
-- underscore routine with ordinary function mutation is locked explicitly.
revoke execute on function public._web_push_apply_action(text,bigint,text,bigint) from public, anon, authenticated;

-- Legacy/noncanonical identity surfaces. The shipped activation flow uses activation-token
-- RPCs; set_initial_pin is unused by active browser code and must not remain an anonymous
-- credential setter. The identity-summary RPC is likewise unused by shipped code and has an
-- email-bearing return schema, so it is removed from the browser API even when current email
-- values happen to be NULL. Both historical reset overloads are unused by shipped code and
-- can return or initiate reset credentials from unauthenticated name/email input; reset
-- credentials must only travel through the canonical email/token activation path.
revoke execute on function public.set_initial_pin(text,text) from public, anon, authenticated;
revoke execute on function public.get_account_identity_summary_scoped(text) from public, anon, authenticated;
revoke execute on function public.request_pin_reset_reactivation_action(text,text,text) from public, anon, authenticated;
revoke execute on function public.request_pin_reset_reactivation_action(text,text) from public, anon, authenticated;

-- Trigger functions are implementation details rather than browser RPCs. Lock the two named
-- non-underscore trigger helpers that remained client-executable after earlier hardening.
-- Existing trigger bindings are not altered.
revoke execute on function public.despimarkt_try_create_market_from_match_row_v646() from public, anon, authenticated;
revoke execute on function public.gejast_cleanup_activation_link_duplicates_before_insert() from public, anon, authenticated;

-- Admin-prefixed routines without an admin-session argument are legacy diagnostics/helpers.
-- Keep only the actual login credential-entry RPC and the player-session Paardenrace
-- compatibility overview, whose payload is public-room information.
do $v812f$
declare r record;
begin
  for r in
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname like 'admin\_%' escape '\'
      and pg_get_function_identity_arguments(p.oid) !~* 'admin_session_token'
      and p.proname not in ('admin_login','admin_get_paardenrace_overview_v667')
  loop
    execute format(
      'revoke execute on function %I.%I(%s) from public, anon, authenticated',
      r.nspname, r.proname, r.args
    );
  end loop;
end
$v812f$;

-- Remaining unauthenticated worker/mutation compatibility aliases.
-- Canonical authenticated/SECURITY DEFINER overloads remain available.
revoke execute on function public.claim_web_push_jobs(integer) from public, anon, authenticated;
revoke execute on function public.consume_web_push_action_v3(uuid) from public, anon, authenticated;
revoke execute on function public.enqueue_email_job(text,jsonb) from public, anon, authenticated;
revoke execute on function public.queue_activation_email(text,text) from public, anon, authenticated;
revoke execute on function public.queue_nearby_verification_pushes_v3(text,bigint,integer) from public, anon, authenticated;
revoke execute on function public.despimarkt_finalize_caute_mint_from_verified_drink(bigint) from public, anon, authenticated;
revoke execute on function public.despimarkt_finalize_debt_clear_from_verified_drink(bigint) from public, anon, authenticated;
revoke execute on function public.validate_outbound_email_job_public(bigint,boolean) from public, anon, authenticated;

commit;
