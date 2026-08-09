begin;

-- v770a: replace v690 placeholder scoped readers with the signatures used by
-- the current frontend. This migration is DDL-only and does not modify match data.
do $deps$
begin
  if to_regprocedure('public._gejast_live_scope_norm_v352(text)') is null then
    raise exception 'v770a dependency missing: _gejast_live_scope_norm_v352(text)';
  end if;
  if to_regprocedure('public._gejast_live_surface_rows_v352(text,boolean)') is null then
    raise exception 'v770a dependency missing: _gejast_live_surface_rows_v352(text,boolean)';
  end if;
  if to_regprocedure('public._gejast_name_for_session(text)') is null then
    raise exception 'v770a dependency missing: _gejast_name_for_session(text)';
  end if;
  if to_regprocedure('public._name_in_site_scope(text,text)') is null then
    raise exception 'v770a dependency missing: _name_in_site_scope(text,text)';
  end if;
end
$deps$;

-- Remove the old v690 one-argument placeholder and any prior copy of the
-- current four-argument contract. DROP is intentionally non-CASCADE.
drop function if exists public.get_live_match_summary_public_scoped(text);
drop function if exists public.get_live_match_summary_public_scoped(text,text,text,text);

create function public.get_live_match_summary_public_scoped(
  game_type_input text,
  match_ref_input text default null,
  client_match_id_input text default null,
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_scope text := public._gejast_live_scope_norm_v352(site_scope_input);
  v_game text := lower(trim(coalesce(game_type_input, '')));
  v_match_ref text := nullif(trim(coalesce(match_ref_input, '')), '');
  v_client_match_id text := nullif(trim(coalesce(client_match_id_input, '')), '');
  v_identity text := coalesce(v_client_match_id, v_match_ref);
  v_item jsonb;
begin
  if v_game not in ('klaverjas', 'boerenbridge') then
    raise exception 'game_type ongeldig';
  end if;

  if v_identity is null then
    return jsonb_build_object(
      'ok', false,
      'found', false,
      'game_type', v_game,
      'match_ref', v_match_ref,
      'client_match_id', v_client_match_id,
      'site_scope', v_scope
    );
  end if;

  select jsonb_build_object(
    'game_type', r.game_type,
    'match_ref', r.client_match_id,
    'client_match_id', r.client_match_id,
    'site_scope', r.site_scope,
    'participants', to_jsonb(coalesce(r.participants, '{}'::text[])),
    'participant_names', to_jsonb(coalesce(r.participants, '{}'::text[])),
    'winner_names', to_jsonb(coalesce(r.winner_names, '{}'::text[])),
    'submitter_name', r.submitter_name,
    'summary', coalesce(r.summary_payload, '{}'::jsonb),
    'summary_payload', coalesce(r.summary_payload, '{}'::jsonb),
    'recap_text', nullif(trim(coalesce(r.summary_payload->>'recap_text', '')), ''),
    'created_at', r.created_at,
    'updated_at', r.updated_at,
    'finished_at', r.finished_at,
    'is_live', r.is_live,
    'live_href', case
      when r.game_type = 'klaverjas' then './klaverjas_live.html?match_ref=' || r.client_match_id
      else './boerenbridge_live.html?match_ref=' || r.client_match_id
    end
  )
  into v_item
  from public._gejast_live_surface_rows_v352(v_scope, true) r
  where r.game_type = v_game
    and (
      r.client_match_id = v_identity
      or nullif(trim(coalesce(r.summary_payload->>'match_ref', '')), '') = v_identity
    )
  order by
    case when r.client_match_id = v_identity then 0 else 1 end,
    r.updated_at desc,
    r.created_at desc
  limit 1;

  if v_item is null then
    return jsonb_build_object(
      'ok', false,
      'found', false,
      'game_type', v_game,
      'match_ref', v_match_ref,
      'client_match_id', v_client_match_id,
      'site_scope', v_scope
    );
  end if;

  return v_item || jsonb_build_object(
    'ok', true,
    'found', true,
    'item', v_item
  );
end
$fn$;

revoke all on function public.get_live_match_summary_public_scoped(text,text,text,text) from public;
grant execute on function public.get_live_match_summary_public_scoped(text,text,text,text) to anon, authenticated;

-- Remove the old v690 one-argument homepage placeholder and any prior copy of
-- the current two-argument contract. DROP is intentionally non-CASCADE.
drop function if exists public.get_homepage_live_state_public_scoped(text);
drop function if exists public.get_homepage_live_state_public_scoped(text,text);

create function public.get_homepage_live_state_public_scoped(
  session_token text default null,
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_scope text := public._gejast_live_scope_norm_v352(site_scope_input);
  v_viewer_name text := null;
  v_kl jsonb := jsonb_build_object('is_live', false);
  v_bb jsonb := jsonb_build_object('is_live', false);
begin
  begin
    v_viewer_name := public._gejast_name_for_session(session_token);
  exception when others then
    v_viewer_name := null;
  end;

  -- A valid session from another site scope must not reveal live entries in
  -- the requested scope even if a display name happens to overlap.
  if v_viewer_name is not null
     and not coalesce(public._name_in_site_scope(v_viewer_name, v_scope), false) then
    v_viewer_name := null;
  end if;

  if v_viewer_name is not null then
    select jsonb_build_object(
      'is_live', true,
      'match_ref', r.client_match_id,
      'client_match_id', r.client_match_id,
      'site_scope', r.site_scope,
      'label', case when lower(coalesce(r.submitter_name, '')) = lower(v_viewer_name)
        then 'Klaverjas beheren' else 'Klaverjas Live' end,
      'copy', case when lower(coalesce(r.submitter_name, '')) = lower(v_viewer_name)
        then 'Open jouw huidige inzending in Wedstrijden beheren.' else 'Bekijk live scoreblad van jouw huidige potje.' end,
      'mode', case when lower(coalesce(r.submitter_name, '')) = lower(v_viewer_name)
        then 'manage' else 'spectate' end,
      'href', case
        when lower(coalesce(r.submitter_name, '')) = lower(v_viewer_name)
          then './match_control.html?game=klaverjas&match_ref=' || r.client_match_id || case when v_scope = 'family' then '&scope=family' else '' end
        else './klaverjas_live.html?match_ref=' || r.client_match_id || case when v_scope = 'family' then '&scope=family' else '' end
      end,
      'participants', to_jsonb(coalesce(r.participants, '{}'::text[])),
      'updated_at', r.updated_at
    )
    into v_kl
    from public._gejast_live_surface_rows_v352(v_scope, false) r
    where r.game_type = 'klaverjas'
      and (
        lower(coalesce(r.submitter_name, '')) = lower(v_viewer_name)
        or exists (
          select 1
          from unnest(coalesce(r.participants, '{}'::text[])) p
          where lower(trim(p)) = lower(trim(v_viewer_name))
        )
      )
    order by
      case when lower(coalesce(r.submitter_name, '')) = lower(v_viewer_name) then 0 else 1 end,
      r.updated_at desc,
      r.created_at desc
    limit 1;

    select jsonb_build_object(
      'is_live', true,
      'match_ref', r.client_match_id,
      'client_match_id', r.client_match_id,
      'site_scope', r.site_scope,
      'label', case when lower(coalesce(r.submitter_name, '')) = lower(v_viewer_name)
        then 'Boerenbridge beheren' else 'Boerenbridge Live' end,
      'copy', case when lower(coalesce(r.submitter_name, '')) = lower(v_viewer_name)
        then 'Open jouw huidige inzending in Wedstrijden beheren.' else 'Bekijk live scoreblad van jouw huidige potje.' end,
      'mode', case when lower(coalesce(r.submitter_name, '')) = lower(v_viewer_name)
        then 'manage' else 'spectate' end,
      'href', case
        when lower(coalesce(r.submitter_name, '')) = lower(v_viewer_name)
          then './match_control.html?game=boerenbridge&match_ref=' || r.client_match_id || case when v_scope = 'family' then '&scope=family' else '' end
        else './boerenbridge_live.html?match_ref=' || r.client_match_id || case when v_scope = 'family' then '&scope=family' else '' end
      end,
      'participants', to_jsonb(coalesce(r.participants, '{}'::text[])),
      'updated_at', r.updated_at
    )
    into v_bb
    from public._gejast_live_surface_rows_v352(v_scope, false) r
    where r.game_type = 'boerenbridge'
      and (
        lower(coalesce(r.submitter_name, '')) = lower(v_viewer_name)
        or exists (
          select 1
          from unnest(coalesce(r.participants, '{}'::text[])) p
          where lower(trim(p)) = lower(trim(v_viewer_name))
        )
      )
    order by
      case when lower(coalesce(r.submitter_name, '')) = lower(v_viewer_name) then 0 else 1 end,
      r.updated_at desc,
      r.created_at desc
    limit 1;
  end if;

  return jsonb_build_object(
    'ok', true,
    'site_scope', v_scope,
    'viewer_name', v_viewer_name,
    'entries', jsonb_build_object(
      'klaverjas', coalesce(v_kl, jsonb_build_object('is_live', false)),
      'boerenbridge', coalesce(v_bb, jsonb_build_object('is_live', false))
    ),
    'by_game', jsonb_build_object(
      'klaverjas', coalesce(v_kl, jsonb_build_object('is_live', false)),
      'boerenbridge', coalesce(v_bb, jsonb_build_object('is_live', false))
    )
  );
end
$fn$;

revoke all on function public.get_homepage_live_state_public_scoped(text,text) from public;
grant execute on function public.get_homepage_live_state_public_scoped(text,text) to anon, authenticated;

commit;
