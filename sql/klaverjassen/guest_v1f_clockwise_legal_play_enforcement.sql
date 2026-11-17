-- Standalone guest-table enforcement. Does not modify authenticated Klaverjassen.
-- Round leader and dealer advance clockwise (+1 modulo four); all real card
-- submissions are checked against the authoritative pre-move hands.
create or replace function public._kalenel_kj_card_strength(c jsonb,led text,trump text)
returns integer language sql immutable set search_path=public,pg_temp as $strength$
  select case
    when c->>'suit'=trump and trump is not null and trump<>'sans'
      then 200 + (9-coalesce(array_position(array['J','9','A','10','K','Q','8','7'],c->>'rank'),9))
    when c->>'suit'=led
      then 100 + (9-coalesce(array_position(array['A','10','K','Q','J','9','8','7'],c->>'rank'),9))
    else 0 end
$strength$;
create or replace function public._kalenel_kj_guest_winner(trick_cards jsonb,trump text)
returns integer language sql immutable set search_path=public,pg_temp as $winner$
  select (item->>'player')::integer from
    jsonb_array_elements(coalesce(trick_cards,'[]'::jsonb)) with ordinality x(item,idx)
    order by public._kalenel_kj_card_strength(item->'card',trick_cards->0->'card'->>'suit',trump) desc,idx
    limit 1
$winner$;
create or replace function public._kalenel_kj_guest_legal_card(
  hand jsonb,trick_cards jsonb,player_seat integer,trump text,candidate jsonb
) returns boolean language plpgsql immutable set search_path=public,pg_temp
as $legal$
declare
  led text;
  suit text:=candidate->>'suit';
  winning_seat integer;
  winning_card jsonb;
  has_follow boolean;
  has_trump boolean;
  has_other boolean;
  have_higher boolean;
  trump_valid boolean:=trump in ('hearts','diamonds','spades','clubs');
begin
  if candidate is null or jsonb_typeof(hand)<>'array'
    or not exists(select 1 from jsonb_array_elements(hand) x where x->>'id'=candidate->>'id') then
    return false;
  end if;
  if jsonb_array_length(coalesce(trick_cards,'[]'::jsonb))=0 then return true; end if;
  led:=trick_cards->0->'card'->>'suit';
  select exists(select 1 from jsonb_array_elements(hand) x where x->>'suit'=led) into has_follow;
  if not trump_valid then return not has_follow or suit=led; end if;
  winning_seat:=public._kalenel_kj_guest_winner(trick_cards,trump);
  select x->'card' into winning_card from jsonb_array_elements(trick_cards) x
   where (x->>'player')::integer=winning_seat limit 1;
  select exists(select 1 from jsonb_array_elements(hand) x where x->>'suit'=trump) into has_trump;
  select exists(select 1 from jsonb_array_elements(hand) x where x->>'suit'<>trump) into has_other;
  select exists(select 1 from jsonb_array_elements(hand) x
     where x->>'suit'=trump and winning_card->>'suit'=trump
       and public._kalenel_kj_card_strength(x,trump,trump)>
         public._kalenel_kj_card_strength(winning_card,trump,trump))
    into have_higher;
  if has_follow then
    if suit<>led then return false; end if;
    if led=trump and have_higher then
      return public._kalenel_kj_card_strength(candidate,trump,trump)>
        public._kalenel_kj_card_strength(winning_card,trump,trump);
    end if;
    return true;
  end if;
  if not has_trump then return true; end if;
  -- Under Amsterdams a winning partner need not be trumped. But a player
  -- with a discard cannot undertrump an already winning trump.
  if winning_seat%2=player_seat%2 then
    if winning_card->>'suit'=trump and suit=trump and has_other then
      return public._kalenel_kj_card_strength(candidate,trump,trump)>
        public._kalenel_kj_card_strength(winning_card,trump,trump);
    end if;
    return true;
  end if;
  if winning_card->>'suit'<>trump then return suit=trump; end if;
  if have_higher then
    return suit=trump and
      public._kalenel_kj_card_strength(candidate,trump,trump)>
        public._kalenel_kj_card_strength(winning_card,trump,trump);
  end if;
  if has_other then return suit<>trump; end if;
  return suit=trump;
