begin;

create or replace function public._gejast_live_scope_norm_v352(v text)
returns text
language sql
immutable
as $$
  select case when lower(trim(coalesce(v, ''))) = 'family' then 'family' else 'friends' end
$$;

create or replace function public._gejast_live_effective_finished_at_v352(
  summary_payload_input jsonb,
  finished_at_input timestamptz,
  created_at_input timestamptz
)
returns timestamptz
language sql
stable
as $$
  select coalesce(
    finished_at_input,
    nullif(summary_payload_input->>'finished_at', '')::timestamptz,
    nullif(summary_payload_input->'raw_payload'->>'finished_at', '')::timestamptz,
    case
      when lower(coalesce(summary_payload_input->'live_state'->>'status', '')) = 'finished'
      then coalesce(
        nullif(summary_payload_input->'live_state'->>'updated_at', '')::timestamptz,
        created_at_input
      )
      else null
    end
  )
$$;

create or replace function public._gejast_live_effective_updated_at_v352(
  summary_payload_input jsonb,
  created_at_input timestamptz,
  finished_at_input timestamptz
)
returns timestamptz
language sql
stable
as $$
  select coalesce(
    nullif(summary_payload_input->'live_state'->>'updated_at', '')::timestamptz,
    finished_at_input,
    created_at_input
  )
$$;

create or replace function public._gejast_live_submitter_name_v352(
  summary_payload_input jsonb
)
returns text
language sql
stable
as $$
  select nullif(trim(coalesce(
    summary_payload_input->'submitter_meta'->>'submitted_by_name',
    summary_payload_input->'raw_payload'->'submitter_meta'->>'submitted_by_name',
    summary_payload_input->'submitter_meta'->>'player_name'
  , '')), '')
$$;

create or replace function public._gejast_live_surface_rows_v352(
  site_scope_input text default 'friends',
  include_finished boolean default false
)
returns table(
  game_type text,
  client_match_id text,
  site_scope text,
  participants text[],
  winner_names text[],
  submitter_name text,
  summary_payload jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  finished_at timestamptz,
  is_live boolean
)
language sql
stable
as $$
  with base as (
    select
      lower(coalesce(g.game_type, '')) as game_type,
      g.client_match_id,
      public._gejast_live_scope_norm_v352(coalesce(g.site_scope, 'friends')) as site_scope,
      coalesce(
        nullif(g.participant_names, '{}'::text[]),
        (select array_agg(value::text) from jsonb_array_elements_text(coalesce(g.summary_payload->'participants', '[]'::jsonb))),
        (select array_agg(value::text) from jsonb_array_elements_text(coalesce(g.summary_payload->'players', '[]'::jsonb))),
        '{}'::text[]
      ) as participants,
      coalesce(
        nullif(g.winner_names, '{}'::text[]),
        (select array_agg(value::text) from jsonb_array_elements_text(coalesce(g.summary_payload->'winner_names', '[]'::jsonb))),
        '{}'::text[]
      ) as winner_names,
      public._gejast_live_submitter_name_v352(coalesce(g.summary_payload, '{}'::jsonb)) as submitter_name,
      coalesce(g.summary_payload, '{}'::jsonb) as summary_payload,
      g.created_at,
      public._gejast_live_effective_updated_at_v352(
        coalesce(g.summary_payload, '{}'::jsonb),
        g.created_at,
        public._gejast_live_effective_finished_at_v352(coalesce(g.summary_payload, '{}'::jsonb), g.finished_at, g.created_at)
      ) as updated_at,
      public._gejast_live_effective_finished_at_v352(coalesce(g.summary_payload, '{}'::jsonb), g.finished_at, g.created_at) as finished_at
    from public.game_match_summaries g
    where lower(coalesce(g.game_type, '')) in ('klaverjas', 'boerenbridge')
      and public._gejast_live_scope_norm_v352(coalesce(g.site_scope, 'friends')) = public._gejast_live_scope_norm_v352(site_scope_input)
  )
  select
    b.game_type,
    b.client_match_id,
    b.site_scope,
    b.participants,
    b.winner_names,
    b.submitter_name,
    b.summary_payload,
    b.created_at,
    b.updated_at,
    b.finished_at,
    (b.finished_at is null) as is_live
  from base b
  where include_finished or b.finished_at is null
