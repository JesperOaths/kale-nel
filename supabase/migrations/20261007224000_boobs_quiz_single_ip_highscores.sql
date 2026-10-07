-- /boobs quiz: one attempt per public IP, server-validated scoring and top-20 highscores.
-- Raw IP addresses are never persisted. A per-project random salt stored in a locked table
-- is used to HMAC the request IP exposed by PostgREST request.headers.

create table if not exists public.boobs_quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  ip_hash text not null unique,
  play_token_hash text not null unique,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  score numeric(3,1),
  grade text,
  display_name text,
  answers_summary jsonb not null default '[]'::jsonb,
  constraint boobs_quiz_score_range check (
    score is null or (score >= 0 and score <= 10 and (score * 2) = trunc(score * 2))
  ),
  constraint boobs_quiz_grade_values check (
    grade is null or grade in ('F','D','C','B','A','S+')
  ),
  constraint boobs_quiz_display_name_length check (
    display_name is null or char_length(display_name) between 1 and 24
  )
);

alter table public.boobs_quiz_attempts enable row level security;
revoke all on table public.boobs_quiz_attempts from anon, authenticated;

create index if not exists boobs_quiz_leaderboard_idx
  on public.boobs_quiz_attempts (score desc, finished_at asc)
  where finished_at is not null;

comment on table public.boobs_quiz_attempts is
  'Server-only /boobs quiz ledger. One salted hash per public IP; raw IP is never stored.';

create table if not exists public.boobs_quiz_private_settings (
  id boolean primary key default true check (id),
  ip_salt bytea not null
);

insert into public.boobs_quiz_private_settings (id, ip_salt)
values (true, extensions.gen_random_bytes(32))
on conflict (id) do nothing;

alter table public.boobs_quiz_private_settings enable row level security;
revoke all on table public.boobs_quiz_private_settings from anon, authenticated;

create or replace function public.boobs_quiz_normalize_v1(input_value text)
returns text
language sql
immutable
strict
set search_path = public
as $$
  select trim(
    regexp_replace(
      translate(
        lower(input_value),
        'áàäâãåéèëêíìïîóòöôõúùüûñç',
        'aaaaaaeeeeiiiiooooouuuunc'
      ),
      '[^a-z0-9]+',
      ' ',
      'g'
    )
  );
$$;

create or replace function public.boobs_quiz_levenshtein_v1(left_value text, right_value text)
returns integer
language plpgsql
immutable
strict
set search_path = public
as $$
declare
  a text := public.boobs_quiz_normalize_v1(left_value);
  b text := public.boobs_quiz_normalize_v1(right_value);
  la integer := char_length(a);
  lb integer := char_length(b);
  previous integer[];
  current integer[];
  i integer;
  j integer;
  cost integer;
begin
  if a = b then return 0; end if;
  if la = 0 then return lb; end if;
  if lb = 0 then return la; end if;

  previous := array_fill(0, array[lb + 1]);
  for j in 0..lb loop
    previous[j + 1] := j;
  end loop;

  for i in 1..la loop
    current := array_fill(0, array[lb + 1]);
    current[1] := i;
    for j in 1..lb loop
      cost := case when substr(a, i, 1) = substr(b, j, 1) then 0 else 1 end;
      current[j + 1] := least(
        current[j] + 1,
        previous[j + 1] + 1,
        previous[j] + cost
      );
    end loop;
    previous := current;
  end loop;

  return previous[lb + 1];
end;
$$;

create or replace function public.boobs_quiz_leaderboard_v1()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'rank', ranked.rn,
      'name', ranked.display_name,
      'score', ranked.score,
      'grade', ranked.grade
    )
    order by ranked.rn
  ), '[]'::jsonb)
  from (
    select
      row_number() over (order by score desc, finished_at asc, id asc)::int as rn,
      display_name,
      score,
      grade
    from public.boobs_quiz_attempts
    where finished_at is not null
      and display_name is not null
    order by score desc, finished_at asc, id asc
    limit 20
  ) ranked;
$$;