end;
$legal$;
create or replace function public._kalenel_kj_guest_validate_play_sequence(
 old_state jsonb,new_state jsonb,actor_seat integer,reason text
) returns void language plpgsql set search_path=public,pg_temp
as $validate$
declare
 old_plays jsonb:=coalesce(old_state->'plays','[]'::jsonb);
 new_plays jsonb:=coalesce(new_state->'plays','[]'::jsonb);
 hand_snapshot jsonb:=coalesce(old_state->'hands','[[],[],[],[]]'::jsonb);
 ongoing jsonb:=coalesce(old_state->'trick','[]'::jsonb);
 game_trump text:=new_state->'accepted_bid'->>'suit';
 old_count integer;
 new_count integer;
 i integer;
 current_turn integer;
 playing_seat integer;
 new_play jsonb;
 actual_card jsonb;
 after_hand jsonb;
 expected_pending jsonb:=null;
 winning_player integer;
begin
 if reason not in ('play_card','bot_turns') then return; end if;
 if jsonb_typeof(old_plays)<>'array' or jsonb_typeof(new_plays)<>'array' then
   raise exception 'Ongeldig kaartverloop';
 end if;
 old_count:=jsonb_array_length(old_plays);
 new_count:=jsonb_array_length(new_plays);
 if new_count<old_count or exists(select 1 from generate_series(0,old_count-1) pos
   where (new_plays->pos) is distinct from (old_plays->pos)) then
   raise exception 'Eerdere zetten mogen niet worden herschreven';
 end if;
 if reason='play_card' and new_count<>old_count+1 then
   raise exception 'Je mag per beurt maar een kaart spelen';
 end if;
 if new_count=old_count then
   if reason='play_card' then raise exception 'Er is geen kaart gespeeld'; end if;
   return;
 end if;
 if reason='bot_turns' and old_state->>'phase'='bidding' then
   current_turn:=(coalesce((old_state->>'dealer')::integer,0)+1)%4;
 else current_turn:=(old_state->>'turn')::integer; end if;
 if current_turn is null then raise exception 'Niemand is aan de beurt'; end if;
 if new_state->>'phase'<>'playing' or
    (new_state->'taken') is distinct from (old_state->'taken') or
    (new_state->'rounds') is distinct from (old_state->'rounds') or
    (new_state->'totals') is distinct from (old_state->'totals') or
    (new_state->'dealer') is distinct from (old_state->'dealer') then
   raise exception 'Een kaartzet mag de deler, slagen of punten niet veranderen';
 end if;
 for i in old_count..new_count-1 loop
   new_play:=new_plays->i;
   playing_seat:=(new_play->>'player')::integer;
   if playing_seat is null or playing_seat not between 0 and 3 or playing_seat<>current_turn then
     raise exception 'Speelvolgorde moet linksom met de klok mee doorgaan';
   end if;
   if reason='play_card' and playing_seat<>actor_seat then
     raise exception 'Alleen je eigen kaart mag worden gespeeld';
   end if;
   if reason='bot_turns' and
      coalesce((old_state->'players'->playing_seat->>'is_bot')::boolean,false)<>true then
     raise exception 'De bot mag geen menselijke kaart spelen';
   end if;
   select c into actual_card from jsonb_array_elements(hand_snapshot->playing_seat) c
     where c->>'id'=new_play->'card'->>'id' limit 1;
   if actual_card is null or actual_card is distinct from new_play->'card' then
     raise exception 'Een kaart ontbreekt uit de oorspronkelijke hand';
   end if;
   if not public._kalenel_kj_guest_legal_card(
      hand_snapshot->playing_seat,ongoing,playing_seat,game_trump,actual_card) then
     raise exception 'Verzaken: je moet kleur bekennen, (over)troeven of correct afgooien';
   end if;
   select coalesce(jsonb_agg(x.card order by x.ord),'[]'::jsonb) into after_hand
     from jsonb_array_elements(hand_snapshot->playing_seat) with ordinality x(card,ord)
     where x.card->>'id'<>actual_card->>'id';
   hand_snapshot:=jsonb_set(hand_snapshot,array[playing_seat::text],after_hand);
   ongoing:=ongoing||jsonb_build_array(jsonb_build_object('player',playing_seat,'card',actual_card));
   if jsonb_array_length(ongoing)=4 then
     if i<>new_count-1 then raise exception 'De slag moet eerst worden afgesloten'; end if;
     winning_player:=public._kalenel_kj_guest_winner(ongoing,game_trump);
     expected_pending:=ongoing;
     current_turn:=null;
   else
     current_turn:=(playing_seat+1)%4;
   end if;
 end loop;
 if (new_state->'hands') is distinct from hand_snapshot then
   raise exception 'Handen en gespeelde kaarten sluiten niet op elkaar aan';
 end if;
 if expected_pending is null then
   if (new_state->'trick') is distinct from ongoing or
      (new_state->'pending_trick' is not null and new_state->'pending_trick'<>'null'::jsonb) or
      (new_state->>'turn')::integer is distinct from current_turn or
      (new_state->>'action_needed_seat')::integer is distinct from current_turn then
      raise exception 'De volgende speler moet met de klok mee zijn';
   end if;
 else
   if (new_state->'trick') is distinct from '[]'::jsonb or
      (new_state->'pending_trick'->'cards') is distinct from expected_pending or
      (new_state->'pending_trick'->>'winner')::integer is distinct from winning_player or
      (new_state->>'turn') is not null and new_state->'turn'<>'null'::jsonb then
     raise exception 'Ongeldige winnaar of kaartvolgorde van de slag';
   end if;
 end if;
