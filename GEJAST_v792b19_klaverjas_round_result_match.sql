-- GEJAST v792b19 — compare a newly appended round result with the server-derived score.
begin;
create or replace function public._klaverjas_online_round_result_match_v792b19(stored_state jsonb, next_state jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  old_count integer := case when jsonb_typeof(stored_state -> 'rounds')='array' then jsonb_array_length(stored_state -> 'rounds') else 0 end;
  new_count integer := case when jsonb_typeof(next_state -> 'rounds')='array' then jsonb_array_length(next_state -> 'rounds') else 0 end;
  round_row jsonb;
  result_row jsonb;
  base jsonb;
  expected jsonb;
  bid jsonb := stored_state -> 'accepted_bid';
  team integer := coalesce((bid ->> 'team')::integer,0);
  c0 integer;
  c1 integer;
  s0 integer;
  s1 integer;
begin
  if new_count = old_count then return; end if;
  if new_count <> old_count + 1 then raise exception 'klaverjas_online_round_result_invalid'; end if;

  round_row := next_state -> 'rounds' -> old_count;
  result_row := round_row -> 'result';
  base := public._klaverjas_online_round_base_v792b17(next_state -> 'taken', bid);
  expected := public._klaverjas_online_round_scores_v792b18(
    base -> 'card_scores', base -> 'trick_counts', team, bid, next_state -> 'roem_by_team'
  );
  c0 := coalesce((base #>> '{card_scores,0}')::integer,0);
  c1 := coalesce((base #>> '{card_scores,1}')::integer,0);
  s0 := coalesce((expected #>> '{scores,0}')::integer,0);
  s1 := coalesce((expected #>> '{scores,1}')::integer,0);

  if coalesce((round_row ->> 'round')::integer,-1) <> old_count + 1
     or coalesce(round_row -> 'bid','null'::jsonb) is distinct from bid
     or coalesce((round_row ->> 'bidder_team')::integer,-1) <> team
     or coalesce(round_row -> 'roem_by_team','null'::jsonb) is distinct from coalesce(next_state -> 'roem_by_team','null'::jsonb)
     or coalesce((round_row ->> 'dealer')::integer,-1) <> coalesce((stored_state ->> 'dealer')::integer,-2)
  then raise exception 'klaverjas_online_round_metadata_invalid'; end if;

  if coalesce((result_row #>> '{cardScores,0}')::integer,-1) <> c0
     or coalesce((result_row #>> '{cardScores,1}')::integer,-1) <> c1
     or coalesce(result_row -> 'trickCounts','null'::jsonb) is distinct from base -> 'trick_counts'
     or coalesce((result_row ->> 'target')::integer,-1) <> coalesce((expected ->> 'target')::integer,-2)
     or coalesce((result_row ->> 'made')::boolean,false) <> coalesce((expected ->> 'made')::boolean,false)
     or coalesce((result_row ->> 'nat')::boolean,false) <> coalesce((expected ->> 'nat')::boolean,false)
     or coalesce((result_row #>> '{scores,0}')::integer,-1) <> s0
     or coalesce((result_row #>> '{scores,1}')::integer,-1) <> s1
  then raise exception 'klaverjas_online_round_score_invalid'; end if;

  if coalesce((expected ->> 'made')::boolean,false) then
    if coalesce(result_row -> 'raw','null'::jsonb) is distinct from expected -> 'scores' then
      raise exception 'klaverjas_online_round_raw_invalid';
    end if;
  else
    if coalesce((result_row #>> '{raw,0}')::integer,-1) <> c0 + coalesce((next_state #>> '{roem_by_team,0}')::integer,0)
       or coalesce((result_row #>> '{raw,1}')::integer,-1) <> c1 + coalesce((next_state #>> '{roem_by_team,1}')::integer,0) then
      raise exception 'klaverjas_online_round_raw_invalid';
    end if;
  end if;
end;
$function$;
revoke execute on function public._klaverjas_online_round_result_match_v792b19(jsonb,jsonb) from public, anon, authenticated;
notify pgrst, 'reload schema';
commit;