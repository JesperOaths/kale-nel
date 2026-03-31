-- Gejast v194 FULL SQL
-- Stronger dummy data seeding + drinks config updates.

begin;

update public.drink_event_types
set unit_value = 2.8
where lower(coalesce(key, '')) = 'ice';

insert into public.allowed_usernames (username, display_name, status)
select 'testdummy', 'Test Dummy', 'approved_pending_activation'
where to_regclass('public.allowed_usernames') is not null
  and not exists (select 1 from public.allowed_usernames where lower(username)='testdummy')
on conflict (username) do update
set display_name = excluded.display_name,
    status = 'approved_pending_activation',
    updated_at = now();

create unique index if not exists drink_events_one_pending_per_player_uidx
on public.drink_events (player_id)
where coalesce(status, '') = 'pending';

alter table public.drink_speed_attempts
  add column if not exists linked_drink_event_id bigint null references public.drink_events(id) on delete set null;

create unique index if not exists drink_speed_attempts_one_pending_linked_uidx
on public.drink_speed_attempts (linked_drink_event_id)
where linked_drink_event_id is not null and coalesce(status, '') = 'pending';

create or replace function public._link_pending_speed_to_verified_drink()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_speed_id bigint;
begin
  if coalesce(new.status, '') = 'verified' and coalesce(old.status, '') <> 'verified' then
    select dsa.id into v_speed_id
    from public.drink_speed_attempts dsa
    where dsa.player_id = new.player_id
      and coalesce(dsa.status, '') = 'pending'
      and dsa.linked_drink_event_id is null
      and abs(extract(epoch from (coalesce(dsa.created_at, now()) - coalesce(new.created_at, now())))) <= 120
    order by dsa.created_at desc
    limit 1;
    if v_speed_id is not null then
      update public.drink_speed_attempts
      set linked_drink_event_id = new.id,
          status = 'verified'
      where id = v_speed_id;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_link_pending_speed_to_verified_drink on public.drink_events;
create trigger trg_link_pending_speed_to_verified_drink
after update on public.drink_events
for each row execute function public._link_pending_speed_to_verified_drink();

create or replace function public.admin_seed_drinks_dummy_data()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_names text[] := array['Verifier 1111','Drinks Dummy 1','Drinks Dummy 2','Drinks Dummy 3','Drinks Dummy 4','Drinks Dummy 5'];
  v_name text;
  v_player_id bigint;
  v_event_type_id bigint;
  v_session_id bigint;
  v_idx int;
  v_sql text;
  v_has_pin_hash boolean;
  v_has_active boolean;
  v_has_created_at boolean;
  v_has_updated_at boolean;
  v_has_de_event_type_id boolean;
  v_has_de_event_type_key boolean;
  v_has_de_player_name boolean;
  v_has_de_session_id boolean;
  v_has_dsa_player_name boolean;
  v_has_dsa_speed_type_key boolean;
  v_seeded_events int := 0;
  v_seeded_speed int := 0;
  v_type text;
  v_units numeric;
