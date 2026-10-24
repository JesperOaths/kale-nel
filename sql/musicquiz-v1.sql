-- Kalenel Tune Rush v1: isolated, no-login quiz tables and atomic game actions.
-- Track audio must be independently licensed. Spotify streams are not permitted for trivia.
create schema if not exists musicquiz;
create table if not exists musicquiz.tracks (
 id uuid primary key default gen_random_uuid(),
 slug text not null unique,
 title text not null,
 artist text not null,
 genre text not null,
 source text not null check (source like 'demo:%' or source like '/music/audio/%'),
 license_note text not null default '',
 cue_ms integer not null default 0 check (cue_ms >= 0),
 title_aliases text[] not null default '{}',
 artist_aliases text[] not null default '{}',
 enabled boolean not null default true,
 constraint musicquiz_audio_license_provenance check (source like 'demo:%' or length(trim(license_note)) >= 20)
);
create table if not exists musicquiz.rooms (
 id uuid primary key default gen_random_uuid(),
 code text not null unique check (code ~ '^[A-HJ-NP-Z2-9]{6}$'),
 host_hash text not null,
 phase text not null default 'lobby' check (phase in ('lobby','paused','playing','holding','answering','solved','finished')),
 genres text[] not null default array['demo'],
 current_track uuid references musicquiz.tracks(id),
 used_tracks uuid[] not null default '{}',
 step integer not null default -1 check (step between -1 and 6),
 round_number integer not null default 0,
 locked_player uuid,
 title_done boolean not null default false,
 artist_done boolean not null default false,
 winner uuid,
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default (now() + interval '8 hours')
);
create table if not exists musicquiz.players (
 id uuid primary key default gen_random_uuid(),
 room_id uuid not null references musicquiz.rooms(id) on delete cascade,
 secret_hash text not null unique,
 name text not null,
 score numeric(7,1) not null default 0,
 blocked_step integer not null default -99,
 joined_at timestamptz not null default now(),
 unique(room_id,name)
);
create index if not exists musicquiz_players_room on musicquiz.players(room_id,score desc);
create index if not exists musicquiz_rooms_expiry on musicquiz.rooms(expires_at);
alter table musicquiz.tracks enable row level security;
alter table musicquiz.rooms enable row level security;
alter table musicquiz.players enable row level security;
revoke all on schema musicquiz from public, anon, authenticated;
revoke all on all tables in schema musicquiz from public, anon, authenticated;
grant usage on schema musicquiz to service_role;
grant select, insert, update, delete on all tables in schema musicquiz to service_role;

create or replace function musicquiz.normalized(s text) returns text
language sql immutable strict set search_path = pg_catalog as $f$
 select regexp_replace(translate(lower(trim(s)),
 'áàâäãåéèêëíìîïóòôöõúùûüñçýÿ',
 'aaaaaaeeeeiiiiooooouuuuncyy'), '[^a-z0-9]+', '', 'g')
$f$;

create or replace function musicquiz.visible_state(p_id uuid,p_hash text) returns jsonb
language plpgsql security invoker set search_path = pg_catalog, musicquiz as $f$
declare r musicquiz.rooms%rowtype; t musicquiz.tracks%rowtype; p musicquiz.players%rowtype;
 host boolean; people jsonb;
begin
 select * into r from musicquiz.rooms where id=p_id;
 if not found then raise exception 'room_not_found'; end if;
 host := (r.host_hash=p_hash);
 if not host then
  select * into p from musicquiz.players where room_id=r.id and secret_hash=p_hash;
  if not found then raise exception 'unauthorized'; end if;
 end if;
 if r.current_track is not null then select * into t from musicquiz.tracks where id=r.current_track; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'name',x.name,'score',x.score)
   order by x.score desc,x.joined_at),'[]'::jsonb) into people
 from musicquiz.players x where x.room_id=r.id;
 return jsonb_build_object(
  'code',r.code,'role',case when host then 'host' else 'player' end,
  'me',case when host then null else p.id end,
  'myBlockedStep',case when host then null else p.blocked_step end,'players',people,
  'phase',r.phase,'genres',to_jsonb(r.genres),'round',r.round_number,
  'step',r.step,'clipMs',case r.step when 0 then 500 when 1 then 1500 when 2 then 3000
    when 3 then 5000 when 4 then 8000 when 5 then 12000 when 6 then 20000 else 0 end,
  'lockedPlayer',r.locked_player,'titleDone',r.title_done,'artistDone',r.artist_done,
  'title',case when r.title_done or r.phase in ('solved','finished') then t.title else null end,
  'artist',case when r.artist_done or r.phase in ('solved','finished') then t.artist else null end,
  'audio',case when host and r.current_track is not null then
      jsonb_build_object('source',t.source,'cueMs',t.cue_ms) else null end,
  'winner',r.winner,'expiresAt',r.expires_at);
