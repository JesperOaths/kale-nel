begin;

create or replace function public._jsonb_replace_text_exact(doc jsonb, old_value text, new_value text)
returns jsonb
language plpgsql
immutable
as $fn$
declare
  result jsonb;
  item record;
begin
  if doc is null then
    return null;
  end if;

  case jsonb_typeof(doc)
    when 'string' then
      if doc #>> '{}' = old_value then
        return to_jsonb(new_value);
      end if;
      return doc;
    when 'array' then
      result := '[]'::jsonb;
      for item in select value from jsonb_array_elements(doc)
      loop
        result := result || jsonb_build_array(public._jsonb_replace_text_exact(item.value, old_value, new_value));
      end loop;
      return result;
    when 'object' then
      result := '{}'::jsonb;
      for item in select key, value from jsonb_each(doc)
      loop
        result := result || jsonb_build_object(item.key, public._jsonb_replace_text_exact(item.value, old_value, new_value));
      end loop;
      return result;
    else
      return doc;
  end case;
end;
$fn$;

-- 1) Repair the raw Boerenbridge match payload itself.
update public.boerenbridge_matches m
set payload = public._jsonb_replace_text_exact(m.payload, 'Bruis', 'Jesper'),
    site_scope = 'family',
    updated_at = now()
where (
    exists (select 1 from jsonb_array_elements_text(coalesce(m.payload->'players','[]'::jsonb)) p(name) where lower(p.name)='bruis')
    or exists (select 1 from jsonb_array_elements(coalesce(m.payload->'totals','[]'::jsonb)) x where lower(coalesce(x->>'name',''))='bruis')
  )
  and exists (select 1 from jsonb_array_elements_text(coalesce(m.payload->'players','[]'::jsonb)) p(name) where lower(p.name)='sierk')
  and exists (select 1 from jsonb_array_elements_text(coalesce(m.payload->'players','[]'::jsonb)) p(name) where lower(p.name)='lilian')
  and exists (select 1 from jsonb_array_elements_text(coalesce(m.payload->'players','[]'::jsonb)) p(name) where lower(p.name)='emil')
  and exists (select 1 from jsonb_array_elements_text(coalesce(m.payload->'players','[]'::jsonb)) p(name) where lower(p.name)='anouk');

-- 2) Repair the summary/cache row that match control reads.
update public.game_match_summaries g
set summary_payload = public._jsonb_replace_text_exact(g.summary_payload, 'Bruis', 'Jesper'),
    participant_names = coalesce(
      (
        select array_agg(case when lower(v)='bruis' then 'Jesper' else v end)
        from unnest(g.participant_names) as v
      ),
      (
        select array_agg(case when lower(value)='bruis' then 'Jesper' else value end)
        from jsonb_array_elements_text(coalesce(g.summary_payload->'participants', g.summary_payload->'players', '[]'::jsonb))
      ),
      '{}'::text[]
    ),
    winner_names = coalesce(
      (
        select array_agg(case when lower(v)='bruis' then 'Jesper' else v end)
        from unnest(g.winner_names) as v
      ),
      (
        select array_agg(case when lower(value)='bruis' then 'Jesper' else value end)
        from jsonb_array_elements_text(coalesce(g.summary_payload->'winner_names', '[]'::jsonb))
      ),
      '{}'::text[]
    ),
    recap_text = replace(coalesce(g.recap_text,''), 'Bruis', 'Jesper'),
    site_scope = 'family'
where lower(coalesce(g.game_type,''))='boerenbridge'
  and (
    exists (select 1 from unnest(coalesce(g.participant_names,'{}'::text[])) p(name) where lower(p.name)='bruis')
    or exists (select 1 from jsonb_array_elements_text(coalesce(g.summary_payload->'participants', g.summary_payload->'players', '[]'::jsonb)) p(name) where lower(p.name)='bruis')
  )
  and (
    exists (select 1 from unnest(coalesce(g.participant_names,'{}'::text[])) p(name) where lower(p.name)='sierk')
    or exists (select 1 from jsonb_array_elements_text(coalesce(g.summary_payload->'participants', g.summary_payload->'players', '[]'::jsonb)) p(name) where lower(p.name)='sierk')
  )
  and (
    exists (select 1 from unnest(coalesce(g.participant_names,'{}'::text[])) p(name) where lower(p.name)='lilian')
    or exists (select 1 from jsonb_array_elements_text(coalesce(g.summary_payload->'participants', g.summary_payload->'players', '[]'::jsonb)) p(name) where lower(p.name)='lilian')
  )
  and (
    exists (select 1 from unnest(coalesce(g.participant_names,'{}'::text[])) p(name) where lower(p.name)='emil')
    or exists (select 1 from jsonb_array_elements_text(coalesce(g.summary_payload->'participants', g.summary_payload->'players', '[]'::jsonb)) p(name) where lower(p.name)='emil')
  )
  and (
    exists (select 1 from unnest(coalesce(g.participant_names,'{}'::text[])) p(name) where lower(p.name)='anouk')
    or exists (select 1 from jsonb_array_elements_text(coalesce(g.summary_payload->'participants', g.summary_payload->'players', '[]'::jsonb)) p(name) where lower(p.name)='anouk')
  );

-- 3) Safety backfill: if any Boerenbridge summary row has all-family participants, force it to family scope.
update public.game_match_summaries g
set site_scope = 'family'
where lower(coalesce(g.game_type,''))='boerenbridge'
  and coalesce(
    array_length(g.participant_names,1),
    jsonb_array_length(coalesce(g.summary_payload->'participants', g.summary_payload->'players', '[]'::jsonb)),
    0
  ) > 0
  and not exists (
    select 1
    from (
      select unnest(coalesce(g.participant_names,'{}'::text[])) as name
      union all
      select value as name from jsonb_array_elements_text(coalesce(g.summary_payload->'participants', g.summary_payload->'players', '[]'::jsonb))
    ) s
    where lower(trim(coalesce(s.name,''))) not in ('jesper','emil','anouk','lilian','sierk','gunnar')
  );

commit;

-- 4) Rebuild old global Boerenbridge ELO/cache too, so Bruis loses this game there as well.
do $do$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='rebuild_stats_hub_elo'
  ) then
    perform public.rebuild_stats_hub_elo('boerenbridge');
  end if;
end
$do$;

-- 5) Rebuild the newer isolated family/friends Boerenbridge core ELO.
do $do$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='rebuild_family_friend_core_elo'
  ) then
    perform public.rebuild_family_friend_core_elo('boerenbridge', null);
  end if;
end
$do$;
