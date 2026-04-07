begin;

create or replace function public._scope_norm(input_scope text)
returns text
language sql
immutable
as $$
  select case when lower(trim(coalesce(input_scope,'')))='family' then 'family' else 'friends' end;
$$;

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

create or replace function public._claim_request_name_from_row(row_json jsonb)
returns text
language sql
immutable
as $$
  select coalesce(
    nullif(trim(row_json->>'desired_name'),''),
    nullif(trim(row_json->>'display_name'),''),
    nullif(trim(row_json->>'request_display_name'),''),
    nullif(trim(row_json->>'username'),''),
    ''
  );
$$;

-- Core scope columns.
do $do$
begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='players') then
    execute 'alter table public.players add column if not exists site_scope text not null default ''friends''';
  end if;
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='allowed_usernames') then
    execute 'alter table public.allowed_usernames add column if not exists site_scope text not null default ''friends''';
  end if;
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='claim_requests') then
    execute 'alter table public.claim_requests add column if not exists site_scope text not null default ''friends''';
  end if;
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='game_match_summaries') then
    execute 'alter table public.game_match_summaries add column if not exists site_scope text not null default ''friends''';
  end if;
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='boerenbridge_matches') then
    execute 'alter table public.boerenbridge_matches add column if not exists site_scope text not null default ''friends''';
  end if;
end
$do$;

-- Family people assignment.
update public.players
set site_scope='family'
where lower(trim(coalesce(display_name,''))) in ('jesper','emil','anouk','lilian','sierk','gunnar');

update public.allowed_usernames
set site_scope='family'
where lower(trim(coalesce(display_name,''))) in ('jesper','emil','anouk','lilian','sierk','gunnar');

do $do$
declare
  name_col text;
begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='claim_requests') then
    select c.column_name into name_col
    from information_schema.columns c
    where c.table_schema='public'
      and c.table_name='claim_requests'
      and c.column_name in ('desired_name','display_name','request_display_name','username')
    order by case c.column_name
      when 'desired_name' then 1
      when 'display_name' then 2
      when 'request_display_name' then 3
      when 'username' then 4
      else 100 end
    limit 1;

    if name_col is not null then
      execute format(
        $$update public.claim_requests
          set site_scope='family'
          where lower(trim(coalesce(%I,''))) in ('jesper','emil','anouk','lilian','sierk','gunnar')$$,
        name_col
      );
    end if;

    if exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='claim_requests' and column_name='requester_meta'
    ) then
      execute $$
        update public.claim_requests
        set site_scope = case
          when lower(coalesce(requester_meta->>'site_scope','friends'))='family' then 'family'
          else site_scope
        end
      $$;
    end if;
  end if;
end
$do$;

-- Keep claim request scope in sync without hard-coding schema-specific name columns.
create or replace function public._apply_claim_request_site_scope()
returns trigger
language plpgsql
set search_path to 'public'
as $fn$
declare
  row_json jsonb;
  meta_scope text;
  req_name text;
begin
  row_json := to_jsonb(NEW);
  meta_scope := lower(coalesce(row_json->'requester_meta'->>'site_scope',''));
  req_name := lower(trim(public._claim_request_name_from_row(row_json)));

  if meta_scope = 'family' then
    NEW.site_scope := 'family';
  elsif req_name in ('jesper','emil','anouk','lilian','sierk','gunnar') then
    NEW.site_scope := 'family';
  elsif NEW.site_scope is null or trim(NEW.site_scope) = '' then
    NEW.site_scope := 'friends';
  end if;

  NEW.site_scope := public._scope_norm(NEW.site_scope);
  return NEW;
end;
$fn$;

do $do$
begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='claim_requests') then
    execute 'drop trigger if exists trg_claim_requests_site_scope on public.claim_requests';
    execute 'create trigger trg_claim_requests_site_scope before insert or update on public.claim_requests for each row execute function public._apply_claim_request_site_scope()';
  end if;
end
$do$;

create or replace function public._sync_allowed_username_site_scope()
returns trigger
language plpgsql
set search_path to 'public'
as $fn$
declare
  req_name text;
begin
  req_name := public._claim_request_name_from_row(to_jsonb(NEW));
  if trim(coalesce(req_name,'')) <> '' then
    update public.allowed_usernames au
    set site_scope = public._scope_norm(NEW.site_scope)
    where lower(trim(coalesce(au.display_name,''))) = lower(trim(req_name));
  end if;
  return NEW;