end
$f$;

create or replace function public.musicquiz_v1(
 p_action text,p_code text,p_hash text,p_data jsonb default '{}'::jsonb
) returns jsonb language plpgsql security invoker
set search_path = pg_catalog, musicquiz, public as $f$
declare
 r musicquiz.rooms%rowtype; p musicquiz.players%rowtype; t musicquiz.tracks%rowtype;
 is_host boolean; who uuid;
 n text; g text[]; song text; artist text; delta numeric(7,1):=0;
 title_ok boolean; artist_ok boolean; done_title boolean; done_artist boolean;
 picked uuid; result jsonb;
begin
 if p_hash is null or p_hash !~ '^[a-f0-9]{64}$' then raise exception 'invalid_token'; end if;
 if p_code is null or upper(trim(p_code)) !~ '^[A-HJ-NP-Z2-9]{6}$' then raise exception 'invalid_code'; end if;
 if p_action='create' then
  perform pg_advisory_xact_lock(711940092);
  delete from musicquiz.rooms where expires_at < now();
  if (select count(*) from musicquiz.rooms)>=150 then raise exception 'room_capacity_reached'; end if;
  insert into musicquiz.rooms(code,host_hash) values(upper(trim(p_code)),p_hash)
   returning * into r;
  return musicquiz.visible_state(r.id,p_hash);
 end if;

 if p_action='state' then
  select * into r from musicquiz.rooms where code=upper(trim(p_code));
 else
  select * into r from musicquiz.rooms where code=upper(trim(p_code)) for update;
 end if;
 if not found then raise exception 'room_not_found'; end if;
 if r.expires_at < now() then raise exception 'room_expired'; end if;
 is_host := (r.host_hash=p_hash);
 if not is_host then
  select * into p from musicquiz.players where room_id=r.id and secret_hash=p_hash;
  if not found and p_action<>'join' then raise exception 'unauthorized'; end if;
 end if;

 if p_action='join' then
  if r.phase<>'lobby' then raise exception 'game_already_started'; end if;
  n:=left(trim(coalesce(p_data->>'name','')),20);
  if length(n)<1 or n !~ '^[[:alnum:] _.-]+$' then raise exception 'invalid_name'; end if;
  if (select count(*) from musicquiz.players where room_id=r.id)>=24 then raise exception 'room_full'; end if;
  if exists(select 1 from musicquiz.players where room_id=r.id and lower(name)=lower(n)) then
   raise exception 'name_taken';
  end if;
  insert into musicquiz.players(room_id,secret_hash,name) values(r.id,p_hash,n);
 elsif p_action='settings' then
  if not is_host or r.phase<>'lobby' then raise exception 'host_lobby_only'; end if;
  select array_agg(distinct value) into g
   from jsonb_array_elements_text(coalesce(p_data->'genres','[]'::jsonb)) as v(value)
   where value in ('demo','pop','rock','hiphop','electronic','indie','dutch','80s','90s');
  if coalesce(array_length(g,1),0)=0 then raise exception 'select_a_genre'; end if;
  update musicquiz.rooms set genres=g where id=r.id;
 elsif p_action in ('start','next') then
  if not is_host then raise exception 'host_only'; end if;
  if p_action='start' and r.phase<>'lobby' then raise exception 'not_in_lobby'; end if;
  if p_action='next' and r.phase<>'solved' then raise exception 'round_not_solved'; end if;
  if p_action='start' and (select count(*) from musicquiz.players where room_id=r.id)<1 then
   raise exception 'no_players';
  end if;
  select x.id into picked from musicquiz.tracks x
   where x.enabled and x.genre=any(r.genres) and not(x.id=any(r.used_tracks))
   order by random() limit 1;
  if picked is null then
   select x.id into picked from musicquiz.tracks x
    where x.enabled and x.genre=any(r.genres) order by random() limit 1;
   if picked is null then raise exception 'no_licensed_songs_for_genres'; end if;
   r.used_tracks:='{}';
  end if;
  update musicquiz.rooms set current_track=picked,
   used_tracks=array_append(r.used_tracks,picked),
   phase='paused',step=-1,round_number=r.round_number+1,
   locked_player=null,title_done=false,artist_done=false
   where id=r.id;
  update musicquiz.players set blocked_step=-99 where room_id=r.id;
 elsif p_action='play' then
  if not is_host or r.phase<>'paused' or r.locked_player is not null then
   raise exception 'not_ready_for_clip';
  end if;
  if r.step>=6 then raise exception 'all_hints_used'; end if;
  update musicquiz.rooms set step=step+1,phase='playing' where id=r.id;
 elsif p_action='pause' then
  if not is_host then raise exception 'host_only'; end if;
  if r.phase='playing' then update musicquiz.rooms set phase='paused' where id=r.id; end if;
 elsif p_action='resume' then
  if not is_host or r.phase<>'holding' or r.step>=6 then raise exception 'resume_unavailable'; end if;
  update musicquiz.rooms set phase='paused' where id=r.id;
 elsif p_action='buzz' then
  if is_host or r.phase not in ('playing','paused','holding') or r.step<0 then
   raise exception 'buzz_closed';
  end if;
  if p.blocked_step=r.step then raise exception 'already_tried_this_clip'; end if;
  update musicquiz.rooms set phase='answering',locked_player=p.id where id=r.id;
 elsif p_action='answer' then
  if is_host or r.phase<>'answering' or r.locked_player is distinct from p.id then
   raise exception 'not_your_turn';
  end if;
  select * into t from musicquiz.tracks where id=r.current_track;
  song:=left(trim(coalesce(p_data->>'song','')),100);
  artist:=left(trim(coalesce(p_data->>'artist','')),100);
  done_title:=r.title_done; done_artist:=r.artist_done;
  if song<>'' and not done_title then
   title_ok := musicquiz.normalized(song)=musicquiz.normalized(t.title)
     or exists(select 1 from unnest(t.title_aliases) a where musicquiz.normalized(a)=musicquiz.normalized(song));
   delta:=delta+case when title_ok then 0.5 else -0.5 end;
   done_title:=title_ok;
  end if;
  if artist<>'' and not done_artist then
   artist_ok := musicquiz.normalized(artist)=musicquiz.normalized(t.artist)
     or exists(select 1 from unnest(t.artist_aliases) a where musicquiz.normalized(a)=musicquiz.normalized(artist));
   delta:=delta+case when artist_ok then 0.5 else -0.5 end;
   done_artist:=artist_ok;
  end if;
  update musicquiz.players set score=score+delta,blocked_step=r.step where id=p.id
    returning score into delta;
  update musicquiz.rooms set
   title_done=done_title,artist_done=done_artist,locked_player=null,
   phase=case when delta>=20 then 'finished'
        when done_title and done_artist then 'solved' else 'holding' end,
   winner=case when delta>=20 then p.id else winner end where id=r.id;
 elsif p_action='skip' then
  if not is_host or r.phase not in ('paused','playing','holding') or r.step<6 then
   raise exception 'skip_unavailable';
  end if;
  update musicquiz.rooms set phase='solved',title_done=true,artist_done=true,
    locked_player=null where id=r.id;
 elsif p_action<>'state' then
  raise exception 'unknown_action';
 end if;
 return musicquiz.visible_state(r.id,p_hash);
