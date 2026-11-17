-- Standalone Klaverjassen guest additions (no scheduled jobs and no legacy-game changes).
-- All cross-device transfers use a one-time 128-bit code. Each claimant rotates their
-- existing 256-bit room bearer token, which immediately revokes the original device.

-- The host may designate a backup. A backup can assume management only after
-- the original host has been inactive for at least 15 minutes.
alter table public.kalenel_klaverjassen_guest_rooms
 add column if not exists host_seen_at timestamptz not null default now();
alter table public.kalenel_klaverjassen_guest_rooms
 add column if not exists deputy_seat smallint;
alter table public.kalenel_klaverjassen_guest_rooms
 drop constraint if exists kj_guest_deputy_seat_check;
alter table public.kalenel_klaverjassen_guest_rooms
 add constraint kj_guest_deputy_seat_check
 check (deputy_seat is null or deputy_seat between 0 and 3);
do $add_view$
declare body text;
begin
 select pg_get_functiondef('public._kalenel_kj_guest_view(public.kalenel_klaverjassen_guest_rooms,integer,text,boolean)'::regprocedure)
 into body;
 if position($fragment$'trick_completed_at',r.trick_completed_at$fragment$ in body)=0 then
   raise exception 'Guest-room view expected field not found';
 end if;
 body:=replace(body,
   $fragment$'trick_completed_at',r.trick_completed_at$fragment$,
   $fragment$'trick_completed_at',r.trick_completed_at,'host_seen_at',r.host_seen_at,'deputy_seat',r.deputy_seat$fragment$);
 execute body;
end $add_view$;

create table if not exists public.kalenel_kj_guest_transfers(
 room_id uuid not null references public.kalenel_klaverjassen_guest_rooms(id) on delete cascade,
 seat smallint not null,
 claim_hash text not null,
 expires_at timestamptz not null,
 created_at timestamptz not null default now(),
 primary key(room_id,seat), unique(claim_hash)
);
alter table public.kalenel_kj_guest_transfers enable row level security;
revoke all on public.kalenel_kj_guest_transfers from public,anon,authenticated;
alter table public.kalenel_klaverjassen_guest_seats
 add column if not exists profile_hash text;
create index if not exists kalenel_kj_seat_profile_idx
 on public.kalenel_klaverjassen_guest_seats(profile_hash) where profile_hash is not null;
create table if not exists public.kalenel_kj_push_subscriptions(
 room_id uuid not null references public.kalenel_klaverjassen_guest_rooms(id) on delete cascade,
 seat smallint not null,
 endpoint text not null,
 p256dh text not null,
 auth text not null,
 updated_at timestamptz not null default now(),
 primary key(room_id,seat,endpoint)
);
alter table public.kalenel_kj_push_subscriptions enable row level security;
revoke all on public.kalenel_kj_push_subscriptions from public,anon,authenticated;
create table if not exists public.kalenel_kj_push_config(
 id integer primary key default 1 check(id=1),
 hook_secret text not null default encode(gen_random_bytes(32),'hex'),
 vapid_public text,
 vapid_private text
);
alter table public.kalenel_kj_push_config enable row level security;
revoke all on public.kalenel_kj_push_config from public,anon,authenticated;
insert into public.kalenel_kj_push_config(id) values(1) on conflict(id) do nothing;

