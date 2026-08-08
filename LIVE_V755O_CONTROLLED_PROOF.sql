-- Controlled live proof for GEJAST v755o Toepen repair.
-- Creates only uniquely-labelled OC_V764 fixtures, exercises the guarded RPC,
-- verifies rejected calls leave no partial rows, then deletes the exact controlled
-- game and temporary sessions before returning results.

create temp table if not exists _v755o_results (
  check_name text primary key,
  result text not null,
  detail text not null
) on commit preserve rows;
truncate _v755o_results;

do $$
declare
  v_run text := 'OC_V764_TOEPEN_PROOF_' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text;
  v_client text;
  v_bad_total_client text;
  v_nonparticipant_client text;
  v_bad_result_client text;
  v_token_a text;
  v_token_b text;
  v_token_stale text;
  v_a_id bigint;
  v_b_id bigint;
  v_a_name text;
  v_b_name text;
  v_scope text;
  v_payload jsonb;
  v_bad_payload jsonb;
  v_json jsonb;
  v_game_id bigint;
  v_before_games bigint;
  v_before_participants bigint;
  v_before_rounds bigint;
  v_before_results bigint;
  v_after_games bigint;
  v_after_participants bigint;
  v_after_rounds bigint;
  v_after_results bigint;
  v_count bigint;
  v_push bigint;
  v_ice numeric;
  v_deleted integer := 0;
  v_webrole_dml integer;
  v_public_dml integer;
