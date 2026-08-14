-- GEJAST v792c — Online Klaverjas deterministic human-game rules guard
-- SQL-only repair layered on v792a + v792b. Frontend VERSION intentionally remains v792.
--
-- v792b closes arbitrary whole-state replacement and deal-nonce escapes. This follow-up closes
-- the remaining legitimate-boundary gaps for persistent all-human rooms: bids, card legality,
-- trick winner/roem, collect transitions and round scores are independently recomputed here.
-- Bot rooms remain non-persistent test rooms and keep the current client-driven batched bot flow.

begin;

create or replace function public._klaverjas_online_card_strength(card_input jsonb, lead_suit text, trump_suit text)
returns integer
language plpgsql
immutable
set search_path to 'public'
as $function$
declare
  suit_text text := card_input ->> 'suit';
  rank_text text := card_input ->> 'rank';
  rank_pos integer;
  base integer := 0;
begin
  if suit_text is null or rank_text is null then return -1; end if;
  if coalesce(trump_suit,'') <> '' and trump_suit <> 'sans' and suit_text = trump_suit then
    rank_pos := array_position(array['J','9','A','10','K','Q','8','7']::text[], rank_text);
    if rank_pos is null then return -1; end if;
    return 200 + (9 - rank_pos);
  end if;
  if suit_text = lead_suit then base := 100; end if;
  rank_pos := array_position(array['A','10','K','Q','J','9','8','7']::text[], rank_text);
  if rank_pos is null then return -1; end if;
  return base + (9 - rank_pos);
end;
$function$;

create or replace function public._klaverjas_online_trick_winner(cards_input jsonb, trump_suit text)
returns integer
language plpgsql
immutable
set search_path to 'public'
as $function$
declare
  play_item jsonb;
  lead_suit text;
  strength integer;
  best_strength integer := -1;
  best_player integer := null;
begin
  if jsonb_typeof(cards_input) <> 'array' or jsonb_array_length(cards_input) < 1 or jsonb_array_length(cards_input) > 4 then
    return null;
  end if;
  lead_suit := cards_input -> 0 -> 'card' ->> 'suit';
  for play_item in select * from jsonb_array_elements(cards_input)
  loop
    if nullif(play_item ->> 'player','')::integer not between 0 and 3 then return null; end if;
    strength := public._klaverjas_online_card_strength(play_item -> 'card', lead_suit, trump_suit);
    if strength < 0 then return null; end if;
    if strength > best_strength then
      best_strength := strength;
      best_player := (play_item ->> 'player')::integer;
    end if;
  end loop;
  return best_player;
end;
$function$;

create or replace function public._klaverjas_online_card_legal(
  hand_input jsonb,
  trick_input jsonb,
  player_seat integer,
  trump_suit text,
  card_input jsonb
)
returns boolean
language plpgsql
immutable
set search_path to 'public'
as $function$
declare
  lead_suit text;
  card_suit text := card_input ->> 'suit';
  has_lead boolean;
  has_trump boolean;
  current_winner integer;
  current_high jsonb;
  candidate jsonb;
  can_over boolean := false;
  high_strength integer;