create or replace function public.klaverjassen_guest_extra_v1(
 action_input text, room_input text default null,token_input text default null,
 payload_input jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path=public,pg_temp
as $func$
declare
 room_rec public.kalenel_klaverjassen_guest_rooms%rowtype;
 seat_rec public.kalenel_klaverjassen_guest_seats%rowtype;
 target public.kalenel_klaverjassen_guest_seats%rowtype;
 room_code text := upper(btrim(coalesce(room_input,'')));
 action text := lower(btrim(coalesce(action_input,'')));
 viewer_hash text;
 claim text;
 claim_row public.kalenel_kj_guest_transfers%rowtype;
 target_seat integer;
 identity text;
 results jsonb := '[]'::jsonb;
 other public.kalenel_klaverjassen_guest_rooms%rowtype;
 round_data jsonb;
 endpoint_text text;
 keys jsonb;
begin
 if room_code !~ '^[A-Z0-9]{4,12}$' then
   raise exception 'Ongeldige klaverjas-roomcode';
 end if;
 if token_input is null or token_input !~ '^[0-9a-f]{64}$' then
   raise exception 'Ongeldige spelerssleutel';
 end if;
 viewer_hash:=encode(digest(token_input,'sha256'),'hex');
 select * into room_rec from public.kalenel_klaverjassen_guest_rooms
  where code=room_code for update;
 if not found then raise exception 'Tafel niet gevonden'; end if;
 if room_rec.status in ('playing','lobby') and room_rec.resume_until<now() then
   raise exception 'De tafel is verlopen';
 end if;

 if action='transfer_claim' then
   claim:=upper(btrim(coalesce(payload_input->>'claim','')));
   if claim !~ '^[0-9A-F]{32}$' then raise exception 'Ongeldige overdrachtscode'; end if;
   select * into claim_row from public.kalenel_kj_guest_transfers
    where room_id=room_rec.id and claim_hash=encode(digest(claim,'sha256'),'hex')
    for update;
   if not found or claim_row.expires_at<now() then
     raise exception 'Deze overdrachtslink is ongeldig of verlopen';
   end if;
   select * into seat_rec from public.kalenel_klaverjassen_guest_seats
    where room_id=room_rec.id and seat=claim_row.seat for update;
   if not found then raise exception 'Spelersstoel ontbreekt'; end if;
   if seat_rec.token_hash=viewer_hash then raise exception 'Deze stoel staat al op dit apparaat'; end if;
   if exists(select 1 from public.kalenel_klaverjassen_guest_seats
      where room_id=room_rec.id and token_hash=viewer_hash) then
     raise exception 'Gebruik een nieuwe privésleutel voor de overdracht';
   end if;
   update public.kalenel_klaverjassen_guest_seats
     set token_hash=viewer_hash where room_id=room_rec.id and seat=seat_rec.seat;
   delete from public.kalenel_kj_guest_transfers
    where room_id=room_rec.id and seat=seat_rec.seat;
   delete from public.kalenel_kj_push_subscriptions
    where room_id=room_rec.id and seat=seat_rec.seat;
   update public.kalenel_klaverjassen_guest_rooms
     set host_hash=case when host_hash=seat_rec.token_hash then viewer_hash else host_hash end,
         revision=revision+1
     where id=room_rec.id returning * into room_rec;
   return public._kalenel_kj_guest_view(room_rec,seat_rec.seat,seat_rec.name,
      room_rec.host_hash=viewer_hash);
 end if;

 select * into seat_rec from public.kalenel_klaverjassen_guest_seats
  where room_id=room_rec.id and token_hash=viewer_hash;
 if not found then raise exception 'Je bent niet op deze tafel aangemeld'; end if;
 if action='transfer_start' then
   if room_rec.status not in ('lobby','playing') then
     raise exception 'Alleen een actieve tafel kan worden overgedragen';
   end if;
   claim:=upper(encode(gen_random_bytes(16),'hex'));
   insert into public.kalenel_kj_guest_transfers(room_id,seat,claim_hash,expires_at)
    values(room_rec.id,seat_rec.seat,encode(digest(claim,'sha256'),'hex'),
           now()+interval '10 minutes')
    on conflict(room_id,seat) do update
      set claim_hash=excluded.claim_hash,expires_at=excluded.expires_at,
          created_at=now();
   return jsonb_build_object('claim',claim,'room',room_rec.code,
                             'expires_at',now()+interval '10 minutes');
 elsif action='transfer_cancel' then
   delete from public.kalenel_kj_guest_transfers
    where room_id=room_rec.id and seat=seat_rec.seat;
   return jsonb_build_object('ok',true);
 elsif action='host_ping' then
   if room_rec.host_hash<>viewer_hash then raise exception 'Alleen de host kan aanwezig melden'; end if;
   if room_rec.status in ('lobby','playing') then
     update public.kalenel_klaverjassen_guest_rooms
       set host_seen_at=now() where id=room_rec.id;
   end if;
   return jsonb_build_object('ok',true);
 elsif action='delegate_set' then
   if room_rec.host_hash<>viewer_hash then raise exception 'Alleen de host kan een reservehost benoemen'; end if;
   if room_rec.status not in ('lobby','playing') then raise exception 'Deze tafel is gesloten'; end if;
   if payload_input->>'seat' is null then
     update public.kalenel_klaverjassen_guest_rooms
       set deputy_seat=null,host_seen_at=now(),revision=revision+1 where id=room_rec.id returning * into room_rec;
   else
     if coalesce(payload_input->>'seat','') !~ '^[0-3]$' then
       raise exception 'Kies een geldige reservehost';
     end if;
     target_seat:=(payload_input->>'seat')::integer;
     if target_seat=seat_rec.seat then raise exception 'Een reservehost moet een andere speler zijn'; end if;
     if coalesce((room_rec.state->'players'->target_seat->>'is_bot')::boolean,true) then
       raise exception 'Een bot kan geen reservehost worden';
     end if;
     if not exists(select 1 from public.kalenel_klaverjassen_guest_seats
       where room_id=room_rec.id and seat=target_seat) then raise exception 'Geen menselijke speler op deze stoel'; end if;
     update public.kalenel_klaverjassen_guest_rooms
       set deputy_seat=target_seat,host_seen_at=now(),revision=revision+1
       where id=room_rec.id returning * into room_rec;
   end if;
   return public._kalenel_kj_guest_view(room_rec,seat_rec.seat,seat_rec.name,true);
 elsif action='delegate_takeover' then
   if room_rec.deputy_seat is distinct from seat_rec.seat then
     raise exception 'Je bent geen aangewezen reservehost';
   end if;
   if room_rec.status not in ('lobby','playing') then raise exception 'Deze tafel is gesloten'; end if;
   if room_rec.host_seen_at>now()-interval '15 minutes' then
     raise exception 'De host is nog actief. Overname kan na 15 minuten zonder activiteit';
   end if;
   update public.kalenel_klaverjassen_guest_rooms
    set host_hash=viewer_hash,host_name=seat_rec.name,
        deputy_seat=null,host_seen_at=now(),
        revision=revision+1,updated_at=now(),resume_until=now()+interval '7 days'
     where id=room_rec.id returning * into room_rec;
   return public._kalenel_kj_guest_view(room_rec,seat_rec.seat,seat_rec.name,true);
 elsif action='host_handover' then
   if room_rec.host_hash<>viewer_hash then raise exception 'Alleen de host kan het beheer overdragen'; end if;
   if room_rec.status not in ('lobby','playing') then raise exception 'Deze tafel is afgesloten'; end if;
   if coalesce(payload_input->>'seat','') !~ '^[0-3]$' then raise exception 'Kies een geldige speler'; end if;
   target_seat:=(payload_input->>'seat')::int;
   if target_seat=seat_rec.seat then raise exception 'Je bent al host'; end if;
   if coalesce((room_rec.state->'players'->target_seat->>'is_bot')::boolean,true) then
     raise exception 'Een bot kan geen host worden';
   end if;
   select * into target from public.kalenel_klaverjassen_guest_seats
    where room_id=room_rec.id and seat=target_seat;
   if not found then raise exception 'Deze stoel heeft geen menselijke speler'; end if;
   update public.kalenel_klaverjassen_guest_rooms
    set host_hash=target.token_hash,host_name=target.name,
        deputy_seat=null,host_seen_at=now(),revision=revision+1,updated_at=now(),resume_until=now()+interval '7 days'
    where id=room_rec.id returning * into room_rec;
   return public._kalenel_kj_guest_view(room_rec,seat_rec.seat,seat_rec.name,false);
 elsif action='profile_link' then
   identity:=coalesce(payload_input->>'profile_key','');
   if identity !~ '^[0-9a-f]{64}$' then raise exception 'Ongeldige privé profielcode'; end if;
   update public.kalenel_klaverjassen_guest_seats
    set profile_hash=encode(digest(identity,'sha256'),'hex')
    where room_id=room_rec.id and seat=seat_rec.seat;
   return jsonb_build_object('ok',true);
 elsif action='profile_stats' then
   identity:=coalesce(payload_input->>'profile_key','');
   if identity !~ '^[0-9a-f]{64}$' then raise exception 'Ongeldige privé profielcode'; end if;
   if seat_rec.profile_hash is distinct from encode(digest(identity,'sha256'),'hex') then
     raise exception 'Dit profiel hoort niet bij deze stoel';
   end if;
   for other in
     select g.* from public.kalenel_klaverjassen_guest_rooms g
      join public.kalenel_klaverjassen_guest_seats p on p.room_id=g.id
     where p.profile_hash=seat_rec.profile_hash
     order by g.created_at desc limit 80
   loop
     select p.seat into target_seat from public.kalenel_klaverjassen_guest_seats p
      where p.room_id=other.id and p.profile_hash=seat_rec.profile_hash limit 1;
     select coalesce(jsonb_agg(jsonb_build_object(
       'bid_player',coalesce((x->'bid'->>'player')::int,-1),
       'bid_team',coalesce((x->>'bidder_team')::int,0),
       'nat',coalesce((x->'result'->>'nat')::boolean,false),
       'made',coalesce((x->'result'->>'made')::boolean,false),
       'scores',coalesce(x->'result'->'scores','[0,0]'::jsonb),
       'roem',coalesce(x->'roem_by_team','[0,0]'::jsonb),
       'klops',coalesce(x->'klop_events','[]'::jsonb)
     )),'[]'::jsonb) into round_data
     from jsonb_array_elements(coalesce(other.state->'rounds','[]'::jsonb)) x;
     results:=results||jsonb_build_array(jsonb_build_object(
       'status',other.status,'seat',target_seat,
       'team',case when target_seat%2=0 then 1 else 2 end,
       'finished',other.status='finished',
       'totals',coalesce(other.state->'totals','[0,0]'::jsonb),
       'rounds',round_data
     ));
   end loop;
   return jsonb_build_object('games',results);
 elsif action='push_subscribe' then
   if room_rec.status not in ('lobby','playing') then
     raise exception 'Deze tafel accepteert geen meldingen meer';
   end if;
   endpoint_text:=coalesce(payload_input->'subscription'->>'endpoint','');
   keys:=payload_input->'subscription'->'keys';
   if length(endpoint_text)>1200 or length(endpoint_text)<40 or
      endpoint_text !~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+\.notify\.windows\.com)/' then
      raise exception 'Onbekende push-provider';
   end if;
   if jsonb_typeof(keys)<>'object' or length(coalesce(keys->>'p256dh',''))>250 or
      coalesce(keys->>'p256dh','') !~ '^[A-Za-z0-9_-]{80,120}$' or
      coalesce(keys->>'auth','') !~ '^[A-Za-z0-9_-]{16,40}$' then
      raise exception 'Ongeldige push-sleutels';
   end if;
   insert into public.kalenel_kj_push_subscriptions(room_id,seat,endpoint,p256dh,auth)
    values(room_rec.id,seat_rec.seat,endpoint_text,keys->>'p256dh',keys->>'auth')
    on conflict(room_id,seat,endpoint) do update
     set p256dh=excluded.p256dh,auth=excluded.auth,updated_at=now();
   return jsonb_build_object('ok',true);
 elsif action='push_unsubscribe' then
   endpoint_text:=coalesce(payload_input->>'endpoint','');
   delete from public.kalenel_kj_push_subscriptions
    where room_id=room_rec.id and seat=seat_rec.seat and endpoint=endpoint_text;
   return jsonb_build_object('ok',true);
 end if;
 raise exception 'Onbekende klaverjas-extra actie';