end;
$fn$;

do $do$
begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='claim_requests')
     and exists (select 1 from information_schema.tables where table_schema='public' and table_name='allowed_usernames') then
    execute 'drop trigger if exists trg_claim_requests_site_scope_after on public.claim_requests';
    execute 'create trigger trg_claim_requests_site_scope_after after insert or update on public.claim_requests for each row execute function public._sync_allowed_username_site_scope()';
  end if;
end
$do$;

-- Manual correction requested by user: Bruis -> Jesper in the specific family Boerenbridge match.
update public.boerenbridge_matches m
set payload = public._jsonb_replace_text_exact(m.payload, 'Bruis', 'Jesper'),
    site_scope = 'family',
    updated_at = now()
where exists (
  select 1 from jsonb_array_elements_text(coalesce(m.payload->'players','[]'::jsonb)) p(name) where lower(p.name)='bruis'
)
and exists (
  select 1 from jsonb_array_elements_text(coalesce(m.payload->'players','[]'::jsonb)) p(name) where lower(p.name)='sierk'
)
and exists (
  select 1 from jsonb_array_elements_text(coalesce(m.payload->'players','[]'::jsonb)) p(name) where lower(p.name)='lilian'
)
and exists (
  select 1 from jsonb_array_elements_text(coalesce(m.payload->'players','[]'::jsonb)) p(name) where lower(p.name)='emil'
)
and exists (
  select 1 from jsonb_array_elements_text(coalesce(m.payload->'players','[]'::jsonb)) p(name) where lower(p.name)='anouk'
);

update public.game_match_summaries g
set participant_names = array(
      select case when lower(x)='bruis' then 'Jesper' else x end
      from unnest(coalesce(g.participant_names,'{}'::text[])) x
    ),
    winner_names = array(
      select case when lower(x)='bruis' then 'Jesper' else x end
      from unnest(coalesce(g.winner_names,'{}'::text[])) x
    ),
    summary_payload = public._jsonb_replace_text_exact(g.summary_payload, 'Bruis', 'Jesper'),
    site_scope = 'family'
where lower(coalesce(g.game_type,'')) = 'boerenbridge'
  and 'Bruis' = any(coalesce(g.participant_names,'{}'::text[]))
  and 'Sierk' = any(coalesce(g.participant_names,'{}'::text[]))
  and 'Lilian' = any(coalesce(g.participant_names,'{}'::text[]))
  and 'Emil' = any(coalesce(g.participant_names,'{}'::text[]))
  and 'Anouk' = any(coalesce(g.participant_names,'{}'::text[]));

-- Backfill existing match scope conservatively based on participant names.
update public.game_match_summaries g
set site_scope = case
  when coalesce(array_length(g.participant_names,1),0) > 0
   and not exists (
     select 1
     from unnest(coalesce(g.participant_names,'{}'::text[])) p(name)
     where lower(trim(coalesce(p.name,''))) not in ('jesper','emil','anouk','lilian','sierk','gunnar')
   ) then 'family'
  else 'friends'
end;

update public.boerenbridge_matches m
set site_scope = case
  when coalesce(jsonb_array_length(coalesce(m.payload->'players','[]'::jsonb)),0) > 0
   and not exists (
     select 1
     from jsonb_array_elements_text(coalesce(m.payload->'players','[]'::jsonb)) p(name)
     where lower(trim(coalesce(p.name,''))) not in ('jesper','emil','anouk','lilian','sierk','gunnar')
   ) then 'family'
  else 'friends'
end;

create or replace function public._site_scope_for_name(input_name text)
returns text
language plpgsql
stable
set search_path to 'public'
as $fn$
declare
  v_scope text;
begin
  if trim(coalesce(input_name,'')) = '' then
    return 'friends';
  end if;

  begin
    select p.site_scope into v_scope
    from public.players p
    where lower(trim(coalesce(p.display_name,''))) = lower(trim(input_name))
    limit 1;
  exception when undefined_column then
    v_scope := null;
  end;

  if v_scope is null then
    begin
      select au.site_scope into v_scope
      from public.allowed_usernames au
      where lower(trim(coalesce(au.display_name,''))) = lower(trim(input_name))
      limit 1;
    exception when undefined_column then
      v_scope := null;
    end;
  end if;

  return public._scope_norm(coalesce(v_scope,'friends'));
