\set ON_ERROR_STOP on
create table public.players(id bigint primary key,display_name text not null,active boolean not null default true,site_scope text not null default 'friends');
create table public.gejast_player_sessions_v746(session_token text primary key,player_id bigint not null references public.players(id),display_name text not null,site_scope text not null,created_at timestamptz not null,last_seen_at timestamptz not null,expires_at timestamptz not null);
create table public.drink_event_types(id bigint primary key,key text unique not null,label text not null,unit_value numeric not null);
create table public.drink_events(id bigserial primary key,player_id bigint not null references public.players(id),player_name text not null,event_type_id bigint,event_type_key text,event_type_label text,quantity integer,total_units numeric,lat double precision,lng double precision,accuracy double precision,status text not null default 'pending',site_scope text not null,metadata jsonb,created_at timestamptz not null default now());
create unique index drink_events_one_pending_per_player_uidx on public.drink_events(player_id) where status='pending';
create table public.drink_verification_votes(id bigserial primary key,drink_event_id bigint not null references public.drink_events(id) on delete cascade,player_id bigint not null,approved boolean not null,unique(drink_event_id,player_id));

insert into public.players(id,display_name,active,site_scope) values
 (101,'Busy Creator',true,'friends'),(102,'Free Creator',true,'friends'),(103,'Verifier One',true,'friends'),(104,'Verifier Two',true,'friends'),(105,'Verifier Three',true,'friends'),(201,'Family Person',true,'family');
insert into public.drink_event_types(id,key,label,unit_value) values (1,'bier','1 Bak',1.0),(2,'ice','Ice',2.8);
insert into public.drink_events(player_id,player_name,event_type_id,event_type_key,event_type_label,quantity,total_units,lat,lng,accuracy,status,site_scope,metadata)
values(101,'Busy Creator',1,'bier','1 Bak',1,1.0,52.3676,4.9041,25,'pending','friends','{"fixture":"preexisting-pending"}'::jsonb);

create or replace function public.contract_drinks_write_v664(session_token text,action text,payload jsonb,site_scope_input text)
returns jsonb language plpgsql as $fn$
declare v_player_id bigint; v_player_name text; v_event_id bigint; v_yes int; v_no int; v_approved boolean;
begin
 select player_id,display_name into v_player_id,v_player_name from public.gejast_player_sessions_v746
  where gejast_player_sessions_v746.session_token=contract_drinks_write_v664.session_token and site_scope=site_scope_input and expires_at>now();
 if v_player_id is null then return jsonb_build_object('ok',false,'message','invalid session'); end if;
 if action='create_event' then
  insert into public.drink_events(player_id,player_name,event_type_id,event_type_key,event_type_label,quantity,total_units,lat,lng,accuracy,status,site_scope,metadata)
  values(v_player_id,v_player_name,1,'bier','1 Bak',1,1.0,52.3676,4.9041,25,'pending',site_scope_input,'{"fixture":"v771d"}'::jsonb)
  returning id into v_event_id;
  return jsonb_build_object('ok',true,'data',jsonb_build_object('drink_event_id',v_event_id));
 elsif action='verify_event' then
  v_event_id:=(payload->>'drink_event_id')::bigint;
  if exists(select 1 from public.drink_events where id=v_event_id and player_id=v_player_id) then return jsonb_build_object('ok',false,'message','self verify forbidden'); end if;
  v_approved:=coalesce((payload->>'approved')::boolean,(payload->>'approve')::boolean,false);
  insert into public.drink_verification_votes(drink_event_id,player_id,approved) values(v_event_id,v_player_id,v_approved)
  on conflict(drink_event_id,player_id) do update set approved=excluded.approved;
  select count(*) filter(where approved),count(*) filter(where not approved) into v_yes,v_no from public.drink_verification_votes where drink_event_id=v_event_id;
  if v_yes>=2 then update public.drink_events set status='approved' where id=v_event_id; end if;
  if v_no>=2 then update public.drink_events set status='rejected' where id=v_event_id; end if;
  return jsonb_build_object('ok',true,'data',jsonb_build_object('drink_event_id',v_event_id));
 end if;
 return jsonb_build_object('ok',false,'message','unsupported action');
end $fn$;

create or replace function public.contract_drinks_read_v664(session_token text,viewer_lat double precision,viewer_lng double precision,history_limit integer,site_scope_input text)
returns jsonb language plpgsql as $fn$
declare v_pending jsonb; v_verified jsonb; v_rejected jsonb;
begin
 if not exists(select 1 from public.gejast_player_sessions_v746 s where s.session_token=contract_drinks_read_v664.session_token and s.site_scope=site_scope_input and s.expires_at>now()) then return jsonb_build_object('ok',false); end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'status',status) order by id),'[]'::jsonb) into v_pending from public.drink_events where site_scope=site_scope_input and status='pending';
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'status',status) order by id),'[]'::jsonb) into v_verified from public.drink_events where site_scope=site_scope_input and status in ('approved','verified');
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'status',status) order by id),'[]'::jsonb) into v_rejected from public.drink_events where site_scope=site_scope_input and status in ('rejected','cancelled');
 return jsonb_build_object('ok',true,'verify_queue',v_pending,'recent_verified',v_verified,'recent_rejected',v_rejected);
end $fn$;
