-- GEJAST v755o: Toepen totals consistency guard.
-- SQL-only forward fix after controlled v764 matrix proof.
-- Requires the saving player to match the requested scope and participant end_points to match round penalties.

begin;

create or replace function public.create_toepen_game(
  session_token text,
  game_payload jsonb,
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  viewer public.players%rowtype;
  game_id_out bigint;
  existing_id bigint;
  participant jsonb;
  round_row jsonb;
  result_row jsonb;
  round_id_out bigint;
  participant_count integer;
  round_count integer;
  winner_names_out text[];
  client_id text;
  seen_names text[] := '{}'::text[];
  lower_name text;
  creator_name text;
  creator_slug text;
  creator_seen boolean := false;
  active_seats integer[];
  winner_seat_value integer;
  stake_value integer;
  seat_value integer;
  action_value text;
  folded_value integer;
  round_result_count integer;
  totals_check record;
  use_scope text := case when lower(coalesce(site_scope_input,''))='family' then 'family' else 'friends' end;
begin
  if game_payload is null or jsonb_typeof(game_payload) <> 'object' then
    raise exception 'Ongeldig Toepen-payload.';
  end if;

  viewer := public._tier3_player_from_any_session_v740(session_token);
  if viewer.id is null then
    raise exception 'Niet ingelogd.';
  end if;
  if lower(coalesce(viewer.site_scope,'friends')) <> use_scope then
    raise exception 'Verkeerde Toepen-scope voor deze speler.';
  end if;
  creator_name := lower(trim(coalesce(viewer.display_name,'')));
  creator_slug := lower(trim(coalesce(viewer.slug,'')));

  client_id := nullif(trim(game_payload->>'client_match_id'),'');
  if client_id is null then
    raise exception 'client_match_id ontbreekt.';
  end if;
  if coalesce(game_payload->>'game_type','toepen') <> 'toepen' then
    raise exception 'Verkeerd speltype.';
  end if;

  participant_count := jsonb_array_length(coalesce(game_payload->'participants','[]'::jsonb));
  round_count := jsonb_array_length(coalesce(game_payload->'rounds','[]'::jsonb));
  if participant_count < 2 or participant_count > 8 then
    raise exception 'Toepen vereist 2 tot 8 spelers.';
  end if;
  if round_count < 1 then
    raise exception 'Een opgeslagen Toepen-potje vereist minimaal één ronde.';
  end if;

  select id into existing_id from public.toepen_games where client_match_id=client_id limit 1;
  if existing_id is not null then
    return jsonb_build_object('ok',true,'game_id',existing_id,'already_saved',true);
  end if;

  select coalesce(array_agg(p->>'name' order by nullif(p->>'finish_rank','')::integer) filter (where nullif(p->>'finish_rank','')::integer=1),'{}'::text[])
    into winner_names_out
    from jsonb_array_elements(game_payload->'participants') p;

  insert into public.toepen_games(
    client_match_id,site_scope,created_by_player_id,created_by_player_name,played_at,
    target_points,ruleset,raw_payload,winner_names,status
  ) values (
    client_id,use_scope,viewer.id,
    coalesce(nullif(trim(viewer.display_name),''),nullif(trim(viewer.slug),''),'Onbekende speler'),
    coalesce(nullif(game_payload->>'played_at','')::timestamptz,now()),
    greatest(1,least(100,coalesce(nullif(game_payload->>'target_points','')::integer,10))),
    coalesce(game_payload->'ruleset','{}'::jsonb),game_payload,coalesce(winner_names_out,'{}'::text[]),'finished'
  ) returning id into game_id_out;

  for participant in select value from jsonb_array_elements(game_payload->'participants')
  loop
    if nullif(trim(participant->>'name'),'') is null then
      raise exception 'Een deelnemer heeft geen naam.';
    end if;
    if nullif(participant->>'seat_no','')::integer is null
       or nullif(participant->>'seat_no','')::integer < 1
       or nullif(participant->>'seat_no','')::integer > participant_count then
      raise exception 'Ongeldig Toepen-stoelnummer.';
    end if;
    lower_name := lower(trim(participant->>'name'));
    if lower_name = any(seen_names) then
      raise exception 'Een Toepen-deelnemer komt dubbel voor.';
    end if;
    seen_names := array_append(seen_names, lower_name);
    if lower_name = creator_name or (creator_slug <> '' and lower_name = creator_slug) then
      creator_seen := true;
    end if;
    insert into public.toepen_game_participants(
      game_id,seat_no,player_name,start_points,end_points,eliminated,eliminated_round_no,finish_rank
    ) values (
      game_id_out,
      nullif(participant->>'seat_no','')::integer,
      trim(participant->>'name'),
      coalesce(nullif(participant->>'start_points','')::integer,0),
      coalesce(nullif(participant->>'end_points','')::integer,0),
      coalesce(nullif(participant->>'eliminated','')::boolean,false),
      nullif(participant->>'eliminated_round_no','')::integer,
      nullif(participant->>'finish_rank','')::integer
    );
  end loop;

  if not creator_seen then
    raise exception 'Alleen een deelnemer mag dit Toepen-potje opslaan.';
  end if;

  for round_row in select value from jsonb_array_elements(game_payload->'rounds')
  loop
    active_seats := array(
      select (p->>'seat_no')::integer
        from jsonb_array_elements(game_payload->'participants') p
       where coalesce(nullif(p->>'eliminated','')::boolean,false) is false
          or coalesce(nullif(p->>'eliminated_round_no','')::integer, 2147483647) >= nullif(round_row->>'round_no','')::integer
    );
    winner_seat_value := nullif(round_row->>'winner_seat','')::integer;
    stake_value := greatest(1,coalesce(nullif(round_row->>'stake_final','')::integer,1));
    if stake_value > 10 then
      raise exception 'Toepen-inzet is hoger dan toegestaan.';
    end if;
    if winner_seat_value is null or not (winner_seat_value = any(active_seats)) then
      raise exception 'Rondewinnaar is geen actieve Toepen-speler.';
    end if;
    round_result_count := jsonb_array_length(coalesce(round_row->'results','[]'::jsonb));
    if round_result_count <> array_length(active_seats, 1) then
      raise exception 'Toepen-ronde bevat niet exact alle actieve spelers.';
    end if;

    insert into public.toepen_rounds(
      game_id,round_no,dealer_seat,winner_seat,winner_name,stake_final,knock_count,special_tags,note,raw_round,created_at
    ) values (
      game_id_out,
      nullif(round_row->>'round_no','')::integer,
      nullif(round_row->>'dealer_seat','')::integer,
      nullif(round_row->>'winner_seat','')::integer,
      coalesce(nullif(trim(round_row->>'winner_name'),''),'Onbekend'),
      stake_value,
      greatest(0,coalesce(nullif(round_row->>'knock_count','')::integer,0)),
      coalesce(array(select jsonb_array_elements_text(coalesce(round_row->'special_tags','[]'::jsonb))),'{}'::text[]),
      coalesce(round_row->>'note',''),round_row,
      coalesce(nullif(round_row->>'created_at','')::timestamptz,now())
    ) returning id into round_id_out;

    for result_row in select value from jsonb_array_elements(coalesce(round_row->'results','[]'::jsonb))
    loop
      seat_value := nullif(result_row->>'seat_no','')::integer;
      action_value := case when result_row->>'action' in ('win','stay','fold') then result_row->>'action' else 'stay' end;
      folded_value := nullif(result_row->>'folded_at_stake','')::integer;
      if seat_value is null or not (seat_value = any(active_seats)) then
        raise exception 'Toepen-resultaat verwijst naar een niet-actieve speler.';
      end if;
      if (seat_value = winner_seat_value and action_value <> 'win')
         or (seat_value <> winner_seat_value and action_value = 'win') then
        raise exception 'Alleen de rondewinnaar mag als winnaar worden opgeslagen.';
      end if;
      if action_value = 'fold'
         and (stake_value <= 1 or folded_value is null or folded_value < 1 or folded_value >= stake_value) then
        raise exception 'Ongeldige Toepen-foldwaarde.';
      end if;
      if action_value <> 'fold' and folded_value is not null then
        raise exception 'Alleen een fold mag een foldwaarde hebben.';
      end if;
      if action_value = 'win' and greatest(0,coalesce(nullif(result_row->>'penalty_points','')::integer,0)) <> 0 then
        raise exception 'Een Toepen-rondewinnaar krijgt geen strafpunten.';
      end if;
      if action_value = 'stay' and greatest(0,coalesce(nullif(result_row->>'penalty_points','')::integer,0)) <> stake_value then
        raise exception 'Blijven moet exact de eindinzet als strafpunten krijgen.';
      end if;
      if action_value = 'fold' and greatest(0,coalesce(nullif(result_row->>'penalty_points','')::integer,0)) <> folded_value then
        raise exception 'Folden moet exact de foldwaarde als strafpunten krijgen.';
      end if;
      insert into public.toepen_round_results(
        round_id,game_id,round_no,seat_no,player_name,action,penalty_points,folded_at_stake
      ) values (
        round_id_out,game_id_out,nullif(round_row->>'round_no','')::integer,
        seat_value,
        coalesce(nullif(trim(result_row->>'name'),''),'Onbekend'),
        action_value,
        greatest(0,coalesce(nullif(result_row->>'penalty_points','')::integer,0)),
        folded_value
      );
    end loop;
  end loop;

  for totals_check in
    select p.seat_no,
           p.player_name,
           p.end_points,
           coalesce(sum(rr.penalty_points),0)::integer as calculated_points
      from public.toepen_game_participants p
      left join public.toepen_round_results rr on rr.game_id = p.game_id and rr.seat_no = p.seat_no
     where p.game_id = game_id_out
     group by p.seat_no, p.player_name, p.end_points
  loop
    if totals_check.end_points <> totals_check.calculated_points then
      raise exception 'Toepen-eindscore komt niet overeen met rondepunten.';
    end if;
  end loop;

  return jsonb_build_object('ok',true,'game_id',game_id_out,'already_saved',false);
exception when others then
  if game_id_out is not null then delete from public.toepen_games where id=game_id_out; end if;
  raise;
end;
$fn$;

revoke all on function public.create_toepen_game(text,jsonb,text) from public;
grant execute on function public.create_toepen_game(text,jsonb,text) to anon, authenticated;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';

commit;
