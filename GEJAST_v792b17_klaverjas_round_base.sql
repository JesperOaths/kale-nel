-- GEJAST v792b17 — derive card scores and trick counts from eight completed tricks.
begin;
create or replace function public._klaverjas_online_round_base_v792b17(taken jsonb, bid jsonb)
returns jsonb
language plpgsql
immutable
security definer
set search_path to 'public'
as $function$
declare
  trick jsonb;
  play jsonb;
  winner integer;
  expected_winner integer;
  team_index integer;
  card_scores integer[] := array[0,0];
  trick_counts integer[] := array[0,0];
  trick_no integer := 0;
  trump text := bid ->> 'suit';
begin
  if jsonb_typeof(taken) <> 'array' or jsonb_array_length(taken) <> 8 then
    raise exception 'klaverjas_online_round_trick_count_invalid';
  end if;
  for trick in select value from jsonb_array_elements(taken)
  loop
    trick_no := trick_no + 1;
    if jsonb_typeof(trick -> 'cards') <> 'array' or jsonb_array_length(trick -> 'cards') <> 4 then
      raise exception 'klaverjas_online_round_trick_shape_invalid';
    end if;
    winner := nullif(trick ->> 'winner','')::integer;
    expected_winner := public._klaverjas_online_trick_winner_v792b6(trick -> 'cards', trump);
    if winner is null or winner <> expected_winner then
      raise exception 'klaverjas_online_round_winner_invalid';
    end if;
    team_index := case when winner in (0,2) then 1 else 2 end;
    trick_counts[team_index] := trick_counts[team_index] + 1;
    for play in select value from jsonb_array_elements(trick -> 'cards')
    loop
      card_scores[team_index] := card_scores[team_index] + public._klaverjas_online_card_points_v792b14(play -> 'card', trump);
    end loop;
    if trick_no = 8 then card_scores[team_index] := card_scores[team_index] + 10; end if;
  end loop;
  return jsonb_build_object(
    'card_scores', jsonb_build_array(card_scores[1], card_scores[2]),
    'trick_counts', jsonb_build_array(trick_counts[1], trick_counts[2])
  );
end;
$function$;
revoke execute on function public._klaverjas_online_round_base_v792b17(jsonb,jsonb) from public, anon, authenticated;
notify pgrst, 'reload schema';
commit;