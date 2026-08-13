-- GEJAST v792d — Online Klaverjas transition compatibility correction
-- SQL-only. Frontend VERSION remains v792.
--
-- v792c deliberately mirrors the browser rules, but its first draft compared the complete
-- lobby/player JSON. Human lobby rows created by the backend omit explicit is_bot/player_type,
-- while newClientState() canonicalizes those fields to false/'human'. The save RPC already
-- validates roster identity field-by-field before this helper runs, so whole-JSON equality here
-- is both redundant and incompatible with a legitimate four-human start.
--
-- This replacement keeps deterministic bid/card/trick/score validation from v792c while relying
-- on the save RPC's existing roster boundary. It also explicitly checks the browser's dealer,
-- turn, roem, taken-prefix and round-result transitions.

begin;

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
  stored_passes integer := coalesce(nullif(stored_state ->> 'passes_since_bid','')::integer,0);
  next_passes integer := coalesce(nullif(next_state ->> 'passes_since_bid','')::integer,0);
  stored_current jsonb := coalesce(stored_state -> 'current_bid','null'::jsonb);
  next_current jsonb := coalesce(next_state -> 'current_bid','null'::jsonb);
  stored_accepted jsonb := coalesce(stored_state -> 'accepted_bid','null'::jsonb);
  next_accepted jsonb := coalesce(next_state -> 'accepted_bid','null'::jsonb);
  stored_pending jsonb := stored_state -> 'pending_trick';
  next_pending jsonb := next_state -> 'pending_trick';
  stored_trick jsonb := coalesce(stored_state -> 'trick','[]'::jsonb);
  next_trick jsonb := coalesce(next_state -> 'trick','[]'::jsonb);
  stored_hands jsonb := stored_state -> 'hands';
  next_hands jsonb := next_state -> 'hands';
  stored_hand jsonb;
  next_hand jsonb;
  removed_card jsonb;
  last_play jsonb;
  idx integer;
  stored_taken jsonb := coalesce(stored_state -> 'taken','[]'::jsonb);
  next_taken jsonb := coalesce(next_state -> 'taken','[]'::jsonb);
  stored_taken_len integer := case when jsonb_typeof(stored_taken)='array' then jsonb_array_length(stored_taken) else 0 end;
  next_taken_len integer := case when jsonb_typeof(next_taken)='array' then jsonb_array_length(next_taken) else 0 end;
  stored_rounds jsonb := coalesce(stored_state -> 'rounds','[]'::jsonb);
  next_rounds jsonb := coalesce(next_state -> 'rounds','[]'::jsonb);
  stored_round_count integer := case when jsonb_typeof(stored_rounds)='array' then jsonb_array_length(stored_rounds) else 0 end;
  next_round_count integer := case when jsonb_typeof(next_rounds)='array' then jsonb_array_length(next_rounds) else 0 end;
  stored_totals jsonb := coalesce(stored_state -> 'totals','[0,0]'::jsonb);
  next_totals jsonb := coalesce(next_state -> 'totals','[0,0]'::jsonb);
  stored_roem jsonb := coalesce(stored_state -> 'roem_by_team','[0,0]'::jsonb);
  next_roem jsonb := coalesce(next_state -> 'roem_by_team','[0,0]'::jsonb);
  winner integer;
  winner_team_index integer;
  expected_roem integer;
  expected_result jsonb;
  appended_round jsonb;
  expected_total0 integer;
  expected_total1 integer;
  closes_bid boolean;
