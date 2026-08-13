-- GEJAST v792b18 — pure round-score calculation matching scoreRound().
begin;
create or replace function public._klaverjas_online_round_scores_v792b18(
  card_scores jsonb,
  trick_counts jsonb,
  bidder_team integer,
  bid jsonb,
  bonus_scores jsonb
)
returns jsonb
language plpgsql
immutable
security definer
set search_path to 'public'
as $function$
declare
  c0 integer := coalesce((card_scores ->> 0)::integer,0);
  c1 integer := coalesce((card_scores ->> 1)::integer,0);
  t0 integer := coalesce((trick_counts ->> 0)::integer,0);
  t1 integer := coalesce((trick_counts ->> 1)::integer,0);
  b0 integer := coalesce((bonus_scores ->> 0)::integer,0);
  b1 integer := coalesce((bonus_scores ->> 1)::integer,0);
  idx integer := bidder_team - 1;
  target integer := public._klaverjas_online_bid_target_v792b16(bid);
  all_tricks boolean;
  all_points boolean;
  made boolean;
  s0 integer;
  s1 integer;
begin
  if bidder_team not in (1,2) or b0 < 0 or b1 < 0 then raise exception 'klaverjas_online_round_inputs_invalid'; end if;
  all_tricks := case when idx=0 then t0=8 else t1=8 end;
  all_points := lower(coalesce(bid ->> 'kind','')) in ('pit','mars','doormars')
    or (lower(coalesce(bid ->> 'mode',''))='sans' and coalesce((bid ->> 'points')::integer,0)=132);
  made := case when all_points then all_tricks else (case when idx=0 then c0 else c1 end) >= target end;
  if made then
    s0 := c0 + b0;
    s1 := c1 + b1;
    if all_tricks then
      if idx=0 then s0 := s0 + 100; else s1 := s1 + 100; end if;
    end if;
  else
    s0 := case when idx=1 then 162 + b0 + b1 else 0 end;
    s1 := case when idx=0 then 162 + b0 + b1 else 0 end;
  end if;
  return jsonb_build_object('scores',jsonb_build_array(s0,s1),'target',target,'made',made,'nat',not made,'all_tricks',all_tricks);
end;
$function$;
revoke execute on function public._klaverjas_online_round_scores_v792b18(jsonb,jsonb,integer,jsonb,jsonb) from public, anon, authenticated;
notify pgrst, 'reload schema';
commit;