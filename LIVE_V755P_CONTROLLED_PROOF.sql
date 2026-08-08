-- Controlled live proof for GEJAST v755p Beerpong repair.
-- Creates only uniquely-labelled OC_V764 fixtures, exercises the guarded RPC,
-- then deletes the exact controlled match and temporary sessions before returning results.
-- Does not touch existing Beerpong matches or ratings/history.

create temp table if not exists _v755p_results (
  check_name text primary key,
  result text not null,
  detail text not null
) on commit preserve rows;
truncate _v755p_results;

do $$
declare
  v_run text := 'OC_V764_BEERPONG_PROOF_' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text;
  v_client text;
  v_token_a text;
  v_token_b text;
  v_token_stale text;
  v_a_id bigint;
  v_b_id bigint;
  v_a_name text;
  v_b_name text;
  v_scope text;
  v_payload jsonb;
  v_json jsonb;
  v_match_id bigint;
  v_created_by bigint;
  v_format text;
  v_cups_a integer;
  v_cups_b integer;
  v_before_matches bigint;
  v_before_ratings bigint;
  v_before_history bigint;
  v_after_matches bigint;
  v_after_ratings bigint;
  v_after_history bigint;
  v_count bigint;
  v_deleted integer := 0;
  v_webrole_dml integer;
  v_public_dml integer;
  v_push bigint;
  v_ice numeric;