create or replace function public.boobs_quiz_api_v1(
  action_input text,
  token_input text default null,
  name_input text default null,
  answers_input jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_action text := lower(trim(coalesce(action_input, 'status')));
  v_headers jsonb := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  v_ip text;
  v_salt bytea;
  v_ip_hash text;
  v_token_hash text;
  v_attempt public.boobs_quiz_attempts%rowtype;
  v_token text;
  v_name text;
  v_score numeric(3,1) := 0;
  v_grade text;
  v_answers text[] := array[
    'Alexandra Daddario',
    'Margot Robbie',
    'Kate Upton',
    'Sofia Vergara',
    'Sydney Sweeney',
    'Pamela Anderson',
    'Salma Hayek',
    'Scarlett Johansson',
    'Ana de Armas',
    'Mia Khalifa'
  ];
  v_summary jsonb := '[]'::jsonb;
  v_row jsonb;
  v_candidate text;
  v_expected text;
  v_distance integer;
  v_max_edits integer;
  v_similarity numeric;
  v_correct boolean;
  v_hint boolean;
  v_points numeric(2,1);
  v_i integer;
begin
  if v_action = 'leaderboard' then
    return jsonb_build_object('ok', true, 'leaderboard', public.boobs_quiz_leaderboard_v1());
  end if;

  select ip_salt into v_salt
  from public.boobs_quiz_private_settings
  where id = true;

  if v_salt is null then
    raise exception 'quiz_salt_missing';
  end if;

  v_ip := nullif(trim(split_part(coalesce(
    nullif(v_headers->>'x-forwarded-for', ''),
    nullif(v_headers->>'cf-connecting-ip', ''),
    nullif(v_headers->>'x-real-ip', ''),
    ''
  ), ',', 1)), '');

  if v_ip is null then
    return jsonb_build_object('ok', false, 'error', 'client_ip_unavailable');
  end if;

  v_ip_hash := encode(
    extensions.hmac(convert_to('boobs-ip-v1:' || v_ip, 'UTF8'), v_salt, 'sha256'),
    'hex'
  );

  select * into v_attempt
  from public.boobs_quiz_attempts
  where ip_hash = v_ip_hash
  limit 1;

  if v_action = 'status' then
    if v_attempt.id is null then
      return jsonb_build_object('ok', true, 'played', false, 'finished', false);
    end if;

    if nullif(trim(coalesce(token_input, '')), '') is not null then
      v_token_hash := encode(
        extensions.hmac(convert_to('boobs-token-v1:' || trim(token_input), 'UTF8'), v_salt, 'sha256'),
        'hex'
      );
    end if;

    return jsonb_build_object(
      'ok', true,
      'played', true,
      'owns', coalesce(v_token_hash = v_attempt.play_token_hash, false),
      'finished', v_attempt.finished_at is not null,
      'score', v_attempt.score,
      'grade', v_attempt.grade,
      'name', v_attempt.display_name
    );
  end if;

  if v_action = 'start' then
    if v_attempt.id is not null then
      if nullif(trim(coalesce(token_input, '')), '') is not null then
        v_token_hash := encode(
          extensions.hmac(convert_to('boobs-token-v1:' || trim(token_input), 'UTF8'), v_salt, 'sha256'),
          'hex'
        );
      end if;

      return jsonb_build_object(
        'ok', true,
        'allowed', coalesce(v_token_hash = v_attempt.play_token_hash, false) and v_attempt.finished_at is null,
        'played', true,
        'owns', coalesce(v_token_hash = v_attempt.play_token_hash, false),
        'finished', v_attempt.finished_at is not null,
        'score', v_attempt.score,
        'grade', v_attempt.grade,
        'name', v_attempt.display_name
      );
    end if;

    v_token := extensions.gen_random_uuid()::text || '.' || extensions.gen_random_uuid()::text;
    v_token_hash := encode(
      extensions.hmac(convert_to('boobs-token-v1:' || v_token, 'UTF8'), v_salt, 'sha256'),
      'hex'
    );

    begin
      insert into public.boobs_quiz_attempts (ip_hash, play_token_hash)
      values (v_ip_hash, v_token_hash);
    exception when unique_violation then
      return jsonb_build_object('ok', true, 'allowed', false, 'played', true, 'owns', false, 'finished', false);
    end;

    return jsonb_build_object('ok', true, 'allowed', true, 'played', false, 'token', v_token);
  end if;

  if v_action in ('complete', 'finish') then
    if v_attempt.id is null then
      return jsonb_build_object('ok', false, 'error', 'attempt_not_found');
    end if;

    if nullif(trim(coalesce(token_input, '')), '') is null then
      return jsonb_build_object('ok', false, 'error', 'missing_token');
    end if;

    v_token_hash := encode(
      extensions.hmac(convert_to('boobs-token-v1:' || trim(token_input), 'UTF8'), v_salt, 'sha256'),
      'hex'
    );

    if v_token_hash <> v_attempt.play_token_hash then
      return jsonb_build_object('ok', false, 'error', 'attempt_not_owned');
    end if;

    if v_attempt.finished_at is not null then
      return jsonb_build_object(
        'ok', true,
        'already_finished', true,
        'score', v_attempt.score,
        'grade', v_attempt.grade,
        'name', v_attempt.display_name,
        'leaderboard', public.boobs_quiz_leaderboard_v1()
      );
    end if;

    if jsonb_typeof(answers_input) <> 'array' or jsonb_array_length(answers_input) <> 10 then
      return jsonb_build_object('ok', false, 'error', 'answers_incomplete');
    end if;

    for v_i in 0..9 loop
      v_row := answers_input->v_i;
      v_candidate := public.boobs_quiz_normalize_v1(coalesce(v_row->>'input', ''));
      v_expected := public.boobs_quiz_normalize_v1(v_answers[v_i + 1]);
      v_hint := lower(coalesce(v_row->>'hintUsed', 'false')) in ('true','t','1','yes','on');

      if v_candidate = '' then
        v_correct := false;
      else
        v_distance := public.boobs_quiz_levenshtein_v1(v_candidate, v_expected);
        v_max_edits := case
          when char_length(v_expected) >= 16 then 3
          when char_length(v_expected) >= 8 then 2
          else 1
        end;
        v_similarity := 1 - (
          v_distance::numeric /
          greatest(char_length(v_candidate), char_length(v_expected), 1)
        );
        v_correct := v_candidate = v_expected
          or v_distance <= v_max_edits
          or v_similarity >= 0.84;
      end if;

      v_points := case
        when v_correct then case when v_hint then 0.5 else 1.0 end
        else 0.0
      end;

      v_score := v_score + v_points;
      v_summary := v_summary || jsonb_build_array(jsonb_build_object(
        'round', v_i + 1,
        'correct', v_correct,
        'hintUsed', v_hint,
        'points', v_points
      ));
    end loop;

    v_grade := case
      when v_score >= 10 then 'S+'
      when v_score >= 8.5 then 'A'
      when v_score >= 7 then 'B'
      when v_score >= 5 then 'C'
      when v_score >= 3 then 'D'
      else 'F'
    end;

    update public.boobs_quiz_attempts
    set
      finished_at = now(),
      score = v_score,
      grade = v_grade,
      answers_summary = v_summary
    where id = v_attempt.id
      and finished_at is null;

    return jsonb_build_object(
      'ok', true,
      'score', v_score,
      'grade', v_grade,
      'name', null,
      'leaderboard', public.boobs_quiz_leaderboard_v1()
    );
  end if;

  if v_action = 'name' then
    if v_attempt.id is null then
      return jsonb_build_object('ok', false, 'error', 'attempt_not_found');
    end if;

    if nullif(trim(coalesce(token_input, '')), '') is null then
      return jsonb_build_object('ok', false, 'error', 'missing_token');
    end if;

    v_token_hash := encode(
      extensions.hmac(convert_to('boobs-token-v1:' || trim(token_input), 'UTF8'), v_salt, 'sha256'),
      'hex'
    );

    if v_token_hash <> v_attempt.play_token_hash then
      return jsonb_build_object('ok', false, 'error', 'attempt_not_owned');
    end if;

    if v_attempt.finished_at is null then
      return jsonb_build_object('ok', false, 'error', 'attempt_not_finished');
    end if;

    if v_attempt.display_name is not null then
      return jsonb_build_object(
        'ok', true,
        'already_named', true,
        'score', v_attempt.score,
        'grade', v_attempt.grade,
        'name', v_attempt.display_name,
        'leaderboard', public.boobs_quiz_leaderboard_v1()
      );
    end if;

    v_name := left(
      trim(
        regexp_replace(
          regexp_replace(coalesce(name_input, ''), '[[:cntrl:]]', '', 'g'),
          '[[:space:]]+',
          ' ',
          'g'
        )
      ),
      24
    );

    if v_name is null or v_name = '' then
      return jsonb_build_object('ok', false, 'error', 'name_required');
    end if;

    update public.boobs_quiz_attempts
    set display_name = v_name
    where id = v_attempt.id
      and display_name is null;

    select * into v_attempt
    from public.boobs_quiz_attempts
    where id = v_attempt.id;

    return jsonb_build_object(
      'ok', true,
      'score', v_attempt.score,
      'grade', v_attempt.grade,
      'name', v_attempt.display_name,
      'leaderboard', public.boobs_quiz_leaderboard_v1()
    );
  end if;

  return jsonb_build_object('ok', false, 'error', 'unknown_action');
end;
$$;

revoke all on function public.boobs_quiz_normalize_v1(text) from public;
revoke all on function public.boobs_quiz_levenshtein_v1(text, text) from public;
revoke all on function public.boobs_quiz_leaderboard_v1() from public;
revoke all on function public.boobs_quiz_api_v1(text, text, text, jsonb) from public;

grant execute on function public.boobs_quiz_api_v1(text, text, text, jsonb) to anon, authenticated;

comment on function public.boobs_quiz_api_v1(text, text, text, jsonb) is
  'Public RPC for /boobs. Enforces one attempt per client IP using a server-secret salted HMAC, validates final score server-side, and returns a top-20 leaderboard.';