begin
  if viewer_seat is null or viewer_seat not between 0 and 3 then return false; end if;
  if next_phase not in ('lobby','bidding','playing','roundOver','finished') then return false; end if;

  -- Roster mutation is intentionally not compared as raw JSON here. The enclosing save RPC
  -- already validates seat/name/team/is_bot/player_type and lobby-only bot additions.
  if stored_phase <> 'lobby' and coalesce(next_state -> 'settings','{}'::jsonb) <> coalesce(stored_state -> 'settings','{}'::jsonb) then
    return false;
  end if;

  -- New deal nonce is allowed only at the three real fresh-deal boundaries.
  if next_nonce <> stored_nonce then
    if next_nonce='' or next_phase<>'bidding' or not public._klaverjas_online_full_deal_valid(next_state) then return false; end if;
    if coalesce(next_state -> 'trick','[]'::jsonb)<>'[]'::jsonb
       or coalesce(next_state -> 'taken','[]'::jsonb)<>'[]'::jsonb
       or next_roem<>'[0,0]'::jsonb
       or next_current<>'null'::jsonb or next_accepted<>'null'::jsonb
       or next_passes<>0
       or nullif(next_state ->> 'turn','') is not null
       or nullif(next_state ->> 'bidder_turn','')::integer<>(coalesce(nullif(next_state ->> 'dealer','')::integer,0)+1)%4 then return false; end if;

    if stored_phase='lobby' then
      return viewer_seat=0
         and jsonb_array_length(coalesce(next_state -> 'players','[]'::jsonb))=4
         and coalesce(next_state ->> 'dealer','')=coalesce(stored_state ->> 'dealer','')
         and next_totals=stored_totals and next_rounds=stored_rounds;
    end if;

    if stored_phase='bidding' and stored_current='null'::jsonb and stored_passes>=3 then
      stored_bidder:=nullif(stored_state ->> 'bidder_turn','')::integer;
      return viewer_seat=stored_bidder
         and coalesce(next_state ->> 'dealer','')=coalesce(stored_state ->> 'dealer','')
         and next_totals=stored_totals and next_rounds=stored_rounds;
    end if;

    if stored_phase='roundOver' then
      return coalesce(next_state ->> 'dealer','')=coalesce(stored_state ->> 'dealer','')
         and next_totals=stored_totals and next_rounds=stored_rounds;
    end if;
    return false;
  end if;

  if stored_phase='lobby' then
    return next_phase='lobby' and next_totals=stored_totals and next_rounds=stored_rounds;
  end if;

  if stored_phase='bidding' then
    stored_bidder:=nullif(stored_state ->> 'bidder_turn','')::integer;
    if viewer_seat<>stored_bidder then return false; end if;
    if coalesce(next_hands,'[]'::jsonb)<>coalesce(stored_hands,'[]'::jsonb)
       or next_taken<>stored_taken or next_trick<>stored_trick
       or next_totals<>stored_totals or next_rounds<>stored_rounds or next_roem<>stored_roem then return false; end if;

    -- Pass leaves current bid untouched. Four no-bid passes are handled above by a fresh nonce.
    if next_current=stored_current then
      if next_passes<>stored_passes+1 then return false; end if;
      if stored_current='null'::jsonb then
        return stored_passes<3 and next_phase='bidding'
           and nullif(next_state ->> 'bidder_turn','')::integer=(stored_bidder+1)%4
           and next_accepted='null'::jsonb;
      end if;
      if stored_passes>=2 then
        return next_phase='playing' and next_accepted=stored_current
           and nullif(next_state ->> 'bidder_turn','') is null
           and nullif(next_state ->> 'turn','')::integer=(stored_dealer+1)%4;
      end if;
      return next_phase='bidding' and next_accepted='null'::jsonb
         and nullif(next_state ->> 'bidder_turn','')::integer=(stored_bidder+1)%4;
    end if;

    if not public._klaverjas_online_bid_valid(next_current,stored_current,viewer_seat) or next_passes<>0 then return false; end if;
    closes_bid:=coalesce(next_current ->> 'kind','') in ('pit','mars','doormars')
      or (next_current ->> 'mode'='sans' and coalesce((next_current ->> 'points')::integer,0)=132);
    if closes_bid then
      return next_phase='playing' and next_accepted=next_current
         and nullif(next_state ->> 'bidder_turn','') is null
         and nullif(next_state ->> 'turn','')::integer=(stored_dealer+1)%4;
    end if;
    return next_phase='bidding' and next_accepted='null'::jsonb
       and nullif(next_state ->> 'bidder_turn','')::integer=(stored_bidder+1)%4;
  end if;

  if stored_phase='playing' then
    if next_current<>stored_current or next_accepted<>stored_accepted
       or coalesce(next_state ->> 'dealer','')<>coalesce(stored_state ->> 'dealer','') then return false; end if;

    -- Normal card play.
    if stored_pending is null or stored_pending='null'::jsonb then
      stored_turn:=nullif(stored_state ->> 'turn','')::integer;
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
      if next_taken<>stored_taken or next_totals<>stored_totals or next_rounds<>stored_rounds or next_roem<>stored_roem then return false; end if;

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
         and not coalesce((next_pending ->> 'klopped')::boolean,false)
         and nullif(next_state ->> 'turn','') is null;
    end if;

    -- Pending trick can first be klopped once, then collected. The server recomputes winner/roem.
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
         or next_totals<>stored_totals or next_rounds<>stored_rounds then return false; end if;
      winner_team_index:=case when winner in (0,2) then 0 else 1 end;
      if winner_team_index=0 then
        return coalesce((next_roem ->> 0)::integer,0)=coalesce((stored_roem ->> 0)::integer,0)+expected_roem
           and coalesce((next_roem ->> 1)::integer,0)=coalesce((stored_roem ->> 1)::integer,0);
      end if;
      return coalesce((next_roem ->> 1)::integer,0)=coalesce((stored_roem ->> 1)::integer,0)+expected_roem
         and coalesce((next_roem ->> 0)::integer,0)=coalesce((stored_roem ->> 0)::integer,0);
    end if;

    if next_taken_len<>stored_taken_len+1 or (next_taken-stored_taken_len)<>stored_taken
       or next_taken -> stored_taken_len -> 'cards'<>stored_pending -> 'cards'
       or nullif(next_taken -> stored_taken_len ->> 'winner','')::integer<>winner
       or next_roem<>stored_roem then return false; end if;

    if stored_taken_len<7 then
      return next_phase='playing' and next_totals=stored_totals and next_rounds=stored_rounds
         and nullif(next_state ->> 'turn','')::integer=winner;
    end if;

    if stored_taken_len<>7 then return false; end if;
    expected_result:=public._klaverjas_online_round_result(next_taken,stored_accepted,next_roem);
    if expected_result is null then return false; end if;
    expected_total0:=coalesce((stored_totals ->> 0)::integer,0)+coalesce((expected_result #>> '{scores,0}')::integer,0);
    expected_total1:=coalesce((stored_totals ->> 1)::integer,0)+coalesce((expected_result #>> '{scores,1}')::integer,0);
    if coalesce((next_totals ->> 0)::integer,0)<>expected_total0
       or coalesce((next_totals ->> 1)::integer,0)<>expected_total1
       or next_round_count<>stored_round_count+1 then return false; end if;
    appended_round:=next_rounds -> stored_round_count;
    if appended_round -> 'bid'<>stored_accepted
       or coalesce((appended_round ->> 'bidder_team')::integer,0)<>coalesce((stored_accepted ->> 'team')::integer,0)
       or appended_round -> 'result'<>expected_result
       or coalesce((appended_round #>> '{totals,0}')::integer,0)<>expected_total0
       or coalesce((appended_round #>> '{totals,1}')::integer,0)<>expected_total1
       or appended_round -> 'roem_by_team'<>next_roem
       or coalesce((appended_round ->> 'dealer')::integer,-1)<>stored_dealer
       or nullif(next_state ->> 'dealer','')::integer<>(stored_dealer+1)%4 then return false; end if;
    if public._klaverjas_online_should_finish(next_state) then return next_phase='finished'; end if;
    return next_phase='roundOver';
  end if;

  if stored_phase='roundOver' then
    if next_phase='roundOver' then return next_state=stored_state; end if;
    return next_phase='finished'
       and coalesce(next_state -> 'hands','[]'::jsonb)=coalesce(stored_state -> 'hands','[]'::jsonb)
       and next_taken=stored_taken and next_totals=stored_totals and next_rounds=stored_rounds
       and next_current=stored_current and next_accepted=stored_accepted;
  end if;

  if stored_phase='finished' then return next_state=stored_state; end if;
  return false;
end;
$function$;

revoke execute on function public._klaverjas_online_human_transition_valid(jsonb,jsonb,integer) from public, anon, authenticated;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';

commit;