begin
  if jsonb_typeof(hand_input) <> 'array' or not (hand_input @> jsonb_build_array(card_input)) then return false; end if;
  if jsonb_typeof(trick_input) <> 'array' or jsonb_array_length(trick_input) = 0 then return true; end if;

  lead_suit := trick_input -> 0 -> 'card' ->> 'suit';
  select exists(select 1 from jsonb_array_elements(hand_input) h where h ->> 'suit' = lead_suit) into has_lead;

  if coalesce(trump_suit,'') = '' or trump_suit = 'sans' then
    return (not has_lead) or card_suit = lead_suit;
  end if;

  if has_lead then
    if card_suit <> lead_suit then return false; end if;
    if lead_suit <> trump_suit then return true; end if;

    current_winner := public._klaverjas_online_trick_winner(trick_input, trump_suit);
    select play into current_high from jsonb_array_elements(trick_input) play where (play ->> 'player')::integer = current_winner limit 1;
    high_strength := public._klaverjas_online_card_strength(current_high -> 'card', lead_suit, trump_suit);
    select exists(
      select 1 from jsonb_array_elements(hand_input) h
       where h ->> 'suit' = trump_suit
         and public._klaverjas_online_card_strength(h, lead_suit, trump_suit) > high_strength
    ) into can_over;
    if can_over then
      return public._klaverjas_online_card_strength(card_input, lead_suit, trump_suit) > high_strength;
    end if;
    return true;
  end if;

  select exists(select 1 from jsonb_array_elements(hand_input) h where h ->> 'suit' = trump_suit) into has_trump;
  if not has_trump then return true; end if;

  current_winner := public._klaverjas_online_trick_winner(trick_input, trump_suit);
  if current_winner is not null and (current_winner % 2) = (player_seat % 2) then
    return true;
  end if;

  if card_suit <> trump_suit then return false; end if;
  select play into current_high from jsonb_array_elements(trick_input) play where (play ->> 'player')::integer = current_winner limit 1;
  if current_high -> 'card' ->> 'suit' <> trump_suit then return true; end if;

  high_strength := public._klaverjas_online_card_strength(current_high -> 'card', lead_suit, trump_suit);
  select exists(
    select 1 from jsonb_array_elements(hand_input) h
     where h ->> 'suit' = trump_suit
       and public._klaverjas_online_card_strength(h, lead_suit, trump_suit) > high_strength
  ) into can_over;
  if can_over then
    return public._klaverjas_online_card_strength(card_input, lead_suit, trump_suit) > high_strength;
  end if;
  return true;
end;
$function$;

create or replace function public._klaverjas_online_roem_points(cards_input jsonb, trump_suit text)
returns integer
language plpgsql
immutable
set search_path to 'public'
as $function$
declare
  total_points integer := 0;
  same_rank text;
  suit_text text;
  positions integer[];
  p integer;
  i integer;
  has_sequence boolean;
begin
  if jsonb_typeof(cards_input) <> 'array' or jsonb_array_length(cards_input) <> 4 then return 0; end if;

  select min(card ->> 'rank') into same_rank
    from jsonb_array_elements(cards_input) play(card)
   having count(distinct card ->> 'rank') = 1 and count(*) = 4;
  if same_rank is not null then
    total_points := total_points + case when same_rank = 'J' then 200 else 100 end;
  end if;

  foreach suit_text in array array['clubs','spades','hearts','diamonds']::text[]
  loop
    select array_agg(pos order by pos) into positions
      from (
        select case card ->> 'rank'
          when 'A' then 1 when 'K' then 2 when 'Q' then 3 when 'J' then 4
          when '10' then 5 when '9' then 6 when '8' then 7 when '7' then 8 end as pos
          from jsonb_array_elements(cards_input) play(card)
         where card ->> 'suit' = suit_text
      ) ranked
     where pos is not null;

    has_sequence := false;
    if coalesce(array_length(positions,1),0) >= 3 then
      for i in 1..array_length(positions,1)-2 loop
        if positions[i+1] = positions[i] + 1 and positions[i+2] = positions[i] + 2 then
          if i + 3 <= array_length(positions,1) and positions[i+3] = positions[i] + 3 then
            total_points := total_points + 50;
          else
            total_points := total_points + 20;
          end if;
          has_sequence := true;
          exit;
        end if;
      end loop;
    end if;

    if suit_text = trump_suit
       and exists(select 1 from jsonb_array_elements(cards_input) play(card) where card ->> 'suit'=suit_text and card ->> 'rank'='K')
       and exists(select 1 from jsonb_array_elements(cards_input) play(card) where card ->> 'suit'=suit_text and card ->> 'rank'='Q') then
      total_points := total_points + 20;
    end if;
  end loop;

  return total_points;
end;
$function$;

create or replace function public._klaverjas_online_bid_rank(bid_input jsonb)
returns numeric
language plpgsql
immutable
set search_path to 'public'
as $function$
declare
  points integer := coalesce(nullif(bid_input ->> 'points','')::integer,0);
  mode_text text := bid_input ->> 'mode';
  kind_text text := bid_input ->> 'kind';
begin
  if bid_input is null or bid_input = 'null'::jsonb then return -1; end if;
  if kind_text in ('pit','mars','doormars') or (mode_text='sans' and points=132) then return 10000; end if;
  return points + case when mode_text='sans' then 0.1 else 0 end;
end;
$function$;

