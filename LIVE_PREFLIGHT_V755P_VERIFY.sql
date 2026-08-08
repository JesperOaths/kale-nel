-- Read-only production preflight for GEJAST v755p Beerpong repair.
-- Safe to run before applying GEJAST_v755p_beerpong_save_auth_guard.sql.
-- Does not create/update/delete production rows.

with fn as (
  select p.oid,
         pg_get_functiondef(p.oid) as definition,
         p.proacl,
         p.proowner,
         p.prosecdef
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.oid = to_regprocedure('public.save_beerpong_match(text,text,jsonb)')
),
required_match_columns(name) as (
  values
    ('client_match_id'),('created_by_player_id'),('match_status'),('match_format'),
    ('team_a_player_names'),('team_b_player_names'),('winner_team'),
    ('team_a_cups_left'),('team_b_cups_left'),('finished_at'),('payload'),('updated_at')
),
match_columns as (
  select count(*)::integer as found
    from required_match_columns r
   where exists (
     select 1 from information_schema.columns c
      where c.table_schema='public' and c.table_name='beerpong_matches' and c.column_name=r.name
   )
),
webrole_dml as (
  select count(*)::integer as grants
    from information_schema.table_privileges
   where table_schema='public'
     and table_name in ('beerpong_matches','beerpong_player_ratings','beerpong_player_rating_history')
     and grantee in ('anon','authenticated')
     and privilege_type in ('INSERT','UPDATE','DELETE')
),
public_dml as (
  select count(*)::integer as grants
    from information_schema.table_privileges
   where table_schema='public'
     and table_name in ('beerpong_matches','beerpong_player_ratings','beerpong_player_rating_history')
     and grantee='PUBLIC'
     and privilege_type in ('INSERT','UPDATE','DELETE')
),
counts as (
  select
    (select count(*) from public.beerpong_matches) as matches,
    (select count(*) from public.beerpong_player_ratings) as ratings,
    (select count(*) from public.beerpong_player_rating_history) as history,
    (select count(*) from public.beerpong_matches where client_match_id like 'OC_V764_BEERPONG_%') as controlled
),
session_cols as (
  select string_agg(column_name, ', ' order by ordinal_position) as cols
    from information_schema.columns
   where table_schema='public' and table_name='gejast_player_sessions_v746'
)
select 'function_exists' as check_name,
       case when exists(select 1 from fn) then 'PASS' else 'FAIL' end as result,
       'save_beerpong_match(text,text,jsonb)' as detail
union all
select 'security_definer',
       case when exists(select 1 from fn where prosecdef) then 'PASS' else 'FAIL' end,
       'existing RPC remains SECURITY DEFINER'
union all
select 'required_match_schema',
       case when (select found from match_columns)=12 then 'PASS' else 'FAIL' end,
       'required beerpong_matches columns found='||(select found::text from match_columns)||'/12'
union all
select 'rating_tables_exist',
       case when to_regclass('public.beerpong_player_ratings') is not null and to_regclass('public.beerpong_player_rating_history') is not null then 'PASS' else 'FAIL' end,
       'current rating + history tables must exist'
union all
select 'current_session_resolver',
       case when exists(select 1 from fn where position('_tier3_player_from_any_session_v740' in definition)>0) then 'PASS' else 'FAIL' end,
       'deployed function uses expected player-session resolver'
union all
select 'current_rating_contract',
       case when exists(select 1 from fn where position('ratings_applied' in definition)>0 and position('rebuild_beerpong_ratings' in definition)=0) then 'PASS' else 'FAIL' end,
       'deployed save currently reports rating status without rebuilding ratings'
union all
select 'known_owner_guard_gap',
       case when exists(select 1 from fn where position('beerpong_match_owner_mismatch' in definition)=0) then 'PASS' else 'FAIL' end,
       'expected pre-v755p state: explicit owner-mismatch guard is absent'
union all
select 'known_direct_dml_gap',
       case when (select grants from webrole_dml)>0 or (select grants from public_dml)>0 then 'PASS' else 'FAIL' end,
       'expected pre-v755p state: direct write grants still exist; webrole grants='||(select grants::text from webrole_dml)||', PUBLIC grants='||(select grants::text from public_dml)
union all
select 'controlled_beerpong_residue',
       case when (select controlled from counts)=0 then 'PASS' else 'FAIL' end,
       'controlled matches='||(select controlled::text from counts)
union all
select 'baseline_counts',
       'PASS',
       'matches='||(select matches::text from counts)||', ratings='||(select ratings::text from counts)||', history='||(select history::text from counts)
union all
select 'ice_invariant',
       case when (select unit_value from public.drink_event_types where key='ice' limit 1)=2.8 then 'PASS' else 'FAIL' end,
       'Ice='||coalesce((select unit_value::text from public.drink_event_types where key='ice' limit 1),'missing')
union all
select 'session_table_shape',
       case when to_regclass('public.gejast_player_sessions_v746') is not null then 'PASS' else 'FAIL' end,
       coalesce((select cols from session_cols),'table missing')
order by check_name;
