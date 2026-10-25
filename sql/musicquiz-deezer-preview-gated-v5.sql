-- Staged Deezer preview *database readiness*, not public playback approval.
-- The gate is false by default; no anonymous or client-side override exists.
create table if not exists musicquiz.deezer_approval(
 id smallint primary key check(id=1),
 approved boolean not null default false,
 authorization_reference text not null default '',
 authorized_at timestamptz,
 check(not approved or (authorized_at is not null and length(authorization_reference)>=12))
);
insert into musicquiz.deezer_approval(id,approved) values(1,false) on conflict(id) do nothing;
alter table musicquiz.deezer_approval enable row level security;
revoke all on musicquiz.deezer_approval from public,anon,authenticated;
grant select,insert,update,delete on musicquiz.deezer_approval to service_role;
create table if not exists musicquiz.deezer_tracks (
 track_id bigint primary key check(track_id>0),
 title text not null check(length(trim(title)) between 1 and 100),
 artist text not null check(length(trim(artist)) between 1 and 100),
 genres text[] not null check(cardinality(genres)>0),
 release_year int not null check(release_year between 1950 and 2100),
 enabled boolean not null default true,
 verified_at timestamptz not null default now()
);
alter table musicquiz.deezer_tracks enable row level security;
revoke all on musicquiz.deezer_tracks from public,anon,authenticated;
grant select,insert,update,delete on musicquiz.deezer_tracks to service_role;
alter table musicquiz.rooms drop constraint if exists rooms_source_mode_check;
alter table musicquiz.rooms add constraint rooms_source_mode_check check(source_mode in ('demo','youtube','catalog','deezer'));
alter table musicquiz.rooms add column if not exists deezer_track_id bigint;
alter table musicquiz.rooms add column if not exists deezer_title text;
alter table musicquiz.rooms add column if not exists deezer_artist text;
alter table musicquiz.rooms add column if not exists deezer_cue_ms int not null default 0 check(deezer_cue_ms between 0 and 9000);
alter table musicquiz.rooms add column if not exists used_deezer_ids bigint[] not null default '{}'::bigint[];
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
  'phase',r.phase,'mode',r.source_mode,'genres',to_jsonb(r.genres),'decades',to_jsonb(r.decades),'round',r.round_number,
  'step',r.step,'firstAnswered',r.first_answered,'stealTurn',r.is_steal,'clipMs',case r.step when 0 then 500 when 1 then 1500 when 2 then 3000
    when 3 then 5000 when 4 then 8000 when 5 then 12000 when 6 then 20000 else 0 end,
  'lockedPlayer',r.locked_player,'answerExpiresAt',r.answer_until,'titleDone',r.title_done,'artistDone',r.artist_done,
  'title',case when r.title_done or r.phase in ('solved','finished') then case when r.source_mode='deezer' then r.deezer_title when r.source_mode in ('youtube','catalog') then r.youtube_title else t.title end else null end,
  'artist',case when r.artist_done or r.phase in ('solved','finished') then case when r.source_mode='deezer' then r.deezer_artist when r.source_mode in ('youtube','catalog') then r.youtube_artist else t.artist end else null end,
  'audio',case when not host then null
      when r.source_mode='deezer' and r.deezer_track_id is not null then
       jsonb_build_object('source','deezer:'||r.deezer_track_id,'cueMs',r.deezer_cue_ms)
      when r.source_mode in ('youtube','catalog') and r.youtube_video_id is not null then
       jsonb_build_object('source','youtube:'||r.youtube_video_id,'cueMs',r.youtube_cue_ms)
      when r.current_track is not null then jsonb_build_object('source',t.source,'cueMs',t.cue_ms)
      else null end,
  'winner',r.winner,'expiresAt',r.expires_at);
end
$f$;


