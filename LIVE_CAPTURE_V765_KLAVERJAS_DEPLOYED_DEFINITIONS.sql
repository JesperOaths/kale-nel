-- v765 Klaverjas deployed-definition capture.
-- READ ONLY against production catalogs/data.
-- Purpose: capture the exact deployed fallback/classic save definitions and schema needed to
-- repair the UUID->bigint/current-save mismatch without guessing.

with f as (
  select p.proname,
         pg_get_function_identity_arguments(p.oid) as args,
         p.prosecdef,
         pg_get_functiondef(p.oid) as definition
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public'
     and p.proname in ('klaverjas_upsert_match_state_scoped','create_jas_game')
)
select 'function_definition'::text as section,
       proname as item,
       args as identity,
       'security_definer='||prosecdef::text as metadata,
       definition as detail
  from f
union all
select 'table_columns',
       c.table_name,
       c.column_name||' '||c.data_type,
       'nullable='||c.is_nullable||coalesce(', default='||c.column_default,''),
       ''
  from information_schema.columns c
 where c.table_schema='public'
   and c.table_name in (
     'jas_games','jas_game_entries','game_rating_rebuild_queue',
     'klaverjas_online_games','klaverjas_online_player_stats'
   )
union all
select 'constraints',
       rel.relname,
       con.conname,
       con.contype::text,
       pg_get_constraintdef(con.oid)
  from pg_constraint con
  join pg_class rel on rel.oid=con.conrelid
  join pg_namespace n on n.oid=rel.relnamespace
 where n.nspname='public'
   and rel.relname in (
     'jas_games','jas_game_entries','game_rating_rebuild_queue',
     'klaverjas_online_games','klaverjas_online_player_stats'
   )
union all
select 'trigger_definition',
       rel.relname,
       t.tgname,
       '',
       pg_get_triggerdef(t.oid)
  from pg_trigger t
  join pg_class rel on rel.oid=t.tgrelid
  join pg_namespace n on n.oid=rel.relnamespace
 where n.nspname='public'
   and not t.tgisinternal
   and rel.relname in (
     'jas_games','jas_game_entries','game_rating_rebuild_queue',
     'klaverjas_online_games','klaverjas_online_player_stats'
   )
union all
select 'baseline',
       'ice',
       'unit_value',
       '',
       coalesce((select unit_value::text from public.drink_event_types where key='ice' limit 1),'missing')
union all
select 'baseline',
       'controlled_v765_residue',
       'expected_zero',
       '',
       (
         select count(*)::text
           from public.web_push_jobs
          where to_jsonb(web_push_jobs)::text ilike '%OC_V765%'
       )
order by section,item,identity;