end;
$func$;
revoke all on function public.klaverjassen_guest_extra_v1(text,text,text,jsonb) from public;
grant execute on function public.klaverjassen_guest_extra_v1(text,text,text,jsonb) to anon,authenticated;

-- Hook lives outside public Data API. It runs only on actual gameplay turn
-- transitions, never periodically, and never exposes hidden cards.
create schema if not exists kalenel_internal;
revoke all on schema kalenel_internal from public,anon,authenticated;
create or replace function kalenel_internal.kj_turn_push_hook()
returns trigger language plpgsql security definer
set search_path=public,pg_temp
as $hook$
declare
 target_seat int;
 prior_seat int;
 new_phase text;
 previous_phase text;
 secret_text text;
 recipient jsonb;
begin
 new_phase:=new.state->>'phase';
 previous_phase:=old.state->>'phase';
 if new.status<>'playing' or new_phase not in ('bidding','playing') or
    (new.state->'pending_trick' is not null and new.state->'pending_trick'<>'null'::jsonb) then
   return new;
 end if;
 if new_phase='bidding' then
   target_seat:=nullif(new.state->>'bidder_turn','')::int;
   prior_seat:=nullif(old.state->>'bidder_turn','')::int;
 else
   target_seat:=nullif(new.state->>'turn','')::int;
   prior_seat:=nullif(old.state->>'turn','')::int;
 end if;
 if target_seat is null or target_seat not between 0 and 3 then return new; end if;
 if target_seat is not distinct from prior_seat and previous_phase=new_phase and
   (old.state->'pending_trick') is not distinct from (new.state->'pending_trick') then
   return new;
 end if;
 recipient:=new.state->'players'->target_seat;
 if coalesce((recipient->>'is_bot')::boolean,true) then return new; end if;
 if not exists(select 1 from public.kalenel_kj_push_subscriptions
     where room_id=new.id and seat=target_seat) then return new; end if;
 select hook_secret into secret_text from public.kalenel_kj_push_config where id=1;
 if secret_text is null then return new; end if;
 perform net.http_post(
  url:='https://uiqntazgnrxwliaidkmy.supabase.co/functions/v1/kalenel-kj-turn-push',
  body:=jsonb_build_object('room_id',new.id,'revision',new.revision,
                          'seat',target_seat,'room',new.code,'phase',new_phase),
  headers:=jsonb_build_object('Content-Type','application/json','x-kj-hook-secret',secret_text),
  timeout_milliseconds:=5000);
 return new;
end;
$hook$;
revoke all on function kalenel_internal.kj_turn_push_hook() from public,anon,authenticated;
drop trigger if exists kalenel_kj_turn_push_trigger on public.kalenel_klaverjassen_guest_rooms;
create trigger kalenel_kj_turn_push_trigger after update of state
on public.kalenel_klaverjassen_guest_rooms
for each row execute function kalenel_internal.kj_turn_push_hook();