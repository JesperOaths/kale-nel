begin;

-- Authoritative per-name scope overrides.
create table if not exists public.site_scope_name_overrides (
  name_key text primary key,
  canonical_name text not null,
  site_scope text not null check (site_scope in ('friends','family')),
  updated_at timestamptz not null default now()
);

insert into public.site_scope_name_overrides(name_key, canonical_name, site_scope)
values
  ('bruis','Bruis','friends'),
  ('jesper','Jesper','family'),
  ('emil','Emil','family'),
  ('anouk','Anouk','family'),
  ('lilian','Lilian','family'),
  ('sierk','Sierk','family'),
  ('gunnar','Gunnar','family'),
  ('evi','Evi','family'),
  ('anna','Anna','family'),
  ('caro','Caro','family')
on conflict (name_key) do update
set canonical_name = excluded.canonical_name,
    site_scope = excluded.site_scope,
    updated_at = now();

create or replace function public._site_scope_for_name(input_name text)
returns text
language plpgsql
stable
set search_path to 'public'
as $fn$
declare
  v_scope text;
  v_name_key text := lower(trim(coalesce(input_name,'')));
begin
  if v_name_key = '' then
    return 'friends';
  end if;

  begin
    select o.site_scope into v_scope
    from public.site_scope_name_overrides o
    where o.name_key = v_name_key
    limit 1;
  exception when undefined_table then
    v_scope := null;
  end;

  if v_scope is null then
    begin
      select p.site_scope into v_scope
      from public.players p
      where lower(trim(coalesce(p.display_name,''))) = v_name_key
      limit 1;
    exception when undefined_column or undefined_table then
      v_scope := null;
    end;
  end if;

  if v_scope is null then
    begin
      select au.site_scope into v_scope
      from public.allowed_usernames au
      where lower(trim(coalesce(au.display_name,''))) = v_name_key
      limit 1;
    exception when undefined_column or undefined_table then
      v_scope := null;
    end;
  end if;

  return public._scope_norm(coalesce(v_scope,'friends'));
end;
$fn$;

create or replace function public._match_scope_for_boerenbridge(p_match_id bigint)
returns text
language plpgsql
stable
set search_path to 'public'
as $fn$
declare
  v_scope text;
begin
  -- 1) explicit match scope wins
  begin
    select public._scope_norm(m.site_scope) into v_scope
    from public.boerenbridge_matches m
    where m.id = p_match_id
      and nullif(trim(coalesce(m.site_scope,'')), '') is not null
    limit 1;
  exception when undefined_column or undefined_table then
    v_scope := null;
  end;

  if v_scope is not null then
    return v_scope;
  end if;

  -- 2) cached summary scope wins next
  begin
    select public._scope_norm(g.site_scope) into v_scope
    from public.boerenbridge_matches m
    join public.game_match_summaries g
      on lower(trim(coalesce(g.client_match_id,''))) = lower(trim(coalesce(m.client_match_id,'')))
    where m.id = p_match_id
      and lower(trim(coalesce(g.game_type,''))) = 'boerenbridge'
      and nullif(trim(coalesce(g.site_scope,'')), '') is not null
    order by coalesce(g.finished_at, g.created_at) desc nulls last
    limit 1;
  exception when undefined_column or undefined_table then
    v_scope := null;
  end;

  if v_scope is not null then
    return v_scope;
  end if;

  -- 3) only derive from names as last resort
  with src as (
    select coalesce(
      (select jsonb_agg(value) from jsonb_array_elements_text(coalesce(m.payload->'players','[]'::jsonb))),
      (select jsonb_agg(x->>'name') from jsonb_array_elements(coalesce(m.payload->'totals','[]'::jsonb)) x),
      '[]'::jsonb
    ) as names
    from public.boerenbridge_matches m
    where m.id = p_match_id
  )
  select case
    when coalesce((select jsonb_array_length(names) from src),0) > 0
     and coalesce((select bool_and(public._name_in_site_scope(value, 'family')) from src, jsonb_array_elements_text(coalesce(src.names,'[]'::jsonb))), false)
      then 'family'
    else 'friends'
  end
  into v_scope;

  return coalesce(v_scope, 'friends');
end;
$fn$;

-- Backfill players + allowed usernames from authoritative overrides.
update public.players p
set site_scope = o.site_scope
from public.site_scope_name_overrides o
where lower(trim(coalesce(p.display_name,''))) = o.name_key
  and coalesce(lower(p.site_scope),'friends') <> o.site_scope;

