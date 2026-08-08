-- Exact cleanup for the one confirmed v764 controlled Beerpong residue row.
-- This script refuses to delete anything unless the row still exactly matches
-- the inspected matrix fixture: id 61, exact client_match_id, null creator,
-- finished 1v1 status, and OC_V764 marker present in payload.
-- It then performs a final global OC_V764 residue scan and baseline checks.

begin;

create temp table if not exists _v764_cleanup_result (
  check_name text primary key,
  result text not null,
  detail text not null
) on commit preserve rows;
truncate _v764_cleanup_result;

DO $$
declare
  v_exact_count bigint;
  v_deleted integer := 0;
  v_before_matches bigint;
  v_after_matches bigint;
  v_ratings bigint;
  v_history bigint;
  v_ice numeric;
  v_global_residue bigint := 0;
  v_global_detail text := 'none';
  r record;
  n bigint;
begin
  select count(*) into v_before_matches from public.beerpong_matches;

  select count(*) into v_exact_count
  from public.beerpong_matches
  where id = 61
    and client_match_id = 'OC_V764_MATRIX_20260803_READONLY_BEER'
    and created_by_player_id is null
    and match_status = 'finished'
    and match_format = '1v1'
    and coalesce(payload::text,'') ilike '%OC_V764%';

  if v_exact_count <> 1 then
    raise exception 'Refusing cleanup: expected exact controlled Beerpong row no longer matches (matches=%).', v_exact_count;
  end if;

  delete from public.beerpong_matches
  where id = 61
    and client_match_id = 'OC_V764_MATRIX_20260803_READONLY_BEER'
    and created_by_player_id is null
    and match_status = 'finished'
    and match_format = '1v1'
    and coalesce(payload::text,'') ilike '%OC_V764%';
  get diagnostics v_deleted = row_count;

  if v_deleted <> 1 then
    raise exception 'Refusing commit: exact controlled row delete count was %, expected 1.', v_deleted;
  end if;

  select count(*) into v_after_matches from public.beerpong_matches;
  select count(*) into v_ratings from public.beerpong_player_ratings;
  select count(*) into v_history from public.beerpong_player_rating_history;
  select unit_value into v_ice from public.drink_event_types where key='ice' limit 1;

  create temp table if not exists _v764_cleanup_scan (
    table_name text primary key,
    controlled_rows bigint not null
  ) on commit preserve rows;
  truncate _v764_cleanup_scan;

  for r in
    select quote_ident(ns.nspname) as qschema,
           quote_ident(c.relname) as qtable,
           c.relname as table_name
    from pg_class c
    join pg_namespace ns on ns.oid=c.relnamespace
    where ns.nspname='public'
      and c.relkind in ('r','p')
    order by c.relname
  loop
    begin
      execute format(
        'select count(*) from %s.%s t where to_jsonb(t)::text ilike %L',
        r.qschema, r.qtable, '%OC_V764%'
      ) into n;
      if n > 0 then
        insert into _v764_cleanup_scan(table_name,controlled_rows)
        values (r.table_name,n)
        on conflict (table_name) do update set controlled_rows=excluded.controlled_rows;
      end if;
    exception when others then
      null;
    end;
  end loop;

  select coalesce(sum(controlled_rows),0),
         coalesce(string_agg(table_name||'='||controlled_rows::text, ', ' order by table_name),'none')
  into v_global_residue, v_global_detail
  from _v764_cleanup_scan;

  insert into _v764_cleanup_result values (
    'exact_controlled_row_deleted',
    case when v_deleted=1 then 'PASS' else 'FAIL' end,
    'deleted rows='||v_deleted::text||'; client_match_id=OC_V764_MATRIX_20260803_READONLY_BEER'
  );

  insert into _v764_cleanup_result values (
    'beerpong_baseline_after_cleanup',
    case when v_after_matches=v_before_matches-1 and v_ratings=0 and v_history=0 then 'PASS' else 'FAIL' end,
    'matches '||v_before_matches::text||'->'||v_after_matches::text||', ratings='||v_ratings::text||', history='||v_history::text
  );

  insert into _v764_cleanup_result values (
    'global_controlled_residue',
    case when v_global_residue=0 then 'PASS' else 'FAIL' end,
    'OC_V764 rows across public tables='||v_global_residue::text||'; '||v_global_detail
  );

  insert into _v764_cleanup_result values (
    'controlled_push_jobs',
    case when (select count(*) from public.web_push_jobs where to_jsonb(web_push_jobs)::text ilike '%OC_V764%')=0 then 'PASS' else 'FAIL' end,
    'controlled push rows='||(select count(*)::text from public.web_push_jobs where to_jsonb(web_push_jobs)::text ilike '%OC_V764%')
  );

  insert into _v764_cleanup_result values (
    'ice_invariant',
    case when v_ice=2.8 then 'PASS' else 'FAIL' end,
    'Ice='||coalesce(v_ice::text,'missing')
  );
end $$;

commit;

select check_name, result, detail
from _v764_cleanup_result
order by check_name;