$$;

create or replace function public.save_game_match_summary_scoped(
  session_token text default null,
  game_type text default null,
  client_match_id text default null,
  summary_payload jsonb default '{}'::jsonb,
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_scope text := public._gejast_live_scope_norm_v352(site_scope_input);
  v_game_type text := lower(trim(coalesce(game_type, '')));
  v_client_match_id text := nullif(trim(coalesce(client_match_id, '')), '');
  v_viewer_name text := null;
  v_summary jsonb := coalesce(summary_payload, '{}'::jsonb);
  v_finished_at timestamptz;
  v_participants text[] := '{}'::text[];
  v_winner_names text[] := '{}'::text[];
  v_submitter_meta jsonb;
  v_raw_result jsonb;
begin
  if v_game_type not in ('klaverjas', 'boerenbridge') then
    raise exception 'game_type ongeldig';
  end if;

  if v_client_match_id is null then
    raise exception 'client_match_id ontbreekt';
  end if;

  begin
    v_viewer_name := public._gejast_name_for_session(session_token);
  exception when others then
    v_viewer_name := null;
  end;

  v_participants := coalesce(
    (select array_agg(value::text) from jsonb_array_elements_text(coalesce(v_summary->'participants', '[]'::jsonb))),
    '{}'::text[]
  );
  v_winner_names := coalesce(
    (select array_agg(value::text) from jsonb_array_elements_text(coalesce(v_summary->'winner_names', '[]'::jsonb))),
    '{}'::text[]
  );

  v_submitter_meta := coalesce(v_summary->'submitter_meta', '{}'::jsonb);
  if nullif(trim(coalesce(v_submitter_meta->>'submitted_by_name', '')), '') is null and v_viewer_name is not null then
    v_submitter_meta := v_submitter_meta || jsonb_build_object('submitted_by_name', v_viewer_name);
  end if;
  if nullif(trim(coalesce(v_submitter_meta->>'submitted_at', '')), '') is null then
    v_submitter_meta := v_submitter_meta || jsonb_build_object('submitted_at', now());
  end if;

  v_summary := v_summary
    || jsonb_build_object('match_ref', v_client_match_id)
    || jsonb_build_object('submitter_meta', v_submitter_meta);

  v_finished_at := public._gejast_live_effective_finished_at_v352(v_summary, nullif(v_summary->>'finished_at', '')::timestamptz, now());
  if v_finished_at is not null then
    v_summary := jsonb_set(
      jsonb_set(v_summary, '{finished_at}', to_jsonb(v_finished_at), true),
      '{live_state,status}',
      to_jsonb('finished'::text),
      true
    );
  else
    v_summary := jsonb_set(
      v_summary,
      '{live_state,status}',
      to_jsonb(coalesce(nullif(v_summary->'live_state'->>'status', ''), 'live')),
      true
    );
  end if;

  v_summary := jsonb_set(
    v_summary,
    '{live_state,updated_at}',
    to_jsonb(coalesce(nullif(v_summary->'live_state'->>'updated_at', '')::timestamptz, now())),
    true
  );

  v_raw_result := public.save_game_match_summary(
    session_token => session_token,
    game_type => v_game_type,
    client_match_id => v_client_match_id,
    summary_payload => v_summary
  );

  update public.game_match_summaries g
     set site_scope = v_scope,
         finished_at = public._gejast_live_effective_finished_at_v352(v_summary, g.finished_at, g.created_at),
         winner_names = coalesce(v_winner_names, '{}'::text[]),
         participant_names = coalesce(v_participants, '{}'::text[]),
         recap_text = coalesce(nullif(trim(coalesce(v_summary->>'recap_text', '')), ''), g.recap_text),
         summary_payload = v_summary
   where lower(g.game_type) = v_game_type
     and g.client_match_id = v_client_match_id;

  return jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'saved', true,
      'game_type', v_game_type,
      'client_match_id', v_client_match_id,
      'site_scope', v_scope,
      'finished_at', v_finished_at,
      'is_live', v_finished_at is null,
      'legacy_result', coalesce(v_raw_result, '{}'::jsonb)
    )
  );