create or replace function public._klaverjas_online_bid_valid(bid_input jsonb, current_bid jsonb, player_seat integer)
returns boolean
language plpgsql
immutable
set search_path to 'public'
as $function$
declare
  points integer := coalesce(nullif(bid_input ->> 'points','')::integer,0);
  mode_text text := bid_input ->> 'mode';
  suit_text text := bid_input ->> 'suit';
  kind_text text := bid_input ->> 'kind';
  all_points boolean;
begin
  if bid_input is null or bid_input = 'null'::jsonb or bid_input ->> 'action' <> 'bid' then return false; end if;
  if nullif(bid_input ->> 'player','')::integer <> player_seat then return false; end if;
  if coalesce(nullif(bid_input ->> 'team','')::integer,0) <> (case when player_seat in (0,2) then 1 else 2 end) then return false; end if;

  all_points := kind_text in ('pit','mars','doormars') or (mode_text='sans' and points=132);
  if all_points then return true; end if;

  if mode_text='sans' then
    if points < 70 or points > 130 then return false; end if;
    return public._klaverjas_online_bid_rank(bid_input) >= public._klaverjas_online_bid_rank(current_bid);
  end if;
  if mode_text <> 'suit' or suit_text not in ('clubs','spades','hearts','diamonds') or points < 80 or points > 160 then return false; end if;
  return public._klaverjas_online_bid_rank(bid_input) > public._klaverjas_online_bid_rank(current_bid);
end;
$function$;

create or replace function public._klaverjas_online_bid_target(bid_input jsonb)
returns integer
language plpgsql
immutable
set search_path to 'public'
as $function$
declare
  points integer := coalesce(nullif(bid_input ->> 'points','')::integer,0);
  mode_text text := bid_input ->> 'mode';
  kind_text text := bid_input ->> 'kind';
begin
  if kind_text in ('pit','mars','doormars') or (mode_text='sans' and points=132) then return 162; end if;
  if mode_text='suit' then return greatest(82, points); end if;
  return points;
end;
$function$;

create or replace function public._klaverjas_online_card_points(card_input jsonb, trump_suit text)
returns integer
language plpgsql
immutable
set search_path to 'public'
as $function$
declare
  rank_text text := card_input ->> 'rank';
  is_trump boolean := coalesce(trump_suit,'') <> '' and trump_suit <> 'sans' and card_input ->> 'suit' = trump_suit;
begin
  if is_trump then
    return case rank_text when 'J' then 20 when '9' then 14 when 'A' then 11 when '10' then 10 when 'K' then 4 when 'Q' then 3 else 0 end;
  end if;
  return case rank_text when 'A' then 11 when '10' then 10 when 'K' then 4 when 'Q' then 3 when 'J' then 2 else 0 end;
end;
$function$;

create or replace function public._klaverjas_online_round_result(taken_input jsonb, accepted_bid jsonb, roem_by_team jsonb)
returns jsonb
language plpgsql
immutable
set search_path to 'public'
as $function$
declare
  trick_item jsonb;
  play_item jsonb;
  trump_suit text := accepted_bid ->> 'suit';
  bidder_team integer := nullif(accepted_bid ->> 'team','')::integer;
  bidder_idx integer;
  defender_idx integer;
  card_scores integer[] := array[0,0];
  trick_counts integer[] := array[0,0];
  scores integer[] := array[0,0];
  raw_scores integer[] := array[0,0];
  winner integer;
  team_idx integer;
  target integer;
  all_tricks boolean;
  all_points boolean;
  made boolean;
  roem0 integer := coalesce((roem_by_team ->> 0)::integer,0);
  roem1 integer := coalesce((roem_by_team ->> 1)::integer,0);
  last_winner integer := null;
