-- Standalone, guest-only Klaverjassen. Independent of GEJAST account/game tables.
-- Capabilities are 256-bit client secrets; only SHA-256 hashes are persisted.
create table if not exists public.kalenel_klaverjassen_guest_rooms (
 id uuid primary key default gen_random_uuid(),
 code text not null unique check (code ~ '^[A-HJ-NP-Z2-9]{6}$'),
 host_hash text not null,
 host_name text not null,
 status text not null default 'lobby',
 state jsonb not null default '{}'::jsonb,
 revision bigint not null default 0,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists kalenel_kj_guest_active_idx on public.kalenel_klaverjassen_guest_rooms(status,updated_at desc);
create table if not exists public.kalenel_klaverjassen_guest_seats (
 room_id uuid not null references public.kalenel_klaverjassen_guest_rooms(id) on delete cascade,
 seat smallint not null check (seat between 0 and 3),
 name text not null check (char_length(name) between 1 and 30),
 token_hash text not null,
 primary key(room_id,seat),
 unique(room_id,token_hash)
);
alter table public.kalenel_klaverjassen_guest_rooms enable row level security;
alter table public.kalenel_klaverjassen_guest_seats enable row level security;
revoke all on public.kalenel_klaverjassen_guest_rooms from public, anon, authenticated;
revoke all on public.kalenel_klaverjassen_guest_seats from public, anon, authenticated;

create or replace function public._kalenel_kj_guest_view(
 r public.kalenel_klaverjassen_guest_rooms,
 viewer_seat integer,
 viewer_name text,
 viewer_is_host boolean
) returns jsonb language plpgsql stable set search_path = 'public', 'pg_temp'
as $$
declare
 s jsonb := r.state;
 hands jsonb := coalesce(s->'hands','[[],[],[],[]]'::jsonb);
 recovery jsonb;
 i integer;
 player jsonb;
begin
 for i in 0..3 loop
  player := s->'players'->i;
  if i <> viewer_seat and not (viewer_is_host and coalesce((player->>'is_bot')::boolean,false)) then
   if jsonb_typeof(hands) = 'array' and jsonb_array_length(hands)>i then
    hands := jsonb_set(hands, array[i::text], '[]'::jsonb);
   end if;
  end if;
 end loop;
 s := jsonb_set(s, '{hands}', hands, true);
 recovery := s->'recovery_snapshot';
 if jsonb_typeof(recovery)='object' then
  recovery := jsonb_set(recovery,'{hands}',hands,true);
  s := jsonb_set(s,'{recovery_snapshot}',recovery,true);
 end if;
 return jsonb_build_object(
  'viewer',jsonb_build_object('seat',viewer_seat,'name',viewer_name,'is_host',viewer_is_host),
  'players', coalesce(s->'players','[]'::jsonb),
  'game',jsonb_build_object('id',r.id,'lobby_code',r.code,'status',r.status,
   'state',s,'revision',r.revision,'dealer_index',0,'created_by_player_name',r.host_name)
 );
end $$;
revoke all on function public._kalenel_kj_guest_view(public.kalenel_klaverjassen_guest_rooms,integer,text,boolean) from public,anon,authenticated;

create or replace function public.klaverjassen_guest_v1(
 action_input text,
 room_input text default null,
 token_input text default null,
 name_input text default null,
 payload_input jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path = 'public','pg_temp'
as $$
declare
 r public.kalenel_klaverjassen_guest_rooms%rowtype;
 action_name text := lower(trim(coalesce(action_input,'')));
 room_code text := upper(trim(coalesce(room_input,'')));
 nick text := btrim(coalesce(name_input,''));
 hash text;
 viewer_seat integer;
 viewer_name text;
 host boolean;
 s jsonb;
 incoming jsonb;
 old_players jsonb;
 new_players jsonb;
 old_hands jsonb;
 new_hands jsonb;
 changed jsonb;
 player jsonb;
 reason text;
 proposed jsonb;
 prev_card jsonb;
 played_card jsonb;
 allcards jsonb;
 card_count integer;
 card_distinct integer;
 i integer;
 n integer;
 code_attempt integer;
 new_code text;
 alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
 bytes bytea;
 settings jsonb;
 bot jsonb;
 bot_roster jsonb;
 t integer;
 new_revision bigint;
begin
 if action_name='list' then
  return coalesce((
   select jsonb_agg(jsonb_build_object(
    'id',g.id,'lobby_code',g.code,'status',g.status,
    'created_by_player_name',g.host_name,
    'player_count',jsonb_array_length(coalesce(g.state->'players','[]'::jsonb)),
    'human_count',(select count(*) from jsonb_array_elements(coalesce(g.state->'players','[]'::jsonb)) z where coalesce((z->>'is_bot')::boolean,false)=false),
    'bot_count',(select count(*) from jsonb_array_elements(coalesce(g.state->'players','[]'::jsonb)) z where coalesce((z->>'is_bot')::boolean,false)=true),
    'has_me',exists(select 1 from public.kalenel_klaverjassen_guest_seats p where p.room_id=g.id and p.token_hash=encode(digest(coalesce(token_input,''),'sha256'),'hex')),
    'is_host',g.host_hash=encode(digest(coalesce(token_input,''),'sha256'),'hex')
   ) order by g.updated_at desc)
   from (select * from public.kalenel_klaverjassen_guest_rooms
    where status='lobby' and updated_at>now()-interval '14 days'
    order by updated_at desc limit 30) g
  ),'[]'::jsonb);
 end if;
 if token_input is null or token_input !~ '^[0-9a-f]{64}$' then
  raise exception 'Een geldige private spelerssleutel ontbreekt';
 end if;
 hash := encode(digest(token_input,'sha256'),'hex');
 if action_name='create' then
  if length(nick)<1 or length(nick)>30 then raise exception 'Vul een spelersnaam in (maximaal 30 tekens)'; end if;
  settings := coalesce(payload_input->'settings','{}'::jsonb);
  if coalesce(settings->>'finish_mode','fixed_rounds') not in ('fixed_rounds','first_to_162') then raise exception 'Ongeldige spelmodus'; end if;
  s := jsonb_build_object('phase','lobby','players',jsonb_build_array(jsonb_build_object(
   'seat',0,'name',nick,'team',1,'is_bot',false,'player_type','human')),
   'hands','[[],[],[],[]]'::jsonb,'dealer',0,'totals',jsonb_build_array(0,0),
   'roem_by_team',jsonb_build_array(0,0),'rounds','[]'::jsonb,
   'settings',jsonb_build_object('finish_mode',settings->>'finish_mode'),'action_needed_seat',null);
  bot_roster := coalesce(settings->'bot_roster','[]'::jsonb);
  if jsonb_typeof(bot_roster)<>'array' then raise exception 'Ongeldige botinstellingen'; end if;
  for i in 0..least(2,jsonb_array_length(bot_roster)-1) loop
   bot := bot_roster->i;
   if coalesce(bot->>'bot_difficulty','hard') not in ('easy','hard') then raise exception 'Ongeldige botsterkte'; end if;
   t := jsonb_array_length(s->'players');
   s := jsonb_set(s,'{players}',(s->'players') || jsonb_build_array(jsonb_build_object(
    'seat',t,'name',left(coalesce(nullif(bot->>'name',''),format('Bot %s',t+1)),30),
    'team',case when t%2=0 then 1 else 2 end,
    'is_bot',true,'player_type','bot','bot_difficulty',bot->>'bot_difficulty')));
  end loop;
  for code_attempt in 1..12 loop
   bytes := gen_random_bytes(6);
   new_code := '';
   for i in 0..5 loop
    new_code := new_code || substr(alphabet,(get_byte(bytes,i)%length(alphabet))+1,1);
   end loop;
   exit when not exists(select 1 from public.kalenel_klaverjassen_guest_rooms where code=new_code);
  end loop;
  if exists(select 1 from public.kalenel_klaverjassen_guest_rooms where code=new_code) then raise exception 'Geen vrije roomcode'; end if;
  insert into public.kalenel_klaverjassen_guest_rooms(code,host_hash,host_name,state)
   values(new_code,hash,nick,s) returning * into r;
  insert into public.kalenel_klaverjassen_guest_seats(room_id,seat,name,token_hash)
   values(r.id,0,nick,hash);
  return public._kalenel_kj_guest_view(r,0,nick,true);
 end if;
 if room_code !~ '^[A-HJ-NP-Z2-9]{6}$' then raise exception 'Ongeldige roomcode'; end if;
 select * into r from public.kalenel_klaverjassen_guest_rooms where code=room_code
  for update;
 if not found then raise exception 'Deze tafel bestaat niet'; end if;
 select p.seat,p.name into viewer_seat,viewer_name
 from public.kalenel_klaverjassen_guest_seats p
 where p.room_id=r.id and p.token_hash=hash;
 host := hash=r.host_hash;
 if action_name='join' then
  if viewer_seat is not null then return public._kalenel_kj_guest_view(r,viewer_seat,viewer_name,host); end if;
  if r.status<>'lobby' then raise exception 'Het potje is al begonnen; je kunt alleen met je eigen reconnect-link terug'; end if;
  if length(nick)<1 or length(nick)>30 then raise exception 'Vul een spelersnaam in'; end if;
  if exists (select 1 from public.kalenel_klaverjassen_guest_seats p where p.room_id=r.id and lower(p.name)=lower(nick)) then
   raise exception 'Deze naam is al bezet. Kies een andere naam';
  end if;
  s := r.state;
  n := jsonb_array_length(s->'players');
  if n>=4 then raise exception 'De tafel zit vol'; end if;
  viewer_seat := n;
  player := jsonb_build_object('seat',n,'name',nick,'team',case when n%2=0 then 1 else 2 end,
   'is_bot',false,'player_type','human');
  s := jsonb_set(s,'{players}',(s->'players')||jsonb_build_array(player),true);
  insert into public.kalenel_klaverjassen_guest_seats(room_id,seat,name,token_hash)
   values(r.id,viewer_seat,nick,hash);
  update public.kalenel_klaverjassen_guest_rooms set state=s,revision=revision+1,updated_at=now()
   where id=r.id returning * into r;
  return public._kalenel_kj_guest_view(r,viewer_seat,nick,false);
 end if;
 if viewer_seat is null then raise exception 'Niet aangemeld voor deze tafel. Join eerst met je naam'; end if;
 if action_name='state' then return public._kalenel_kj_guest_view(r,viewer_seat,viewer_name,host); end if;
 if action_name='close' then
  if not host then raise exception 'Alleen de host kan de tafel sluiten'; end if;
  update public.kalenel_klaverjassen_guest_rooms
  set status='closed',state=jsonb_set(state,'{phase}','"closed"'::jsonb),revision=revision+1,updated_at=now()
  where id=r.id;
  return jsonb_build_object('ok',true);
 end if;
 if action_name<>'save' then raise exception 'Onbekende actie'; end if;
 if r.status in ('closed','finished') then raise exception 'Deze tafel is afgesloten'; end if;
 if coalesce((payload_input->>'revision')::bigint,-1)<>r.revision then
  raise exception 'Er is nieuwere spelinformatie. Laad de tafel opnieuw';
 end if;
 incoming := payload_input->'state';
 if jsonb_typeof(incoming)<>'object' or octet_length(incoming::text)>120000 then
  raise exception 'Ongeldig of te groot speldocument';
 end if;
 s := r.state;
 reason := coalesce(incoming->>'last_progress_reason','');
 old_players := coalesce(s->'players','[]'::jsonb);
 new_players := coalesce(incoming->'players','[]'::jsonb);
 if jsonb_typeof(new_players)<>'array' or jsonb_array_length(new_players)>4 then
  raise exception 'Ongeldige stoelen';
 end if;
 if reason='add_bot' then
  if not host or s->>'phase'<>'lobby' or jsonb_array_length(new_players)<>jsonb_array_length(old_players)+1 then
   raise exception 'Alleen de host kan in de lobby een bot toevoegen';
  end if;
  bot := new_players->(jsonb_array_length(new_players)-1);
  if coalesce((bot->>'is_bot')::boolean,false)<>true
    or coalesce(bot->>'bot_difficulty','') not in ('easy','hard') then
   raise exception 'Ongeldige bot';
  end if;
 elsif jsonb_array_length(old_players)<>jsonb_array_length(new_players) then
  raise exception 'De bezetting mag niet wijzigen tijdens het spelen';
 end if;
 for i in 0..jsonb_array_length(old_players)-1 loop
  if coalesce(old_players->i->>'name','')<>coalesce(new_players->i->>'name','') or
   coalesce(old_players->i->>'is_bot','false')<>coalesce(new_players->i->>'is_bot','false') then
   raise exception 'Speleridentiteit of botstatus mag niet wijzigen';
  end if;
 end loop;
 if reason in ('start_round','next_round') then
  if not host or jsonb_array_length(old_players)<>4 or
   (reason='start_round' and s->>'phase'<>'lobby') or
   (reason='next_round' and s->>'phase'<>'roundOver') or incoming->>'phase'<>'bidding' then
   raise exception 'Starten is alleen mogelijk door de host met vier spelers';
  end if;
  if incoming->'totals'<>s->'totals' or incoming->'rounds'<>s->'rounds' then
   raise exception 'Punten en rondehistorie moeten behouden blijven';
  end if;
  allcards := '[]'::jsonb;
  if jsonb_typeof(incoming->'hands')<>'array' or jsonb_array_length(incoming->'hands')<>4 then raise exception 'Ongeldige kaartverdeling'; end if;
  for i in 0..3 loop
   if jsonb_array_length(incoming->'hands'->i)<>8 then raise exception 'Elke speler krijgt acht kaarten'; end if;
   allcards := allcards || (incoming->'hands'->i);
  end loop;
  select count(*),count(distinct c->>'id') into card_count,card_distinct
  from jsonb_array_elements(allcards) c;
  if card_count<>32 or card_distinct<>32 then raise exception 'De kaarten zijn niet uniek'; end if;
  if exists(select 1 from jsonb_array_elements(allcards) c where
    coalesce(c->>'id','')<>coalesce(c->>'suit','')||'-'||coalesce(c->>'rank','') or
    c->>'suit' not in ('hearts','diamonds','spades','clubs') or
    c->>'rank' not in ('A','10','K','Q','J','9','8','7')) then
   raise exception 'Ongeldige kaarten';
  end if;
 elsif reason='place_bid' then
  if s->>'phase'<>'bidding' or (s->>'bidder_turn')::integer<>viewer_seat
    or incoming->'totals'<>s->'totals' then raise exception 'Je bent niet aan de beurt om te bieden'; end if;
 elsif reason='play_card' then
  if s->>'phase'<>'playing' or (s->>'turn')::integer<>viewer_seat or s->'pending_trick'<>'null'::jsonb and s->'pending_trick' is not null then
   raise exception 'Je bent niet aan de beurt om een kaart te spelen';
  end if;
  if jsonb_array_length(coalesce(incoming->'hands'->viewer_seat,'[]'::jsonb)) <>
   jsonb_array_length(coalesce(s->'hands'->viewer_seat,'[]'::jsonb))-1 then
   raise exception 'Je moet precies een kaart afleggen';
  end if;
  if incoming->'totals'<>s->'totals' then raise exception 'Punten mogen niet worden gewijzigd'; end if;
 elsif reason='klop_roem' then
  if s->'pending_trick' is null or s->'pending_trick'='null'::jsonb or
   ((s->'pending_trick'->>'winner')::integer%2)<>(viewer_seat%2) then
   raise exception 'Alleen het winnende team mag roem kloppen';
  end if;
 elsif reason in ('collect_trick','round_over') then
  if s->'pending_trick' is null or s->'pending_trick'='null'::jsonb or
   ((s->'pending_trick'->>'winner')::integer%2)<>(viewer_seat%2) then
   raise exception 'Alleen het winnende team mag de slag ophalen';
  end if;
 elsif reason='bot_turns' then
  if not host or
   (s->>'phase'='bidding' and coalesce((old_players->((s->>'bidder_turn')::integer)->>'is_bot')::boolean,false)<>true)
   and (s->>'phase'<>'playing' or
    coalesce((old_players->(case when s->'pending_trick' is not null and s->'pending_trick'<>'null'::jsonb then (s->'pending_trick'->>'winner')::integer else (s->>'turn')::integer end)->>'is_bot')::boolean,false)<>true) then
   raise exception 'Er is geen bot aan de beurt';
  end if;
 elsif reason='finish_game' then
  if not host and (s->'pending_trick' is null or s->'pending_trick'='null'::jsonb or
     ((s->'pending_trick'->>'winner')::integer%2)<>(viewer_seat%2)) then
   raise exception 'Alleen de host kan het potje afronden';
  end if;
 else
  raise exception 'Onbekende of niet-toegestane spelactie: %',left(reason,50);
 end if;
 -- Never let a client overwrite or even return another human's hidden cards.
 -- The host only controls its own cards and bot hands, never guest hands.
 if reason not in ('start_round','next_round') then
  old_hands := coalesce(s->'hands','[[],[],[],[]]'::jsonb);
  new_hands := coalesce(incoming->'hands','[[],[],[],[]]'::jsonb);
  if jsonb_typeof(new_hands)<>'array' or jsonb_array_length(new_hands)<>4 then
   raise exception 'Ongeldige handindeling';
  end if;
  for i in 0..3 loop
   if i<>viewer_seat and not (host and coalesce((old_players->i->>'is_bot')::boolean,false)) then
    proposed := new_hands->i;
    if proposed<>'[]'::jsonb and proposed<>old_hands->i then
     raise exception 'Handen van andere spelers zijn afgeschermd';
    end if;
    new_hands := jsonb_set(new_hands,array[i::text],coalesce(old_hands->i,'[]'::jsonb),true);
   elsif reason not in ('play_card','bot_turns') and new_hands->i<>old_hands->i then
    raise exception 'Deze actie mag geen kaarten verwijderen';
   end if;
  end loop;
  incoming := jsonb_set(incoming,'{hands}',new_hands,true);
 end if;
 -- A recovery snapshot is never accepted as a separate source of private cards.
 if jsonb_typeof(incoming->'recovery_snapshot')='object' then
  incoming := jsonb_set(incoming,'{recovery_snapshot,hands}',incoming->'hands',true);
 end if;
 if reason='play_card' then
  select c into played_card from jsonb_array_elements(s->'hands'->viewer_seat) c
   where not exists(select 1 from jsonb_array_elements(incoming->'hands'->viewer_seat) n where n->>'id'=c->>'id');
  if played_card is null or
   exists(select 1 from jsonb_array_elements(incoming->'hands'->viewer_seat) n
    where not exists(select 1 from jsonb_array_elements(s->'hands'->viewer_seat) c where c->>'id'=n->>'id')) then
   raise exception 'Ongeldige kaartwisseling';
  end if;
  if not exists(select 1 from jsonb_array_elements(
   case when jsonb_array_length(coalesce(incoming->'trick','[]'::jsonb))>0 then incoming->'trick'
   else coalesce(incoming->'pending_trick'->'cards','[]'::jsonb) end
  ) x where (x->>'player')::integer=viewer_seat and x->'card'->>'id'=played_card->>'id') then
   raise exception 'Gespeelde kaart ontbreekt op tafel';
  end if;
 end if;
 -- Game identity, counters and private room authority always remain server-owned.
 incoming := incoming - 'guest_revision' - 'created_by_player_id';
 new_revision := r.revision+1;
 update public.kalenel_klaverjassen_guest_rooms
 set state=incoming,revision=new_revision,
 status=case when incoming->>'phase'='finished' then 'finished' else 'playing' end,
 updated_at=now()
 where id=r.id returning * into r;
 if reason='add_bot' then
  update public.kalenel_klaverjassen_guest_rooms set status='lobby' where id=r.id returning * into r;
 end if;
 return public._kalenel_kj_guest_view(r,viewer_seat,viewer_name,host);
end $$;
revoke all on function public.klaverjassen_guest_v1(text,text,text,text,jsonb) from public;
grant execute on function public.klaverjassen_guest_v1(text,text,text,text,jsonb) to anon,authenticated;
