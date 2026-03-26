begin;

create table if not exists public.boerenbridge_matches (
  id bigserial primary key,
  client_match_id text not null unique,
  created_by_player_id bigint,
  app_version text,
  rules_version text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  participant_names text[] not null default '{}',
  player_count integer not null default 0,
  winner_names text[] not null default '{}',
  top_score integer,
  totals jsonb not null default '[]'::jsonb,
  match_payload jsonb not null default '{}'::jsonb
);

create index if not exists boerenbridge_matches_created_by_idx on public.boerenbridge_matches (created_by_player_id);
create index if not exists boerenbridge_matches_finished_at_idx on public.boerenbridge_matches (finished_at desc nulls last);

create table if not exists public.boerenbridge_match_rounds (
  id bigserial primary key,
  match_id bigint not null references public.boerenbridge_matches(id) on delete cascade,
  round_index integer not null,
  label text not null,
  trick_count integer not null,
  dealer_index integer,
  special_name text,
  round_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (match_id, round_index)
);

create index if not exists boerenbridge_match_rounds_match_idx on public.boerenbridge_match_rounds(match_id, round_index);

create table if not exists public.boerenbridge_player_stats (
  player_name text primary key,
  games_played integer not null default 0,
  wins integer not null default 0,
  total_points integer not null default 0,
  exact_bid_count integer not null default 0,
  total_slagen integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_trusted_devices (
  id bigserial primary key,
  admin_username text not null,
  device_token_hash text not null unique,
  device_label text,
  device_meta jsonb not null default '{}'::jsonb,
  trusted_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists admin_trusted_devices_admin_idx on public.admin_trusted_devices (admin_username, revoked_at);

create or replace function public.save_boerenbridge_match(
  session_token text,
  client_match_id text,
  rules_version text,
  app_version text,
  match_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_player public.players%rowtype;
  v_payload jsonb := coalesce(match_payload, '{}'::jsonb);
  v_match_id bigint;
  v_totals jsonb := coalesce(v_payload->'totals', '[]'::jsonb);
  v_summary jsonb := coalesce(v_payload->'match_summary', '{}'::jsonb);
  v_round jsonb;
  v_player_name text;
  v_points integer;
  v_exact integer;
  v_slagen integer;
begin
  if nullif(trim(coalesce(client_match_id, '')), '') is null then
    raise exception 'client_match_id ontbreekt';
  end if;

  begin
    if nullif(trim(coalesce(session_token, '')), '') is not null then
      v_player := public._gejast_player_from_session(session_token);
    end if;
  exception when others then
    null;
  end;

  insert into public.boerenbridge_matches (
    client_match_id,
    created_by_player_id,
    app_version,
    rules_version,
    created_at,
    finished_at,
    participant_names,
    player_count,
    winner_names,
    top_score,
    totals,
    match_payload
  )
  values (
    client_match_id,
    v_player.id,
    coalesce(app_version, v_payload->>'app_version'),
    coalesce(rules_version, v_payload->>'rules_version'),
    coalesce((v_payload->>'created_at')::timestamptz, now()),
    (v_payload->>'finished_at')::timestamptz,
    coalesce((select array_agg(value::text) from jsonb_array_elements_text(coalesce(v_payload->'participants','[]'::jsonb))), '{}'::text[]),
    coalesce((v_payload->>'player_count')::integer, 0),
    coalesce((select array_agg(value::text) from jsonb_array_elements_text(coalesce(v_summary->'winner_names','[]'::jsonb))), '{}'::text[]),
    nullif(v_summary->>'top_score','')::integer,
    v_totals,
    v_payload
  )
  on conflict (client_match_id)
  do update set
    created_by_player_id = excluded.created_by_player_id,
    app_version = excluded.app_version,
    rules_version = excluded.rules_version,
    finished_at = excluded.finished_at,
    participant_names = excluded.participant_names,
    player_count = excluded.player_count,
    winner_names = excluded.winner_names,
    top_score = excluded.top_score,
    totals = excluded.totals,
    match_payload = excluded.match_payload
  returning id into v_match_id;

  delete from public.boerenbridge_match_rounds where match_id = v_match_id;

  for v_round in select value from jsonb_array_elements(coalesce(v_payload->'rounds','[]'::jsonb))
  loop
    insert into public.boerenbridge_match_rounds (
      match_id, round_index, label, trick_count, dealer_index, special_name, round_payload
    ) values (
      v_match_id,
      coalesce((v_round->>'round_index')::integer, 0),
      coalesce(v_round->>'label', '?'),
      coalesce((v_round->>'trick_count')::integer, 0),
      nullif(v_round->>'dealer_index','')::integer,
      nullif(v_round->>'special',''),
      v_round
    );
  end loop;

  for v_player_name, v_points, v_exact, v_slagen in
    select
      coalesce(value->>'name',''),
      coalesce((value->>'final_total_points')::integer, 0),
      coalesce((value->>'exact_bid_count')::integer, 0),
      coalesce((value->>'total_slagen')::integer, 0)
    from jsonb_array_elements(v_totals)
  loop
    if nullif(trim(v_player_name), '') is null then
      continue;
    end if;

    insert into public.boerenbridge_player_stats (
      player_name, games_played, wins, total_points, exact_bid_count, total_slagen, updated_at
    ) values (
      v_player_name,
      1,
      case when v_player_name = any(coalesce((select array_agg(value::text) from jsonb_array_elements_text(coalesce(v_summary->'winner_names','[]'::jsonb))), '{}'::text[])) then 1 else 0 end,
      v_points,
      v_exact,
      v_slagen,
      now()
    )
    on conflict (player_name)
    do update set
      games_played = public.boerenbridge_player_stats.games_played + 1,
      wins = public.boerenbridge_player_stats.wins + case when excluded.wins > 0 then 1 else 0 end,
      total_points = public.boerenbridge_player_stats.total_points + excluded.total_points,
      exact_bid_count = public.boerenbridge_player_stats.exact_bid_count + excluded.exact_bid_count,
      total_slagen = public.boerenbridge_player_stats.total_slagen + excluded.total_slagen,
      updated_at = now();
  end loop;

  return jsonb_build_object('ok', true, 'match_id', v_match_id, 'client_match_id', client_match_id);
end;
$function$;

create or replace function public.admin_trust_device_action(
  admin_session_token text,
  input_device_token_hash text,
  input_device_label text default null,
  input_device_meta jsonb default '{}'::jsonb,
  input_admin_username text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_session jsonb;
  v_admin_username text;
begin
  if nullif(trim(coalesce(input_device_token_hash, '')), '') is null then
    raise exception 'device_token_hash ontbreekt';
  end if;

  v_session := to_jsonb(public.admin_check_session(admin_session_token));
  v_admin_username := coalesce(
    nullif(trim(input_admin_username), ''),
    nullif(trim(v_session->>'admin_username'), ''),
    nullif(trim(v_session->>'username'), '')
  );

  if v_admin_username is null then
    raise exception 'Kon adminnaam niet bepalen';
  end if;

  insert into public.admin_trusted_devices (
    admin_username,
    device_token_hash,
    device_label,
    device_meta,
    trusted_at,
    last_seen_at,
    revoked_at
  ) values (
    v_admin_username,
    input_device_token_hash,
    nullif(trim(coalesce(input_device_label, '')), ''),
    coalesce(input_device_meta, '{}'::jsonb),
    now(),
    now(),
    null
  )
  on conflict (device_token_hash)
  do update set
    admin_username = excluded.admin_username,
    device_label = excluded.device_label,
    device_meta = excluded.device_meta,
    trusted_at = now(),
    last_seen_at = now(),
    revoked_at = null;

  return jsonb_build_object('ok', true, 'admin_username', v_admin_username);
end;
$function$;

create or replace function public.admin_forget_device_action(
  admin_session_token text,
  input_device_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform public.admin_check_session(admin_session_token);

  update public.admin_trusted_devices
     set revoked_at = now(),
         last_seen_at = now()
   where device_token_hash = input_device_token_hash
     and revoked_at is null;

  return jsonb_build_object('ok', true);
end;
$function$;

create or replace function public.admin_check_session_with_device(
  admin_session_token text,
  input_device_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_session jsonb;
  v_admin_username text;
begin
  v_session := to_jsonb(public.admin_check_session(admin_session_token));
  v_admin_username := coalesce(nullif(trim(v_session->>'admin_username'),''), nullif(trim(v_session->>'username'),''));

  if not exists (
    select 1
      from public.admin_trusted_devices d
     where d.device_token_hash = input_device_token_hash
       and d.admin_username = v_admin_username
       and d.revoked_at is null
  ) then
    raise exception 'Dit apparaat is niet vertrouwd';
  end if;

  update public.admin_trusted_devices
     set last_seen_at = now()
   where device_token_hash = input_device_token_hash
     and revoked_at is null;

  return jsonb_build_object('ok', true, 'admin_username', v_admin_username);
end;
$function$;

grant execute on function public.save_boerenbridge_match(text, text, text, text, jsonb) to anon, authenticated;
grant execute on function public.admin_trust_device_action(text, text, text, jsonb, text) to anon, authenticated;
grant execute on function public.admin_forget_device_action(text, text) to anon, authenticated;
grant execute on function public.admin_check_session_with_device(text, text) to anon, authenticated;

commit;
