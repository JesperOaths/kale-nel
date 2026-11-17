-- Rollback-only regression for clockwise turns and Amsterdam card restrictions.
-- Run inside BEGIN / ROLLBACK. No production game state is changed.
do $test$
declare
  host_key text:=repeat('a',64);
  guest1 text:=repeat('b',64);
  guest2 text:=repeat('c',64);
  guest3 text:=repeat('d',64);
  code_room text:='QAFIXTURN26';
  trick_cards jsonb;
  hand_cards jsonb;
  hearts_a jsonb:='{"suit":"hearts","rank":"A","id":"hearts-A"}';
  hearts_7 jsonb:='{"suit":"hearts","rank":"7","id":"hearts-7"}';
  hearts_8 jsonb:='{"suit":"hearts","rank":"8","id":"hearts-8"}';
  hearts_k jsonb:='{"suit":"hearts","rank":"K","id":"hearts-K"}';
  diamonds_j jsonb:='{"suit":"diamonds","rank":"J","id":"diamonds-J"}';
  diamonds_9 jsonb:='{"suit":"diamonds","rank":"9","id":"diamonds-9"}';
  diamonds_7 jsonb:='{"suit":"diamonds","rank":"7","id":"diamonds-7"}';
  spades_a jsonb:='{"suit":"spades","rank":"A","id":"spades-A"}';
  bid jsonb:='{"action":"bid","mode":"suit","suit":"diamonds","points":90,"team":1,"player":0}';
  old_state jsonb;
  new_state jsonb;
  remote jsonb;
  room_revision bigint;
