-- Custom 4–12 character guest room codes and friendly titles, 7-day inactivity
-- resume windows and server-timed automatic trick collection.
-- No cron/task creation; expiration is validated on guest RPC access.
alter table public.kalenel_klaverjassen_guest_rooms
 drop constraint if exists kalenel_klaverjassen_guest_rooms_code_check;
alter table public.kalenel_klaverjassen_guest_rooms
 add constraint kalenel_klaverjassen_guest_rooms_code_check
 check (code ~ '^[A-Z0-9]{4,12}$');
alter table public.kalenel_klaverjassen_guest_rooms
 add column if not exists room_title text;
alter table public.kalenel_klaverjassen_guest_rooms
 add column if not exists resume_until timestamptz;
alter table public.kalenel_klaverjassen_guest_rooms
 add column if not exists trick_completed_at timestamptz;
update public.kalenel_klaverjassen_guest_rooms
 set room_title=left(host_name||'''s tafel',50)
 where room_title is null;
update public.kalenel_klaverjassen_guest_rooms
 set resume_until=greatest(now()+interval '7 days', updated_at+interval '7 days')
 where resume_until is null and status in ('playing','lobby');
update public.kalenel_klaverjassen_guest_rooms
 set resume_until=coalesce(resume_until,updated_at+interval '7 days')
 where resume_until is null;
update public.kalenel_klaverjassen_guest_rooms
 set trick_completed_at=coalesce(trick_completed_at,updated_at)
 where state->'pending_trick' is not null and state->'pending_trick'<>'null'::jsonb
   and status='playing';
alter table public.kalenel_klaverjassen_guest_rooms
 alter column room_title set not null;
alter table public.kalenel_klaverjassen_guest_rooms
 alter column resume_until set not null;
alter table public.kalenel_klaverjassen_guest_rooms
 alter column resume_until set default (now()+interval '7 days');

do $patch$
declare fn text; view_fn text;
begin
 select pg_get_functiondef('public._kalenel_kj_guest_view(public.kalenel_klaverjassen_guest_rooms,integer,text,boolean)'::regprocedure)
   into view_fn;
  if position($kj_fragment$'created_by_player_name',r.host_name)$kj_fragment$ in view_fn)=0 then raise exception 'Missing expected SQL patch fragment view_fn #1'; end if;
 view_fn:=replace(view_fn,$kj_fragment$'created_by_player_name',r.host_name)$kj_fragment$,$kj_fragment$'created_by_player_name',r.host_name,'room_title',r.room_title,'resume_until',r.resume_until)$kj_fragment$);
 view_fn:=replace(view_fn, E'\nend $function

 select pg_get_functiondef('public.klaverjassen_guest_v1(text,text,text,text,jsonb)'::regprocedure)
   into fn;
  if position($kj_fragment$    where status='lobby' and updated_at>now()-interval '14 days'$kj_fragment$ in fn)=0 then raise exception 'Missing expected SQL patch fragment fn #1'; end if;
 fn:=replace(fn,$kj_fragment$    where status='lobby' and updated_at>now()-interval '14 days'$kj_fragment$,$kj_fragment$    where resume_until>=now() and (status='lobby' or (status='playing' and exists (select 1 from public.kalenel_klaverjassen_guest_seats mine where mine.room_id=kalenel_klaverjassen_guest_rooms.id and mine.token_hash=encode(digest(coalesce(token_input,''),'sha256'),'hex'))))$kj_fragment$);
 if position($kj_fragment$    'is_host',g.host_hash=encode(digest(coalesce(token_input,''),'sha256'),'hex')$kj_fragment$ in fn)=0 then raise exception 'Missing expected SQL patch fragment fn #2'; end if;
 fn:=replace(fn,$kj_fragment$    'is_host',g.host_hash=encode(digest(coalesce(token_input,''),'sha256'),'hex')$kj_fragment$,$kj_fragment$    'is_host',g.host_hash=encode(digest(coalesce(token_input,''),'sha256'),'hex'),
    'room_title',g.room_title,'resume_until',g.resume_until$kj_fragment$);
 if position($kj_fragment$  for code_attempt in 1..12 loop
   bytes := gen_random_bytes(6);
   new_code := '';
   for i in 0..5 loop
    new_code := new_code || substr(alphabet,(get_byte(bytes,i)%length(alphabet))+1,1);
   end loop;
   exit when not exists(select 1 from public.kalenel_klaverjassen_guest_rooms where code=new_code);
  end loop;
  if exists(select 1 from public.kalenel_klaverjassen_guest_rooms where code=new_code) then raise exception 'Geen vrije roomcode'; end if;
  insert into public.kalenel_klaverjassen_guest_rooms(code,host_hash,host_name,state)
   values(new_code,hash,nick,s) returning * into r;$kj_fragment$ in fn)=0 then raise exception 'Missing expected SQL patch fragment fn #3'; end if;
 fn:=replace(fn,$kj_fragment$  for code_attempt in 1..12 loop
   bytes := gen_random_bytes(6);
   new_code := '';
   for i in 0..5 loop
    new_code := new_code || substr(alphabet,(get_byte(bytes,i)%length(alphabet))+1,1);
   end loop;
   exit when not exists(select 1 from public.kalenel_klaverjassen_guest_rooms where code=new_code);
  end loop;
  if exists(select 1 from public.kalenel_klaverjassen_guest_rooms where code=new_code) then raise exception 'Geen vrije roomcode'; end if;
  insert into public.kalenel_klaverjassen_guest_rooms(code,host_hash,host_name,state)
   values(new_code,hash,nick,s) returning * into r;$kj_fragment$,$kj_fragment$  new_code := upper(btrim(coalesce(settings->>'lobby_code','')));
  if new_code<>'' then
   if new_code !~ '^[A-Z0-9]{4,12}$' then
    raise exception 'Je eigen roomcode moet 4 t/m 12 letters of cijfers bevatten';
   end if;
  else
   for code_attempt in 1..12 loop
    bytes := gen_random_bytes(6);
    new_code := '';
    for i in 0..5 loop
     new_code := new_code || substr(alphabet,(get_byte(bytes,i)%length(alphabet))+1,1);
    end loop;
    exit when not exists(select 1 from public.kalenel_klaverjassen_guest_rooms where code=new_code);
   end loop;
  end if;
  if exists(select 1 from public.kalenel_klaverjassen_guest_rooms where code=new_code) then
    raise exception 'Deze roomcode is al in gebruik. Kies een andere naam.';
  end if;
  insert into public.kalenel_klaverjassen_guest_rooms(code,host_hash,host_name,state,room_title,resume_until)
   values(new_code,hash,nick,s,
     coalesce(nullif(left(btrim(coalesce(settings->>'room_title','')),50),''),left(nick||'''s tafel',50)),
     now()+interval '7 days') returning * into r;$kj_fragment$);
 if position($kj_fragment$if room_code !~ '^[A-HJ-NP-Z2-9]{6}$' then$kj_fragment$ in fn)=0 then raise exception 'Missing expected SQL patch fragment fn #4'; end if;
 fn:=replace(fn,$kj_fragment$if room_code !~ '^[A-HJ-NP-Z2-9]{6}$' then$kj_fragment$,$kj_fragment$if room_code !~ '^[A-Z0-9]{4,12}$' then$kj_fragment$);
 if position($kj_fragment$ if not found then raise exception 'Deze tafel bestaat niet'; end if;
 select p.seat,p.name$kj_fragment$ in fn)=0 then raise exception 'Missing expected SQL patch fragment fn #5'; end if;
 fn:=replace(fn,$kj_fragment$ if not found then raise exception 'Deze tafel bestaat niet'; end if;
 select p.seat,p.name$kj_fragment$,$kj_fragment$ if not found then raise exception 'Deze tafel bestaat niet'; end if;
 if r.status in ('lobby','playing') and now()>r.resume_until then
  raise exception 'Deze tafel is na zeven dagen zonder zetten verlopen';
 end if;
 select p.seat,p.name$kj_fragment$);
 if position($kj_fragment$update public.kalenel_klaverjassen_guest_rooms set state=s,revision=revision+1,updated_at=now()$kj_fragment$ in fn)=0 then raise exception 'Missing expected SQL patch fragment fn #6'; end if;
 fn:=replace(fn,$kj_fragment$update public.kalenel_klaverjassen_guest_rooms set state=s,revision=revision+1,updated_at=now()$kj_fragment$,$kj_fragment$update public.kalenel_klaverjassen_guest_rooms set state=s,revision=revision+1,updated_at=now(),resume_until=now()+interval '7 days'$kj_fragment$);
 if position($kj_fragment$ elsif reason in ('collect_trick','round_over') then
  if s->'pending_trick' is null or s->'pending_trick'='null'::jsonb or
   ((s->'pending_trick'->>'winner')::integer%2)<>(viewer_seat%2) then
   raise exception 'Alleen het winnende team mag de slag ophalen';
  end if;$kj_fragment$ in fn)=0 then raise exception 'Missing expected SQL patch fragment fn #7'; end if;
 fn:=replace(fn,$kj_fragment$ elsif reason in ('collect_trick','round_over') then
  if s->'pending_trick' is null or s->'pending_trick'='null'::jsonb or
   ((s->'pending_trick'->>'winner')::integer%2)<>(viewer_seat%2) then
   raise exception 'Alleen het winnende team mag de slag ophalen';
  end if;$kj_fragment$,$kj_fragment$ elsif reason in ('collect_trick','round_over','auto_collect') then
  if s->'pending_trick' is null or s->'pending_trick'='null'::jsonb or
   (not host and ((s->'pending_trick'->>'winner')::integer%2)<>(viewer_seat%2)) then
   raise exception 'Alleen de host of het winnende team mag de slag automatisch ophalen';
  end if;
  if reason='auto_collect' then
   if r.trick_completed_at is null or now() < r.trick_completed_at +
     case when coalesce((s->'pending_trick'->'roem'->>'points')::integer,0)>0
            and coalesce((s->'pending_trick'->>'klopped')::boolean,false)=false
       then interval '5 seconds' else interval '1 second' end then
    raise exception 'De slag wacht nog op de roem-knop of de animatie';
   end if;
   if incoming->'pending_trick' is not null and incoming->'pending_trick'<>'null'::jsonb then
    raise exception 'Automatisch ophalen moet de afgesloten slag verwijderen';
   end if;
   if incoming->'taken' <> coalesce(s->'taken','[]'::jsonb) || jsonb_build_array(s->'pending_trick') then
    raise exception 'De slaglijst moet exact één gewonnen slag toevoegen';
   end if;
  end if;$kj_fragment$);
 if position($kj_fragment$set state=incoming,revision=new_revision,
 status=case when incoming->>'phase'='finished' then 'finished' else 'playing' end,
 updated_at=now()$kj_fragment$ in fn)=0 then raise exception 'Missing expected SQL patch fragment fn #8'; end if;
 fn:=replace(fn,$kj_fragment$set state=incoming,revision=new_revision,
 status=case when incoming->>'phase'='finished' then 'finished' else 'playing' end,
 updated_at=now()$kj_fragment$,$kj_fragment$set state=incoming,revision=new_revision,
 status=case when incoming->>'phase'='finished' then 'finished' else 'playing' end,
 updated_at=now(),
 resume_until=now()+interval '7 days',
 trick_completed_at=case
   when incoming->'pending_trick' is null or incoming->'pending_trick'='null'::jsonb then null
   when r.state->'pending_trick' is null or r.state->'pending_trick'='null'::jsonb then now()
   else r.trick_completed_at end$kj_fragment$);
 fn:=replace(fn, E'\nend $function
end $patch$;
, E'\nend; $function

 select pg_get_functiondef('public.klaverjassen_guest_v1(text,text,text,text,jsonb)'::regprocedure)
   into fn;
  if position($kj_fragment$    where status='lobby' and updated_at>now()-interval '14 days'$kj_fragment$ in fn)=0 then raise exception 'Missing expected SQL patch fragment fn #1'; end if;
 fn:=replace(fn,$kj_fragment$    where status='lobby' and updated_at>now()-interval '14 days'$kj_fragment$,$kj_fragment$    where resume_until>=now() and (status='lobby' or (status='playing' and exists (select 1 from public.kalenel_klaverjassen_guest_seats mine where mine.room_id=kalenel_klaverjassen_guest_rooms.id and mine.token_hash=encode(digest(coalesce(token_input,''),'sha256'),'hex'))))$kj_fragment$);
 if position($kj_fragment$    'is_host',g.host_hash=encode(digest(coalesce(token_input,''),'sha256'),'hex')$kj_fragment$ in fn)=0 then raise exception 'Missing expected SQL patch fragment fn #2'; end if;
 fn:=replace(fn,$kj_fragment$    'is_host',g.host_hash=encode(digest(coalesce(token_input,''),'sha256'),'hex')$kj_fragment$,$kj_fragment$    'is_host',g.host_hash=encode(digest(coalesce(token_input,''),'sha256'),'hex'),
    'room_title',g.room_title,'resume_until',g.resume_until$kj_fragment$);
 if position($kj_fragment$  for code_attempt in 1..12 loop
   bytes := gen_random_bytes(6);
   new_code := '';
   for i in 0..5 loop
    new_code := new_code || substr(alphabet,(get_byte(bytes,i)%length(alphabet))+1,1);
   end loop;
   exit when not exists(select 1 from public.kalenel_klaverjassen_guest_rooms where code=new_code);
  end loop;
  if exists(select 1 from public.kalenel_klaverjassen_guest_rooms where code=new_code) then raise exception 'Geen vrije roomcode'; end if;
  insert into public.kalenel_klaverjassen_guest_rooms(code,host_hash,host_name,state)
   values(new_code,hash,nick,s) returning * into r;$kj_fragment$ in fn)=0 then raise exception 'Missing expected SQL patch fragment fn #3'; end if;
 fn:=replace(fn,$kj_fragment$  for code_attempt in 1..12 loop
   bytes := gen_random_bytes(6);
   new_code := '';
   for i in 0..5 loop
    new_code := new_code || substr(alphabet,(get_byte(bytes,i)%length(alphabet))+1,1);
   end loop;
   exit when not exists(select 1 from public.kalenel_klaverjassen_guest_rooms where code=new_code);
  end loop;
  if exists(select 1 from public.kalenel_klaverjassen_guest_rooms where code=new_code) then raise exception 'Geen vrije roomcode'; end if;
  insert into public.kalenel_klaverjassen_guest_rooms(code,host_hash,host_name,state)
   values(new_code,hash,nick,s) returning * into r;$kj_fragment$,$kj_fragment$  new_code := upper(btrim(coalesce(settings->>'lobby_code','')));
  if new_code<>'' then
   if new_code !~ '^[A-Z0-9]{4,12}$' then
    raise exception 'Je eigen roomcode moet 4 t/m 12 letters of cijfers bevatten';
   end if;
  else
   for code_attempt in 1..12 loop
    bytes := gen_random_bytes(6);
    new_code := '';
    for i in 0..5 loop
     new_code := new_code || substr(alphabet,(get_byte(bytes,i)%length(alphabet))+1,1);
    end loop;
    exit when not exists(select 1 from public.kalenel_klaverjassen_guest_rooms where code=new_code);
   end loop;
  end if;
  if exists(select 1 from public.kalenel_klaverjassen_guest_rooms where code=new_code) then
    raise exception 'Deze roomcode is al in gebruik. Kies een andere naam.';
  end if;
  insert into public.kalenel_klaverjassen_guest_rooms(code,host_hash,host_name,state,room_title,resume_until)
   values(new_code,hash,nick,s,
     coalesce(nullif(left(btrim(coalesce(settings->>'room_title','')),50),''),left(nick||'''s tafel',50)),
     now()+interval '7 days') returning * into r;$kj_fragment$);
 if position($kj_fragment$if room_code !~ '^[A-HJ-NP-Z2-9]{6}$' then$kj_fragment$ in fn)=0 then raise exception 'Missing expected SQL patch fragment fn #4'; end if;
 fn:=replace(fn,$kj_fragment$if room_code !~ '^[A-HJ-NP-Z2-9]{6}$' then$kj_fragment$,$kj_fragment$if room_code !~ '^[A-Z0-9]{4,12}$' then$kj_fragment$);
 if position($kj_fragment$ if not found then raise exception 'Deze tafel bestaat niet'; end if;
 select p.seat,p.name$kj_fragment$ in fn)=0 then raise exception 'Missing expected SQL patch fragment fn #5'; end if;
 fn:=replace(fn,$kj_fragment$ if not found then raise exception 'Deze tafel bestaat niet'; end if;
 select p.seat,p.name$kj_fragment$,$kj_fragment$ if not found then raise exception 'Deze tafel bestaat niet'; end if;
 if r.status in ('lobby','playing') and now()>r.resume_until then
  raise exception 'Deze tafel is na zeven dagen zonder zetten verlopen';
 end if;
 select p.seat,p.name$kj_fragment$);
 if position($kj_fragment$update public.kalenel_klaverjassen_guest_rooms set state=s,revision=revision+1,updated_at=now()$kj_fragment$ in fn)=0 then raise exception 'Missing expected SQL patch fragment fn #6'; end if;
 fn:=replace(fn,$kj_fragment$update public.kalenel_klaverjassen_guest_rooms set state=s,revision=revision+1,updated_at=now()$kj_fragment$,$kj_fragment$update public.kalenel_klaverjassen_guest_rooms set state=s,revision=revision+1,updated_at=now(),resume_until=now()+interval '7 days'$kj_fragment$);
 if position($kj_fragment$ elsif reason in ('collect_trick','round_over') then
  if s->'pending_trick' is null or s->'pending_trick'='null'::jsonb or
   ((s->'pending_trick'->>'winner')::integer%2)<>(viewer_seat%2) then
   raise exception 'Alleen het winnende team mag de slag ophalen';
  end if;$kj_fragment$ in fn)=0 then raise exception 'Missing expected SQL patch fragment fn #7'; end if;
 fn:=replace(fn,$kj_fragment$ elsif reason in ('collect_trick','round_over') then
  if s->'pending_trick' is null or s->'pending_trick'='null'::jsonb or
   ((s->'pending_trick'->>'winner')::integer%2)<>(viewer_seat%2) then
   raise exception 'Alleen het winnende team mag de slag ophalen';
  end if;$kj_fragment$,$kj_fragment$ elsif reason in ('collect_trick','round_over','auto_collect') then
  if s->'pending_trick' is null or s->'pending_trick'='null'::jsonb or
   (not host and ((s->'pending_trick'->>'winner')::integer%2)<>(viewer_seat%2)) then
   raise exception 'Alleen de host of het winnende team mag de slag automatisch ophalen';
  end if;
  if reason='auto_collect' then
   if r.trick_completed_at is null or now() < r.trick_completed_at +
     case when coalesce((s->'pending_trick'->'roem'->>'points')::integer,0)>0
            and coalesce((s->'pending_trick'->>'klopped')::boolean,false)=false
       then interval '5 seconds' else interval '1 second' end then
    raise exception 'De slag wacht nog op de roem-knop of de animatie';
   end if;
   if incoming->'pending_trick' is not null and incoming->'pending_trick'<>'null'::jsonb then
    raise exception 'Automatisch ophalen moet de afgesloten slag verwijderen';
   end if;
   if incoming->'taken' <> coalesce(s->'taken','[]'::jsonb) || jsonb_build_array(s->'pending_trick') then
    raise exception 'De slaglijst moet exact één gewonnen slag toevoegen';
   end if;
  end if;$kj_fragment$);
 if position($kj_fragment$set state=incoming,revision=new_revision,
 status=case when incoming->>'phase'='finished' then 'finished' else 'playing' end,
 updated_at=now()$kj_fragment$ in fn)=0 then raise exception 'Missing expected SQL patch fragment fn #8'; end if;
 fn:=replace(fn,$kj_fragment$set state=incoming,revision=new_revision,
 status=case when incoming->>'phase'='finished' then 'finished' else 'playing' end,
 updated_at=now()$kj_fragment$,$kj_fragment$set state=incoming,revision=new_revision,
 status=case when incoming->>'phase'='finished' then 'finished' else 'playing' end,
 updated_at=now(),
 resume_until=now()+interval '7 days',
 trick_completed_at=case
   when incoming->'pending_trick' is null or incoming->'pending_trick'='null'::jsonb then null
   when r.state->'pending_trick' is null or r.state->'pending_trick'='null'::jsonb then now()
   else r.trick_completed_at end$kj_fragment$);
 execute fn;
end $patch$;
);
 execute view_fn;

 select pg_get_functiondef('public.klaverjassen_guest_v1(text,text,text,text,jsonb)'::regprocedure)
   into fn;
  if position($kj_fragment$    where status='lobby' and updated_at>now()-interval '14 days'$kj_fragment$ in fn)=0 then raise exception 'Missing expected SQL patch fragment fn #1'; end if;
 fn:=replace(fn,$kj_fragment$    where status='lobby' and updated_at>now()-interval '14 days'$kj_fragment$,$kj_fragment$    where resume_until>=now() and (status='lobby' or (status='playing' and exists (select 1 from public.kalenel_klaverjassen_guest_seats mine where mine.room_id=kalenel_klaverjassen_guest_rooms.id and mine.token_hash=encode(digest(coalesce(token_input,''),'sha256'),'hex'))))$kj_fragment$);
 if position($kj_fragment$    'is_host',g.host_hash=encode(digest(coalesce(token_input,''),'sha256'),'hex')$kj_fragment$ in fn)=0 then raise exception 'Missing expected SQL patch fragment fn #2'; end if;
 fn:=replace(fn,$kj_fragment$    'is_host',g.host_hash=encode(digest(coalesce(token_input,''),'sha256'),'hex')$kj_fragment$,$kj_fragment$    'is_host',g.host_hash=encode(digest(coalesce(token_input,''),'sha256'),'hex'),
    'room_title',g.room_title,'resume_until',g.resume_until$kj_fragment$);
 if position($kj_fragment$  for code_attempt in 1..12 loop
   bytes := gen_random_bytes(6);
   new_code := '';
   for i in 0..5 loop
    new_code := new_code || substr(alphabet,(get_byte(bytes,i)%length(alphabet))+1,1);
   end loop;
   exit when not exists(select 1 from public.kalenel_klaverjassen_guest_rooms where code=new_code);
  end loop;
  if exists(select 1 from public.kalenel_klaverjassen_guest_rooms where code=new_code) then raise exception 'Geen vrije roomcode'; end if;
  insert into public.kalenel_klaverjassen_guest_rooms(code,host_hash,host_name,state)
   values(new_code,hash,nick,s) returning * into r;$kj_fragment$ in fn)=0 then raise exception 'Missing expected SQL patch fragment fn #3'; end if;
 fn:=replace(fn,$kj_fragment$  for code_attempt in 1..12 loop
   bytes := gen_random_bytes(6);
   new_code := '';
   for i in 0..5 loop
    new_code := new_code || substr(alphabet,(get_byte(bytes,i)%length(alphabet))+1,1);
   end loop;
   exit when not exists(select 1 from public.kalenel_klaverjassen_guest_rooms where code=new_code);
  end loop;
  if exists(select 1 from public.kalenel_klaverjassen_guest_rooms where code=new_code) then raise exception 'Geen vrije roomcode'; end if;
  insert into public.kalenel_klaverjassen_guest_rooms(code,host_hash,host_name,state)
   values(new_code,hash,nick,s) returning * into r;$kj_fragment$,$kj_fragment$  new_code := upper(btrim(coalesce(settings->>'lobby_code','')));
  if new_code<>'' then
   if new_code !~ '^[A-Z0-9]{4,12}$' then
    raise exception 'Je eigen roomcode moet 4 t/m 12 letters of cijfers bevatten';
   end if;
  else
   for code_attempt in 1..12 loop
    bytes := gen_random_bytes(6);
    new_code := '';
    for i in 0..5 loop
     new_code := new_code || substr(alphabet,(get_byte(bytes,i)%length(alphabet))+1,1);
    end loop;
    exit when not exists(select 1 from public.kalenel_klaverjassen_guest_rooms where code=new_code);
   end loop;
  end if;
  if exists(select 1 from public.kalenel_klaverjassen_guest_rooms where code=new_code) then
    raise exception 'Deze roomcode is al in gebruik. Kies een andere naam.';
  end if;
  insert into public.kalenel_klaverjassen_guest_rooms(code,host_hash,host_name,state,room_title,resume_until)
   values(new_code,hash,nick,s,
     coalesce(nullif(left(btrim(coalesce(settings->>'room_title','')),50),''),left(nick||'''s tafel',50)),
     now()+interval '7 days') returning * into r;$kj_fragment$);
 if position($kj_fragment$if room_code !~ '^[A-HJ-NP-Z2-9]{6}$' then$kj_fragment$ in fn)=0 then raise exception 'Missing expected SQL patch fragment fn #4'; end if;
 fn:=replace(fn,$kj_fragment$if room_code !~ '^[A-HJ-NP-Z2-9]{6}$' then$kj_fragment$,$kj_fragment$if room_code !~ '^[A-Z0-9]{4,12}$' then$kj_fragment$);
 if position($kj_fragment$ if not found then raise exception 'Deze tafel bestaat niet'; end if;
 select p.seat,p.name$kj_fragment$ in fn)=0 then raise exception 'Missing expected SQL patch fragment fn #5'; end if;
 fn:=replace(fn,$kj_fragment$ if not found then raise exception 'Deze tafel bestaat niet'; end if;
 select p.seat,p.name$kj_fragment$,$kj_fragment$ if not found then raise exception 'Deze tafel bestaat niet'; end if;
 if r.status in ('lobby','playing') and now()>r.resume_until then
  raise exception 'Deze tafel is na zeven dagen zonder zetten verlopen';
 end if;
 select p.seat,p.name$kj_fragment$);
 if position($kj_fragment$update public.kalenel_klaverjassen_guest_rooms set state=s,revision=revision+1,updated_at=now()$kj_fragment$ in fn)=0 then raise exception 'Missing expected SQL patch fragment fn #6'; end if;
 fn:=replace(fn,$kj_fragment$update public.kalenel_klaverjassen_guest_rooms set state=s,revision=revision+1,updated_at=now()$kj_fragment$,$kj_fragment$update public.kalenel_klaverjassen_guest_rooms set state=s,revision=revision+1,updated_at=now(),resume_until=now()+interval '7 days'$kj_fragment$);
 if position($kj_fragment$ elsif reason in ('collect_trick','round_over') then
  if s->'pending_trick' is null or s->'pending_trick'='null'::jsonb or
   ((s->'pending_trick'->>'winner')::integer%2)<>(viewer_seat%2) then
   raise exception 'Alleen het winnende team mag de slag ophalen';
  end if;$kj_fragment$ in fn)=0 then raise exception 'Missing expected SQL patch fragment fn #7'; end if;
 fn:=replace(fn,$kj_fragment$ elsif reason in ('collect_trick','round_over') then
  if s->'pending_trick' is null or s->'pending_trick'='null'::jsonb or
   ((s->'pending_trick'->>'winner')::integer%2)<>(viewer_seat%2) then
   raise exception 'Alleen het winnende team mag de slag ophalen';
  end if;$kj_fragment$,$kj_fragment$ elsif reason in ('collect_trick','round_over','auto_collect') then
  if s->'pending_trick' is null or s->'pending_trick'='null'::jsonb or
   (not host and ((s->'pending_trick'->>'winner')::integer%2)<>(viewer_seat%2)) then
   raise exception 'Alleen de host of het winnende team mag de slag automatisch ophalen';
  end if;
  if reason='auto_collect' then
   if r.trick_completed_at is null or now() < r.trick_completed_at +
     case when coalesce((s->'pending_trick'->'roem'->>'points')::integer,0)>0
            and coalesce((s->'pending_trick'->>'klopped')::boolean,false)=false
       then interval '5 seconds' else interval '1 second' end then
    raise exception 'De slag wacht nog op de roem-knop of de animatie';
   end if;
   if incoming->'pending_trick' is not null and incoming->'pending_trick'<>'null'::jsonb then
    raise exception 'Automatisch ophalen moet de afgesloten slag verwijderen';
   end if;
   if incoming->'taken' <> coalesce(s->'taken','[]'::jsonb) || jsonb_build_array(s->'pending_trick') then
    raise exception 'De slaglijst moet exact één gewonnen slag toevoegen';
   end if;
  end if;$kj_fragment$);
 if position($kj_fragment$set state=incoming,revision=new_revision,
 status=case when incoming->>'phase'='finished' then 'finished' else 'playing' end,
 updated_at=now()$kj_fragment$ in fn)=0 then raise exception 'Missing expected SQL patch fragment fn #8'; end if;
 fn:=replace(fn,$kj_fragment$set state=incoming,revision=new_revision,
 status=case when incoming->>'phase'='finished' then 'finished' else 'playing' end,
 updated_at=now()$kj_fragment$,$kj_fragment$set state=incoming,revision=new_revision,
 status=case when incoming->>'phase'='finished' then 'finished' else 'playing' end,
 updated_at=now(),
 resume_until=now()+interval '7 days',
 trick_completed_at=case
   when incoming->'pending_trick' is null or incoming->'pending_trick'='null'::jsonb then null
   when r.state->'pending_trick' is null or r.state->'pending_trick'='null'::jsonb then now()
   else r.trick_completed_at end$kj_fragment$);
 execute fn;
end $patch$;
, E'\nend; $function
end $patch$;
, E'\nend; $function

 select pg_get_functiondef('public.klaverjassen_guest_v1(text,text,text,text,jsonb)'::regprocedure)
   into fn;
  if position($kj_fragment$    where status='lobby' and updated_at>now()-interval '14 days'$kj_fragment$ in fn)=0 then raise exception 'Missing expected SQL patch fragment fn #1'; end if;
 fn:=replace(fn,$kj_fragment$    where status='lobby' and updated_at>now()-interval '14 days'$kj_fragment$,$kj_fragment$    where resume_until>=now() and (status='lobby' or (status='playing' and exists (select 1 from public.kalenel_klaverjassen_guest_seats mine where mine.room_id=kalenel_klaverjassen_guest_rooms.id and mine.token_hash=encode(digest(coalesce(token_input,''),'sha256'),'hex'))))$kj_fragment$);
 if position($kj_fragment$    'is_host',g.host_hash=encode(digest(coalesce(token_input,''),'sha256'),'hex')$kj_fragment$ in fn)=0 then raise exception 'Missing expected SQL patch fragment fn #2'; end if;
 fn:=replace(fn,$kj_fragment$    'is_host',g.host_hash=encode(digest(coalesce(token_input,''),'sha256'),'hex')$kj_fragment$,$kj_fragment$    'is_host',g.host_hash=encode(digest(coalesce(token_input,''),'sha256'),'hex'),
    'room_title',g.room_title,'resume_until',g.resume_until$kj_fragment$);
 if position($kj_fragment$  for code_attempt in 1..12 loop
   bytes := gen_random_bytes(6);
   new_code := '';
   for i in 0..5 loop
    new_code := new_code || substr(alphabet,(get_byte(bytes,i)%length(alphabet))+1,1);
   end loop;
   exit when not exists(select 1 from public.kalenel_klaverjassen_guest_rooms where code=new_code);
  end loop;
  if exists(select 1 from public.kalenel_klaverjassen_guest_rooms where code=new_code) then raise exception 'Geen vrije roomcode'; end if;
  insert into public.kalenel_klaverjassen_guest_rooms(code,host_hash,host_name,state)
   values(new_code,hash,nick,s) returning * into r;$kj_fragment$ in fn)=0 then raise exception 'Missing expected SQL patch fragment fn #3'; end if;
 fn:=replace(fn,$kj_fragment$  for code_attempt in 1..12 loop
   bytes := gen_random_bytes(6);
   new_code := '';
   for i in 0..5 loop
    new_code := new_code || substr(alphabet,(get_byte(bytes,i)%length(alphabet))+1,1);
   end loop;
   exit when not exists(select 1 from public.kalenel_klaverjassen_guest_rooms where code=new_code);
  end loop;
  if exists(select 1 from public.kalenel_klaverjassen_guest_rooms where code=new_code) then raise exception 'Geen vrije roomcode'; end if;
  insert into public.kalenel_klaverjassen_guest_rooms(code,host_hash,host_name,state)
   values(new_code,hash,nick,s) returning * into r;$kj_fragment$,$kj_fragment$  new_code := upper(btrim(coalesce(settings->>'lobby_code','')));
  if new_code<>'' then
   if new_code !~ '^[A-Z0-9]{4,12}$' then
    raise exception 'Je eigen roomcode moet 4 t/m 12 letters of cijfers bevatten';
   end if;
  else
   for code_attempt in 1..12 loop
    bytes := gen_random_bytes(6);
    new_code := '';
    for i in 0..5 loop
     new_code := new_code || substr(alphabet,(get_byte(bytes,i)%length(alphabet))+1,1);
    end loop;
    exit when not exists(select 1 from public.kalenel_klaverjassen_guest_rooms where code=new_code);
   end loop;
  end if;
  if exists(select 1 from public.kalenel_klaverjassen_guest_rooms where code=new_code) then
    raise exception 'Deze roomcode is al in gebruik. Kies een andere naam.';
  end if;
  insert into public.kalenel_klaverjassen_guest_rooms(code,host_hash,host_name,state,room_title,resume_until)
   values(new_code,hash,nick,s,
     coalesce(nullif(left(btrim(coalesce(settings->>'room_title','')),50),''),left(nick||'''s tafel',50)),
     now()+interval '7 days') returning * into r;$kj_fragment$);
 if position($kj_fragment$if room_code !~ '^[A-HJ-NP-Z2-9]{6}$' then$kj_fragment$ in fn)=0 then raise exception 'Missing expected SQL patch fragment fn #4'; end if;
 fn:=replace(fn,$kj_fragment$if room_code !~ '^[A-HJ-NP-Z2-9]{6}$' then$kj_fragment$,$kj_fragment$if room_code !~ '^[A-Z0-9]{4,12}$' then$kj_fragment$);
 if position($kj_fragment$ if not found then raise exception 'Deze tafel bestaat niet'; end if;
 select p.seat,p.name$kj_fragment$ in fn)=0 then raise exception 'Missing expected SQL patch fragment fn #5'; end if;
 fn:=replace(fn,$kj_fragment$ if not found then raise exception 'Deze tafel bestaat niet'; end if;
 select p.seat,p.name$kj_fragment$,$kj_fragment$ if not found then raise exception 'Deze tafel bestaat niet'; end if;
 if r.status in ('lobby','playing') and now()>r.resume_until then
  raise exception 'Deze tafel is na zeven dagen zonder zetten verlopen';
 end if;
 select p.seat,p.name$kj_fragment$);
 if position($kj_fragment$update public.kalenel_klaverjassen_guest_rooms set state=s,revision=revision+1,updated_at=now()$kj_fragment$ in fn)=0 then raise exception 'Missing expected SQL patch fragment fn #6'; end if;
 fn:=replace(fn,$kj_fragment$update public.kalenel_klaverjassen_guest_rooms set state=s,revision=revision+1,updated_at=now()$kj_fragment$,$kj_fragment$update public.kalenel_klaverjassen_guest_rooms set state=s,revision=revision+1,updated_at=now(),resume_until=now()+interval '7 days'$kj_fragment$);
 if position($kj_fragment$ elsif reason in ('collect_trick','round_over') then
  if s->'pending_trick' is null or s->'pending_trick'='null'::jsonb or
   ((s->'pending_trick'->>'winner')::integer%2)<>(viewer_seat%2) then
   raise exception 'Alleen het winnende team mag de slag ophalen';
  end if;$kj_fragment$ in fn)=0 then raise exception 'Missing expected SQL patch fragment fn #7'; end if;
 fn:=replace(fn,$kj_fragment$ elsif reason in ('collect_trick','round_over') then
  if s->'pending_trick' is null or s->'pending_trick'='null'::jsonb or
   ((s->'pending_trick'->>'winner')::integer%2)<>(viewer_seat%2) then
   raise exception 'Alleen het winnende team mag de slag ophalen';
  end if;$kj_fragment$,$kj_fragment$ elsif reason in ('collect_trick','round_over','auto_collect') then
  if s->'pending_trick' is null or s->'pending_trick'='null'::jsonb or
   (not host and ((s->'pending_trick'->>'winner')::integer%2)<>(viewer_seat%2)) then
   raise exception 'Alleen de host of het winnende team mag de slag automatisch ophalen';
  end if;
  if reason='auto_collect' then
   if r.trick_completed_at is null or now() < r.trick_completed_at +
     case when coalesce((s->'pending_trick'->'roem'->>'points')::integer,0)>0
            and coalesce((s->'pending_trick'->>'klopped')::boolean,false)=false
       then interval '5 seconds' else interval '1 second' end then
    raise exception 'De slag wacht nog op de roem-knop of de animatie';
   end if;
   if incoming->'pending_trick' is not null and incoming->'pending_trick'<>'null'::jsonb then
    raise exception 'Automatisch ophalen moet de afgesloten slag verwijderen';
   end if;
   if incoming->'taken' <> coalesce(s->'taken','[]'::jsonb) || jsonb_build_array(s->'pending_trick') then
    raise exception 'De slaglijst moet exact één gewonnen slag toevoegen';
   end if;
  end if;$kj_fragment$);
 if position($kj_fragment$set state=incoming,revision=new_revision,
 status=case when incoming->>'phase'='finished' then 'finished' else 'playing' end,
 updated_at=now()$kj_fragment$ in fn)=0 then raise exception 'Missing expected SQL patch fragment fn #8'; end if;
 fn:=replace(fn,$kj_fragment$set state=incoming,revision=new_revision,
 status=case when incoming->>'phase'='finished' then 'finished' else 'playing' end,
 updated_at=now()$kj_fragment$,$kj_fragment$set state=incoming,revision=new_revision,
 status=case when incoming->>'phase'='finished' then 'finished' else 'playing' end,
 updated_at=now(),
 resume_until=now()+interval '7 days',
 trick_completed_at=case
   when incoming->'pending_trick' is null or incoming->'pending_trick'='null'::jsonb then null
   when r.state->'pending_trick' is null or r.state->'pending_trick'='null'::jsonb then now()
   else r.trick_completed_at end$kj_fragment$);
 execute fn;
end $patch$;
);
 execute view_fn;

 select pg_get_functiondef('public.klaverjassen_guest_v1(text,text,text,text,jsonb)'::regprocedure)
   into fn;
  if position($kj_fragment$    where status='lobby' and updated_at>now()-interval '14 days'$kj_fragment$ in fn)=0 then raise exception 'Missing expected SQL patch fragment fn #1'; end if;
 fn:=replace(fn,$kj_fragment$    where status='lobby' and updated_at>now()-interval '14 days'$kj_fragment$,$kj_fragment$    where resume_until>=now() and (status='lobby' or (status='playing' and exists (select 1 from public.kalenel_klaverjassen_guest_seats mine where mine.room_id=kalenel_klaverjassen_guest_rooms.id and mine.token_hash=encode(digest(coalesce(token_input,''),'sha256'),'hex'))))$kj_fragment$);
 if position($kj_fragment$    'is_host',g.host_hash=encode(digest(coalesce(token_input,''),'sha256'),'hex')$kj_fragment$ in fn)=0 then raise exception 'Missing expected SQL patch fragment fn #2'; end if;
 fn:=replace(fn,$kj_fragment$    'is_host',g.host_hash=encode(digest(coalesce(token_input,''),'sha256'),'hex')$kj_fragment$,$kj_fragment$    'is_host',g.host_hash=encode(digest(coalesce(token_input,''),'sha256'),'hex'),
    'room_title',g.room_title,'resume_until',g.resume_until$kj_fragment$);
 if position($kj_fragment$  for code_attempt in 1..12 loop
   bytes := gen_random_bytes(6);
   new_code := '';
   for i in 0..5 loop
    new_code := new_code || substr(alphabet,(get_byte(bytes,i)%length(alphabet))+1,1);
   end loop;
   exit when not exists(select 1 from public.kalenel_klaverjassen_guest_rooms where code=new_code);
  end loop;
  if exists(select 1 from public.kalenel_klaverjassen_guest_rooms where code=new_code) then raise exception 'Geen vrije roomcode'; end if;
  insert into public.kalenel_klaverjassen_guest_rooms(code,host_hash,host_name,state)
   values(new_code,hash,nick,s) returning * into r;$kj_fragment$ in fn)=0 then raise exception 'Missing expected SQL patch fragment fn #3'; end if;
 fn:=replace(fn,$kj_fragment$  for code_attempt in 1..12 loop
   bytes := gen_random_bytes(6);
   new_code := '';
   for i in 0..5 loop
    new_code := new_code || substr(alphabet,(get_byte(bytes,i)%length(alphabet))+1,1);
   end loop;
   exit when not exists(select 1 from public.kalenel_klaverjassen_guest_rooms where code=new_code);
  end loop;
  if exists(select 1 from public.kalenel_klaverjassen_guest_rooms where code=new_code) then raise exception 'Geen vrije roomcode'; end if;
  insert into public.kalenel_klaverjassen_guest_rooms(code,host_hash,host_name,state)
   values(new_code,hash,nick,s) returning * into r;$kj_fragment$,$kj_fragment$  new_code := upper(btrim(coalesce(settings->>'lobby_code','')));
  if new_code<>'' then
   if new_code !~ '^[A-Z0-9]{4,12}$' then
    raise exception 'Je eigen roomcode moet 4 t/m 12 letters of cijfers bevatten';
   end if;
  else
   for code_attempt in 1..12 loop
    bytes := gen_random_bytes(6);
    new_code := '';
    for i in 0..5 loop
     new_code := new_code || substr(alphabet,(get_byte(bytes,i)%length(alphabet))+1,1);
    end loop;
    exit when not exists(select 1 from public.kalenel_klaverjassen_guest_rooms where code=new_code);
   end loop;
  end if;
  if exists(select 1 from public.kalenel_klaverjassen_guest_rooms where code=new_code) then
    raise exception 'Deze roomcode is al in gebruik. Kies een andere naam.';
  end if;
  insert into public.kalenel_klaverjassen_guest_rooms(code,host_hash,host_name,state,room_title,resume_until)
   values(new_code,hash,nick,s,
     coalesce(nullif(left(btrim(coalesce(settings->>'room_title','')),50),''),left(nick||'''s tafel',50)),
     now()+interval '7 days') returning * into r;$kj_fragment$);
 if position($kj_fragment$if room_code !~ '^[A-HJ-NP-Z2-9]{6}$' then$kj_fragment$ in fn)=0 then raise exception 'Missing expected SQL patch fragment fn #4'; end if;
 fn:=replace(fn,$kj_fragment$if room_code !~ '^[A-HJ-NP-Z2-9]{6}$' then$kj_fragment$,$kj_fragment$if room_code !~ '^[A-Z0-9]{4,12}$' then$kj_fragment$);
 if position($kj_fragment$ if not found then raise exception 'Deze tafel bestaat niet'; end if;
 select p.seat,p.name$kj_fragment$ in fn)=0 then raise exception 'Missing expected SQL patch fragment fn #5'; end if;
 fn:=replace(fn,$kj_fragment$ if not found then raise exception 'Deze tafel bestaat niet'; end if;
 select p.seat,p.name$kj_fragment$,$kj_fragment$ if not found then raise exception 'Deze tafel bestaat niet'; end if;
 if r.status in ('lobby','playing') and now()>r.resume_until then
  raise exception 'Deze tafel is na zeven dagen zonder zetten verlopen';
 end if;
 select p.seat,p.name$kj_fragment$);
 if position($kj_fragment$update public.kalenel_klaverjassen_guest_rooms set state=s,revision=revision+1,updated_at=now()$kj_fragment$ in fn)=0 then raise exception 'Missing expected SQL patch fragment fn #6'; end if;
 fn:=replace(fn,$kj_fragment$update public.kalenel_klaverjassen_guest_rooms set state=s,revision=revision+1,updated_at=now()$kj_fragment$,$kj_fragment$update public.kalenel_klaverjassen_guest_rooms set state=s,revision=revision+1,updated_at=now(),resume_until=now()+interval '7 days'$kj_fragment$);
 if position($kj_fragment$ elsif reason in ('collect_trick','round_over') then
  if s->'pending_trick' is null or s->'pending_trick'='null'::jsonb or
   ((s->'pending_trick'->>'winner')::integer%2)<>(viewer_seat%2) then
   raise exception 'Alleen het winnende team mag de slag ophalen';
  end if;$kj_fragment$ in fn)=0 then raise exception 'Missing expected SQL patch fragment fn #7'; end if;
 fn:=replace(fn,$kj_fragment$ elsif reason in ('collect_trick','round_over') then
  if s->'pending_trick' is null or s->'pending_trick'='null'::jsonb or
   ((s->'pending_trick'->>'winner')::integer%2)<>(viewer_seat%2) then
   raise exception 'Alleen het winnende team mag de slag ophalen';
  end if;$kj_fragment$,$kj_fragment$ elsif reason in ('collect_trick','round_over','auto_collect') then
  if s->'pending_trick' is null or s->'pending_trick'='null'::jsonb or
   (not host and ((s->'pending_trick'->>'winner')::integer%2)<>(viewer_seat%2)) then
   raise exception 'Alleen de host of het winnende team mag de slag automatisch ophalen';
  end if;
  if reason='auto_collect' then
   if r.trick_completed_at is null or now() < r.trick_completed_at +
     case when coalesce((s->'pending_trick'->'roem'->>'points')::integer,0)>0
            and coalesce((s->'pending_trick'->>'klopped')::boolean,false)=false
       then interval '5 seconds' else interval '1 second' end then
    raise exception 'De slag wacht nog op de roem-knop of de animatie';
   end if;
   if incoming->'pending_trick' is not null and incoming->'pending_trick'<>'null'::jsonb then
    raise exception 'Automatisch ophalen moet de afgesloten slag verwijderen';
   end if;
   if incoming->'taken' <> coalesce(s->'taken','[]'::jsonb) || jsonb_build_array(s->'pending_trick') then
    raise exception 'De slaglijst moet exact één gewonnen slag toevoegen';
   end if;
  end if;$kj_fragment$);
 if position($kj_fragment$set state=incoming,revision=new_revision,
 status=case when incoming->>'phase'='finished' then 'finished' else 'playing' end,
 updated_at=now()$kj_fragment$ in fn)=0 then raise exception 'Missing expected SQL patch fragment fn #8'; end if;
 fn:=replace(fn,$kj_fragment$set state=incoming,revision=new_revision,
 status=case when incoming->>'phase'='finished' then 'finished' else 'playing' end,
 updated_at=now()$kj_fragment$,$kj_fragment$set state=incoming,revision=new_revision,
 status=case when incoming->>'phase'='finished' then 'finished' else 'playing' end,
 updated_at=now(),
 resume_until=now()+interval '7 days',
 trick_completed_at=case
   when incoming->'pending_trick' is null or incoming->'pending_trick'='null'::jsonb then null
   when r.state->'pending_trick' is null or r.state->'pending_trick'='null'::jsonb then now()
   else r.trick_completed_at end$kj_fragment$);
 execute fn;
end $patch$;
);
 execute fn;
end $patch$;
, E'\nend; $function

 select pg_get_functiondef('public.klaverjassen_guest_v1(text,text,text,text,jsonb)'::regprocedure)
   into fn;
  if position($kj_fragment$    where status='lobby' and updated_at>now()-interval '14 days'$kj_fragment$ in fn)=0 then raise exception 'Missing expected SQL patch fragment fn #1'; end if;
 fn:=replace(fn,$kj_fragment$    where status='lobby' and updated_at>now()-interval '14 days'$kj_fragment$,$kj_fragment$    where resume_until>=now() and (status='lobby' or (status='playing' and exists (select 1 from public.kalenel_klaverjassen_guest_seats mine where mine.room_id=kalenel_klaverjassen_guest_rooms.id and mine.token_hash=encode(digest(coalesce(token_input,''),'sha256'),'hex'))))$kj_fragment$);
 if position($kj_fragment$    'is_host',g.host_hash=encode(digest(coalesce(token_input,''),'sha256'),'hex')$kj_fragment$ in fn)=0 then raise exception 'Missing expected SQL patch fragment fn #2'; end if;
 fn:=replace(fn,$kj_fragment$    'is_host',g.host_hash=encode(digest(coalesce(token_input,''),'sha256'),'hex')$kj_fragment$,$kj_fragment$    'is_host',g.host_hash=encode(digest(coalesce(token_input,''),'sha256'),'hex'),
    'room_title',g.room_title,'resume_until',g.resume_until$kj_fragment$);
 if position($kj_fragment$  for code_attempt in 1..12 loop
   bytes := gen_random_bytes(6);
   new_code := '';
   for i in 0..5 loop
    new_code := new_code || substr(alphabet,(get_byte(bytes,i)%length(alphabet))+1,1);
   end loop;
   exit when not exists(select 1 from public.kalenel_klaverjassen_guest_rooms where code=new_code);
  end loop;
  if exists(select 1 from public.kalenel_klaverjassen_guest_rooms where code=new_code) then raise exception 'Geen vrije roomcode'; end if;
  insert into public.kalenel_klaverjassen_guest_rooms(code,host_hash,host_name,state)
   values(new_code,hash,nick,s) returning * into r;$kj_fragment$ in fn)=0 then raise exception 'Missing expected SQL patch fragment fn #3'; end if;
 fn:=replace(fn,$kj_fragment$  for code_attempt in 1..12 loop
   bytes := gen_random_bytes(6);
   new_code := '';
   for i in 0..5 loop
    new_code := new_code || substr(alphabet,(get_byte(bytes,i)%length(alphabet))+1,1);
   end loop;
   exit when not exists(select 1 from public.kalenel_klaverjassen_guest_rooms where code=new_code);
  end loop;
  if exists(select 1 from public.kalenel_klaverjassen_guest_rooms where code=new_code) then raise exception 'Geen vrije roomcode'; end if;
  insert into public.kalenel_klaverjassen_guest_rooms(code,host_hash,host_name,state)
   values(new_code,hash,nick,s) returning * into r;$kj_fragment$,$kj_fragment$  new_code := upper(btrim(coalesce(settings->>'lobby_code','')));
  if new_code<>'' then
   if new_code !~ '^[A-Z0-9]{4,12}$' then
    raise exception 'Je eigen roomcode moet 4 t/m 12 letters of cijfers bevatten';
   end if;
  else
   for code_attempt in 1..12 loop
    bytes := gen_random_bytes(6);
    new_code := '';
    for i in 0..5 loop
     new_code := new_code || substr(alphabet,(get_byte(bytes,i)%length(alphabet))+1,1);
    end loop;
    exit when not exists(select 1 from public.kalenel_klaverjassen_guest_rooms where code=new_code);
   end loop;
  end if;
  if exists(select 1 from public.kalenel_klaverjassen_guest_rooms where code=new_code) then
    raise exception 'Deze roomcode is al in gebruik. Kies een andere naam.';
  end if;
  insert into public.kalenel_klaverjassen_guest_rooms(code,host_hash,host_name,state,room_title,resume_until)
   values(new_code,hash,nick,s,
     coalesce(nullif(left(btrim(coalesce(settings->>'room_title','')),50),''),left(nick||'''s tafel',50)),
     now()+interval '7 days') returning * into r;$kj_fragment$);
 if position($kj_fragment$if room_code !~ '^[A-HJ-NP-Z2-9]{6}$' then$kj_fragment$ in fn)=0 then raise exception 'Missing expected SQL patch fragment fn #4'; end if;
 fn:=replace(fn,$kj_fragment$if room_code !~ '^[A-HJ-NP-Z2-9]{6}$' then$kj_fragment$,$kj_fragment$if room_code !~ '^[A-Z0-9]{4,12}$' then$kj_fragment$);
 if position($kj_fragment$ if not found then raise exception 'Deze tafel bestaat niet'; end if;
 select p.seat,p.name$kj_fragment$ in fn)=0 then raise exception 'Missing expected SQL patch fragment fn #5'; end if;
 fn:=replace(fn,$kj_fragment$ if not found then raise exception 'Deze tafel bestaat niet'; end if;
 select p.seat,p.name$kj_fragment$,$kj_fragment$ if not found then raise exception 'Deze tafel bestaat niet'; end if;
 if r.status in ('lobby','playing') and now()>r.resume_until then
  raise exception 'Deze tafel is na zeven dagen zonder zetten verlopen';
 end if;
 select p.seat,p.name$kj_fragment$);
 if position($kj_fragment$update public.kalenel_klaverjassen_guest_rooms set state=s,revision=revision+1,updated_at=now()$kj_fragment$ in fn)=0 then raise exception 'Missing expected SQL patch fragment fn #6'; end if;
 fn:=replace(fn,$kj_fragment$update public.kalenel_klaverjassen_guest_rooms set state=s,revision=revision+1,updated_at=now()$kj_fragment$,$kj_fragment$update public.kalenel_klaverjassen_guest_rooms set state=s,revision=revision+1,updated_at=now(),resume_until=now()+interval '7 days'$kj_fragment$);
 if position($kj_fragment$ elsif reason in ('collect_trick','round_over') then
  if s->'pending_trick' is null or s->'pending_trick'='null'::jsonb or
   ((s->'pending_trick'->>'winner')::integer%2)<>(viewer_seat%2) then
   raise exception 'Alleen het winnende team mag de slag ophalen';
  end if;$kj_fragment$ in fn)=0 then raise exception 'Missing expected SQL patch fragment fn #7'; end if;
 fn:=replace(fn,$kj_fragment$ elsif reason in ('collect_trick','round_over') then
  if s->'pending_trick' is null or s->'pending_trick'='null'::jsonb or
   ((s->'pending_trick'->>'winner')::integer%2)<>(viewer_seat%2) then
   raise exception 'Alleen het winnende team mag de slag ophalen';
  end if;$kj_fragment$,$kj_fragment$ elsif reason in ('collect_trick','round_over','auto_collect') then
  if s->'pending_trick' is null or s->'pending_trick'='null'::jsonb or
   (not host and ((s->'pending_trick'->>'winner')::integer%2)<>(viewer_seat%2)) then
   raise exception 'Alleen de host of het winnende team mag de slag automatisch ophalen';
  end if;
  if reason='auto_collect' then
   if r.trick_completed_at is null or now() < r.trick_completed_at +
     case when coalesce((s->'pending_trick'->'roem'->>'points')::integer,0)>0
            and coalesce((s->'pending_trick'->>'klopped')::boolean,false)=false
       then interval '5 seconds' else interval '1 second' end then
    raise exception 'De slag wacht nog op de roem-knop of de animatie';
   end if;
   if incoming->'pending_trick' is not null and incoming->'pending_trick'<>'null'::jsonb then
    raise exception 'Automatisch ophalen moet de afgesloten slag verwijderen';
   end if;
   if incoming->'taken' <> coalesce(s->'taken','[]'::jsonb) || jsonb_build_array(s->'pending_trick') then
    raise exception 'De slaglijst moet exact één gewonnen slag toevoegen';
   end if;
  end if;$kj_fragment$);
 if position($kj_fragment$set state=incoming,revision=new_revision,
 status=case when incoming->>'phase'='finished' then 'finished' else 'playing' end,
 updated_at=now()$kj_fragment$ in fn)=0 then raise exception 'Missing expected SQL patch fragment fn #8'; end if;
 fn:=replace(fn,$kj_fragment$set state=incoming,revision=new_revision,
 status=case when incoming->>'phase'='finished' then 'finished' else 'playing' end,
 updated_at=now()$kj_fragment$,$kj_fragment$set state=incoming,revision=new_revision,
 status=case when incoming->>'phase'='finished' then 'finished' else 'playing' end,
 updated_at=now(),
 resume_until=now()+interval '7 days',
 trick_completed_at=case
   when incoming->'pending_trick' is null or incoming->'pending_trick'='null'::jsonb then null
   when r.state->'pending_trick' is null or r.state->'pending_trick'='null'::jsonb then now()
   else r.trick_completed_at end$kj_fragment$);
 execute fn;
end $patch$;
);
 execute view_fn;

 select pg_get_functiondef('public.klaverjassen_guest_v1(text,text,text,text,jsonb)'::regprocedure)
   into fn;
  if position($kj_fragment$    where status='lobby' and updated_at>now()-interval '14 days'$kj_fragment$ in fn)=0 then raise exception 'Missing expected SQL patch fragment fn #1'; end if;
 fn:=replace(fn,$kj_fragment$    where status='lobby' and updated_at>now()-interval '14 days'$kj_fragment$,$kj_fragment$    where resume_until>=now() and (status='lobby' or (status='playing' and exists (select 1 from public.kalenel_klaverjassen_guest_seats mine where mine.room_id=kalenel_klaverjassen_guest_rooms.id and mine.token_hash=encode(digest(coalesce(token_input,''),'sha256'),'hex'))))$kj_fragment$);
 if position($kj_fragment$    'is_host',g.host_hash=encode(digest(coalesce(token_input,''),'sha256'),'hex')$kj_fragment$ in fn)=0 then raise exception 'Missing expected SQL patch fragment fn #2'; end if;
 fn:=replace(fn,$kj_fragment$    'is_host',g.host_hash=encode(digest(coalesce(token_input,''),'sha256'),'hex')$kj_fragment$,$kj_fragment$    'is_host',g.host_hash=encode(digest(coalesce(token_input,''),'sha256'),'hex'),
    'room_title',g.room_title,'resume_until',g.resume_until$kj_fragment$);
 if position($kj_fragment$  for code_attempt in 1..12 loop
   bytes := gen_random_bytes(6);
   new_code := '';
   for i in 0..5 loop
    new_code := new_code || substr(alphabet,(get_byte(bytes,i)%length(alphabet))+1,1);
   end loop;
   exit when not exists(select 1 from public.kalenel_klaverjassen_guest_rooms where code=new_code);
  end loop;
  if exists(select 1 from public.kalenel_klaverjassen_guest_rooms where code=new_code) then raise exception 'Geen vrije roomcode'; end if;
  insert into public.kalenel_klaverjassen_guest_rooms(code,host_hash,host_name,state)
   values(new_code,hash,nick,s) returning * into r;$kj_fragment$ in fn)=0 then raise exception 'Missing expected SQL patch fragment fn #3'; end if;
 fn:=replace(fn,$kj_fragment$  for code_attempt in 1..12 loop
   bytes := gen_random_bytes(6);
   new_code := '';
   for i in 0..5 loop
    new_code := new_code || substr(alphabet,(get_byte(bytes,i)%length(alphabet))+1,1);
   end loop;
   exit when not exists(select 1 from public.kalenel_klaverjassen_guest_rooms where code=new_code);
  end loop;
  if exists(select 1 from public.kalenel_klaverjassen_guest_rooms where code=new_code) then raise exception 'Geen vrije roomcode'; end if;
  insert into public.kalenel_klaverjassen_guest_rooms(code,host_hash,host_name,state)
   values(new_code,hash,nick,s) returning * into r;$kj_fragment$,$kj_fragment$  new_code := upper(btrim(coalesce(settings->>'lobby_code','')));
  if new_code<>'' then
   if new_code !~ '^[A-Z0-9]{4,12}$' then
    raise exception 'Je eigen roomcode moet 4 t/m 12 letters of cijfers bevatten';
   end if;
  else
   for code_attempt in 1..12 loop
    bytes := gen_random_bytes(6);
    new_code := '';
    for i in 0..5 loop
     new_code := new_code || substr(alphabet,(get_byte(bytes,i)%length(alphabet))+1,1);
    end loop;
    exit when not exists(select 1 from public.kalenel_klaverjassen_guest_rooms where code=new_code);
   end loop;
  end if;
  if exists(select 1 from public.kalenel_klaverjassen_guest_rooms where code=new_code) then
    raise exception 'Deze roomcode is al in gebruik. Kies een andere naam.';
  end if;
  insert into public.kalenel_klaverjassen_guest_rooms(code,host_hash,host_name,state,room_title,resume_until)
   values(new_code,hash,nick,s,
     coalesce(nullif(left(btrim(coalesce(settings->>'room_title','')),50),''),left(nick||'''s tafel',50)),
     now()+interval '7 days') returning * into r;$kj_fragment$);
 if position($kj_fragment$if room_code !~ '^[A-HJ-NP-Z2-9]{6}$' then$kj_fragment$ in fn)=0 then raise exception 'Missing expected SQL patch fragment fn #4'; end if;
 fn:=replace(fn,$kj_fragment$if room_code !~ '^[A-HJ-NP-Z2-9]{6}$' then$kj_fragment$,$kj_fragment$if room_code !~ '^[A-Z0-9]{4,12}$' then$kj_fragment$);
 if position($kj_fragment$ if not found then raise exception 'Deze tafel bestaat niet'; end if;
 select p.seat,p.name$kj_fragment$ in fn)=0 then raise exception 'Missing expected SQL patch fragment fn #5'; end if;
 fn:=replace(fn,$kj_fragment$ if not found then raise exception 'Deze tafel bestaat niet'; end if;
 select p.seat,p.name$kj_fragment$,$kj_fragment$ if not found then raise exception 'Deze tafel bestaat niet'; end if;
 if r.status in ('lobby','playing') and now()>r.resume_until then
  raise exception 'Deze tafel is na zeven dagen zonder zetten verlopen';
 end if;
 select p.seat,p.name$kj_fragment$);
 if position($kj_fragment$update public.kalenel_klaverjassen_guest_rooms set state=s,revision=revision+1,updated_at=now()$kj_fragment$ in fn)=0 then raise exception 'Missing expected SQL patch fragment fn #6'; end if;
 fn:=replace(fn,$kj_fragment$update public.kalenel_klaverjassen_guest_rooms set state=s,revision=revision+1,updated_at=now()$kj_fragment$,$kj_fragment$update public.kalenel_klaverjassen_guest_rooms set state=s,revision=revision+1,updated_at=now(),resume_until=now()+interval '7 days'$kj_fragment$);
 if position($kj_fragment$ elsif reason in ('collect_trick','round_over') then
  if s->'pending_trick' is null or s->'pending_trick'='null'::jsonb or
   ((s->'pending_trick'->>'winner')::integer%2)<>(viewer_seat%2) then
   raise exception 'Alleen het winnende team mag de slag ophalen';
  end if;$kj_fragment$ in fn)=0 then raise exception 'Missing expected SQL patch fragment fn #7'; end if;
 fn:=replace(fn,$kj_fragment$ elsif reason in ('collect_trick','round_over') then
  if s->'pending_trick' is null or s->'pending_trick'='null'::jsonb or
   ((s->'pending_trick'->>'winner')::integer%2)<>(viewer_seat%2) then
   raise exception 'Alleen het winnende team mag de slag ophalen';
  end if;$kj_fragment$,$kj_fragment$ elsif reason in ('collect_trick','round_over','auto_collect') then
  if s->'pending_trick' is null or s->'pending_trick'='null'::jsonb or
   (not host and ((s->'pending_trick'->>'winner')::integer%2)<>(viewer_seat%2)) then
   raise exception 'Alleen de host of het winnende team mag de slag automatisch ophalen';
  end if;
  if reason='auto_collect' then
   if r.trick_completed_at is null or now() < r.trick_completed_at +
     case when coalesce((s->'pending_trick'->'roem'->>'points')::integer,0)>0
            and coalesce((s->'pending_trick'->>'klopped')::boolean,false)=false
       then interval '5 seconds' else interval '1 second' end then
    raise exception 'De slag wacht nog op de roem-knop of de animatie';
   end if;
   if incoming->'pending_trick' is not null and incoming->'pending_trick'<>'null'::jsonb then
    raise exception 'Automatisch ophalen moet de afgesloten slag verwijderen';
   end if;
   if incoming->'taken' <> coalesce(s->'taken','[]'::jsonb) || jsonb_build_array(s->'pending_trick') then
    raise exception 'De slaglijst moet exact één gewonnen slag toevoegen';
   end if;
  end if;$kj_fragment$);
 if position($kj_fragment$set state=incoming,revision=new_revision,
 status=case when incoming->>'phase'='finished' then 'finished' else 'playing' end,
 updated_at=now()$kj_fragment$ in fn)=0 then raise exception 'Missing expected SQL patch fragment fn #8'; end if;
 fn:=replace(fn,$kj_fragment$set state=incoming,revision=new_revision,
 status=case when incoming->>'phase'='finished' then 'finished' else 'playing' end,
 updated_at=now()$kj_fragment$,$kj_fragment$set state=incoming,revision=new_revision,
 status=case when incoming->>'phase'='finished' then 'finished' else 'playing' end,
 updated_at=now(),
 resume_until=now()+interval '7 days',
 trick_completed_at=case
   when incoming->'pending_trick' is null or incoming->'pending_trick'='null'::jsonb then null
   when r.state->'pending_trick' is null or r.state->'pending_trick'='null'::jsonb then now()
   else r.trick_completed_at end$kj_fragment$);
 execute fn;
end $patch$;