begin
  v_client := v_run || '_MATCH';
  v_token_a := v_run || '_SESSION_A';
  v_token_b := v_run || '_SESSION_B';
  v_token_stale := v_run || '_SESSION_STALE';

  select count(*) into v_before_matches from public.beerpong_matches;
  select count(*) into v_before_ratings from public.beerpong_player_ratings;
  select count(*) into v_before_history from public.beerpong_player_rating_history;

  select p.id,
         coalesce(nullif(trim(p.display_name),''), nullif(trim(p.slug),''), 'Player ' || p.id::text),
         coalesce(nullif(trim(p.site_scope),''), 'friends')
    into v_a_id, v_a_name, v_scope
    from public.players p
   order by case
              when lower(coalesce(p.display_name,''))='bruis' or lower(coalesce(p.slug,''))='bruis' then 0
              else 1
            end,
            p.id
   limit 1;

  if v_a_id is null then
    insert into _v755p_results values ('fixture_player_a','FAIL','no player row available');
    return;
  end if;

  select p.id,
         coalesce(nullif(trim(p.display_name),''), nullif(trim(p.slug),''), 'Player ' || p.id::text)
    into v_b_id, v_b_name
    from public.players p
   where p.id <> v_a_id
     and coalesce(nullif(trim(p.site_scope),''), 'friends') = v_scope
   order by p.id
   limit 1;

  if v_b_name is null then
    v_b_name := 'OC V764 Opponent';
  end if;

  insert into public.gejast_player_sessions_v746(
    session_token, player_id, display_name, site_scope, created_at, last_seen_at, expires_at
  ) values (
    v_token_a, v_a_id, v_a_name, v_scope, now(), now(), now() + interval '20 minutes'
  );

  if v_b_id is not null then
    insert into public.gejast_player_sessions_v746(
      session_token, player_id, display_name, site_scope, created_at, last_seen_at, expires_at
    ) values (
      v_token_b, v_b_id, v_b_name, v_scope, now(), now(), now() + interval '20 minutes'
    );
  end if;

  insert into public.gejast_player_sessions_v746(
    session_token, player_id, display_name, site_scope, created_at, last_seen_at, expires_at
  ) values (
    v_token_stale, v_a_id, v_a_name, v_scope, now() - interval '2 hours', now() - interval '2 hours', now() - interval '1 hour'
  );

  insert into _v755p_results values (
    'temporary_sessions', 'PASS',
    'created controlled A + stale session' || case when v_b_id is not null then ' + distinct player B session' else '; no distinct player B found' end
  );

  v_payload := jsonb_build_object(
    'status','finished',
    'format','1v1',
    'team_a_player_names',jsonb_build_array(v_a_name),
    'team_b_player_names',jsonb_build_array(v_b_name),
    'winner_team','team_a',
    'cups_left_team_a',2,
    'cups_left_team_b',0
  );

  begin
    v_json := public.save_beerpong_match(v_token_a, v_client, v_payload);
    v_match_id := nullif(v_json->>'match_id','')::bigint;
    insert into _v755p_results values (
      'valid_save',
      case when coalesce((v_json->>'ok')::boolean,false) and coalesce((v_json->>'already_saved')::boolean,false)=false and v_match_id is not null then 'PASS' else 'FAIL' end,
      'ok='||coalesce(v_json->>'ok','null')||', already_saved='||coalesce(v_json->>'already_saved','null')||', controlled match id='||coalesce(v_match_id::text,'null')
    );
  exception when others then
    insert into _v755p_results values ('valid_save','FAIL',sqlerrm);
  end;

  if v_match_id is not null then
    select created_by_player_id, match_format, team_a_cups_left, team_b_cups_left
      into v_created_by, v_format, v_cups_a, v_cups_b
      from public.beerpong_matches
     where id=v_match_id and client_match_id=v_client;

    insert into _v755p_results values (
      'creator_owner',
      case when v_created_by=v_a_id then 'PASS' else 'FAIL' end,
      'created_by matches controlled player A'
    );

    insert into _v755p_results values (
      'payload_aliases',
      case when v_format='1v1' and v_cups_a=2 and v_cups_b=0 then 'PASS' else 'FAIL' end,
      'match_format='||coalesce(v_format,'null')||', team_a_cups_left='||coalesce(v_cups_a::text,'null')||', team_b_cups_left='||coalesce(v_cups_b::text,'null')
    );

    begin
      v_json := public.save_beerpong_match(v_token_a, v_client, v_payload);
      select count(*) into v_count from public.beerpong_matches where client_match_id=v_client;
      insert into _v755p_results values (
        'same_owner_replay',
        case when coalesce((v_json->>'already_saved')::boolean,false) and nullif(v_json->>'match_id','')::bigint=v_match_id and v_count=1 then 'PASS' else 'FAIL' end,
        'same match id, already_saved='||coalesce(v_json->>'already_saved','null')||', rows='||v_count::text
      );
    exception when others then
      insert into _v755p_results values ('same_owner_replay','FAIL',sqlerrm);
    end;
  end if;

  if v_b_id is not null and v_match_id is not null then
    begin
      perform public.save_beerpong_match(v_token_b, v_client, v_payload);
      insert into _v755p_results values ('cross_player_owner_guard','FAIL','different valid player overwrote existing client_match_id');
    exception when others then
      insert into _v755p_results values (
        'cross_player_owner_guard',
        case when position('beerpong_match_owner_mismatch' in sqlerrm)>0 then 'PASS' else 'FAIL' end,
        sqlerrm
      );
    end;
  else
    insert into _v755p_results values ('cross_player_owner_guard','SKIP','no distinct same-scope player B available');
  end if;

  begin
    perform public.save_beerpong_match(null, v_run||'_MISSING', v_payload);
    insert into _v755p_results values ('missing_session_rejected','FAIL','missing session unexpectedly accepted');
  exception when others then
    insert into _v755p_results values (
      'missing_session_rejected',
      case when position('Niet ingelogd.' in sqlerrm)>0 then 'PASS' else 'FAIL' end,
      sqlerrm
    );
  end;

  begin
    perform public.save_beerpong_match(v_run||'_INVALID_TOKEN', v_run||'_INVALID', v_payload);
    insert into _v755p_results values ('invalid_session_rejected','FAIL','invalid session unexpectedly accepted');
  exception when others then
    insert into _v755p_results values (
      'invalid_session_rejected',
      case when position('Niet ingelogd.' in sqlerrm)>0 then 'PASS' else 'FAIL' end,
      sqlerrm
    );
  end;

  begin
    perform public.save_beerpong_match(v_token_stale, v_run||'_STALE', v_payload);
    insert into _v755p_results values ('stale_session_rejected','FAIL','expired session unexpectedly accepted');
  exception when others then
    insert into _v755p_results values (
      'stale_session_rejected',
      case when position('Niet ingelogd.' in sqlerrm)>0 then 'PASS' else 'FAIL' end,
      sqlerrm
    );
  end;

  select count(*)::integer into v_webrole_dml
    from information_schema.table_privileges
   where table_schema='public'
     and table_name in ('beerpong_matches','beerpong_player_ratings','beerpong_player_rating_history')
     and grantee in ('anon','authenticated')
     and privilege_type in ('INSERT','UPDATE','DELETE');

  select count(*)::integer into v_public_dml
    from information_schema.table_privileges
   where table_schema='public'
     and table_name in ('beerpong_matches','beerpong_player_ratings','beerpong_player_rating_history')
     and grantee='PUBLIC'
     and privilege_type in ('INSERT','UPDATE','DELETE');

  insert into _v755p_results values (
    'direct_dml_boundary',
    case when v_webrole_dml=0 and v_public_dml=0 then 'PASS' else 'FAIL' end,
    'webrole grants='||v_webrole_dml::text||', PUBLIC grants='||v_public_dml::text
  );

  if v_match_id is not null then
    delete from public.beerpong_matches
     where id=v_match_id
       and client_match_id=v_client
       and created_by_player_id=v_a_id;
    get diagnostics v_deleted = row_count;
  end if;

  delete from public.beerpong_matches
   where client_match_id in (v_run||'_MISSING', v_run||'_INVALID', v_run||'_STALE');

  delete from public.gejast_player_sessions_v746
   where session_token in (v_token_a, v_token_b, v_token_stale)
      or session_token=v_run||'_INVALID_TOKEN';

  insert into _v755p_results values (
    'exact_match_cleanup',
    case when v_match_id is null or v_deleted=1 then 'PASS' else 'FAIL' end,
    'exact controlled match rows deleted='||v_deleted::text
  );

  select count(*) into v_after_matches from public.beerpong_matches;
  select count(*) into v_after_ratings from public.beerpong_player_ratings;
  select count(*) into v_after_history from public.beerpong_player_rating_history;
  select count(*) into v_count from public.beerpong_matches where client_match_id like v_run||'%';
  select count(*) into v_push from public.web_push_jobs where to_jsonb(web_push_jobs)::text like '%'||v_run||'%';
  select unit_value into v_ice from public.drink_event_types where key='ice' limit 1;

  insert into _v755p_results values (
    'baseline_restored',
    case when v_after_matches=v_before_matches and v_after_ratings=v_before_ratings and v_after_history=v_before_history and v_count=0 then 'PASS' else 'FAIL' end,
    'matches '||v_before_matches::text||'->'||v_after_matches::text||', ratings '||v_before_ratings::text||'->'||v_after_ratings::text||', history '||v_before_history::text||'->'||v_after_history::text||', controlled residue='||v_count::text
  );

  insert into _v755p_results values (
    'rating_history_unchanged',
    case when v_after_ratings=v_before_ratings and v_after_history=v_before_history then 'PASS' else 'FAIL' end,
    'ratings='||v_after_ratings::text||', history='||v_after_history::text
  );

  insert into _v755p_results values (
    'controlled_push_jobs',
    case when v_push=0 then 'PASS' else 'FAIL' end,
    'controlled push rows='||v_push::text
  );

  insert into _v755p_results values (
    'ice_invariant',
    case when v_ice=2.8 then 'PASS' else 'FAIL' end,
    'Ice='||coalesce(v_ice::text,'missing')
  );
exception when others then
  -- Emergency exact-prefix cleanup for this unique run only.
  delete from public.beerpong_matches where client_match_id like v_run||'%';
  delete from public.gejast_player_sessions_v746 where session_token like v_run||'%';
  insert into _v755p_results(check_name,result,detail)
  values ('fatal_script_error','FAIL',sqlerrm)
  on conflict (check_name) do update set result=excluded.result, detail=excluded.detail;
end $$;

select check_name, result, detail
from _v755p_results
order by check_name;