begin
  hand_cards:=jsonb_build_array(hearts_8,diamonds_j,spades_a);
  trick_cards:=jsonb_build_array(jsonb_build_object('player',1,'card',hearts_a));
  if not public._kalenel_kj_guest_legal_card(hand_cards,trick_cards,2,'diamonds',hearts_8)
     or public._kalenel_kj_guest_legal_card(hand_cards,trick_cards,2,'diamonds',diamonds_j) then
    raise exception 'Follow suit / avoid renouncing failed';
  end if;
  hand_cards:=jsonb_build_array(spades_a,diamonds_7);
  if not public._kalenel_kj_guest_legal_card(hand_cards,trick_cards,2,'diamonds',diamonds_7)
     or public._kalenel_kj_guest_legal_card(hand_cards,trick_cards,2,'diamonds',spades_a) then
    raise exception 'Must trump when opponent leads failed';
  end if;
  trick_cards:=jsonb_build_array(jsonb_build_object('player',0,'card',hearts_a));
  if not public._kalenel_kj_guest_legal_card(hand_cards,trick_cards,2,'diamonds',spades_a) then
    raise exception 'Winning partner should allow discard in Amsterdam rules';
  end if;
  trick_cards:=jsonb_build_array(jsonb_build_object('player',1,'card',diamonds_9));
  hand_cards:=jsonb_build_array(diamonds_j,diamonds_7,spades_a);
  if not public._kalenel_kj_guest_legal_card(hand_cards,trick_cards,2,'diamonds',diamonds_j)
     or public._kalenel_kj_guest_legal_card(hand_cards,trick_cards,2,'diamonds',diamonds_7)
     or public._kalenel_kj_guest_legal_card(hand_cards,trick_cards,2,'diamonds',spades_a) then
    raise exception 'Forced overtrumping of led trump failed';
  end if;
  trick_cards:=jsonb_build_array(jsonb_build_object('player',1,'card',hearts_a),
      jsonb_build_object('player',3,'card',diamonds_j));
  hand_cards:=jsonb_build_array(diamonds_7,spades_a);
  if not public._kalenel_kj_guest_legal_card(hand_cards,trick_cards,2,'diamonds',spades_a)
     or public._kalenel_kj_guest_legal_card(hand_cards,trick_cards,2,'diamonds',diamonds_7) then
    raise exception 'Do not undertrump when you can discard';
  end if;
  if not public._kalenel_kj_guest_legal_card(jsonb_build_array(diamonds_7),trick_cards,2,'diamonds',diamonds_7) then
    raise exception 'Forced undertrump with only trumps must be allowed';
  end if;
  trick_cards:=jsonb_build_array(jsonb_build_object('player',0,'card',diamonds_9),
    jsonb_build_object('player',1,'card',diamonds_j));
  if public._kalenel_kj_guest_winner(trick_cards,'diamonds')<>1 then
    raise exception 'Trump Jack must win over trump Nine';
  end if;

  remote:=public.klaverjassen_guest_v1('create',null,host_key,'QA Host',
    jsonb_build_object('settings',jsonb_build_object('lobby_code',code_room,'finish_mode','fixed_rounds')));
  perform public.klaverjassen_guest_v1('join',code_room,guest1,'QA Guest 1');
  perform public.klaverjassen_guest_v1('join',code_room,guest2,'QA Guest 2');
  perform public.klaverjassen_guest_v1('join',code_room,guest3,'QA Guest 3');
  select state,revision into old_state,room_revision
    from public.kalenel_klaverjassen_guest_rooms where code=code_room;
  old_state:=old_state||jsonb_build_object(
    'phase','playing','dealer',3,'turn',0,'action_needed_seat',0,
    'hands',jsonb_build_array(jsonb_build_array(hearts_a,hearts_8),
      jsonb_build_array(hearts_7,diamonds_7),
      jsonb_build_array(hearts_k,spades_a),
      jsonb_build_array(diamonds_j,diamonds_9)),
    'accepted_bid',bid,'current_bid',bid,'trick','[]'::jsonb,
    'plays','[]'::jsonb,'pending_trick',null,'taken','[]'::jsonb);
  update public.kalenel_klaverjassen_guest_rooms
    set state=old_state,status='playing' where code=code_room;
  new_state:=jsonb_set(old_state,'{hands,0}',jsonb_build_array(hearts_8),true);
  new_state:=jsonb_set(new_state,'{trick}',jsonb_build_array(
    jsonb_build_object('player',0,'card',hearts_a)),true);
  new_state:=jsonb_set(new_state,'{plays}',jsonb_build_array(
    jsonb_build_object('trick_no',1,'player',0,'card',hearts_a)),true);
  new_state:=new_state||jsonb_build_object('turn',1,'action_needed_seat',1,
    'last_progress_reason','play_card');
  begin
    perform public.klaverjassen_guest_v1('save',code_room,host_key,null,
     jsonb_build_object('revision',room_revision,'state',
       new_state||jsonb_build_object('turn',2,'action_needed_seat',2)));
    raise exception 'OUT_OF_ORDER_ACCEPTED';
  exception when others then
    if sqlerrm='OUT_OF_ORDER_ACCEPTED' then raise; end if;
  end;
  remote:=public.klaverjassen_guest_v1('save',code_room,host_key,null,
   jsonb_build_object('revision',room_revision,'state',new_state));
  if (remote->'game'->'state'->>'turn')::integer<>1 then
    raise exception 'Turn did not advance clockwise to seat one';
  end if;
  select state,revision into old_state,room_revision
   from public.kalenel_klaverjassen_guest_rooms where code=code_room;
  new_state:=jsonb_set(old_state,'{hands,1}',jsonb_build_array(diamonds_7),true);
  new_state:=jsonb_set(new_state,'{trick}',old_state->'trick'||
      jsonb_build_array(jsonb_build_object('player',1,'card',hearts_7)),true);
  new_state:=jsonb_set(new_state,'{plays}',old_state->'plays'||
      jsonb_build_array(jsonb_build_object('trick_no',1,'player',1,'card',hearts_7)),true);
  new_state:=new_state||jsonb_build_object('turn',2,'action_needed_seat',2,
    'last_progress_reason','play_card');
  remote:=public.klaverjassen_guest_v1('save',code_room,guest1,null,
    jsonb_build_object('revision',room_revision,'state',new_state));
  if (remote->'game'->'state'->>'turn')::integer<>2 then
    raise exception 'Clockwise turn from seat one to seat two failed';
  end if;
  -- The third player must also follow hearts, not trump with diamonds.
  select state,revision into old_state,room_revision
   from public.kalenel_klaverjassen_guest_rooms where code=code_room;
  new_state:=jsonb_set(old_state,'{hands,2}',jsonb_build_array(hearts_k),true);
  new_state:=jsonb_set(new_state,'{trick}',old_state->'trick'||
      jsonb_build_array(jsonb_build_object('player',2,'card',spades_a)),true);
  new_state:=jsonb_set(new_state,'{plays}',old_state->'plays'||
      jsonb_build_array(jsonb_build_object('trick_no',1,'player',2,'card',spades_a)),true);
  new_state:=new_state||jsonb_build_object('turn',3,'action_needed_seat',3,
    'last_progress_reason','play_card');
  begin
    perform public.klaverjassen_guest_v1('save',code_room,guest2,null,
      jsonb_build_object('revision',room_revision,'state',new_state));
    raise exception 'RENONCE_ACCEPTED';
  exception when others then
    if sqlerrm='RENONCE_ACCEPTED' then raise; end if;
  end;
