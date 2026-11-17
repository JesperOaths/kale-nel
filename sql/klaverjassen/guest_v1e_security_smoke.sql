-- Must be run inside BEGIN / ROLLBACK. It leaves no production rooms or keys.
set local role anon;
do $test$
declare
 host_key text:=repeat('a',64);
 guest_key text:=repeat('b',64);
 moved_key text:=repeat('c',64);
 profile_key text:=repeat('d',64);
 room_code text:='QASEAT2026';
 created jsonb;
 transfer jsonb;
 claim text;
 room_view jsonb;
 stats jsonb;
begin
 created:=public.klaverjassen_guest_v1('create',null,host_key,'Host QA',
  jsonb_build_object('settings',jsonb_build_object('lobby_code',room_code,
   'room_title','QA guest recovery','finish_mode','fixed_rounds')));
 if created->'viewer'->>'name'<>'Host QA' then raise exception 'Guest room creation failed'; end if;
 perform public.klaverjassen_guest_v1('join',room_code,guest_key,'Guest QA');
 transfer:=public.klaverjassen_guest_extra_v1('transfer_start',room_code,guest_key);
 claim:=transfer->>'claim';
 if claim !~ '^[0-9A-F]{32}$' then raise exception 'Insufficient transfer entropy'; end if;
 begin
  perform public.klaverjassen_guest_extra_v1('transfer_claim',room_code,moved_key,
   jsonb_build_object('claim',repeat('0',32)));
  raise exception 'INVALID_TRANSFER_ACCEPTED';
 exception when others then
  if sqlerrm='INVALID_TRANSFER_ACCEPTED' then raise; end if;
 end;
 room_view:=public.klaverjassen_guest_extra_v1('transfer_claim',room_code,moved_key,
  jsonb_build_object('claim',claim));
 if (room_view->'viewer'->>'seat')::int<>1 then raise exception 'Seat transfer failed'; end if;
 begin
  perform public.klaverjassen_guest_v1('state',room_code,guest_key);
  raise exception 'OLD_DEVICE_AUTHORIZED';
 exception when others then
  if sqlerrm='OLD_DEVICE_AUTHORIZED' then raise; end if;
 end;
 begin
  perform public.klaverjassen_guest_extra_v1('transfer_claim',room_code,guest_key,
   jsonb_build_object('claim',claim));
  raise exception 'TRANSFER_REPLAY_ACCEPTED';
 exception when others then
  if sqlerrm='TRANSFER_REPLAY_ACCEPTED' then raise; end if;
 end;
 perform public.klaverjassen_guest_extra_v1('profile_link',room_code,moved_key,
  jsonb_build_object('profile_key',profile_key));
 stats:=public.klaverjassen_guest_extra_v1('profile_stats',room_code,moved_key,
  jsonb_build_object('profile_key',profile_key));
 if jsonb_array_length(stats->'games')<>1 then raise exception 'Profile stats not linked'; end if;
 begin
  perform public.klaverjassen_guest_extra_v1('profile_stats',room_code,moved_key,
   jsonb_build_object('profile_key',repeat('e',64)));
  raise exception 'WRONG_PROFILE_ACCEPTED';
 exception when others then
  if sqlerrm='WRONG_PROFILE_ACCEPTED' then raise; end if;
 end;
 begin
  perform public.klaverjassen_guest_extra_v1('host_handover',room_code,moved_key,
   jsonb_build_object('seat',0));
  raise exception 'NONHOST_HANDOVER';
 exception when others then
  if sqlerrm='NONHOST_HANDOVER' then raise; end if;
 end;
 room_view:=public.klaverjassen_guest_extra_v1('host_handover',room_code,host_key,
  jsonb_build_object('seat',1));
 if coalesce((room_view->'viewer'->>'is_host')::boolean,true) then
  raise exception 'Previous host retained control';
 end if;
 room_view:=public.klaverjassen_guest_v1('state',room_code,moved_key);
 if not coalesce((room_view->'viewer'->>'is_host')::boolean,false) then
   raise exception 'New host not recognized';
 end if;
 begin
  perform public.klaverjassen_guest_extra_v1('host_handover',room_code,host_key,
   jsonb_build_object('seat',1));
  raise exception 'OLD_HOST_HANDOVER';
 exception when others then
  if sqlerrm='OLD_HOST_HANDOVER' then raise; end if;
 end;
 begin
  perform public.klaverjassen_guest_extra_v1('push_subscribe',room_code,moved_key,
   jsonb_build_object('subscription',jsonb_build_object(
    'endpoint','https://evil.example/not-a-push-provider',
    'keys',jsonb_build_object('p256dh',repeat('a',87),'auth',repeat('b',24)))));
  raise exception 'UNTRUSTED_PUSH_HOST';
 exception when others then
  if sqlerrm='UNTRUSTED_PUSH_HOST' then raise; end if;
 end;
 perform public.klaverjassen_guest_extra_v1('push_subscribe',room_code,moved_key,
   jsonb_build_object('subscription',jsonb_build_object(
    'endpoint','https://fcm.googleapis.com/fcm/send/push-test-1234567890abcdefghijklmnopqrstuvwxyz',
    'keys',jsonb_build_object('p256dh',repeat('a',87),'auth',repeat('b',24)))));
 perform public.klaverjassen_guest_extra_v1('push_unsubscribe',room_code,moved_key,
   jsonb_build_object('endpoint',
    'https://fcm.googleapis.com/fcm/send/push-test-1234567890abcdefghijklmnopqrstuvwxyz'));
end $test$;
reset role;
do $deputy$
declare a text:=repeat('1',64);b text:=repeat('2',64);
 code text:='QADEPUTY26'; r jsonb; old timestamptz;
begin
 perform public.klaverjassen_guest_v1('create',null,a,'Host',
   jsonb_build_object('settings',jsonb_build_object('lobby_code',code,
   'finish_mode','fixed_rounds')));
 perform public.klaverjassen_guest_v1('join',code,b,'Backup');
 r:=public.klaverjassen_guest_extra_v1('delegate_set',code,a,jsonb_build_object('seat',1));
 if (r->'game'->>'deputy_seat')::int<>1 then raise exception 'Deputy assignment failed'; end if;
 begin
  perform public.klaverjassen_guest_extra_v1('delegate_takeover',code,b);
  raise exception 'EARLY_DEPUTY_ACCESS';
 exception when others then if sqlerrm='EARLY_DEPUTY_ACCESS' then raise;end if; end;
 -- Only this transactional regression changes the heartbeat.
 update public.kalenel_klaverjassen_guest_rooms
   set host_seen_at=now()-interval '16 minutes' where code='QADEPUTY26';
 r:=public.klaverjassen_guest_extra_v1('delegate_takeover',code,b);
 if not coalesce((r->'viewer'->>'is_host')::boolean,false) then
  raise exception 'Deputy could not take over abandoned room';
 end if;
 begin
  perform public.klaverjassen_guest_extra_v1('host_ping',code,a);
  raise exception 'OLD_HOST_STILL_ACTIVE';
 exception when others then if sqlerrm='OLD_HOST_STILL_ACTIVE' then raise;end if; end;
end $deputy$;
select 'EXTRA_GUEST_SECURE_TRANSFER_HOST_STATS_PUSH_DEPUTY_PASS' as result;