begin
  v_client := v_run || '_VALID';
  v_bad_total_client := v_run || '_BAD_TOTAL';
  v_nonparticipant_client := v_run || '_NONPARTICIPANT';
  v_bad_result_client := v_run || '_BAD_RESULT';
  v_token_a := v_run || '_SESSION_A';
  v_token_b := v_run || '_SESSION_B';
  v_token_stale := v_run || '_SESSION_STALE';

  select count(*) into v_before_games from public.toepen_games;
  select count(*) into v_before_participants from public.toepen_game_participants;
  select count(*) into v_before_rounds from public.toepen_rounds;
  select count(*) into v_before_results from public.toepen_round_results;

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
    insert into _v755o_results values ('fixture_player_a','FAIL','no player row available');
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
    v_b_name := 'OC V764 Toepen Opponent';
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

  insert into _v755o_results values (
    'temporary_sessions','PASS',
    'created controlled A + stale session' || case when v_b_id is not null then ' + distinct player B session' else '; no distinct player B needed' end
  );

  v_payload := jsonb_build_object(
    'client_match_id', v_client,
    'game_type','toepen',
    'target_points',10,
    'ruleset',jsonb_build_object('matrix','v755o'),
    'participants',jsonb_build_array(
      jsonb_build_object('seat_no',1,'name',v_a_name,'start_points',0,'end_points',0,'eliminated',false,'finish_rank',1),
      jsonb_build_object('seat_no',2,'name',v_b_name,'start_points',0,'end_points',1,'eliminated',false,'finish_rank',2)
    ),
    'rounds',jsonb_build_array(
      jsonb_build_object(
        'round_no',1,'dealer_seat',2,'winner_seat',1,'winner_name',v_a_name,
        'stake_final',1,'knock_count',0,'special_tags',jsonb_build_array(),'note',v_run,
        'results',jsonb_build_array(
          jsonb_build_object('seat_no',1,'name',v_a_name,'action','win','penalty_points',0),
          jsonb_build_object('seat_no',2,'name',v_b_name,'action','stay','penalty_points',1)
        )
      )
    )
  );

  begin
    v_json := public.create_toepen_game(v_token_a, v_payload, v_scope);
    v_game_id := nullif(v_json->>'game_id','')::bigint;
    insert into _v755o_results values (
      'valid_save',
      case when coalesce((v_json->>'ok')::boolean,false) and coalesce((v_json->>'already_saved')::boolean,false)=false and v_game_id is not null then 'PASS' else 'FAIL' end,
      'ok='||coalesce(v_json->>'ok','null')||', already_saved='||coalesce(v_json->>'already_saved','null')||', controlled game id='||coalesce(v_game_id::text,'null')
    );
  exception when others then
    insert into _v755o_results values ('valid_save','FAIL',sqlerrm);
  end;

  if v_game_id is not null then
    select count(*) into v_count from public.toepen_game_participants where game_id=v_game_id;
    insert into _v755o_results values (
      'valid_child_rows',
      case when v_count=2
             and (select count(*) from public.toepen_rounds where game_id=v_game_id)=1
             and (select count(*) from public.toepen_round_results where game_id=v_game_id)=2
           then 'PASS' else 'FAIL' end,
      'participants='||v_count::text||', rounds='||(select count(*)::text from public.toepen_rounds where game_id=v_game_id)||', results='||(select count(*)::text from public.toepen_round_results where game_id=v_game_id)
    );

    begin
      v_json := public.create_toepen_game(v_token_a, v_payload, v_scope);
      select count(*) into v_count from public.toepen_games where client_match_id=v_client;
      insert into _v755o_results values (
        'same_owner_replay',
        case when coalesce((v_json->>'already_saved')::boolean,false) and nullif(v_json->>'game_id','')::bigint=v_game_id and v_count=1 then 'PASS' else 'FAIL' end,
        'same game id, already_saved='||coalesce(v_json->>'already_saved','null')||', rows='||v_count::text
      );
    exception when others then
      insert into _v755o_results values ('same_owner_replay','FAIL',sqlerrm);
    end;
  end if;

  -- Forged participant total: same round penalties, but player B end_points=99.
  v_bad_payload := jsonb_set(v_payload, '{client_match_id}', to_jsonb(v_bad_total_client));
  v_bad_payload := jsonb_set(v_bad_payload, '{participants,1,end_points}', '99'::jsonb);
  begin
    perform public.create_toepen_game(v_token_a, v_bad_payload, v_scope);
    insert into _v755o_results values ('forged_total_rejected','FAIL','inconsistent end_points unexpectedly accepted');
  exception when others then
    select count(*) into v_count from public.toepen_games where client_match_id=v_bad_total_client;
    insert into _v755o_results values (
      'forged_total_rejected',
      case when position('Toepen-eindscore komt niet overeen met rondepunten.' in sqlerrm)>0 and v_count=0 then 'PASS' else 'FAIL' end,
      sqlerrm||'; residue='||v_count::text
    );
  end;

  -- Valid session but saver omitted from participants.
  v_bad_payload := jsonb_build_object(
    'client_match_id',v_nonparticipant_client,
    'game_type','toepen','target_points',10,
    'participants',jsonb_build_array(
      jsonb_build_object('seat_no',1,'name','OC V764 Outsider One','start_points',0,'end_points',0,'eliminated',false,'finish_rank',1),
      jsonb_build_object('seat_no',2,'name','OC V764 Outsider Two','start_points',0,'end_points',1,'eliminated',false,'finish_rank',2)
    ),
    'rounds',jsonb_build_array(
      jsonb_build_object('round_no',1,'dealer_seat',2,'winner_seat',1,'winner_name','OC V764 Outsider One','stake_final',1,'knock_count',0,'special_tags',jsonb_build_array(),
        'results',jsonb_build_array(
          jsonb_build_object('seat_no',1,'name','OC V764 Outsider One','action','win','penalty_points',0),
          jsonb_build_object('seat_no',2,'name','OC V764 Outsider Two','action','stay','penalty_points',1)
        )
      )
    )
  );
  begin
    perform public.create_toepen_game(v_token_a, v_bad_payload, v_scope);
    insert into _v755o_results values ('nonparticipant_rejected','FAIL','valid non-participant saver unexpectedly accepted');
  exception when others then
    select count(*) into v_count from public.toepen_games where client_match_id=v_nonparticipant_client;
    insert into _v755o_results values (
      'nonparticipant_rejected',
      case when position('Alleen een deelnemer mag dit Toepen-potje opslaan.' in sqlerrm)>0 and v_count=0 then 'PASS' else 'FAIL' end,
      sqlerrm||'; residue='||v_count::text
    );
  end;

  -- Malformed result: non-winner is marked win.
  v_bad_payload := jsonb_set(v_payload, '{client_match_id}', to_jsonb(v_bad_result_client));
  v_bad_payload := jsonb_set(v_bad_payload, '{rounds,0,results,1,action}', '"win"'::jsonb);
  begin
    perform public.create_toepen_game(v_token_a, v_bad_payload, v_scope);
    insert into _v755o_results values ('malformed_result_rejected','FAIL','invalid winner/result unexpectedly accepted');
  exception when others then
    select count(*) into v_count from public.toepen_games where client_match_id=v_bad_result_client;
    insert into _v755o_results values (
      'malformed_result_rejected',
      case when position('Alleen de rondewinnaar mag als winnaar worden opgeslagen.' in sqlerrm)>0 and v_count=0 then 'PASS' else 'FAIL' end,
      sqlerrm||'; residue='||v_count::text
    );
  end;

  begin
    perform public.create_toepen_game(null, jsonb_set(v_payload,'{client_match_id}',to_jsonb(v_run||'_MISSING')), v_scope);
    insert into _v755o_results values ('missing_session_rejected','FAIL','missing session unexpectedly accepted');
  exception when others then
    insert into _v755o_results values ('missing_session_rejected',case when position('Niet ingelogd.' in sqlerrm)>0 then 'PASS' else 'FAIL' end,sqlerrm);
  end;

  begin
    perform public.create_toepen_game(v_run||'_INVALID_TOKEN', jsonb_set(v_payload,'{client_match_id}',to_jsonb(v_run||'_INVALID')), v_scope);
    insert into _v755o_results values ('invalid_session_rejected','FAIL','invalid session unexpectedly accepted');
  exception when others then
    insert into _v755o_results values ('invalid_session_rejected',case when position('Niet ingelogd.' in sqlerrm)>0 then 'PASS' else 'FAIL' end,sqlerrm);
  end;

  begin
    perform public.create_toepen_game(v_token_stale, jsonb_set(v_payload,'{client_match_id}',to_jsonb(v_run||'_STALE')), v_scope);
    insert into _v755o_results values ('stale_session_rejected','FAIL','expired session unexpectedly accepted');
  exception when others then
    insert into _v755o_results values ('stale_session_rejected',case when position('Niet ingelogd.' in sqlerrm)>0 then 'PASS' else 'FAIL' end,sqlerrm);
  end;

  select count(*)::integer into v_webrole_dml
    from information_schema.table_privileges
   where table_schema='public'
     and table_name in ('toepen_games','toepen_game_participants','toepen_rounds','toepen_round_results')
     and grantee in ('anon','authenticated')
     and privilege_type in ('INSERT','UPDATE','DELETE');
  select count(*)::integer into v_public_dml
    from information_schema.table_privileges
   where table_schema='public'
     and table_name in ('toepen_games','toepen_game_participants','toepen_rounds','toepen_round_results')
     and grantee='PUBLIC'
     and privilege_type in ('INSERT','UPDATE','DELETE');
  insert into _v755o_results values (
    'direct_dml_boundary',
    case when v_webrole_dml=0 and v_public_dml=0 then 'PASS' else 'FAIL' end,
    'webrole grants='||v_webrole_dml::text||', PUBLIC grants='||v_public_dml::text
  );

  if v_game_id is not null then
    delete from public.toepen_games where id=v_game_id and client_match_id=v_client and created_by_player_id=v_a_id;
    get diagnostics v_deleted = row_count;
  end if;

  delete from public.toepen_games where client_match_id like v_run||'%';
  delete from public.gejast_player_sessions_v746 where session_token like v_run||'%';

  insert into _v755o_results values (
    'exact_game_cleanup',
    case when v_game_id is null or v_deleted=1 then 'PASS' else 'FAIL' end,
    'exact controlled game rows deleted='||v_deleted::text
  );

  select count(*) into v_after_games from public.toepen_games;
  select count(*) into v_after_participants from public.toepen_game_participants;
  select count(*) into v_after_rounds from public.toepen_rounds;
  select count(*) into v_after_results from public.toepen_round_results;
  select count(*) into v_count from public.toepen_games where client_match_id like v_run||'%';
  select count(*) into v_push from public.web_push_jobs where to_jsonb(web_push_jobs)::text like '%'||v_run||'%';
  select unit_value into v_ice from public.drink_event_types where key='ice' limit 1;

  insert into _v755o_results values (
    'baseline_restored',
    case when v_after_games=v_before_games
              and v_after_participants=v_before_participants
              and v_after_rounds=v_before_rounds
              and v_after_results=v_before_results
              and v_count=0 then 'PASS' else 'FAIL' end,
    'games '||v_before_games::text||'->'||v_after_games::text||', participants '||v_before_participants::text||'->'||v_after_participants::text||', rounds '||v_before_rounds::text||'->'||v_after_rounds::text||', results '||v_before_results::text||'->'||v_after_results::text||', controlled residue='||v_count::text
  );

  insert into _v755o_results values ('controlled_push_jobs',case when v_push=0 then 'PASS' else 'FAIL' end,'controlled push rows='||v_push::text);
  insert into _v755o_results values ('ice_invariant',case when v_ice=2.8 then 'PASS' else 'FAIL' end,'Ice='||coalesce(v_ice::text,'missing'));
exception when others then
  delete from public.toepen_games where client_match_id like v_run||'%';
  delete from public.gejast_player_sessions_v746 where session_token like v_run||'%';
  insert into _v755o_results(check_name,result,detail)
  values ('fatal_script_error','FAIL',sqlerrm)
  on conflict (check_name) do update set result=excluded.result,detail=excluded.detail;
end $$;

select check_name,result,detail
from _v755o_results
order by check_name;