end $test$;
do $bots$
declare
 room_code text:='KJBOTFIX26';
 host_token text:=repeat('e',64);
 h_a jsonb:='{"id":"hearts-A","suit":"hearts","rank":"A"}';
 h_k jsonb:='{"id":"hearts-K","suit":"hearts","rank":"K"}';
 h_9 jsonb:='{"id":"hearts-9","suit":"hearts","rank":"9"}';
 h_7 jsonb:='{"id":"hearts-7","suit":"hearts","rank":"7"}';
 h_8 jsonb:='{"id":"hearts-8","suit":"hearts","rank":"8"}';
 d_7 jsonb:='{"id":"diamonds-7","suit":"diamonds","rank":"7"}';
 bid jsonb:='{"action":"bid","mode":"suit","suit":"diamonds","points":90,"team":1,"player":0}';
 initial_trick jsonb;
 full_trick jsonb;
 old_state jsonb;
 next_state jsonb;
 revision_num bigint;
 remote jsonb;
begin
 remote:=public.klaverjassen_guest_v1('create',null,host_token,'Bot QA Host',
   jsonb_build_object('settings',jsonb_build_object(
     'lobby_code',room_code,'finish_mode','fixed_rounds',
     'bot_roster',jsonb_build_array(
       jsonb_build_object('name','Bot One','bot_difficulty','easy'),
       jsonb_build_object('name','Bot Two','bot_difficulty','easy'),
       jsonb_build_object('name','Bot Three','bot_difficulty','hard')))));
 initial_trick:=jsonb_build_array(jsonb_build_object('player',0,'card',h_a));
 full_trick:=initial_trick||jsonb_build_array(
   jsonb_build_object('player',1,'card',h_7),
   jsonb_build_object('player',2,'card',h_k),
   jsonb_build_object('player',3,'card',h_9));
 select state,revision into old_state,revision_num
 from public.kalenel_klaverjassen_guest_rooms where code=room_code;
 old_state:=old_state||jsonb_build_object(
   'phase','playing','dealer',3,'turn',1,'action_needed_seat',1,
   'hands',jsonb_build_array(jsonb_build_array(h_8),
      jsonb_build_array(h_7,d_7),jsonb_build_array(h_k),jsonb_build_array(h_9)),
   'accepted_bid',bid,'current_bid',bid,'trick',initial_trick,
   'plays',jsonb_build_array(jsonb_build_object('trick_no',1,'player',0,'card',h_a)),
   'pending_trick',null,'taken','[]'::jsonb);
 update public.kalenel_klaverjassen_guest_rooms
    set state=old_state,status='playing' where code=room_code;
 next_state:=jsonb_set(old_state,'{hands}',jsonb_build_array(
   jsonb_build_array(h_8),jsonb_build_array(d_7),'[]'::jsonb,'[]'::jsonb),true);
 next_state:=jsonb_set(next_state,'{plays}',old_state->'plays'||
    jsonb_build_array(
       jsonb_build_object('trick_no',1,'player',1,'card',h_7),
       jsonb_build_object('trick_no',1,'player',2,'card',h_k),
       jsonb_build_object('trick_no',1,'player',3,'card',h_9)),true);
 next_state:=next_state||jsonb_build_object(
   'trick','[]'::jsonb,'pending_trick',jsonb_build_object(
      'winner',0,'cards',full_trick,'roem',jsonb_build_object(
       'points',0,'items','[]'::jsonb),'klopped',false),
   'turn',null,'action_needed_seat',0,'last_progress_reason','bot_turns');
 begin
  perform public.klaverjassen_guest_v1('save',room_code,host_token,null,
    jsonb_build_object('revision',revision_num,
    'state',jsonb_set(next_state,'{plays,1,card}',d_7,true)));
  raise exception 'BOT_RENONCE_ACCEPTED';
 exception when others then if sqlerrm='BOT_RENONCE_ACCEPTED' then raise;end if;end;
 begin
  perform public.klaverjassen_guest_v1('save',room_code,host_token,null,
    jsonb_build_object('revision',revision_num,
    'state',jsonb_set(next_state,'{plays,1,player}','2'::jsonb,true)));
  raise exception 'BOT_OUT_OF_ORDER_ACCEPTED';
 exception when others then if sqlerrm='BOT_OUT_OF_ORDER_ACCEPTED' then raise;end if;end;
 remote:=public.klaverjassen_guest_v1('save',room_code,host_token,null,
   jsonb_build_object('revision',revision_num,'state',next_state));
 if (remote->'game'->'state'->'pending_trick'->>'winner')::integer<>0 then
   raise exception 'Server did not validate four sequential bot/human cards';
 end if;
end $bots$;

select 'KJ_CLOCKWISE_AMSTERDAM_SQL_PASS' as result;