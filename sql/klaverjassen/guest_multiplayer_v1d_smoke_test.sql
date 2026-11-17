-- Transactional guest-room regression, run after the v1d migration.
-- The outer BEGIN/ROLLBACK deliberately leaves no QA rooms behind.
do $test$
declare
 token_host text:=repeat('a',64);
 token_guest text:=repeat('b',64);
 room_code_local text;
 row_revision bigint;
 r jsonb;
 room_state jsonb;
 completed jsonb;
begin
 r:=public.klaverjassen_guest_v1('create',null,token_host,'QA Host',
   jsonb_build_object('settings',jsonb_build_object(
     'lobby_code','QA7NIGHT99','room_title','Avondje klaverjassen','finish_mode','fixed_rounds')));
 room_code_local:=r->'game'->>'lobby_code';
 if room_code_local<>'QA7NIGHT99' or r->'game'->>'room_title'<>'Avondje klaverjassen'
   or (r->'game'->>'resume_until')::timestamptz < now()+interval '6 days 23 hours' then
   raise exception 'Custom code, title, or retention invalid: %',r->'game';
 end if;
 begin
  perform public.klaverjassen_guest_v1('create',null,token_guest,'QA Duplicate',
   jsonb_build_object('settings',jsonb_build_object(
     'lobby_code',room_code_local,'finish_mode','fixed_rounds')));
  raise exception 'DUPLICATE_ACCEPTED';
 exception when others then
  if sqlerrm='DUPLICATE_ACCEPTED' then raise; end if;
 end;
 begin
  perform public.klaverjassen_guest_v1('create',null,token_guest,'QA BadCode',
   jsonb_build_object('settings',jsonb_build_object(
     'lobby_code','BAD.CODE','finish_mode','fixed_rounds')));
  raise exception 'INVALID_CODE_ACCEPTED';
 exception when others then
  if sqlerrm='INVALID_CODE_ACCEPTED' then raise; end if;
 end;
 r:=public.klaverjassen_guest_v1('join',room_code_local,token_guest,'QA Guest');
 if (r->'viewer'->>'seat')::int<>1 then raise exception 'Guest could not join'; end if;
 select qr.revision,qr.state into row_revision,room_state
 from public.kalenel_klaverjassen_guest_rooms qr where qr.code=room_code_local;
 completed:=jsonb_build_object('winner',1,
   'cards',jsonb_build_array(jsonb_build_object('player',1,'card',jsonb_build_object('id','hearts-A'))),
   'roem',jsonb_build_object('points',20,'items','[]'::jsonb),'klopped',false);
 room_state:=jsonb_set(room_state,'{pending_trick}',completed,true);
 room_state:=jsonb_set(room_state,'{hands}','[[],[],[],[]]'::jsonb,true);
 update public.kalenel_klaverjassen_guest_rooms
 set state=room_state,status='playing',trick_completed_at=now()-interval '2 seconds'
 where code=room_code_local;
 room_state:=jsonb_set(room_state,'{pending_trick}','null'::jsonb,true);
 room_state:=jsonb_set(room_state,'{taken}',jsonb_build_array(completed),true);
 room_state:=room_state||jsonb_build_object('last_progress_reason','auto_collect');
 begin
  perform public.klaverjassen_guest_v1('save',room_code_local,token_host,null,
    jsonb_build_object('revision',row_revision,'state',room_state));
  raise exception 'EARLY_COLLECT_ACCEPTED';
 exception when others then
  if sqlerrm='EARLY_COLLECT_ACCEPTED' then raise; end if;
 end;
 update public.kalenel_klaverjassen_guest_rooms
 set trick_completed_at=now()-interval '6 seconds'
 where code=room_code_local;
 r:=public.klaverjassen_guest_v1('save',room_code_local,token_host,null,
   jsonb_build_object('revision',row_revision,'state',room_state));
 if jsonb_array_length(r->'game'->'state'->'taken')<>1 then
   raise exception 'Automatic trick collection failed';
 end if;
 if (r->'game'->>'resume_until')::timestamptz < now()+interval '6 days 23 hours' then
   raise exception 'Auto collect failed to refresh 7-day retention';
 end if;
 update public.kalenel_klaverjassen_guest_rooms
 set resume_until=now()-interval '1 minute'
 where code=room_code_local;
 begin
  perform public.klaverjassen_guest_v1('state',room_code_local,token_host);
  raise exception 'EXPIRED_ROOM_ACCESS';
 exception when others then
  if sqlerrm='EXPIRED_ROOM_ACCESS' then raise; end if;
 end;
end $test$;