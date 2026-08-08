-- Read-only post-apply verification for GEJAST v755p Beerpong repair.
-- Safe to run after v755p reports success.
-- Does not create/update/delete production rows.

with fn as (
  select p.oid,
         pg_get_functiondef(p.oid) as definition,
         p.proacl,
         p.proowner,
         p.prosecdef
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname='public'
     and p.oid=to_regprocedure('public.save_beerpong_match(text,text,jsonb)')
),
public_fn_exec as (
  select exists (
    select 1
      from fn,
           lateral aclexplode(coalesce(fn.proacl, acldefault('f', fn.proowner))) a
     where a.grantee=0 and a.privilege_type='EXECUTE'
  ) as allowed
),
public_dml as (
  select count(*)::integer as grants
    from information_schema.table_privileges
   where table_schema='public'
     and table_name in ('beerpong_matches','beerpong_player_ratings','beerpong_player_rating_history')
     and grantee='PUBLIC'
     and privilege_type in ('INSERT','UPDATE','DELETE')
),
webrole_dml as (
  select count(*)::integer as grants
    from information_schema.table_privileges
   where table_schema='public'
     and table_name in ('beerpong_matches','beerpong_player_ratings','beerpong_player_rating_history')
     and grantee in ('anon','authenticated')
     and privilege_type in ('INSERT','UPDATE','DELETE')
),
counts as (
  select
    (select count(*) from public.beerpong_matches) as matches,
    (select count(*) from public.beerpong_player_ratings) as ratings,
    (select count(*) from public.beerpong_player_rating_history) as history,
    (select count(*) from public.beerpong_matches where client_match_id like 'OC_V764_BEERPONG_%') as controlled
)
select 'function_exists' as check_name,
       case when exists(select 1 from fn) then 'PASS' else 'FAIL' end as result,
       'save_beerpong_match(text,text,jsonb)' as detail
union all
select 'security_definer',
       case when exists(select 1 from fn where prosecdef) then 'PASS' else 'FAIL' end,
       'RPC remains SECURITY DEFINER'
union all
select 'live_session_guard',
       case when exists(select 1 from fn where position('_tier3_player_from_any_session_v740' in definition)>0 and position('Niet ingelogd.' in definition)>0) then 'PASS' else 'FAIL' end,
       'valid player session required before write'
union all
select 'live_owner_guard',
       case when exists(select 1 from fn where position('beerpong_match_owner_mismatch' in definition)>0 and position('created_by_player_id <> p.id' in definition)>0) then 'PASS' else 'FAIL' end,
       'existing client_match_id is owner-scoped'
union all
select 'live_format_alias',
       case when exists(select 1 from fn where position("v_payload->>'match_format'" in definition)>0 and position("v_payload->>'format'" in definition)>0) then 'PASS' else 'FAIL' end,
       'match_format + format aliases compiled'
union all
select 'live_cups_alias',
       case when exists(select 1 from fn where position("cups_left_team_a" in definition)>0 and position("cups_left_team_b" in definition)>0) then 'PASS' else 'FAIL' end,
       'cups aliases compiled'
union all
select 'no_rating_rebuild',
       case when exists(select 1 from fn where position('rebuild_beerpong_ratings' in definition)=0) then 'PASS' else 'FAIL' end,
       'v755p must not rebuild ratings/history'
union all
select 'ratings_applied_false_contract',
       case when exists(select 1 from fn where position("'ratings_applied', false" in definition)>0) then 'PASS' else 'FAIL' end,
       'current no-rating-save contract preserved'
union all
select 'public_execute_revoked',
       case when not (select allowed from public_fn_exec) then 'PASS' else 'FAIL' end,
       'PUBLIC must not execute save_beerpong_match'
union all
select 'anon_execute_allowed',
       case when has_function_privilege('anon','public.save_beerpong_match(text,text,jsonb)','EXECUTE') then 'PASS' else 'FAIL' end,
       'anon may call internally guarded RPC'
union all
select 'authenticated_execute_allowed',
       case when has_function_privilege('authenticated','public.save_beerpong_match(text,text,jsonb)','EXECUTE') then 'PASS' else 'FAIL' end,
       'authenticated may call internally guarded RPC'
union all
select 'public_direct_dml_revoked',
       case when (select grants from public_dml)=0 then 'PASS' else 'FAIL' end,
       'no PUBLIC direct Beerpong INSERT/UPDATE/DELETE grants'
union all
select 'webrole_direct_dml_revoked',
       case when (select grants from webrole_dml)=0 then 'PASS' else 'FAIL' end,
       'no anon/authenticated direct Beerpong INSERT/UPDATE/DELETE grants'
union all
select 'controlled_beerpong_residue',
       case when (select controlled from counts)=0 then 'PASS' else 'FAIL' end,
       'controlled matches='||(select controlled::text from counts)
union all
select 'current_counts',
       'PASS',
       'matches='||(select matches::text from counts)||', ratings='||(select ratings::text from counts)||', history='||(select history::text from counts)
union all
select 'ice_invariant',
       case when (select unit_value from public.drink_event_types where key='ice' limit 1)=2.8 then 'PASS' else 'FAIL' end,
       'Ice='||coalesce((select unit_value::text from public.drink_event_types where key='ice' limit 1),'missing')
order by check_name;