create or replace function public.musicquiz_v1(
 p_action text,p_code text,p_hash text,p_data jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer
set search_path = pg_catalog, musicquiz as $f$
declare
 r musicquiz.rooms%rowtype; p musicquiz.players%rowtype; t musicquiz.tracks%rowtype;
 is_host boolean; who uuid;
 n text; g text[]; song text; artist text; delta numeric(7,1):=0;
 title_ok boolean; artist_ok boolean; done_title boolean; done_artist boolean;
 picked uuid; result jsonb;
 desired_mode text; video_id text; cue integer; selected musicquiz.video_pool%rowtype; dz musicquiz.deezer_tracks%rowtype; d text[]; duration_ms integer; low_ms integer; high_ms integer;
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
   where value in ('demo','pop','rock','hiphop','electronic','indie','dutch','disco','rnb','metal','dance');
  if coalesce(array_length(g,1),0)=0 then raise exception 'select_a_genre'; end if;
  select coalesce(array_agg(distinct value),'{}'::text[]) into d
   from jsonb_array_elements_text(coalesce(p_data->'decades','[]'::jsonb)) as v(value)
   where value in ('1960','1970','1980','1990','2000','2010','2020');
  update musicquiz.rooms set genres=g,decades=d where id=r.id;
 elsif p_action in ('start','next') then
  if not is_host then raise exception 'host_only'; end if;
  if p_action='start' and r.phase<>'lobby' then raise exception 'not_in_lobby'; end if;
  if p_action='next' and r.phase<>'solved' then raise exception 'round_not_solved'; end if;
  if p_action='start' and (select count(*) from musicquiz.players where room_id=r.id)<1 then
   raise exception 'no_players';
  end if;
  desired_mode:=case when p_action='start' then coalesce(p_data->>'mode','demo') else r.source_mode end;
  if desired_mode not in ('demo','youtube','catalog','deezer') then raise exception 'invalid_music_source'; end if;
  if desired_mode='deezer' then
   if not exists (select 1 from musicquiz.deezer_approval where id=1 and approved and authorized_at is not null and length(authorization_reference)>=12)
    then raise exception 'deezer_not_authorized';end if;
   select z.* into dz from musicquiz.deezer_tracks z
   where z.enabled and z.genres && r.genres
    and (cardinality(r.decades)=0 or ((z.release_year/10)*10)::text=any(r.decades))
    and not (z.track_id=any(r.used_deezer_ids))
   order by random() limit 1;
   if not found then
    select z.* into dz from musicquiz.deezer_tracks z
    where z.enabled and z.genres && r.genres
     and (cardinality(r.decades)=0 or ((z.release_year/10)*10)::text=any(r.decades))
    order by random() limit 1;
    if not found then raise exception 'no_deezer_preview_for_filters'; end if;
    r.used_deezer_ids:='{}';
   end if;
   update musicquiz.rooms set current_track=null,source_mode='deezer',
    deezer_track_id=dz.track_id,deezer_title=dz.title,deezer_artist=dz.artist,
    deezer_cue_ms=floor(random()*9000)::integer,
    used_deezer_ids=array_append(r.used_deezer_ids,dz.track_id),
    youtube_video_id=null,youtube_title=null,youtube_artist=null,youtube_cue_ms=0,
    phase='paused',step=-1,round_number=r.round_number+1,
    locked_player=null,answer_until=null,first_answered=false,is_steal=false,title_done=false,artist_done=false
   where id=r.id;
  elsif desired_mode='catalog' then
   select y.* into selected from musicquiz.video_pool y
   where y.enabled and (y.origin='curated' or y.checked_at>=now()-interval '29 days') and y.genres && r.genres
    and (cardinality(r.decades)=0 or ((y.release_year / 10)*10)::text=any(r.decades))
    and not(y.video_id=any(r.used_youtube_ids))
   order by random() limit 1;
   if not found then
    select y.* into selected from musicquiz.video_pool y
    where y.enabled and (y.origin='curated' or y.checked_at>=now()-interval '29 days') and y.genres && r.genres
     and (cardinality(r.decades)=0 or ((y.release_year / 10)*10)::text=any(r.decades))
    order by random() limit 1;
    if not found then raise exception 'no_videos_for_filters'; end if;
    r.used_youtube_ids:='{}';
   end if;
   update musicquiz.rooms set current_track=null,source_mode='catalog',
    youtube_video_id=selected.video_id,youtube_title=selected.title,youtube_artist=selected.artist,
    youtube_cue_ms=0,used_youtube_ids=array_append(r.used_youtube_ids,selected.video_id),
    phase='paused',step=-1,round_number=r.round_number+1,
    locked_player=null,answer_until=null,first_answered=false,is_steal=false,title_done=false,artist_done=false
    where id=r.id;
  elsif desired_mode='youtube' then
   video_id:=trim(coalesce(p_data->>'videoId',''));
   song:=left(trim(coalesce(p_data->>'song','')),100);
   artist:=left(trim(coalesce(p_data->>'artist','')),100);
   if video_id !~ '^[A-Za-z0-9_-]{11}$' then raise exception 'invalid_youtube_video'; end if;
   if length(song)<1 or length(artist)<1 then raise exception 'provide_song_and_artist'; end if;
   if coalesce(p_data->>'cueMs','') !~ '^[0-9]{1,6}$' then raise exception 'invalid_cue'; end if;
   cue:=(p_data->>'cueMs')::integer;
   if cue>600000 then raise exception 'invalid_cue'; end if;
   update musicquiz.rooms set current_track=null,source_mode='youtube',
    youtube_video_id=video_id,youtube_title=song,youtube_artist=artist,youtube_cue_ms=cue,
    phase='paused',step=-1,round_number=r.round_number+1,
    locked_player=null,answer_until=null,first_answered=false,is_steal=false,title_done=false,artist_done=false
    where id=r.id;
  else
   select x.id into picked from musicquiz.tracks x
    where x.enabled and x.genre=any(r.genres) and not(x.id=any(r.used_tracks))
    order by random() limit 1;
   if picked is null then
    select x.id into picked from musicquiz.tracks x
     where x.enabled and x.genre=any(r.genres) order by random() limit 1;
    if picked is null then raise exception 'no_licensed_songs_for_genres'; end if;
    r.used_tracks:='{}';
   end if;
   update musicquiz.rooms set current_track=picked,source_mode='demo',
    youtube_video_id=null,youtube_title=null,youtube_artist=null,youtube_cue_ms=0,
    used_tracks=array_append(r.used_tracks,picked),
    phase='paused',step=-1,round_number=r.round_number+1,
    locked_player=null,answer_until=null,first_answered=false,is_steal=false,title_done=false,artist_done=false
    where id=r.id;
  end if;
  update musicquiz.players set blocked_step=-99 where room_id=r.id;
 elsif p_action='random_cue' then
  if not is_host or r.source_mode not in ('catalog','youtube')
   or r.phase<>'paused' or r.step<>-1 then raise exception 'cue_not_available'; end if;
  if coalesce(p_data->>'durationMs','') !~ '^[0-9]{5,8}$' then raise exception 'invalid_video_duration'; end if;
  duration_ms:=(p_data->>'durationMs')::integer;
  if duration_ms<45000 or duration_ms>7200000 then raise exception 'invalid_video_duration'; end if;
  low_ms:=greatest(10000,least(60000,(duration_ms*0.15)::integer));
  high_ms:=duration_ms-21000;
  if high_ms<=low_ms then raise exception 'video_too_short_for_clues'; end if;
  cue:=low_ms+floor(random()*(high_ms-low_ms))::integer;
  update musicquiz.rooms set youtube_cue_ms=cue where id=r.id;
 elsif p_action='play' then
  if not is_host or r.phase<>'paused' or r.locked_player is not null then
   raise exception 'not_ready_for_clip';
  end if;
  if r.step>=6 then raise exception 'all_hints_used'; end if;
  update musicquiz.rooms set step=step+1,phase='playing',first_answered=false,is_steal=false where id=r.id;
 elsif p_action='replay' then
  if not is_host or r.phase not in ('paused','playing') or r.locked_player is not null
   or r.first_answered or r.step<0 or r.step>6 then raise exception 'replay_unavailable'; end if;
  if coalesce(p_data->>'expectedRound','') !~ '^[0-9]{1,9}$'
   or coalesce(p_data->>'expectedStep','') !~ '^[0-6]$' then raise exception 'stale_clue'; end if;
  if (p_data->>'expectedRound')::integer<>r.round_number
   or (p_data->>'expectedStep')::integer<>r.step then raise exception 'stale_clue'; end if;
  -- Idempotent recovery: keep the cue, hint length, scores and attempted-player locks.
  update musicquiz.rooms set phase='playing' where id=r.id;
 elsif p_action='pause' then
  if not is_host then raise exception 'host_only'; end if;
  if r.phase='playing' then update musicquiz.rooms set phase='paused' where id=r.id; end if;
 elsif p_action='resume' then
  if not is_host or r.phase<>'holding' or r.step>=6 then raise exception 'resume_unavailable'; end if;
  update musicquiz.rooms set phase='paused' where id=r.id;
 elsif p_action='buzz' then
  if is_host or r.phase not in ('playing','paused') or r.step<0 or r.first_answered then
   raise exception 'buzz_closed';
  end if;
  if p.blocked_step=r.step then raise exception 'already_tried_this_clip'; end if;
  update musicquiz.rooms set phase='answering',locked_player=p.id,is_steal=false,answer_until=now()+interval '25 seconds' where id=r.id;
 elsif p_action='steal' then
  if is_host or r.phase<>'holding' or not r.first_answered then raise exception 'steal_closed'; end if;
  if p.blocked_step=r.step then raise exception 'already_tried_this_clip'; end if;
  update musicquiz.rooms set phase='answering',locked_player=p.id,is_steal=true,answer_until=now()+interval '25 seconds' where id=r.id;
 elsif p_action='expire' then
  if r.phase<>'answering' or r.answer_until is null or now()<r.answer_until then
   raise exception 'answer_still_open';
  end if;
  update musicquiz.players set blocked_step=r.step where id=r.locked_player;
  update musicquiz.rooms set phase='holding',locked_player=null,
    first_answered=true,is_steal=false,answer_until=null where id=r.id;
 elsif p_action='forfeit' then
  if is_host or r.phase<>'answering' or r.locked_player is distinct from p.id then
   raise exception 'not_your_turn';
  end if;
  update musicquiz.players set blocked_step=r.step where id=p.id;
  update musicquiz.rooms set phase='holding',locked_player=null,
    first_answered=true,is_steal=false,answer_until=null where id=r.id;
 elsif p_action='answer' then
  if r.answer_until is not null and now()>r.answer_until then raise exception 'answer_time_expired'; end if;
  if is_host or r.phase<>'answering' or r.locked_player is distinct from p.id then
   raise exception 'not_your_turn';
  end if;
  select * into t from musicquiz.tracks where id=r.current_track;
  song:=left(trim(coalesce(p_data->>'song','')),100);
  artist:=left(trim(coalesce(p_data->>'artist','')),100);
  done_title:=r.title_done; done_artist:=r.artist_done;
  if r.is_steal and ((not done_title and song='') or (not done_artist and artist='')) then
    raise exception 'steal_requires_remaining_answers';
  end if;
  if song<>'' and not done_title then
   title_ok := musicquiz.accepted_guess(song,
    case when r.source_mode='deezer' then r.deezer_title when r.source_mode in ('youtube','catalog') then r.youtube_title else t.title end,
    case when r.source_mode in ('youtube','catalog','deezer') then '{}'::text[] else t.title_aliases end);
   delta:=delta+case when title_ok then 0.5 when r.is_steal then -1 else -0.5 end;
   done_title:=title_ok;
  end if;
  if artist<>'' and not done_artist then
   artist_ok := musicquiz.accepted_guess(artist,
    case when r.source_mode='deezer' then r.deezer_artist when r.source_mode in ('youtube','catalog') then r.youtube_artist else t.artist end,
    case when r.source_mode in ('youtube','catalog','deezer') then '{}'::text[] else t.artist_aliases end);
   delta:=delta+case when artist_ok then 0.5 when r.is_steal then -1 else -0.5 end;
   done_artist:=artist_ok;
  end if;
  update musicquiz.players set score=greatest(0,score+delta),blocked_step=r.step where id=p.id
    returning score into delta;
  update musicquiz.rooms set
   title_done=done_title,artist_done=done_artist,locked_player=null,answer_until=null,
   first_answered=true,is_steal=false,
   phase=case when delta>=20 then 'finished'
        when done_title and done_artist then 'solved' else 'holding' end,
   winner=case when delta>=20 then p.id else winner end where id=r.id;
 elsif p_action='skip' then
  if not is_host or r.phase not in ('paused','playing','holding') or (r.step<6 and r.source_mode='demo') then
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


revoke all on function public.musicquiz_v1(text,text,text,jsonb) from public,authenticated;
grant execute on function public.musicquiz_v1(text,text,text,jsonb) to anon,service_role;
revoke all on function musicquiz.visible_state(uuid,text) from public,anon,authenticated;
grant execute on function musicquiz.visible_state(uuid,text) to service_role;