end;
$validate$;
revoke all on function public._kalenel_kj_card_strength(jsonb,text,text) from public,anon,authenticated;
revoke all on function public._kalenel_kj_guest_winner(jsonb,text) from public,anon,authenticated;
revoke all on function public._kalenel_kj_guest_legal_card(jsonb,jsonb,integer,text,jsonb) from public,anon,authenticated;
revoke all on function public._kalenel_kj_guest_validate_play_sequence(jsonb,jsonb,integer,text) from public,anon,authenticated;

do $patch$
declare f text;
begin
 select pg_get_functiondef('public.klaverjassen_guest_v1(text,text,text,text,jsonb)'::regprocedure) into f;
 if position($old$  if incoming->'totals'<>s->'totals' or incoming->'rounds'<>s->'rounds' then
   raise exception 'Punten en rondehistorie moeten behouden blijven';
  end if;$old$ in f)=0 then
  raise exception 'Expected round-start validation is missing';
 end if;
 f:=replace(f,$old$  if incoming->'totals'<>s->'totals' or incoming->'rounds'<>s->'rounds' then
   raise exception 'Punten en rondehistorie moeten behouden blijven';
  end if;$old$,
  $new$  if incoming->'totals'<>s->'totals' or incoming->'rounds'<>s->'rounds' then
   raise exception 'Punten en rondehistorie moeten behouden blijven';
  end if;
  if (incoming->>'dealer')::integer is distinct from (s->>'dealer')::integer
    or (incoming->>'bidder_turn')::integer is distinct from
         ((coalesce((s->>'dealer')::integer,0)+1)%4)
    or incoming->>'turn' is not null and incoming->'turn'<>'null'::jsonb then
   raise exception 'De deler blijft op de uitgedeelde stoel en voorhand zit links';
  end if;$new$);
 if position($old$ if jsonb_typeof(incoming->'recovery_snapshot')='object' then
  incoming := jsonb_set(incoming,'{recovery_snapshot,hands}',incoming->'hands',true);
 end if;
 if reason='play_card' then$old$ in f)=0 then
  raise exception 'Expected private-hand validation anchor is missing';
 end if;
 f:=replace(f,$old$ if jsonb_typeof(incoming->'recovery_snapshot')='object' then
  incoming := jsonb_set(incoming,'{recovery_snapshot,hands}',incoming->'hands',true);
 end if;
 if reason='play_card' then$old$,
 $new$ if jsonb_typeof(incoming->'recovery_snapshot')='object' then
  incoming := jsonb_set(incoming,'{recovery_snapshot,hands}',incoming->'hands',true);
 end if;
 perform public._kalenel_kj_guest_validate_play_sequence(s,incoming,viewer_seat,reason);
 if reason='play_card' then$new$);
 if position($old$   if (incoming->'taken') IS DISTINCT FROM (coalesce(s->'taken','[]'::jsonb) || jsonb_build_array(s->'pending_trick')) then
    raise exception 'De slaglijst moet exact één gewonnen slag toevoegen';
   end if;$old$ in f)=0 then
   raise exception 'Expected collected-trick validation is missing';
 end if;
 f:=replace(f,$old$   if (incoming->'taken') IS DISTINCT FROM (coalesce(s->'taken','[]'::jsonb) || jsonb_build_array(s->'pending_trick')) then
    raise exception 'De slaglijst moet exact één gewonnen slag toevoegen';
   end if;$old$,
 $new$   if (incoming->'taken') IS DISTINCT FROM (coalesce(s->'taken','[]'::jsonb) || jsonb_build_array(s->'pending_trick')) then
    raise exception 'De slaglijst moet exact één gewonnen slag toevoegen';
   end if;
   if jsonb_array_length(incoming->'taken')=8 then
     if (incoming->>'dealer')::integer is distinct from ((coalesce((s->>'dealer')::integer,0)+1)%4) or
        jsonb_array_length(coalesce(incoming->'rounds','[]'::jsonb)) <>
          jsonb_array_length(coalesce(s->'rounds','[]'::jsonb))+1 then
       raise exception 'Na acht slagen gaat de deler één plaats naar links en volgt een ronde';
     end if;
   else
     if (incoming->>'dealer')::integer is distinct from (s->>'dealer')::integer or
        jsonb_array_length(coalesce(incoming->'rounds','[]'::jsonb)) <>
          jsonb_array_length(coalesce(s->'rounds','[]'::jsonb)) then
       raise exception 'Tijdens de acht slagen blijft de deler ongewijzigd';
     end if;
   end if;$new$);
 -- Preserve the dealer throughout ordinary bids, human/bot cards, and Klop.
 if position($old$ reason := coalesce(incoming->>'last_progress_reason','');
 old_players := coalesce(s->'players','[]'::jsonb);$old$ in f)=0 then
   raise exception 'Expected dealer invariance anchor is missing';
 end if;
 f:=replace(f,$old$ reason := coalesce(incoming->>'last_progress_reason','');
 old_players := coalesce(s->'players','[]'::jsonb);$old$,
 $new$ reason := coalesce(incoming->>'last_progress_reason','');
 if reason in ('bid','play_card','bot_turns','klop_roem') and
    (incoming->'dealer') is distinct from (s->'dealer') then
   raise exception 'De deler kan niet midden in een ronde veranderen';
 end if;
 old_players := coalesce(s->'players','[]'::jsonb);$new$);
 if position($old$ elsif reason='bid' then
  if s->>'phase'<>'bidding' or (s->>'bidder_turn')::integer<>viewer_seat
    or incoming->'totals'<>s->'totals' then raise exception 'Je bent niet aan de beurt om te bieden'; end if;
 elsif reason='play_card' then$old$ in f)=0 then
   raise exception 'Expected bid clockwise progression anchor is missing';
 end if;
 f:=replace(f,$old$ elsif reason='bid' then
  if s->>'phase'<>'bidding' or (s->>'bidder_turn')::integer<>viewer_seat
    or incoming->'totals'<>s->'totals' then raise exception 'Je bent niet aan de beurt om te bieden'; end if;
 elsif reason='play_card' then$old$,
 $new$ elsif reason='bid' then
  if s->>'phase'<>'bidding' or (s->>'bidder_turn')::integer<>viewer_seat
    or incoming->'totals'<>s->'totals' then raise exception 'Je bent niet aan de beurt om te bieden'; end if;
  if incoming->>'phase'='bidding' then
    if (incoming->>'deal_nonce') is distinct from (s->>'deal_nonce') then
      if (incoming->>'bidder_turn')::integer is distinct from
          ((coalesce((s->>'dealer')::integer,0)+1)%4) then
        raise exception 'Na opnieuw delen begint voorhand links van de deler';
      end if;
    else
      if (incoming->>'bidder_turn')::integer is distinct from ((viewer_seat+1)%4) then
        raise exception 'De biedbeurt moet met de klok mee naar links';
      end if;
    end if;
  elsif incoming->>'phase'='playing' then
    if (incoming->>'turn')::integer is distinct from
        ((coalesce((s->>'dealer')::integer,0)+1)%4) or
       (incoming->'accepted_bid' is null or incoming->'accepted_bid'='null'::jsonb) then
      raise exception 'De eerste slag begint bij de speler links van de deler';
    end if;
  else
    raise exception 'Ongeldige fase na een bod';
  end if;
 elsif reason='play_card' then$new$);
 execute f || ';';
end $patch$;
