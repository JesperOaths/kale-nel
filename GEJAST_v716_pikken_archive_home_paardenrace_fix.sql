-- GEJAST v716: make Pikken Despinoza lobby naming self-contained, archive abandoned live games,
-- and expose Pikken history/stats consistently.
-- Run this whole file in Supabase SQL editor after the previous SQL files.

begin;

-- 1) Pikken lobby naming. This is included here even if v714 was skipped.
create or replace function public._pikken_next_despinoza_lobby_code_v716(site_scope_input text default 'friends')
returns text
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_scope text := coalesce(nullif(trim(coalesce(site_scope_input,'')), ''), 'friends');
  v_n integer := 1;
  v_code text;
begin
  loop
    v_code := 'DESPINOZA ' || v_n::text;
    if not exists (
      select 1
      from public.pikken_games g
      where upper(trim(coalesce(g.lobby_code,''))) = upper(v_code)
        and coalesce(g.site_scope,'friends') = v_scope
        and lower(coalesce(g.status, g.state->>'phase', 'lobby')) not in ('finished','deleted','closed','abandoned')
        and coalesce(g.updated_at, g.created_at, now()) > now() - interval '15 minutes'
    ) then
      return v_code;
    end if;
    v_n := v_n + 1;
    if v_n > 999 then
      return 'DESPINOZA ' || floor(1000 + random() * 8999)::integer::text;
    end if;
  end loop;
end
$fn$;

drop function if exists public.pikken_create_lobby_fast_v687(text,text,jsonb,text);

create or replace function public.pikken_create_lobby_fast_v687(
  session_token text default null,
  session_token_input text default null,
  config_input jsonb default '{}'::jsonb,
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  p public.players%rowtype;
  v_token text := coalesce(session_token_input, session_token);
  v_scope text := coalesce(nullif(trim(coalesce(site_scope_input,'')), ''), 'friends');
  v_start_dice integer := greatest(1, least(coalesce(nullif(config_input->>'start_dice','')::integer, 6), 8));
  v_code text := public._pikken_next_despinoza_lobby_code_v716(v_scope);
  v_game_id uuid;
  v_name text;
begin
  select * into p from public._gejast_player_from_session(v_token);
  if p.id is null then
    raise exception 'Niet ingelogd.';
  end if;

  v_name := coalesce(to_jsonb(p)->>'display_name', to_jsonb(p)->>'name', to_jsonb(p)->>'email', 'Speler');

  insert into public.pikken_games(lobby_code, site_scope, status, config, state, created_by_player_id, created_by_player_name, updated_at)
  values (
    v_code,
    v_scope,
    'lobby',
    coalesce(config_input,'{}'::jsonb) || jsonb_build_object('start_dice', v_start_dice),
    jsonb_build_object('phase','lobby','round_no',0),
    p.id,
    v_name,
    now()
  )
  returning id into v_game_id;

  insert into public.pikken_game_players(game_id, player_id, player_name, seat_index, is_ready, dice_count)
  values (v_game_id, p.id, v_name, 1, false, v_start_dice);

  return jsonb_build_object('ok', true, 'game_id', v_game_id, 'id', v_game_id, 'lobby_code', v_code, 'code', v_code, 'start_dice', v_start_dice);
end
$fn$;

-- 2) Abandon/finish a Pikken game when the live page is left.
drop function if exists public.pikken_abandon_and_record_v716(text,text,uuid,text,text);

create or replace function public.pikken_abandon_and_record_v716(
  session_token text default null,
  session_token_input text default null,
  game_id_input uuid default null,
  reason_input text default 'page_left',
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  p public.players%rowtype;
  g public.pikken_games%rowtype;
  v_token text := coalesce(session_token_input, session_token);
  v_scope text := coalesce(nullif(trim(coalesce(site_scope_input,'')), ''), 'friends');
  v_winner record;
  v_round integer := 0;
begin
  if game_id_input is null then raise exception 'Pikken game_id ontbreekt.'; end if;
  select * into p from public._gejast_player_from_session(v_token);
  if p.id is null then raise exception 'Niet ingelogd.'; end if;

  select * into g
  from public.pikken_games
  where id = game_id_input
    and coalesce(site_scope,'friends') = v_scope
  for update;

  if g.id is null then
    return jsonb_build_object('ok', true, 'already_missing', true);
  end if;

  if not exists(select 1 from public.pikken_game_players gp where gp.game_id = g.id and gp.player_id = p.id)
     and g.created_by_player_id is distinct from p.id then
    raise exception 'Je zit niet in deze Pikken match.';
  end if;

  if lower(coalesce(g.status, g.state->>'phase', '')) <> 'finished' then
    select gp.player_id, gp.player_name, gp.dice_count
      into v_winner
    from public.pikken_game_players gp
    where gp.game_id = g.id
    order by coalesce(gp.dice_count,0) desc, gp.eliminated_at nulls first, gp.seat_index
    limit 1;

    v_round := greatest(1, coalesce(nullif(g.state->>'round_no','')::integer, 1));

    update public.pikken_games
       set status = 'finished',
           finished_at = now(),
           state = coalesce(state,'{}'::jsonb)
             || jsonb_build_object(
                  'phase','finished',
                  'abandoned', true,
                  'abandon_reason', coalesce(reason_input,'page_left'),
                  'winner_player_id', v_winner.player_id,
                  'winner_name', v_winner.player_name,
                  'round_no', v_round
                ),
           state_version = coalesce(state_version,0) + 1,
           updated_at = now()
     where id = g.id;
  end if;

  return public.pikken_record_completed_match_v709(v_token, v_token, g.id, v_scope);
end
$fn$;

grant execute on function public._pikken_next_despinoza_lobby_code_v716(text) to anon, authenticated;
grant execute on function public.pikken_create_lobby_fast_v687(text,text,jsonb,text) to anon, authenticated;
grant execute on function public.pikken_abandon_and_record_v716(text,text,uuid,text,text) to anon, authenticated;

commit;
