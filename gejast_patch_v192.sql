-- Gejast v192
-- More schema-aware drinks seeding + activation placeholder + verification hardening follow-up.

begin;

-- Keep Test Dummy activatable/selectable.
insert into public.allowed_usernames (username, display_name, status)
select 'testdummy', 'Test Dummy', 'approved'
where to_regclass('public.allowed_usernames') is not null
  and not exists (select 1 from public.allowed_usernames where lower(username)='testdummy');

-- Helper function to seed dummy drinks via the real project flow when available.
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
  v_tokens jsonb := '{}'::jsonb;
  v_login jsonb;
  v_event jsonb;
  v_event_id bigint;
  v_speed jsonb;
  v_speed_id bigint;
  v_submitter text;
  v_verifier text;
  v_type text;
  v_idx int;
  v_lat numeric := 52.0110;
  v_lng numeric := 4.3570;
  v_has_pin_hash boolean;
  v_has_active boolean;
  v_has_created_at boolean;
  v_has_updated_at boolean;
  v_sql text;
  v_seeded_events int := 0;
  v_seeded_speed int := 0;
begin
  select exists(select 1 from information_schema.columns where table_schema='public' and table_name='players' and column_name='pin_hash') into v_has_pin_hash;
  select exists(select 1 from information_schema.columns where table_schema='public' and table_name='players' and column_name='active') into v_has_active;
  select exists(select 1 from information_schema.columns where table_schema='public' and table_name='players' and column_name='created_at') into v_has_created_at;
  select exists(select 1 from information_schema.columns where table_schema='public' and table_name='players' and column_name='updated_at') into v_has_updated_at;

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
      v_sql := v_sql || ')';
      execute v_sql;
    end if;

    if to_regclass('public.allowed_usernames') is not null then
      begin
        insert into public.allowed_usernames (username, display_name, status)
        values (lower(replace(v_name,' ','')), v_name, 'active')
        on conflict (username) do update set display_name = excluded.display_name, status='active';
      exception when others then null;
      end;
    end if;

    begin
      execute format('select public.login_player(%L,%L)', v_name, '1111') into v_login;
      if v_login ? 'session_token' then
        v_tokens := v_tokens || jsonb_build_object(v_name, v_login->>'session_token');
      end if;
    exception when others then null;
    end;
  end loop;

  if jsonb_object_length(v_tokens) = 0 then
    return jsonb_build_object('ok', false, 'message', 'Geen sessions kunnen maken via login_player.');
  end if;

  for v_idx in 1..18 loop
    v_submitter := v_names[1 + ((v_idx - 1) % array_length(v_names,1))];
    v_verifier := case when v_submitter = 'Verifier 1111' then 'Drinks Dummy 1' else 'Verifier 1111' end;
    v_type := (array['bier','bier','ice','shot','liter_bier','wijnfles'])[1 + ((v_idx - 1) % 6)];
    begin
      execute format($f$select public.create_drink_event(%L,%L,%s,%s,%s,%s)$f$, v_tokens->>v_submitter, v_type, 1, v_lat, v_lng, 8) into v_event;
      v_event_id := coalesce((v_event->>'drink_event_id')::bigint, (v_event->>'id')::bigint);
      if v_event_id is not null then
        perform public.verify_drink_event(v_tokens->>v_verifier, v_event_id, v_lat, v_lng, 8, true, 'seed');
        v_seeded_events := v_seeded_events + 1;
      end if;
    exception when others then null;
    end;
  end loop;

  for v_idx in 1..12 loop
    v_submitter := v_names[1 + ((v_idx - 1) % array_length(v_names,1))];
    v_verifier := case when v_submitter = 'Verifier 1111' then 'Drinks Dummy 1' else 'Verifier 1111' end;
    v_type := (array['bier','ice','shot','liter_bier','wijnfles'])[1 + ((v_idx - 1) % 5)];
    begin
      execute format($f$select public.create_drink_speed_attempt(%L,%L,%s,%s,%s,%s)$f$, v_tokens->>v_submitter, v_type, (3.0 + v_idx), v_lat, v_lng, 8) into v_speed;
      v_speed_id := coalesce((v_speed->>'attempt_id')::bigint, (v_speed->>'id')::bigint);
      if v_speed_id is not null then
        perform public.verify_drink_speed_attempt(v_tokens->>v_verifier, v_speed_id, v_lat, v_lng, 8);
        v_seeded_speed := v_seeded_speed + 1;
      end if;
    exception when others then null;
    end;
  end loop;

  return jsonb_build_object('ok', true, 'seeded_events', v_seeded_events, 'seeded_speed', v_seeded_speed, 'message', 'Dummy drinks data geprobeerd te zaaien via live RPCs.');
end;
$$;

commit;