end
$f$;

revoke all on function public.musicquiz_v1(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.musicquiz_v1(text,text,text,jsonb) to service_role;
revoke all on function musicquiz.visible_state(uuid,text) from public,anon,authenticated;
revoke all on function musicquiz.normalized(text) from public,anon,authenticated;
grant execute on function musicquiz.visible_state(uuid,text), musicquiz.normalized(text) to service_role;

-- Demo-only synthesized performances of public-domain melodies.
-- Real tracks require independently verified recording/performance rights.
insert into musicquiz.tracks(slug,title,artist,genre,source,title_aliases,artist_aliases)
values
 ('demo-twinkle','Twinkle Twinkle Little Star','Traditional','demo','demo:twinkle',array['Twinkle Twinkle'],array[]::text[]),
 ('demo-ode','Ode to Joy','Ludwig van Beethoven','demo','demo:ode',array[]::text[],array['Beethoven']),
 ('demo-jacques','Frère Jacques','Traditional','demo','demo:jacques',array['Frere Jacques'],array[]::text[]),
 ('demo-elise','Für Elise','Ludwig van Beethoven','demo','demo:elise',array['Fur Elise'],array['Beethoven']),
 ('demo-greensleeves','Greensleeves','Traditional','demo','demo:greensleeves',array[]::text[],array[]::text[])
on conflict(slug) do nothing;
