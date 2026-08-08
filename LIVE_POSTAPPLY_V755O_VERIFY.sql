-- Read-only post-apply verification for GEJAST v755o.
-- Safe to run in Supabase SQL Editor after v755o reports success.
-- Does not create/update/delete production rows.

with fn as (
  select p.oid,
         pg_get_functiondef(p.oid) as definition,
         p.proacl,
         p.proowner
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.oid = to_regprocedure('public.create_toepen_game(text,jsonb,text)')
),
public_fn_exec as (
  select exists (
    select 1
      from fn,
           lateral aclexplode(coalesce(fn.proacl, acldefault('f', fn.proowner))) a
     where a.grantee = 0
       and a.privilege_type = 'EXECUTE'
  ) as allowed
),
public_table_dml as (
  select count(*)::integer as grants
    from information_schema.table_privileges
   where table_schema = 'public'
     and table_name in ('toepen_games','toepen_game_participants','toepen_rounds','toepen_round_results')
     and grantee = 'PUBLIC'
     and privilege_type in ('INSERT','UPDATE','DELETE')
),
webrole_table_dml as (
  select count(*)::integer as grants
    from information_schema.table_privileges
   where table_schema = 'public'
     and table_name in ('toepen_games','toepen_game_participants','toepen_rounds','toepen_round_results')
     and grantee in ('anon','authenticated')
     and privilege_type in ('INSERT','UPDATE','DELETE')
)
select 'function_exists' as check_name,
       case when exists(select 1 from fn) then 'PASS' else 'FAIL' end as result,
       'create_toepen_game(text,jsonb,text)' as detail
union all
select 'live_totals_guard',
       case when exists(select 1 from fn where position('Toepen-eindscore komt niet overeen met rondepunten.' in definition) > 0) then 'PASS' else 'FAIL' end,
       'compiled live function contains totals mismatch rejection'
union all
select 'live_session_guard',
       case when exists(select 1 from fn where position('_tier3_player_from_any_session_v740' in definition) > 0 and position('Niet ingelogd.' in definition) > 0) then 'PASS' else 'FAIL' end,
       'compiled live function retains player-session validation'
union all
select 'live_participant_guard',
       case when exists(select 1 from fn where position('Alleen een deelnemer mag dit Toepen-potje opslaan.' in definition) > 0) then 'PASS' else 'FAIL' end,
       'compiled live function retains saver-participant check'
union all
select 'public_execute_revoked',
       case when not (select allowed from public_fn_exec) then 'PASS' else 'FAIL' end,
       'PUBLIC must not execute create_toepen_game'
union all
select 'anon_execute_allowed',
       case when has_function_privilege('anon','public.create_toepen_game(text,jsonb,text)','EXECUTE') then 'PASS' else 'FAIL' end,
       'anon calls guarded RPC only'
union all
select 'authenticated_execute_allowed',
       case when has_function_privilege('authenticated','public.create_toepen_game(text,jsonb,text)','EXECUTE') then 'PASS' else 'FAIL' end,
       'authenticated calls guarded RPC only'
union all
select 'public_direct_dml_revoked',
       case when (select grants from public_table_dml) = 0 then 'PASS' else 'FAIL' end,
       'no PUBLIC INSERT/UPDATE/DELETE grants on Toepen write tables'
union all
select 'webrole_direct_dml_revoked',
       case when (select grants from webrole_table_dml) = 0 then 'PASS' else 'FAIL' end,
       'no anon/authenticated INSERT/UPDATE/DELETE grants on Toepen write tables'
union all
select 'controlled_toepen_residue',
       case when (select count(*) from public.toepen_games where client_match_id like 'OC_V764_TOEPEN_%') = 0 then 'PASS' else 'FAIL' end,
       'remaining controlled games=' || (select count(*)::text from public.toepen_games where client_match_id like 'OC_V764_TOEPEN_%')
union all
select 'ice_invariant',
       case when (select unit_value from public.drink_event_types where key='ice' limit 1) = 2.8 then 'PASS' else 'FAIL' end,
       'Ice=' || coalesce((select unit_value::text from public.drink_event_types where key='ice' limit 1),'missing')
order by check_name;