begin
  if bidder_team not in (1,2) or jsonb_typeof(taken_input) <> 'array' or jsonb_array_length(taken_input) <> 8 then return null; end if;
  bidder_idx := bidder_team;
  defender_idx := case when bidder_team=1 then 2 else 1 end;

  for trick_item in select * from jsonb_array_elements(taken_input)
  loop
    if jsonb_typeof(trick_item -> 'cards') <> 'array' or jsonb_array_length(trick_item -> 'cards') <> 4 then return null; end if;
    winner := public._klaverjas_online_trick_winner(trick_item -> 'cards', trump_suit);
    if winner is null or nullif(trick_item ->> 'winner','')::integer <> winner then return null; end if;
    team_idx := case when winner in (0,2) then 1 else 2 end;
    trick_counts[team_idx] := trick_counts[team_idx] + 1;
    for play_item in select * from jsonb_array_elements(trick_item -> 'cards')
    loop
      card_scores[team_idx] := card_scores[team_idx] + public._klaverjas_online_card_points(play_item -> 'card', trump_suit);
    end loop;
    last_winner := winner;
  end loop;

  team_idx := case when last_winner in (0,2) then 1 else 2 end;
  card_scores[team_idx] := card_scores[team_idx] + 10;
  target := public._klaverjas_online_bid_target(accepted_bid);
  all_tricks := trick_counts[bidder_idx] = 8;
  all_points := coalesce(accepted_bid ->> 'kind','') in ('pit','mars','doormars') or (accepted_bid ->> 'mode'='sans' and coalesce((accepted_bid ->> 'points')::integer,0)=132);
  made := case when all_points then all_tricks else card_scores[bidder_idx] >= target end;
  raw_scores[1] := card_scores[1] + roem0;
  raw_scores[2] := card_scores[2] + roem1;

  if not made then
    scores[defender_idx] := 162 + roem0 + roem1;
  else
    scores[1] := raw_scores[1];
    scores[2] := raw_scores[2];
    if all_tricks then scores[bidder_idx] := scores[bidder_idx] + 100; end if;
  end if;

  return jsonb_build_object(
    'cardScores', jsonb_build_array(card_scores[1],card_scores[2]),
    'raw', jsonb_build_array(raw_scores[1],raw_scores[2]),
    'trickCounts', jsonb_build_array(trick_counts[1],trick_counts[2]),
    'nat', not made,
    'scores', jsonb_build_array(scores[1],scores[2]),
    'target', target,
    'made', made
  );
end;
$function$;