end;
$fn$;

create or replace function public._name_in_site_scope(input_name text, input_scope text)
returns boolean
language sql
stable
as $$
  select public._site_scope_for_name(input_name) = public._scope_norm(input_scope);
$$;

create or replace function public._jsonb_name_array_in_scope(name_array jsonb, input_scope text)
returns boolean
language sql
stable
as $$
  select coalesce(bool_and(public._name_in_site_scope(value, input_scope)), true)
  from jsonb_array_elements_text(coalesce(name_array,'[]'::jsonb));
$$;

create or replace function public._match_jsonb_in_scope(match_row jsonb, input_scope text)
returns boolean
language sql
stable
as $$
  select
    public._jsonb_name_array_in_scope(coalesce(match_row->'winner_names','[]'::jsonb), input_scope)
    and public._jsonb_name_array_in_scope(coalesce(match_row->'loser_names','[]'::jsonb), input_scope)
    and public._jsonb_name_array_in_scope(coalesce(match_row->'participants','[]'::jsonb), input_scope)
    and public._jsonb_name_array_in_scope(coalesce(match_row->'participant_names','[]'::jsonb), input_scope)
    and public._jsonb_name_array_in_scope(coalesce(match_row->'team_a_player_names','[]'::jsonb), input_scope)
    and public._jsonb_name_array_in_scope(coalesce(match_row->'team_b_player_names','[]'::jsonb), input_scope)
    and public._jsonb_name_array_in_scope(coalesce(match_row->'players','[]'::jsonb), input_scope)
    and coalesce((
      select bool_and(public._name_in_site_scope(coalesce(d->>'player_name', d->>'display_name', ''), input_scope))
      from jsonb_array_elements(coalesce(match_row->'details','[]'::jsonb)) d
    ), true);
$$;

create or replace function public._filter_jsonb_rows_by_name_key(rows jsonb, key_name text, input_scope text)
returns jsonb
language sql
stable
as $$
  select coalesce(jsonb_agg(item), '[]'::jsonb)
  from jsonb_array_elements(coalesce(rows,'[]'::jsonb)) item
  where public._name_in_site_scope(coalesce(item->>key_name, item->>'display_name', item->>'player_name', ''), input_scope);
$$;

create or replace function public._filter_jsonb_rows_by_pair_keys(rows jsonb, key_a text, key_b text, input_scope text)
returns jsonb
language sql
stable
as $$
  select coalesce(jsonb_agg(item), '[]'::jsonb)
  from jsonb_array_elements(coalesce(rows,'[]'::jsonb)) item
  where public._name_in_site_scope(coalesce(item->>key_a,''), input_scope)
    and public._name_in_site_scope(coalesce(item->>key_b,''), input_scope);
$$;

create or replace function public._filter_jsonb_matches(rows jsonb, input_scope text)
returns jsonb
language sql
stable
as $$
  select coalesce(jsonb_agg(item), '[]'::jsonb)
  from jsonb_array_elements(coalesce(rows,'[]'::jsonb)) item
  where public._match_jsonb_in_scope(item, input_scope);
$$;

create or replace function public._filter_unified_games_by_scope(games_obj jsonb, input_scope text)
returns jsonb
language plpgsql
stable
as $fn$
declare
  result jsonb := '{}'::jsonb;
  kv record;
  scoped_game jsonb;
begin
  for kv in select key, value from jsonb_each(coalesce(games_obj,'{}'::jsonb))
  loop
    scoped_game := kv.value;
    if jsonb_typeof(scoped_game) = 'object' and scoped_game ? 'matches' then
      scoped_game := jsonb_set(scoped_game, '{matches}', public._filter_jsonb_matches(scoped_game->'matches', input_scope), true);
    end if;
    result := result || jsonb_build_object(kv.key, scoped_game);
  end loop;
  return result;
end;
$fn$;

