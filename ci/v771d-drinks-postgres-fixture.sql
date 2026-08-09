\set ON_ERROR_STOP on

create table public.players(
  id bigint primary key,
  display_name text not null,
  active boolean not null default true,
  site_scope text not null default 'friends'
);

create table public.gejast_player_sessions_v746(
  session_token text primary key,
  player_id bigint not null references public.players(id),
  display_name text not null,
  site_scope text not null,
  created_at timestamptz not null,
  last_seen_at timestamptz not null,
  expires_at timestamptz not null
);

create table public.drink_event_types(
  key text primary key,
  unit_value numeric not null
);

create table public.drink_events(
  id bigserial primary key,
  creator_session_token text not null,
  event_type_key text not null references public.drink_event_types(key),
  quantity integer not null,
  site_scope text not null,
  status text not null default 'pending'
);

create table public.drink_verification_votes(
  id bigserial primary key,
  drink_event_id bigint not null references public.drink_events(id) on delete cascade,
  verifier_session_token text not null,
  approved boolean not null,
  unique(drink_event_id, verifier_session_token)
);

insert into public.players(id,display_name,active,site_scope) values
  (101,'Fixture A',true,'friends'),
  (102,'Fixture B',true,'friends'),
  (103,'Fixture C',true,'friends'),
  (104,'Fixture D',true,'friends'),
  (201,'Family Fixture',true,'family');

insert into public.drink_event_types(key,unit_value) values
  ('bier',1.0),
  ('ice',2.8);

create or replace function public.contract_drinks_write_v664(
  session_token text,
  action text,
  payload jsonb,
  site_scope_input text
) returns jsonb
language plpgsql
as $fn$
declare
  v_event_id bigint;
  v_approved boolean;
  v_yes integer;
  v_no integer;
begin
  if not exists(
    select 1 from public.gejast_player_sessions_v746 s
     where s.session_token=contract_drinks_write_v664.session_token
       and s.site_scope=site_scope_input
       and s.expires_at>now()
  ) then
    return jsonb_build_object('ok',false,'message','invalid session');
  end if;

  if action='create_event' then
    insert into public.drink_events(
      creator_session_token,event_type_key,quantity,site_scope,status
    ) values(
      session_token,
      coalesce(payload->>'event_type_key','bier'),
      coalesce((payload->>'quantity')::integer,1),
      site_scope_input,
      'pending'
    ) returning id into v_event_id;
    return jsonb_build_object('ok',true,'data',jsonb_build_object('drink_event_id',v_event_id,'status','pending'));
  end if;

  if action='verify_event' then
    v_event_id:=coalesce(nullif(payload->>'drink_event_id','')::bigint,0);
    v_approved:=coalesce((payload->>'approved')::boolean,(payload->>'approve')::boolean,false);

    if not exists(
      select 1 from public.drink_events e
       where e.id=v_event_id and e.site_scope=site_scope_input and e.status='pending'
    ) then
      return jsonb_build_object('ok',false,'message','event unavailable');
    end if;

    insert into public.drink_verification_votes(drink_event_id,verifier_session_token,approved)
    values(v_event_id,session_token,v_approved)
    on conflict(drink_event_id,verifier_session_token) do update set approved=excluded.approved;

    select count(*) filter(where approved),count(*) filter(where not approved)
      into v_yes,v_no
      from public.drink_verification_votes
     where drink_event_id=v_event_id;

    if v_yes>=2 then
      update public.drink_events set status='approved' where id=v_event_id;
    elsif v_no>=2 then
      update public.drink_events set status='rejected' where id=v_event_id;
    end if;

    return jsonb_build_object('ok',true,'data',jsonb_build_object('drink_event_id',v_event_id));
  end if;

  return jsonb_build_object('ok',false,'message','unsupported action');
end
$fn$;

create or replace function public.contract_drinks_read_v664(
  session_token text,
  viewer_lat double precision,
  viewer_lng double precision,
  history_limit integer,
  site_scope_input text
) returns jsonb
language plpgsql
as $fn$
declare
  v_pending jsonb;
  v_verified jsonb;
  v_rejected jsonb;
begin
  if not exists(
    select 1 from public.gejast_player_sessions_v746 s
     where s.session_token=contract_drinks_read_v664.session_token
       and s.site_scope=site_scope_input
       and s.expires_at>now()
  ) then
    return jsonb_build_object('ok',false,'message','invalid session');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id',id,'status',status) order by id),'[]'::jsonb)
    into v_pending from public.drink_events where site_scope=site_scope_input and status='pending';
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'status',status) order by id),'[]'::jsonb)
    into v_verified from public.drink_events where site_scope=site_scope_input and status in ('approved','verified');
  select coalesce(jsonb_agg(jsonb_build_object('id',id,'status',status) order by id),'[]'::jsonb)
    into v_rejected from public.drink_events where site_scope=site_scope_input and status in ('rejected','cancelled');

  return jsonb_build_object(
    'ok',true,
    'verify_queue',v_pending,
    'recent_verified',v_verified,
    'recent_rejected',v_rejected
  );
end
$fn$;