create or replace function public._klaverjas_online_should_finish(state_input jsonb)
returns boolean
language plpgsql
immutable
set search_path to 'public'
as $function$
begin
  if state_input #>> '{settings,finish_mode}' = 'first_to_162' then
    return coalesce((state_input #>> '{totals,0}')::integer,0) >= 162 or coalesce((state_input #>> '{totals,1}')::integer,0) >= 162;
  end if;
  return case when jsonb_typeof(state_input -> 'rounds')='array' then jsonb_array_length(state_input -> 'rounds') >= 16 else false end;
end;
$function$;

create or replace function public._klaverjas_online_human_transition_valid(
  stored_state jsonb,
  next_state jsonb,
  viewer_seat integer
)
returns boolean
language plpgsql
immutable
set search_path to 'public'
as $function$
declare
  stored_phase text := coalesce(nullif(stored_state ->> 'phase',''), 'lobby');
  next_phase text := coalesce(nullif(next_state ->> 'phase',''), stored_phase);
  stored_nonce text := coalesce(stored_state ->> 'deal_nonce','');
  next_nonce text := coalesce(next_state ->> 'deal_nonce','');
  stored_dealer integer := coalesce(nullif(stored_state ->> 'dealer','')::integer,0);
  stored_turn integer;
  stored_bidder integer;
  next_bidder integer;
  stored_passes integer := coalesce(nullif(stored_state ->> 'passes_since_bid','')::integer,0);
  next_passes integer := coalesce(nullif(next_state ->> 'passes_since_bid','')::integer,0);
  stored_current jsonb := coalesce(stored_state -> 'current_bid','null'::jsonb);
  next_current jsonb := coalesce(next_state -> 'current_bid','null'::jsonb);
  stored_accepted jsonb := coalesce(stored_state -> 'accepted_bid','null'::jsonb);
  next_accepted jsonb := coalesce(next_state -> 'accepted_bid','null'::jsonb);
  stored_pending jsonb := stored_state -> 'pending_trick';
  next_pending jsonb := next_state -> 'pending_trick';
  stored_trick jsonb := coalesce(stored_state -> 'trick', '[]'::jsonb);
  next_trick jsonb := coalesce(next_state -> 'trick', '[]'::jsonb);
  stored_hands jsonb := stored_state -> 'hands';
  next_hands jsonb := next_state -> 'hands';
  stored_hand jsonb;
  next_hand jsonb;
  removed_card jsonb;
  last_play jsonb;
  idx integer;
  stored_taken jsonb := coalesce(stored_state -> 'taken','[]'::jsonb);
  next_taken jsonb := coalesce(next_state -> 'taken','[]'::jsonb);
  stored_taken_len integer := case when jsonb_typeof(stored_state -> 'taken')='array' then jsonb_array_length(stored_state -> 'taken') else 0 end;
  next_taken_len integer := case when jsonb_typeof(next_state -> 'taken')='array' then jsonb_array_length(next_state -> 'taken') else 0 end;
  winner integer;
  expected_roem integer;
  winner_team_idx integer;
  stored_roem0 integer := coalesce((stored_state #>> '{roem_by_team,0}')::integer,0);
  stored_roem1 integer := coalesce((stored_state #>> '{roem_by_team,1}')::integer,0);
  next_roem0 integer := coalesce((next_state #>> '{roem_by_team,0}')::integer,0);
  next_roem1 integer := coalesce((next_state #>> '{roem_by_team,1}')::integer,0);
  expected_result jsonb;
  appended_round jsonb;
  stored_round_count integer := case when jsonb_typeof(stored_state -> 'rounds')='array' then jsonb_array_length(stored_state -> 'rounds') else 0 end;
  next_round_count integer := case when jsonb_typeof(next_state -> 'rounds')='array' then jsonb_array_length(next_state -> 'rounds') else 0 end;
  expected_total0 integer;
  expected_total1 integer;
  closes_bid boolean;
begin
  if viewer_seat is null or viewer_seat not between 0 and 3 then return false; end if;
  if next_phase not in ('lobby','bidding','playing','roundOver','finished') then return false; end if;
  if coalesce(next_state -> 'players','[]'::jsonb) <> coalesce(stored_state -> 'players','[]'::jsonb) then return false; end if;

  if stored_phase <> 'lobby' then
    if coalesce(next_state -> 'settings','{}'::jsonb) <> coalesce(stored_state -> 'settings','{}'::jsonb) then return false; end if;
  end if;

  -- Fresh deal boundaries are the only legal nonce changes.
  if next_nonce <> stored_nonce then
    if next_nonce='' or not public._klaverjas_online_full_deal_valid(next_state) then return false; end if;
    if coalesce(next_state -> 'trick','[]'::jsonb) <> '[]'::jsonb
       or coalesce(next_state -> 'taken','[]'::jsonb) <> '[]'::jsonb
       or coalesce(next_state -> 'roem_by_team','[0,0]'::jsonb) <> '[0,0]'::jsonb
       or next_current <> 'null'::jsonb or next_accepted <> 'null'::jsonb
       or next_passes <> 0 or next_phase <> 'bidding' then return false; end if;
    next_bidder := nullif(next_state ->> 'bidder_turn','')::integer;
    if next_bidder <> (coalesce(nullif(next_state ->> 'dealer','')::integer,0)+1)%4 then return false; end if;

    if stored_phase='lobby' then
      return viewer_seat=0
         and jsonb_array_length(coalesce(next_state -> 'players','[]'::jsonb))=4
         and coalesce(next_state ->> 'dealer','')=coalesce(stored_state ->> 'dealer','')
         and coalesce(next_state -> 'totals','[0,0]'::jsonb)=coalesce(stored_state -> 'totals','[0,0]'::jsonb)
         and coalesce(next_state -> 'rounds','[]'::jsonb)=coalesce(stored_state -> 'rounds','[]'::jsonb);
    end if;
    if stored_phase='bidding' and stored_current='null'::jsonb and stored_passes>=3 then
      stored_bidder := nullif(stored_state ->> 'bidder_turn','')::integer;
      return viewer_seat=stored_bidder
         and coalesce(next_state ->> 'dealer','')=coalesce(stored_state ->> 'dealer','')
         and coalesce(next_state -> 'totals','[0,0]'::jsonb)=coalesce(stored_state -> 'totals','[0,0]'::jsonb)
         and coalesce(next_state -> 'rounds','[]'::jsonb)=coalesce(stored_state -> 'rounds','[]'::jsonb);
    end if;
    if stored_phase='roundOver' then
      return coalesce(next_state ->> 'dealer','')=coalesce(stored_state ->> 'dealer','')
         and coalesce(next_state -> 'totals','[0,0]'::jsonb)=coalesce(stored_state -> 'totals','[0,0]'::jsonb)
         and coalesce(next_state -> 'rounds','[]'::jsonb)=coalesce(stored_state -> 'rounds','[]'::jsonb);
    end if;
    return false;
  end if;

  if stored_phase='lobby' then
    return next_phase='lobby'
       and coalesce(next_state -> 'totals','[0,0]'::jsonb)=coalesce(stored_state -> 'totals','[0,0]'::jsonb)
       and coalesce(next_state -> 'rounds','[]'::jsonb)=coalesce(stored_state -> 'rounds','[]'::jsonb);
  end if;

  if stored_phase='bidding' then
    stored_bidder := nullif(stored_state ->> 'bidder_turn','')::integer;
    if viewer_seat<>stored_bidder then return false; end if;
    if coalesce(next_hands,'[]'::jsonb)<>coalesce(stored_hands,'[]'::jsonb)
       or next_taken<>stored_taken or next_trick<>stored_trick
       or coalesce(next_state -> 'totals','[0,0]'::jsonb)<>coalesce(stored_state -> 'totals','[0,0]'::jsonb)
       or coalesce(next_state -> 'rounds','[]'::jsonb)<>coalesce(stored_state -> 'rounds','[]'::jsonb)
       or coalesce(next_state -> 'roem_by_team','[0,0]'::jsonb)<>coalesce(stored_state -> 'roem_by_team','[0,0]'::jsonb) then return false; end if;

    if next_current = stored_current then
      if next_passes <> stored_passes+1 then return false; end if;
      if stored_current='null'::jsonb then
        return stored_passes<3 and next_phase='bidding'
           and nullif(next_state ->> 'bidder_turn','')::integer=(stored_bidder+1)%4
           and next_accepted='null'::jsonb;
      end if;
      if stored_passes>=2 then
        return next_phase='playing' and next_accepted=stored_current
           and coalesce(next_state -> 'bidder_turn','null'::jsonb)='null'::jsonb
           and nullif(next_state ->> 'turn','')::integer=(stored_dealer+1)%4;
      end if;
      return next_phase='bidding'
         and nullif(next_state ->> 'bidder_turn','')::integer=(stored_bidder+1)%4
         and next_accepted='null'::jsonb;
    end if;

    if not public._klaverjas_online_bid_valid(next_current, stored_current, viewer_seat) or next_passes<>0 then return false; end if;
    closes_bid := coalesce(next_current ->> 'kind','') in ('pit','mars','doormars')
       or (next_current ->> 'mode'='sans' and coalesce((next_current ->> 'points')::integer,0)=132);
    if closes_bid then
      return next_phase='playing' and next_accepted=next_current
         and coalesce(next_state -> 'bidder_turn','null'::jsonb)='null'::jsonb
         and nullif(next_state ->> 'turn','')::integer=(stored_dealer+1)%4;
    end if;
    return next_phase='bidding' and next_accepted='null'::jsonb
       and nullif(next_state ->> 'bidder_turn','')::integer=(stored_bidder+1)%4;
  end if;

  if stored_phase='playing' then
    if next_current<>stored_current or next_accepted<>stored_accepted then return false; end if;
    if coalesce(next_state ->> 'dealer','')<>coalesce(stored_state ->> 'dealer','') then return false; end if;

    if stored_pending is null or stored_pending='null'::jsonb then
      stored_turn := nullif(stored_state ->> 'turn','')::integer;
      if viewer_seat<>stored_turn or next_phase<>'playing' then return false; end if;
      if jsonb_typeof(stored_hands)<>'array' or jsonb_typeof(next_hands)<>'array'
         or jsonb_array_length(stored_hands)<>4 or jsonb_array_length(next_hands)<>4 then return false; end if;
      for idx in 0..3 loop
        stored_hand:=coalesce(stored_hands -> idx,'[]'::jsonb);
        next_hand:=coalesce(next_hands -> idx,'[]'::jsonb);
        if idx<>viewer_seat and next_hand<>stored_hand then return false; end if;
      end loop;
      stored_hand:=coalesce(stored_hands -> viewer_seat,'[]'::jsonb);
      next_hand:=coalesce(next_hands -> viewer_seat,'[]'::jsonb);
      if jsonb_array_length(next_hand)<>jsonb_array_length(stored_hand)-1 or not(stored_hand @> next_hand) then return false; end if;
      select card into removed_card from jsonb_array_elements(stored_hand) cards(card)
       where not exists(select 1 from jsonb_array_elements(next_hand) incoming where incoming ->> 'id'=card ->> 'id') limit 1;
      if removed_card is null or not public._klaverjas_online_card_legal(stored_hand,stored_trick,viewer_seat,stored_accepted ->> 'suit',removed_card) then return false; end if;
      if next_taken<>stored_taken
         or coalesce(next_state -> 'totals','[0,0]'::jsonb)<>coalesce(stored_state -> 'totals','[0,0]'::jsonb)
         or coalesce(next_state -> 'rounds','[]'::jsonb)<>coalesce(stored_state -> 'rounds','[]'::jsonb)
         or next_roem0<>stored_roem0 or next_roem1<>stored_roem1 then return false; end if;

      if jsonb_array_length(stored_trick)<3 then
        if jsonb_array_length(next_trick)<>jsonb_array_length(stored_trick)+1
           or (next_trick-(jsonb_array_length(next_trick)-1))<>stored_trick then return false; end if;
        last_play:=next_trick -> (jsonb_array_length(next_trick)-1);
        return nullif(last_play ->> 'player','')::integer=viewer_seat
           and last_play -> 'card'=removed_card
           and (next_pending is null or next_pending='null'::jsonb)
           and nullif(next_state ->> 'turn','')::integer=(viewer_seat+1)%4;
      end if;

      if jsonb_array_length(stored_trick)<>3 or jsonb_array_length(next_trick)<>0
         or jsonb_typeof(next_pending)<>'object' or jsonb_typeof(next_pending -> 'cards')<>'array'
         or jsonb_array_length(next_pending -> 'cards')<>4 or ((next_pending -> 'cards')-3)<>stored_trick then return false; end if;
      last_play:=next_pending -> 'cards' -> 3;
      if nullif(last_play ->> 'player','')::integer<>viewer_seat or last_play -> 'card'<>removed_card then return false; end if;
      winner:=public._klaverjas_online_trick_winner(next_pending -> 'cards',stored_accepted ->> 'suit');
      expected_roem:=public._klaverjas_online_roem_points(next_pending -> 'cards',stored_accepted ->> 'suit');
      return winner is not null
         and nullif(next_pending ->> 'winner','')::integer=winner
         and coalesce((next_pending #>> '{roem,points}')::integer,0)=expected_roem
         and coalesce((next_pending ->> 'klopped')::boolean,false)=false
         and coalesce(next_state -> 'turn','null'::jsonb)='null'::jsonb;
    end if;

    winner:=public._klaverjas_online_trick_winner(stored_pending -> 'cards',stored_accepted ->> 'suit');
    expected_roem:=public._klaverjas_online_roem_points(stored_pending -> 'cards',stored_accepted ->> 'suit');
    if winner is null or nullif(stored_pending ->> 'winner','')::integer<>winner
       or coalesce((stored_pending #>> '{roem,points}')::integer,0)<>expected_roem
       or (viewer_seat%2)<>(winner%2) then return false; end if;
    if coalesce(next_hands,'[]'::jsonb)<>coalesce(stored_hands,'[]'::jsonb) or next_trick<>stored_trick then return false; end if;

    if next_pending is not null and next_pending<>'null'::jsonb then
      if next_phase<>'playing' or next_taken<>stored_taken
         or next_pending -> 'cards'<>stored_pending -> 'cards'
         or nullif(next_pending ->> 'winner','')::integer<>winner
         or coalesce((next_pending #>> '{roem,points}')::integer,0)<>expected_roem
         or coalesce((stored_pending ->> 'klopped')::boolean,false)
         or not coalesce((next_pending ->> 'klopped')::boolean,false)
         or coalesce(next_state -> 'totals','[0,0]'::jsonb)<>coalesce(stored_state -> 'totals','[0,0]'::jsonb)
         or coalesce(next_state -> 'rounds','[]'::jsonb)<>coalesce(stored_state -> 'rounds','[]'::jsonb) then return false; end if;
      winner_team_idx:=case when winner in (0,2) then 1 else 2 end;
      if winner_team_idx=1 then return next_roem0=stored_roem0+expected_roem and next_roem1=stored_roem1; end if;
      return next_roem1=stored_roem1+expected_roem and next_roem0=stored_roem0;
    end if;

    if next_taken_len<>stored_taken_len+1 or (next_taken-stored_taken_len)<>stored_taken
       or next_taken -> stored_taken_len -> 'cards'<>stored_pending -> 'cards'
       or nullif(next_taken -> stored_taken_len ->> 'winner','')::integer<>winner
       or next_roem0<>stored_roem0 or next_roem1<>stored_roem1 then return false; end if;

    if stored_taken_len<7 then
      return next_phase='playing'
         and coalesce(next_state -> 'totals','[0,0]'::jsonb)=coalesce(stored_state -> 'totals','[0,0]'::jsonb)
         and coalesce(next_state -> 'rounds','[]'::jsonb)=coalesce(stored_state -> 'rounds','[]'::jsonb)
         and nullif(next_state ->> 'turn','')::integer=winner;
    end if;

    if stored_taken_len<>7 then return false; end if;
    expected_result:=public._klaverjas_online_round_result(next_taken,stored_accepted,next_state -> 'roem_by_team');
    if expected_result is null then return false; end if;
    expected_total0:=coalesce((stored_state #>> '{totals,0}')::integer,0)+coalesce((expected_result #>> '{scores,0}')::integer,0);
    expected_total1:=coalesce((stored_state #>> '{totals,1}')::integer,0)+coalesce((expected_result #>> '{scores,1}')::integer,0);
    if coalesce((next_state #>> '{totals,0}')::integer,0)<>expected_total0
       or coalesce((next_state #>> '{totals,1}')::integer,0)<>expected_total1
       or next_round_count<>stored_round_count+1 then return false; end if;
    appended_round:=next_state -> 'rounds' -> stored_round_count;
    if appended_round -> 'bid'<>stored_accepted
       or coalesce((appended_round ->> 'bidder_team')::integer,0)<>coalesce((stored_accepted ->> 'team')::integer,0)
       or appended_round -> 'result'<>expected_result
       or coalesce((appended_round #>> '{totals,0}')::integer,0)<>expected_total0
       or coalesce((appended_round #>> '{totals,1}')::integer,0)<>expected_total1
       or appended_round -> 'roem_by_team'<>next_state -> 'roem_by_team'
       or coalesce((appended_round ->> 'dealer')::integer,-1)<>stored_dealer then return false; end if;
    if nullif(next_state ->> 'dealer','')::integer<>(stored_dealer+1)%4 then return false; end if;
    if public._klaverjas_online_should_finish(next_state) then return next_phase='finished'; end if;
    return next_phase='roundOver';
  end if;

  if stored_phase='roundOver' then
    if next_phase='roundOver' then return next_state=stored_state; end if;
    return next_phase='finished'
       and coalesce(next_state -> 'hands','[]'::jsonb)=coalesce(stored_state -> 'hands','[]'::jsonb)
       and coalesce(next_state -> 'taken','[]'::jsonb)=coalesce(stored_state -> 'taken','[]'::jsonb)
       and coalesce(next_state -> 'totals','[0,0]'::jsonb)=coalesce(stored_state -> 'totals','[0,0]'::jsonb)
       and coalesce(next_state -> 'rounds','[]'::jsonb)=coalesce(stored_state -> 'rounds','[]'::jsonb)
       and next_current=stored_current and next_accepted=stored_accepted;
  end if;

  if stored_phase='finished' then return next_state=stored_state; end if;
  return false;
end;
$function$;

revoke execute on function public._klaverjas_online_card_strength(jsonb,text,text) from public, anon, authenticated;
revoke execute on function public._klaverjas_online_trick_winner(jsonb,text) from public, anon, authenticated;
revoke execute on function public._klaverjas_online_card_legal(jsonb,jsonb,integer,text,jsonb) from public, anon, authenticated;
revoke execute on function public._klaverjas_online_roem_points(jsonb,text) from public, anon, authenticated;
revoke execute on function public._klaverjas_online_bid_rank(jsonb) from public, anon, authenticated;
revoke execute on function public._klaverjas_online_bid_valid(jsonb,jsonb,integer) from public, anon, authenticated;
revoke execute on function public._klaverjas_online_bid_target(jsonb) from public, anon, authenticated;
revoke execute on function public._klaverjas_online_card_points(jsonb,text) from public, anon, authenticated;
revoke execute on function public._klaverjas_online_round_result(jsonb,jsonb,jsonb) from public, anon, authenticated;
revoke execute on function public._klaverjas_online_should_finish(jsonb) from public, anon, authenticated;
revoke execute on function public._klaverjas_online_human_transition_valid(jsonb,jsonb,integer) from public, anon, authenticated;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';

commit;