-- Scoped requestable names.
drop function if exists public.get_requestable_names_scoped(text);
create or replace function public.get_requestable_names_scoped(site_scope_input text default 'friends')
returns jsonb
language sql
security definer
set search_path to 'public'
as $$
  with curated as (
    select distinct
      trim(coalesce(au.display_name,'')) as display_name,
      lower(trim(coalesce(au.display_name,''))) as sort_name
    from public.allowed_usernames au
    where coalesce(trim(coalesce(au.display_name,'')), '') <> ''
      and coalesce(lower(au.site_scope), 'friends') = public._scope_norm(site_scope_input)
      and lower(coalesce(au.status, 'available')) not in ('retired','deleted','blocked','suspended')
  )
  select jsonb_build_object('names', coalesce(jsonb_agg(display_name order by sort_name), '[]'::jsonb))
  from curated;
$$;

grant execute on function public.get_requestable_names_scoped(text) to anon, authenticated;

-- Scoped login names.
drop function if exists public.get_login_names_scoped(text);
create or replace function public.get_login_names_scoped(site_scope_input text default 'friends')
returns jsonb
language sql
security definer
set search_path to 'public'
as $$
  with src as (
    select distinct
      trim(coalesce(au.display_name, p.display_name)) as display_name,
      lower(trim(coalesce(au.display_name, p.display_name))) as sort_name,
      lower(coalesce(p.site_scope, au.site_scope, 'friends')) as site_scope
    from public.allowed_usernames au
    left join public.players p on p.id = au.player_id
    where coalesce(trim(coalesce(au.display_name, p.display_name)), '') <> ''
      and lower(coalesce(au.status, '')) not in ('retired', 'deleted', 'blocked', 'suspended')
      and (
        au.player_id is not null
        or lower(coalesce(au.status, '')) in ('active', 'claimed', 'approved_pending_activation', 'available', 'reserved')
      )
  )
  select jsonb_build_object('names', coalesce(jsonb_agg(display_name order by sort_name), '[]'::jsonb))
  from src
  where site_scope = public._scope_norm(site_scope_input);
$$;

grant execute on function public.get_login_names_scoped(text) to anon, authenticated;

-- Scoped public profiles.
drop function if exists public.get_player_profiles_public_scoped(text);
create or replace function public.get_player_profiles_public_scoped(site_scope_input text default 'friends')
returns jsonb
language sql
security definer
set search_path to 'public'
as $$
with base as (
  select public.get_player_profiles_public() as payload
), filtered as (
  select coalesce(jsonb_agg(item), '[]'::jsonb) as items
  from base, jsonb_array_elements(coalesce(base.payload->'players','[]'::jsonb)) item
  where public._name_in_site_scope(coalesce(item->>'player_name', item->>'display_name', item->>'chosen_username', item->>'public_display_name', ''), site_scope_input)
)
select jsonb_build_object('players', coalesce((select items from filtered),'[]'::jsonb));
$$;

grant execute on function public.get_player_profiles_public_scoped(text) to anon, authenticated;


-- Scoped site-wide players list for profiles.
drop function if exists public.get_all_site_players_public_scoped(text);
create or replace function public.get_all_site_players_public_scoped(site_scope_input text default 'friends')
returns jsonb
language sql
security definer
set search_path to 'public'
as $$
with base as (
  select public.get_all_site_players_public() as payload
), filtered as (
  select coalesce(jsonb_agg(item), '[]'::jsonb) as items
  from base, jsonb_array_elements(coalesce(base.payload->'players','[]'::jsonb)) item
  where public._name_in_site_scope(coalesce(item->>'player_name', item->>'display_name', item->>'chosen_username', item->>'public_display_name', ''), site_scope_input)
)
select jsonb_build_object('players', coalesce((select items from filtered),'[]'::jsonb));
$$;

grant execute on function public.get_all_site_players_public_scoped(text) to anon, authenticated;

-- Scoped ladder page.
drop function if exists public.get_public_ladder_page_scoped(text, text);
create or replace function public.get_public_ladder_page_scoped(game_key text, site_scope_input text default 'friends')
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  base jsonb;
  scope_key text := public._scope_norm(site_scope_input);
begin
  base := public.get_public_ladder_page(game_key);
  base := jsonb_set(base, '{ladder}', public._filter_jsonb_rows_by_name_key(base->'ladder', 'player_name', scope_key), true);
  base := jsonb_set(base, '{recent_matches}', public._filter_jsonb_matches(base->'recent_matches', scope_key), true);
  base := jsonb_set(base, '{pair_stats}', public._filter_jsonb_rows_by_pair_keys(base->'pair_stats', 'player_a', 'player_b', scope_key), true);
  base := jsonb_set(base, '{matchup_stats}', public._filter_jsonb_rows_by_pair_keys(base->'matchup_stats', 'player_a', 'player_b', scope_key), true);
  base := jsonb_set(base, '{history_series}', public._filter_jsonb_rows_by_name_key(base->'history_series', 'player_name', scope_key), true);
  return base;
