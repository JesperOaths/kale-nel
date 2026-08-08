-- Final read-only production invariant check for v764 live-write matrix.
-- Safe to run in Supabase SQL Editor.
-- Does not update/delete/insert any production rows; temp table is session-local only.

create temp table if not exists _v764_final_scan (
  table_name text primary key,
  controlled_rows bigint not null
) on commit preserve rows;
truncate _v764_final_scan;

do $$
declare
  r record;
  n bigint;
begin
  for r in
    select quote_ident(n.nspname) as qschema,
           quote_ident(c.relname) as qtable,
           c.relname as table_name
      from pg_class c
      join pg_namespace n on n.oid=c.relnamespace
     where n.nspname='public'
       and c.relkind in ('r','p')
     order by c.relname
  loop
    begin
      execute format(
        'select count(*) from %s.%s t where to_jsonb(t)::text ilike %L',
        r.qschema, r.qtable, '%OC_V764%'
      ) into n;
      if n > 0 then
        insert into _v764_final_scan(table_name,controlled_rows)
        values (r.table_name,n)
        on conflict (table_name) do update set controlled_rows=excluded.controlled_rows;
      end if;
    exception when others then
      -- Ignore non-readable/system-like relations; all ordinary public tables are expected to scan.
      null;
    end;
  end loop;
end $$;

with residue as (
  select coalesce(sum(controlled_rows),0)::bigint as total,
         coalesce(string_agg(table_name||'='||controlled_rows::text, ', ' order by table_name),'none') as detail
    from _v764_final_scan
), snapshot as (
  select
    (select unit_value from public.drink_event_types where key='ice' limit 1) as ice,
    (select count(*) from public.beerpong_matches) as beerpong_matches,
    (select count(*) from public.beerpong_player_ratings) as beerpong_ratings,
    (select count(*) from public.beerpong_player_rating_history) as beerpong_history,
    (select count(*) from public.toepen_games) as toepen_games,
    (select count(*) from public.toepen_game_participants) as toepen_participants,
    (select count(*) from public.toepen_rounds) as toepen_rounds,
    (select count(*) from public.toepen_round_results) as toepen_results,
    (select count(*) from public.boerenbridge_matches) as boerenbridge_matches,
    (select count(*) from public.drink_events) as drink_events,
    (select count(*) from public.allowed_usernames) as allowed_usernames,
    (select count(*) from public.web_push_jobs where to_jsonb(web_push_jobs)::text ilike '%OC_V764%') as controlled_push_jobs
)
select 'global_controlled_residue' as check_name,
       case when (select total from residue)=0 then 'PASS' else 'FAIL' end as result,
       'OC_V764 rows across public tables='||(select total::text from residue)||'; '||(select detail from residue) as detail
union all
select 'controlled_push_jobs',
       case when (select controlled_push_jobs from snapshot)=0 then 'PASS' else 'FAIL' end,
       'controlled push rows='||(select controlled_push_jobs::text from snapshot)
union all
select 'ice_invariant',
       case when (select ice from snapshot)=2.8 then 'PASS' else 'FAIL' end,
       'Ice='||coalesce((select ice::text from snapshot),'missing')
union all
select 'toepen_final_baseline',
       case when (select toepen_games+toepen_participants+toepen_rounds+toepen_results from snapshot)=0 then 'PASS' else 'FAIL' end,
       'games='||(select toepen_games::text from snapshot)||', participants='||(select toepen_participants::text from snapshot)||', rounds='||(select toepen_rounds::text from snapshot)||', results='||(select toepen_results::text from snapshot)
union all
select 'beerpong_final_baseline',
       case when (select beerpong_ratings+beerpong_history from snapshot)=0 then 'PASS' else 'FAIL' end,
       'matches='||(select beerpong_matches::text from snapshot)||', ratings='||(select beerpong_ratings::text from snapshot)||', history='||(select beerpong_history::text from snapshot)
union all
select 'other_baseline_snapshot',
       'PASS',
       'boerenbridge_matches='||(select boerenbridge_matches::text from snapshot)||', drink_events='||(select drink_events::text from snapshot)||', allowed_usernames='||(select allowed_usernames::text from snapshot)
order by check_name;