begin
  select exists(select 1 from information_schema.columns where table_schema='public' and table_name='players' and column_name='pin_hash') into v_has_pin_hash;
  select exists(select 1 from information_schema.columns where table_schema='public' and table_name='players' and column_name='active') into v_has_active;
  select exists(select 1 from information_schema.columns where table_schema='public' and table_name='players' and column_name='created_at') into v_has_created_at;
  select exists(select 1 from information_schema.columns where table_schema='public' and table_name='players' and column_name='updated_at') into v_has_updated_at;
  select exists(select 1 from information_schema.columns where table_schema='public' and table_name='drink_events' and column_name='event_type_id') into v_has_de_event_type_id;
  select exists(select 1 from information_schema.columns where table_schema='public' and table_name='drink_events' and column_name='event_type_key') into v_has_de_event_type_key;
  select exists(select 1 from information_schema.columns where table_schema='public' and table_name='drink_events' and column_name='player_name') into v_has_de_player_name;
  select exists(select 1 from information_schema.columns where table_schema='public' and table_name='drink_events' and column_name='session_id') into v_has_de_session_id;
  select exists(select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_attempts' and column_name='player_name') into v_has_dsa_player_name;
  select exists(select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_attempts' and column_name='speed_type_key') into v_has_dsa_speed_type_key;

  foreach v_name in array v_names loop
    select id into v_player_id from public.players where lower(display_name)=lower(v_name) limit 1;
    if v_player_id is null then
      v_sql := 'insert into public.players (display_name';
      if v_has_pin_hash then v_sql := v_sql || ', pin_hash'; end if;
      if v_has_active then v_sql := v_sql || ', active'; end if;
      if v_has_created_at then v_sql := v_sql || ', created_at'; end if;
      if v_has_updated_at then v_sql := v_sql || ', updated_at'; end if;
      v_sql := v_sql || ') values (' || quote_literal(v_name);
      if v_has_pin_hash then v_sql := v_sql || ', extensions.crypt(''1111'', extensions.gen_salt(''bf''))'; end if;
      if v_has_active then v_sql := v_sql || ', true'; end if;
      if v_has_created_at then v_sql := v_sql || ', now()'; end if;
      if v_has_updated_at then v_sql := v_sql || ', now()'; end if;
      v_sql := v_sql || ') returning id';
      execute v_sql into v_player_id;
    end if;

    if to_regclass('public.allowed_usernames') is not null then
      begin
        insert into public.allowed_usernames (username, display_name, status, player_id)
        values (lower(replace(v_name,' ','')), v_name, 'active', v_player_id)
        on conflict (username) do update
        set display_name = excluded.display_name,
            status = 'active',
            player_id = excluded.player_id,
            updated_at = now();
      exception when others then null;
      end;
    end if;

    -- Session row if the schema needs one.
    if v_has_de_session_id and to_regclass('public.drink_sessions') is not null then
      begin
        execute 'insert into public.drink_sessions (player_id, started_at) values ($1, now()) returning id' into v_session_id using v_player_id;
      exception when others then
        v_session_id := null;
      end;
    end if;

    for v_idx in 1..3 loop
      v_type := (array['bier','ice','shot','liter_bier','wijnfles'])[1 + ((v_idx - 1) % 5)];
      v_units := case v_type when 'bier' then 1.0 when 'ice' then 2.8 when 'shot' then 0.7 when 'liter_bier' then 4.0 else 7.5 end;
      select id into v_event_type_id from public.drink_event_types where lower(key)=lower(v_type) limit 1;
      v_sql := 'insert into public.drink_events (player_id';
      if v_has_de_player_name then v_sql := v_sql || ', player_name'; end if;
      if v_has_de_event_type_id then v_sql := v_sql || ', event_type_id'; end if;
      if v_has_de_event_type_key then v_sql := v_sql || ', event_type_key'; end if;
      if v_has_de_session_id and v_session_id is not null then v_sql := v_sql || ', session_id'; end if;
      v_sql := v_sql || ', quantity, total_units, status, created_at';
      if exists(select 1 from information_schema.columns where table_schema='public' and table_name='drink_events' and column_name='verified_at') then v_sql := v_sql || ', verified_at'; end if;
      if exists(select 1 from information_schema.columns where table_schema='public' and table_name='drink_events' and column_name='lat') then v_sql := v_sql || ', lat'; end if;
      if exists(select 1 from information_schema.columns where table_schema='public' and table_name='drink_events' and column_name='lng') then v_sql := v_sql || ', lng'; end if;
      if exists(select 1 from information_schema.columns where table_schema='public' and table_name='drink_events' and column_name='accuracy') then v_sql := v_sql || ', accuracy'; end if;
      v_sql := v_sql || ') values (' || v_player_id;
      if v_has_de_player_name then v_sql := v_sql || ', ' || quote_literal(v_name); end if;
      if v_has_de_event_type_id then v_sql := v_sql || ', ' || coalesce(v_event_type_id::text,'null'); end if;
      if v_has_de_event_type_key then v_sql := v_sql || ', ' || quote_literal(v_type); end if;
      if v_has_de_session_id and v_session_id is not null then v_sql := v_sql || ', ' || v_session_id; end if;
      v_sql := v_sql || ', 1, ' || v_units || ', ''verified'', now() - interval ''' || (v_idx*2) || ' hours''';
      if exists(select 1 from information_schema.columns where table_schema='public' and table_name='drink_events' and column_name='verified_at') then v_sql := v_sql || ', now() - interval ''' || (v_idx*2-1) || ' hours'''; end if;
      if exists(select 1 from information_schema.columns where table_schema='public' and table_name='drink_events' and column_name='lat') then v_sql := v_sql || ', 53.2277'; end if;
      if exists(select 1 from information_schema.columns where table_schema='public' and table_name='drink_events' and column_name='lng') then v_sql := v_sql || ', 6.5706'; end if;
      if exists(select 1 from information_schema.columns where table_schema='public' and table_name='drink_events' and column_name='accuracy') then v_sql := v_sql || ', 20'; end if;
      v_sql := v_sql || ')';
      begin execute v_sql; v_seeded_events := v_seeded_events + 1; exception when others then null; end;
    end loop;

    for v_idx in 1..2 loop
      v_type := (array['bier','ice','shot','liter_bier','wijnfles'])[1 + ((v_idx - 1) % 5)];
      v_sql := 'insert into public.drink_speed_attempts (player_id';
      if v_has_dsa_player_name then v_sql := v_sql || ', player_name'; end if;
      if v_has_dsa_speed_type_key then v_sql := v_sql || ', speed_type_key'; end if;
      v_sql := v_sql || ', duration_seconds, status, created_at';
      if exists(select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_attempts' and column_name='lat') then v_sql := v_sql || ', lat'; end if;
      if exists(select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_attempts' and column_name='lng') then v_sql := v_sql || ', lng'; end if;
      if exists(select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_attempts' and column_name='accuracy') then v_sql := v_sql || ', accuracy'; end if;
      v_sql := v_sql || ') values (' || v_player_id;
      if v_has_dsa_player_name then v_sql := v_sql || ', ' || quote_literal(v_name); end if;
      if v_has_dsa_speed_type_key then v_sql := v_sql || ', ' || quote_literal(v_type); end if;
      v_sql := v_sql || ', ' || (4.0 + v_idx + (random()*4)) || ', ''verified'', now() - interval ''' || (v_idx) || ' hours''';
      if exists(select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_attempts' and column_name='lat') then v_sql := v_sql || ', 53.2277'; end if;
      if exists(select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_attempts' and column_name='lng') then v_sql := v_sql || ', 6.5706'; end if;
      if exists(select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_attempts' and column_name='accuracy') then v_sql := v_sql || ', 20'; end if;
      v_sql := v_sql || ')';
      begin execute v_sql; v_seeded_speed := v_seeded_speed + 1; exception when others then null; end;
    end loop;
  end loop;

  return jsonb_build_object('ok', true, 'seeded_events', v_seeded_events, 'seeded_speed', v_seeded_speed);
end;
$$;

select public.admin_seed_drinks_dummy_data();

commit;