end;
$fn$;

grant execute on function public.get_public_ladder_page_scoped(text, text) to anon, authenticated;

-- Scoped shared ladder stats.
drop function if exists public.get_public_shared_ladder_stats_scoped(text, text);
create or replace function public.get_public_shared_ladder_stats_scoped(game_key text, site_scope_input text default 'friends')
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  base jsonb;
  scope_key text := public._scope_norm(site_scope_input);
  leaders jsonb;
  filtered_leaders jsonb := '{}'::jsonb;
  key_name text;
  leader jsonb;
begin
  base := public.get_public_shared_ladder_stats(game_key);
  base := jsonb_set(base, '{players}', public._filter_jsonb_rows_by_name_key(base->'players', 'player_name', scope_key), true);
  leaders := coalesce(base->'leaders', '{}'::jsonb);
  for key_name in select key from jsonb_object_keys(leaders) key
  loop
    leader := leaders->key_name;
    if jsonb_typeof(leader)='object' and public._name_in_site_scope(coalesce(leader->>'player_name',leader->>'display_name',''), scope_key) then
      filtered_leaders := filtered_leaders || jsonb_build_object(key_name, leader);
    end if;
  end loop;
  base := jsonb_set(base, '{leaders}', filtered_leaders, true);
  return base;
end;
$fn$;

grant execute on function public.get_public_shared_ladder_stats_scoped(text, text) to anon, authenticated;

-- Scoped game insights: conservative blank cards to avoid leaking cross-scope precomputed aggregates.
drop function if exists public.get_public_game_advanced_insights_scoped(text, text);
create or replace function public.get_public_game_advanced_insights_scoped(game_key text, site_scope_input text default 'friends')
returns jsonb
language sql
security definer
set search_path to 'public'
as $$
  select jsonb_build_object('cards', '[]'::jsonb);
$$;

grant execute on function public.get_public_game_advanced_insights_scoped(text, text) to anon, authenticated;

-- Scoped unified player page.
drop function if exists public.get_public_player_unified_scoped(text, text);
create or replace function public.get_public_player_unified_scoped(player_name text, site_scope_input text default 'friends')
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  base jsonb;
  scope_key text := public._scope_norm(site_scope_input);
begin
  if not public._name_in_site_scope(player_name, scope_key) then
    return jsonb_build_object('player_name', player_name, 'overview', '{}'::jsonb, 'games', '{}'::jsonb);
  end if;
  base := public.get_public_player_unified(player_name);
  if base ? 'games' then
    base := jsonb_set(base, '{games}', public._filter_unified_games_by_scope(base->'games', scope_key), true);
  end if;
  return base;
end;
$fn$;

grant execute on function public.get_public_player_unified_scoped(text, text) to anon, authenticated;

-- Scoped shared player stats: only same-scope players.
drop function if exists public.get_public_shared_player_stats_scoped(text, text, text);
create or replace function public.get_public_shared_player_stats_scoped(game_key text, player_name text, site_scope_input text default 'friends')
returns jsonb
language sql
security definer
set search_path to 'public'
as $$
  select case
    when public._name_in_site_scope(player_name, site_scope_input)
      then public.get_public_shared_player_stats(game_key, player_name)
    else '{}'::jsonb
  end;
$$;

grant execute on function public.get_public_shared_player_stats_scoped(text, text, text) to anon, authenticated;

-- Scoped player insights: only same-scope players.
drop function if exists public.get_public_player_game_insights_scoped(text, text, text);
create or replace function public.get_public_player_game_insights_scoped(game_key text, player_name text, site_scope_input text default 'friends')
returns jsonb
language sql
security definer
set search_path to 'public'
as $$
  select case
    when public._name_in_site_scope(player_name, site_scope_input)
      then public.get_public_player_game_insights(game_key, player_name)
    else jsonb_build_object('cards', '[]'::jsonb)
  end;
$$;

grant execute on function public.get_public_player_game_insights_scoped(text, text, text) to anon, authenticated;

commit;