end;
$$;

create or replace function public.repair_finished_match_summaries_v352(
  limit_count integer default 500
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_updated integer := 0;
begin
  with repairable as (
    select
      g.id,
      public._gejast_live_effective_finished_at_v352(coalesce(g.summary_payload, '{}'::jsonb), g.finished_at, g.created_at) as repaired_finished_at
    from public.game_match_summaries g
    where lower(coalesce(g.game_type, '')) in ('klaverjas', 'boerenbridge')
      and g.finished_at is null
      and public._gejast_live_effective_finished_at_v352(coalesce(g.summary_payload, '{}'::jsonb), g.finished_at, g.created_at) is not null
    order by g.created_at desc
    limit greatest(1, least(coalesce(limit_count, 500), 5000))
  )
  update public.game_match_summaries g
     set finished_at = r.repaired_finished_at
    from repairable r
   where g.id = r.id;

  get diagnostics v_updated = row_count;

  return jsonb_build_object(
    'ok', true,
    'updated_rows', v_updated
  );
end;
$$;

create or replace function public.get_live_surface_bundle_scoped(
  session_token text default null,
  site_scope_input text default 'friends',
  game_type_input text default null,
  client_match_id_input text default null,
  include_finished boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_scope text := public._gejast_live_scope_norm_v352(site_scope_input);
  v_viewer_name text := null;
  v_game text := nullif(lower(trim(coalesce(game_type_input, ''))), '');
  v_client_match_id text := nullif(trim(coalesce(client_match_id_input, '')), '');
  v_matches jsonb := '[]'::jsonb;
  v_match jsonb := null;
  v_kl jsonb := jsonb_build_object('is_live', false);
  v_bb jsonb := jsonb_build_object('is_live', false);
begin
  perform public.repair_finished_match_summaries_v352(250);

  begin
    v_viewer_name := public._gejast_name_for_session(session_token);
  exception when others then
    v_viewer_name := null;
  end;

  with live_rows as (
    select
      r.*,
      (v_viewer_name is not null and public._gejast_live_submitter_name_v352(r.summary_payload) is not null and lower(public._gejast_live_submitter_name_v352(r.summary_payload)) = lower(v_viewer_name)) as is_submitter,
      (v_viewer_name is not null and exists (
        select 1 from unnest(coalesce(r.participants, '{}'::text[])) p where lower(p) = lower(v_viewer_name)
      )) as is_participant
    from public._gejast_live_surface_rows_v352(v_scope, include_finished or v_client_match_id is not null) r
    where (v_game is null or r.game_type = v_game)
      and (v_client_match_id is null or r.client_match_id = v_client_match_id)
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'game_type', l.game_type,
      'client_match_id', l.client_match_id,
      'site_scope', l.site_scope,
      'participants', to_jsonb(coalesce(l.participants, '{}'::text[])),
      'winner_names', to_jsonb(coalesce(l.winner_names, '{}'::text[])),
      'submitter_name', l.submitter_name,
      'summary_payload', l.summary_payload,
      'created_at', l.created_at,
      'updated_at', l.updated_at,
      'finished_at', l.finished_at,
      'is_live', l.is_live,
      'viewer_role', case when l.is_submitter then 'submitter' when l.is_participant then 'participant' else null end,
      'live_href', case when l.game_type = 'klaverjas' then './klaverjas_live.html?match_ref=' || l.client_match_id else './boerenbridge_live.html?match_ref=' || l.client_match_id end,
      'manage_href', './match_control.html?game=' || l.game_type || '&match_ref=' || l.client_match_id
    )
    order by l.updated_at desc, l.created_at desc
  ), '[]'::jsonb)
  into v_matches
  from live_rows l
  where include_finished or l.is_live;

  if v_client_match_id is not null then
    select value
      into v_match
      from jsonb_array_elements(coalesce(v_matches, '[]'::jsonb))
      limit 1;
  end if;

  if v_viewer_name is not null then
    with per_game as (
      select
        l.*,
        row_number() over (
          partition by l.game_type
          order by
            case when l.is_submitter then 0 else 1 end,
            l.updated_at desc,
            l.created_at desc
        ) as rn
      from (
        select
          r.*,
          (public._gejast_live_submitter_name_v352(r.summary_payload) is not null and lower(public._gejast_live_submitter_name_v352(r.summary_payload)) = lower(v_viewer_name)) as is_submitter,
          exists (select 1 from unnest(coalesce(r.participants, '{}'::text[])) p where lower(p) = lower(v_viewer_name)) as is_participant
        from public._gejast_live_surface_rows_v352(v_scope, false) r
      ) l
      where l.is_live
        and (l.is_submitter or l.is_participant)
    )
    select
      max(case when game_type = 'klaverjas' and rn = 1 then jsonb_build_object(
        'is_live', true,
        'match_ref', client_match_id,
        'label', case when is_submitter then 'Klaverjas beheren' else 'Klaverjas Live' end,
        'copy', case when is_submitter then 'Open jouw huidige inzending in Wedstrijden beheren.' else 'Bekijk live scoreblad van jouw huidige potje.' end,
        'mode', case when is_submitter then 'manage' else 'spectate' end,
        'href', case when is_submitter then './match_control.html?game=klaverjas&match_ref=' || client_match_id else './klaverjas_live.html?match_ref=' || client_match_id end
      ) end),
      max(case when game_type = 'boerenbridge' and rn = 1 then jsonb_build_object(
        'is_live', true,
        'match_ref', client_match_id,
        'label', case when is_submitter then 'Boerenbridge beheren' else 'Boerenbridge Live' end,
        'copy', case when is_submitter then 'Open jouw huidige inzending in Wedstrijden beheren.' else 'Bekijk live scoreblad van jouw huidige potje.' end,
        'mode', case when is_submitter then 'manage' else 'spectate' end,
        'href', case when is_submitter then './match_control.html?game=boerenbridge&match_ref=' || client_match_id else './boerenbridge_live.html?match_ref=' || client_match_id end
      ) end)
    into v_kl, v_bb
    from per_game;
  end if;

  return jsonb_build_object(
    'ok', true,
    'data', jsonb_build_object(
      'viewer_name', v_viewer_name,
      'site_scope', v_scope,
      'entries', jsonb_build_object(
        'klaverjas', coalesce(v_kl, jsonb_build_object('is_live', false)),
        'boerenbridge', coalesce(v_bb, jsonb_build_object('is_live', false))
      ),
      'homepage', jsonb_build_object(
        'entries', jsonb_build_object(
          'klaverjas', coalesce(v_kl, jsonb_build_object('is_live', false)),
          'boerenbridge', coalesce(v_bb, jsonb_build_object('is_live', false))
        )
      ),
      'matches', coalesce(v_matches, '[]'::jsonb),
      'match', v_match
    )
  );
end;
$$;

grant execute on function public._gejast_live_scope_norm_v352(text) to anon, authenticated;
grant execute on function public._gejast_live_effective_finished_at_v352(jsonb, timestamptz, timestamptz) to anon, authenticated;
grant execute on function public._gejast_live_effective_updated_at_v352(jsonb, timestamptz, timestamptz) to anon, authenticated;
grant execute on function public._gejast_live_submitter_name_v352(jsonb) to anon, authenticated;
grant execute on function public._gejast_live_surface_rows_v352(text, boolean) to anon, authenticated;
grant execute on function public.save_game_match_summary_scoped(text, text, text, jsonb, text) to anon, authenticated;
grant execute on function public.repair_finished_match_summaries_v352(integer) to anon, authenticated;
grant execute on function public.get_live_surface_bundle_scoped(text, text, text, text, boolean) to anon, authenticated;

commit;