update public.allowed_usernames au
set site_scope = o.site_scope
from public.site_scope_name_overrides o
where lower(trim(coalesce(au.display_name,''))) = o.name_key
  and coalesce(lower(au.site_scope),'friends') <> o.site_scope;

-- Backfill Boerenbridge match scope from explicit participants / overrides.
update public.boerenbridge_matches m
set site_scope = case
  when exists (
    select 1
    from jsonb_array_elements(coalesce(m.payload->'totals','[]'::jsonb)) x
    where public._site_scope_for_name(coalesce(x->>'name','')) = 'friends'
  ) then 'friends'
  when exists (
    select 1
    from jsonb_array_elements(coalesce(m.payload->'totals','[]'::jsonb)) x
  ) then 'family'
  else coalesce(nullif(trim(coalesce(m.site_scope,'')), ''), 'friends')
end
where coalesce(lower(m.match_status),'') = 'finished';

-- The specific Bruis -> Jesper family correction must stay explicit.
update public.boerenbridge_matches m
set payload =
      jsonb_set(
        jsonb_set(
          jsonb_set(
            m.payload,
            '{players}',
            (
              select coalesce(jsonb_agg(case when lower(value)='bruis' then to_jsonb('Jesper'::text) else to_jsonb(value) end), '[]'::jsonb)
              from jsonb_array_elements_text(coalesce(m.payload->'players','[]'::jsonb)) value
            ),
            true
          ),
          '{totals}',
          (
            select coalesce(jsonb_agg(
              case when lower(coalesce(x->>'name',''))='bruis'
                   then jsonb_set(x, '{name}', to_jsonb('Jesper'::text), true)
                   else x end
            ), '[]'::jsonb)
            from jsonb_array_elements(coalesce(m.payload->'totals','[]'::jsonb)) x
          ),
          true
        ),
        '{match_summary,winner_names}',
        (
          select coalesce(jsonb_agg(case when lower(value)='bruis' then to_jsonb('Jesper'::text) else to_jsonb(value) end), '[]'::jsonb)
          from jsonb_array_elements_text(coalesce(m.payload->'match_summary'->'winner_names','[]'::jsonb)) value
        ),
        true
      ),
    site_scope = 'family'
where exists (
  select 1
  from jsonb_array_elements_text(coalesce(m.payload->'players','[]'::jsonb)) p
  where lower(p) in ('bruis','emil','lilian','anouk','sierk')
)
and (
  select count(*)
  from jsonb_array_elements_text(coalesce(m.payload->'players','[]'::jsonb)) p
  where lower(p) in ('bruis','emil','lilian','anouk','sierk')
) = 5;

-- Keep cached match summaries aligned with the raw Boerenbridge match scope + names.
update public.game_match_summaries g
set participant_names = (
      select coalesce(array_agg(value::text), '{}'::text[])
      from jsonb_array_elements_text(coalesce(m.payload->'players','[]'::jsonb)) value
    ),
    winner_names = (
      select coalesce(array_agg(value::text), '{}'::text[])
      from jsonb_array_elements_text(coalesce(m.payload->'match_summary'->'winner_names','[]'::jsonb)) value
    ),
    summary_payload = jsonb_set(
      jsonb_set(
        coalesce(g.summary_payload, '{}'::jsonb),
        '{players}',
        coalesce(m.payload->'players', '[]'::jsonb),
        true
      ),
      '{winner_names}',
      coalesce(m.payload->'match_summary'->'winner_names', '[]'::jsonb),
      true
    ),
    site_scope = public._match_scope_for_boerenbridge(m.id)
from public.boerenbridge_matches m
where lower(trim(coalesce(g.game_type,''))) = 'boerenbridge'
  and lower(trim(coalesce(g.client_match_id,''))) = lower(trim(coalesce(m.client_match_id,'')));

-- For any remaining Boerenbridge summaries without a direct raw row match, derive from participant names.
update public.game_match_summaries g
set site_scope = case
  when exists (
    select 1 from unnest(coalesce(g.participant_names,'{}'::text[])) p
    where public._site_scope_for_name(p) = 'friends'
  ) then 'friends'
  when coalesce(array_length(g.participant_names,1),0) > 0 then 'family'
  else coalesce(nullif(trim(coalesce(g.site_scope,'')), ''), 'friends')
end
where lower(trim(coalesce(g.game_type,''))) = 'boerenbridge';

-- Rebuild the isolated Boerenbridge core now that scope classification is fixed.
select public.rebuild_family_friend_core_elo('boerenbridge', null);

commit;
