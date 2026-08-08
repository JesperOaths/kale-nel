-- v755r Klaverjas production apply + controlled verification.
-- ONE TRANSACTION. Any failed assertion aborts the migration and all controlled writes.
-- On success, controlled fixtures are removed before COMMIT and a PASS table is returned.

create temp table if not exists _v755r_results(
  check_name text primary key,
  result text not null,
  detail text not null
) on commit preserve rows;
truncate _v755r_results;

create temp table if not exists _v755r_baseline(
  key text primary key,
  value bigint not null
) on commit preserve rows;
truncate _v755r_baseline;
insert into _v755r_baseline values
  ('klaverjas_matches',(select count(*) from public.klaverjas_matches)),
  ('klaverjas_rounds',(select count(*) from public.klaverjas_rounds)),
  ('klaverjas_match_snapshots',(select count(*) from public.klaverjas_match_snapshots)),
  ('jas_games',(select count(*) from public.jas_games)),
  ('jas_game_entries',(select count(*) from public.jas_game_entries)),
  ('game_rating_rebuild_queue',(select count(*) from public.game_rating_rebuild_queue)),
  ('klaverjas_online_games',(select count(*) from public.klaverjas_online_games)),
  ('klaverjas_online_player_stats',(select count(*) from public.klaverjas_online_player_stats));

begin;

create or replace function public.klaverjas_upsert_match_state_scoped(
  session_token text default null,
  match_id_input bigint default null,
  site_scope_input text default 'friends',
  team_w_player_ids_input jsonb default '[]'::jsonb,
  team_z_player_ids_input jsonb default '[]'::jsonb,
  team_w_player_names_input jsonb default '[]'::jsonb,
  team_z_player_names_input jsonb default '[]'::jsonb,
  rounds_input jsonb default '[]'::jsonb,
  payload_snapshot_input jsonb default '{}'::jsonb,
  status_input text default 'active',
  started_at_input timestamp with time zone default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_actor public.players%rowtype;
  v_match_id bigint := match_id_input;
  v_scope text := public._klaverjas_safe_scope(site_scope_input);
  v_client_match_id text := nullif(trim(coalesce(payload_snapshot_input ->> 'client_match_id','')), '');
  v_existing_owner bigint;
  v_existing_client text;
  v_round_count integer := 0;
  v_tak_count integer := 0;
  v_progress numeric(8,4) := 0;
  v_elo_scale numeric(8,4) := 0;
  v_score_w integer := 0;
  v_score_z integer := 0;
  v_raw_w integer := 0;
  v_raw_z integer := 0;
  v_roem_w integer := 0;
  v_roem_z integer := 0;
  v_winner text := null;
  v_status text := case when lower(coalesce(status_input,'')) = 'finished' then 'finished' when lower(coalesce(status_input,'')) = 'abandoned' then 'abandoned' else 'active' end;
  v_player_order jsonb := coalesce(payload_snapshot_input -> 'playerOrder', payload_snapshot_input -> 'player_order', '[]'::jsonb);
  v_snapshot_no integer := 0;
  v_round jsonb;
  v_i integer := 0;
  v_round_score_state jsonb;
begin
  v_actor := public._jas_session_player(session_token);

  if jsonb_typeof(coalesce(rounds_input, '[]'::jsonb)) <> 'array' then
    raise exception 'rounds_input must be a json array';
  end if;

  if v_match_id is null then
    if v_client_match_id is not null then
      select id, created_by_player_id
        into v_match_id, v_existing_owner
        from public.klaverjas_matches
       where client_match_id = v_client_match_id
       for update;
      if found then
        if v_existing_owner is null then raise exception 'klaverjas_match_owner_unknown'; end if;
        if v_existing_owner <> v_actor.id then raise exception 'klaverjas_match_owner_mismatch'; end if;
      end if;
    end if;

    if v_match_id is null then
      v_client_match_id := coalesce(v_client_match_id, 'legacy-' || gen_random_uuid()::text);
      insert into public.klaverjas_matches(
        client_match_id, created_by_player_id, site_scope, started_at, status,
        team_w_player_ids, team_z_player_ids, team_w_player_names, team_z_player_names, payload_snapshot
      ) values (
        v_client_match_id, v_actor.id, v_scope, coalesce(started_at_input,now()), v_status,
        coalesce(team_w_player_ids_input,'[]'::jsonb), coalesce(team_z_player_ids_input,'[]'::jsonb),
        coalesce(team_w_player_names_input,'[]'::jsonb), coalesce(team_z_player_names_input,'[]'::jsonb),
        coalesce(payload_snapshot_input,'{}'::jsonb)
      ) returning id into v_match_id;
    end if;
  else
    select created_by_player_id, client_match_id
      into v_existing_owner, v_existing_client
      from public.klaverjas_matches
     where id = v_match_id
     for update;
    if found then
      if v_existing_owner is null then raise exception 'klaverjas_match_owner_unknown'; end if;
      if v_existing_owner <> v_actor.id then raise exception 'klaverjas_match_owner_mismatch'; end if;
      if v_client_match_id is not null and v_existing_client <> v_client_match_id then raise exception 'klaverjas_match_client_id_mismatch'; end if;
      v_client_match_id := v_existing_client;
    else
      v_client_match_id := coalesce(v_client_match_id, 'legacy-id-' || v_match_id::text);
      insert into public.klaverjas_matches(
        id, client_match_id, created_by_player_id, site_scope, started_at, status,
        team_w_player_ids, team_z_player_ids, team_w_player_names, team_z_player_names, payload_snapshot
      ) values (
        v_match_id, v_client_match_id, v_actor.id, v_scope, coalesce(started_at_input,now()), v_status,
        coalesce(team_w_player_ids_input,'[]'::jsonb), coalesce(team_z_player_ids_input,'[]'::jsonb),
        coalesce(team_w_player_names_input,'[]'::jsonb), coalesce(team_z_player_names_input,'[]'::jsonb),
        coalesce(payload_snapshot_input,'{}'::jsonb)
      );
    end if;
  end if;

  update public.klaverjas_matches
     set site_scope=v_scope,
         started_at=coalesce(started_at_input,started_at,now()),
         status=v_status,
         team_w_player_ids=coalesce(team_w_player_ids_input,'[]'::jsonb),
         team_z_player_ids=coalesce(team_z_player_ids_input,'[]'::jsonb),
         team_w_player_names=coalesce(team_w_player_names_input,'[]'::jsonb),
         team_z_player_names=coalesce(team_z_player_names_input,'[]'::jsonb),
         payload_snapshot=coalesce(payload_snapshot_input,'{}'::jsonb),
         updated_at=now()
   where id=v_match_id and created_by_player_id=v_actor.id;
  if not found then raise exception 'klaverjas_match_owner_mismatch'; end if;

  delete from public.klaverjas_rounds where match_id=v_match_id;
  delete from public.klaverjas_match_snapshots where match_id=v_match_id;

  for v_round in select value from jsonb_array_elements(coalesce(rounds_input,'[]'::jsonb))
  loop
    v_i := v_i + 1;
    insert into public.klaverjas_rounds(
      match_id,round_no,tak_no,round_in_tak,bid_team,bid_value,suit,
      base_points_w,base_points_z,roem_w,roem_z,nat_by,pit_by,verzaakt_by,
      awarded_raw_w,awarded_raw_z,awarded_ladder_w,awarded_ladder_z,
      dealer_player,forehand_player,payload
    ) values (
      v_match_id,
      coalesce(nullif((v_round->>'round')::int,null),nullif((v_round->>'roundNo')::int,null),v_i),
      coalesce(nullif((v_round->>'tak')::int,null),public._klaverjas_tak_count(v_i)),
      coalesce(nullif((v_round->>'roundInTak')::int,null),((v_i-1)%4)+1),
      coalesce(v_round->>'team','W'), coalesce((v_round->>'bid')::int,80), coalesce(v_round->>'suit','S'),
      coalesce((v_round->>'baseW')::int,0), coalesce((v_round->>'baseZ')::int,0),
      coalesce((v_round->>'roemW')::int,0), coalesce((v_round->>'roemZ')::int,0),
      nullif(v_round->>'natBy',''), nullif(v_round->>'pitBy',''), nullif(v_round->>'verzaaktBy',''),
      coalesce((v_round->>'fw')::int,0), coalesce((v_round->>'fz')::int,0),
      coalesce((v_round->>'fw')::int,0), coalesce((v_round->>'fz')::int,0),
      coalesce(v_round->>'dealer',public._klaverjas_dealer_name(v_player_order,v_i)),
      coalesce(v_round->>'forehand',public._klaverjas_forehand_name(v_player_order,v_i)),
      coalesce(v_round,'{}'::jsonb)
    );
  end loop;

  select count(*)::int,
         public._klaverjas_tak_count(count(*)::int),
         least(1::numeric,count(*)::numeric/16::numeric),
         public._klaverjas_progress_scale(count(*)::int),
         coalesce(sum(awarded_ladder_w),0),coalesce(sum(awarded_ladder_z),0),
         coalesce(sum(awarded_raw_w),0),coalesce(sum(awarded_raw_z),0),
         coalesce(sum(roem_w),0),coalesce(sum(roem_z),0)
    into v_round_count,v_tak_count,v_progress,v_elo_scale,v_score_w,v_score_z,v_raw_w,v_raw_z,v_roem_w,v_roem_z
    from public.klaverjas_rounds where match_id=v_match_id;

  if v_score_w>v_score_z then v_winner:='wij';
  elsif v_score_z>v_score_w then v_winner:='zij';
  else v_winner:='draw'; end if;

  update public.klaverjas_matches
     set status=v_status,
         finished_at=case when v_status in ('finished','abandoned') then now() else null end,
         total_rounds_played=v_round_count,total_takken_played=v_tak_count,
         progress_ratio=v_progress,elo_scale_applied=v_elo_scale,
         final_score_w=v_score_w,final_score_z=v_score_z,final_raw_w=v_raw_w,final_raw_z=v_raw_z,
         total_roem_w=v_roem_w,total_roem_z=v_roem_z,
         kruipen_side=public._klaverjas_kruip_side(v_score_w,v_score_z),
         naakt_kruipen_side=public._klaverjas_naakt_kruip_side(v_score_w,v_score_z),
         winner_side=v_winner,
         theoretical_full_delta=case when v_winner='wij' then greatest(1,v_score_w-v_score_z) when v_winner='zij' then greatest(1,v_score_z-v_score_w) else 0 end,
         actual_delta=case when v_winner='draw' then 0 else round((case when v_winner='wij' then greatest(1,v_score_w-v_score_z) else greatest(1,v_score_z-v_score_w) end)*v_elo_scale)::int end,
         payload_snapshot=coalesce(payload_snapshot_input,'{}'::jsonb),updated_at=now()
   where id=v_match_id and created_by_player_id=v_actor.id;

  if v_round_count>=8 then
    for v_i in 8..v_round_count loop
      v_snapshot_no:=v_snapshot_no+1;
      select jsonb_build_object(
        'match_id',v_match_id,'round_count',v_i,'tak_count',public._klaverjas_tak_count(v_i),
        'progress_ratio',least(1::numeric,v_i::numeric/16::numeric),'elo_scale',public._klaverjas_progress_scale(v_i),
        'players',jsonb_build_object('W',team_w_player_names_input,'Z',team_z_player_names_input),
        'totals',jsonb_build_object(
          'W',coalesce((select sum(awarded_ladder_w) from public.klaverjas_rounds where match_id=v_match_id and round_no<=v_i),0),
          'Z',coalesce((select sum(awarded_ladder_z) from public.klaverjas_rounds where match_id=v_match_id and round_no<=v_i),0)),
        'rawTotals',jsonb_build_object(
          'W',coalesce((select sum(awarded_raw_w) from public.klaverjas_rounds where match_id=v_match_id and round_no<=v_i),0),
          'Z',coalesce((select sum(awarded_raw_z) from public.klaverjas_rounds where match_id=v_match_id and round_no<=v_i),0)),
        'rounds',coalesce((select jsonb_agg(payload order by round_no) from public.klaverjas_rounds where match_id=v_match_id and round_no<=v_i),'[]'::jsonb)
      ) into v_round_score_state;
      insert into public.klaverjas_match_snapshots(match_id,snapshot_no,round_count,tak_count,progress_ratio,elo_scale,serialized_score_state)
      values(v_match_id,v_snapshot_no,v_i,public._klaverjas_tak_count(v_i),least(1::numeric,v_i::numeric/16::numeric),public._klaverjas_progress_scale(v_i),v_round_score_state);
    end loop;
  end if;

  return public._klaverjas_build_match_json(v_match_id);
end;
$function$;

create or replace function public.save_klaverjas_match_v687(
  session_token text default null,
  session_token_input text default null,
  client_match_id_input text default null,
  match_payload jsonb default '{}'::jsonb,
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $function$
declare
  v_token text:=coalesce(nullif(trim(coalesce(session_token_input,'')),''),nullif(trim(coalesce(session_token,'')),''));
  v_actor public.players%rowtype;
  v_client_match_id text:=nullif(trim(coalesce(client_match_id_input,'')),'');
  v_existing_id bigint;
  v_existing_owner bigint;
  v_team_w_names jsonb:=coalesce(match_payload->'team_a_names',match_payload->'team_w_names','[]'::jsonb);
  v_team_z_names jsonb:=coalesce(match_payload->'team_b_names',match_payload->'team_z_names','[]'::jsonb);
  v_score_w integer:=coalesce((match_payload->>'team_a_score')::integer,(match_payload->>'score_a')::integer,0);
  v_score_z integer:=coalesce((match_payload->>'team_b_score')::integer,(match_payload->>'score_b')::integer,0);
  v_roem_w integer:=coalesce((match_payload->>'roem_a')::integer,0);
  v_roem_z integer:=coalesce((match_payload->>'roem_b')::integer,0);
  v_notes text:=coalesce(match_payload->>'notes',match_payload->>'note','');
  v_rounds jsonb;
  v_snapshot jsonb;
  v_result jsonb;
  v_distinct_names integer;
  v_already_saved boolean:=false;
begin
  v_actor:=public._jas_session_player(v_token);
  if v_client_match_id is null then raise exception 'klaverjas_client_match_id_required'; end if;
  if jsonb_typeof(v_team_w_names)<>'array' or jsonb_array_length(v_team_w_names)<>2 then raise exception 'Klaverjassen verwacht precies twee spelers per team.'; end if;
  if jsonb_typeof(v_team_z_names)<>'array' or jsonb_array_length(v_team_z_names)<>2 then raise exception 'Klaverjassen verwacht precies twee spelers per team.'; end if;
  select count(distinct lower(trim(value)))::integer into v_distinct_names from jsonb_array_elements_text(v_team_w_names||v_team_z_names) x(value);
  if v_distinct_names<>4 then raise exception 'Elke speler mag maar één keer meedoen.'; end if;
  if v_score_w=v_score_z then raise exception 'Een Klaverjas-pot kan niet gelijk eindigen.'; end if;

  select id,created_by_player_id into v_existing_id,v_existing_owner
    from public.klaverjas_matches where client_match_id=v_client_match_id for update;
  if found then
    if v_existing_owner is null then raise exception 'klaverjas_match_owner_unknown'; end if;
    if v_existing_owner<>v_actor.id then raise exception 'klaverjas_match_owner_mismatch'; end if;
    v_already_saved:=true;
  end if;

  v_rounds:=jsonb_build_array(jsonb_build_object(
    'round',1,'roundNo',1,'team','W','bid',80,'suit','S',
    'baseW',v_score_w,'baseZ',v_score_z,'roemW',v_roem_w,'roemZ',v_roem_z,
    'fw',v_score_w,'fz',v_score_z,'note',v_notes));

  v_snapshot:=coalesce(match_payload,'{}'::jsonb)||jsonb_build_object(
    'client_match_id',v_client_match_id,'team_a_names',v_team_w_names,'team_b_names',v_team_z_names,
    'team_a_score',v_score_w,'team_b_score',v_score_z,'roem_a',v_roem_w,'roem_b',v_roem_z,
    'notes',v_notes,'source',coalesce(nullif(trim(match_payload->>'source'),''),'klaverjas_scorer_v687'));

  v_result:=public.klaverjas_upsert_match_state_scoped(
    v_token,v_existing_id,site_scope_input,'[]'::jsonb,'[]'::jsonb,
    v_team_w_names,v_team_z_names,v_rounds,v_snapshot,'finished',now());

  select id into v_existing_id from public.klaverjas_matches where client_match_id=v_client_match_id;
  return coalesce(v_result,'{}'::jsonb)||jsonb_build_object(
    'ok',true,'match_id',v_existing_id,'client_match_id',v_client_match_id,'already_saved',v_already_saved);
end;
$function$;

revoke insert,update,delete on table public.klaverjas_matches from public,anon,authenticated;
revoke insert,update,delete on table public.klaverjas_rounds from public,anon,authenticated;
revoke insert,update,delete on table public.klaverjas_match_snapshots from public,anon,authenticated;
revoke insert,update,delete on table public.jas_games from public,anon,authenticated;
revoke insert,update,delete on table public.jas_game_entries from public,anon,authenticated;
revoke insert,update,delete on table public.game_rating_rebuild_queue from public,anon,authenticated;
revoke insert,update,delete on table public.klaverjas_online_games from public,anon,authenticated;
revoke insert,update,delete on table public.klaverjas_online_player_stats from public,anon,authenticated;

revoke execute on function public.save_klaverjas_match_v687(text,text,text,jsonb,text) from public;
grant execute on function public.save_klaverjas_match_v687(text,text,text,jsonb,text) to anon,authenticated;
revoke execute on function public.klaverjas_upsert_match_state_scoped(text,bigint,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text,timestamp with time zone) from public;
grant execute on function public.klaverjas_upsert_match_state_scoped(text,bigint,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,text,timestamp with time zone) to anon,authenticated;
revoke execute on function public.create_jas_game(text,jsonb) from public;
grant execute on function public.create_jas_game(text,jsonb) to anon,authenticated;

-- Controlled proof. Uses temporary session rows and one controlled legacy match, all deleted before commit.
do $proof$
declare
  v_ids bigint[];
  v_names text[];
  v_token_a text := 'OC_V765_KLAVERJAS_A_'||txid_current()::text;
  v_token_b text := 'OC_V765_KLAVERJAS_B_'||txid_current()::text;
  v_token_stale text := 'OC_V765_KLAVERJAS_STALE_'||txid_current()::text;
  v_client text := 'OC_V765_KLAVERJAS_MATCH_'||txid_current()::text;
  v_payload jsonb;
  v_first jsonb;
  v_replay jsonb;
  v_match_id bigint;
  v_owner bigint;
  v_count bigint;
  v_detail text;
begin
  select array_agg(id order by id),array_agg(display_name order by id)
    into v_ids,v_names
    from (select id,display_name from public.players where coalesce(active,true)=true and nullif(trim(display_name),'') is not null order by id limit 4) s;
  if coalesce(array_length(v_ids,1),0)<>4 then raise exception 'v755r proof requires four active players'; end if;

  insert into public.gejast_player_sessions_v746(session_token,player_id,display_name,site_scope,created_at,last_seen_at,expires_at)
  values
    (v_token_a,v_ids[1],v_names[1],'friends',now(),now(),now()+interval '30 minutes'),
    (v_token_b,v_ids[2],v_names[2],'friends',now(),now(),now()+interval '30 minutes'),
    (v_token_stale,v_ids[1],v_names[1],'friends',now()-interval '2 hours',now()-interval '2 hours',now()-interval '1 hour');

  v_payload:=jsonb_build_object(
    'team_a_names',to_jsonb(array[v_names[1],v_names[3]]),
    'team_b_names',to_jsonb(array[v_names[2],v_names[4]]),
    'team_a_score',120,'team_b_score',90,'roem_a',10,'roem_b',0,
    'notes','OC_V765 transaction-gated proof','source','OC_V765');

  v_first:=public.save_klaverjas_match_v687(v_token_a,v_token_a,v_client,v_payload,'friends');
  v_match_id:=(v_first->>'match_id')::bigint;
  if v_match_id is null or coalesce((v_first->>'ok')::boolean,false) is not true or coalesce((v_first->>'already_saved')::boolean,true) is not false then
    raise exception 'v755r valid save contract failed: %',v_first;
  end if;

  select created_by_player_id,count(*) over() into v_owner,v_count from public.klaverjas_matches where client_match_id=v_client;
  if v_owner is distinct from v_ids[1] or v_count<>1 then raise exception 'v755r creator/idempotency row check failed'; end if;
  if (select final_score_w from public.klaverjas_matches where id=v_match_id)<>120 or (select final_score_z from public.klaverjas_matches where id=v_match_id)<>90 then
    raise exception 'v755r score persistence failed';
  end if;
  if (select count(*) from public.klaverjas_rounds where match_id=v_match_id)<>1 then raise exception 'v755r expected one canonical scorer round'; end if;
  insert into _v755r_results values('valid_uuid_save','PASS','text/UUID-style client id persisted once with creator and 120-90 score');

  v_replay:=public.save_klaverjas_match_v687(v_token_a,v_token_a,v_client,v_payload,'friends');
  if (v_replay->>'match_id')::bigint<>v_match_id or coalesce((v_replay->>'already_saved')::boolean,false) is not true then raise exception 'v755r same-owner replay failed: %',v_replay; end if;
  if (select count(*) from public.klaverjas_matches where client_match_id=v_client)<>1 then raise exception 'v755r replay created duplicate'; end if;
  insert into _v755r_results values('same_owner_replay','PASS','same match id, already_saved=true, one row');

  begin
    perform public.save_klaverjas_match_v687(v_token_b,v_token_b,v_client,v_payload,'friends');
    raise exception 'cross-owner write unexpectedly succeeded';
  exception when others then
    if position('klaverjas_match_owner_mismatch' in sqlerrm)=0 then raise; end if;
  end;
  insert into _v755r_results values('cross_player_owner_guard','PASS','different valid player rejected with klaverjas_match_owner_mismatch');

  begin
    perform public.save_klaverjas_match_v687(null,null,'OC_V765_MISSING_'||txid_current()::text,v_payload,'friends');
    raise exception 'missing session unexpectedly succeeded';
  exception when others then
    if position('Log eerst in met een geldige spelersessie' in sqlerrm)=0 then raise; end if;
  end;
  insert into _v755r_results values('missing_session_rejected','PASS','missing session rejected before write');

  begin
    perform public.save_klaverjas_match_v687('OC_V765_INVALID','OC_V765_INVALID','OC_V765_INVALID_MATCH_'||txid_current()::text,v_payload,'friends');
    raise exception 'invalid session unexpectedly succeeded';
  exception when others then
    if position('Log eerst in met een geldige spelersessie' in sqlerrm)=0 then raise; end if;
  end;
  insert into _v755r_results values('invalid_session_rejected','PASS','invalid session rejected before write');

  begin
    perform public.save_klaverjas_match_v687(v_token_stale,v_token_stale,'OC_V765_STALE_MATCH_'||txid_current()::text,v_payload,'friends');
    raise exception 'stale session unexpectedly succeeded';
  exception when others then
    if position('Log eerst in met een geldige spelersessie' in sqlerrm)=0 then raise; end if;
  end;
  insert into _v755r_results values('stale_session_rejected','PASS','expired controlled session rejected before write');

  select count(*) into v_count from information_schema.table_privileges
   where table_schema='public'
     and table_name in ('klaverjas_matches','klaverjas_rounds','klaverjas_match_snapshots','jas_games','jas_game_entries','game_rating_rebuild_queue','klaverjas_online_games','klaverjas_online_player_stats')
     and grantee in ('PUBLIC','anon','authenticated') and privilege_type in ('INSERT','UPDATE','DELETE');
  if v_count<>0 then raise exception 'v755r direct DML grants remain: %',v_count; end if;
  insert into _v755r_results values('direct_dml_boundary','PASS','PUBLIC/anon/authenticated INSERT/UPDATE/DELETE grants=0 on target tables');

  if exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname in ('save_klaverjas_match_v687','klaverjas_upsert_match_state_scoped','create_jas_game')
       and exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE')
  ) then raise exception 'v755r PUBLIC execute remains on a write RPC'; end if;
  insert into _v755r_results values('rpc_execute_boundary','PASS','PUBLIC execute removed; guarded web-role RPC execution retained');

  if (select count(*) from public.jas_games)<>(select value from _v755r_baseline where key='jas_games')
     or (select count(*) from public.jas_game_entries)<>(select value from _v755r_baseline where key='jas_game_entries')
     or (select count(*) from public.game_rating_rebuild_queue)<>(select value from _v755r_baseline where key='game_rating_rebuild_queue') then
    raise exception 'v755r current save unexpectedly touched classic/rating tables';
  end if;
  insert into _v755r_results values('rating_history_isolation','PASS','jas_games/entries/rebuild queue unchanged by current scorer proof');

  delete from public.klaverjas_matches where id=v_match_id and client_match_id=v_client and created_by_player_id=v_ids[1];
  if not found then raise exception 'v755r exact controlled match cleanup failed'; end if;
  delete from public.gejast_player_sessions_v746 where session_token in (v_token_a,v_token_b,v_token_stale);

  if (select count(*) from public.klaverjas_matches)<>(select value from _v755r_baseline where key='klaverjas_matches')
     or (select count(*) from public.klaverjas_rounds)<>(select value from _v755r_baseline where key='klaverjas_rounds')
     or (select count(*) from public.klaverjas_match_snapshots)<>(select value from _v755r_baseline where key='klaverjas_match_snapshots') then
    raise exception 'v755r legacy baseline not restored';
  end if;
  insert into _v755r_results values('baseline_restored','PASS','controlled legacy match/round/snapshot fixture removed exactly');

  if exists(select 1 from public.klaverjas_matches where to_jsonb(klaverjas_matches)::text ilike '%OC_V765%')
     or exists(select 1 from public.gejast_player_sessions_v746 where session_token ilike 'OC_V765_KLAVERJAS_%') then
    raise exception 'v755r controlled residue remains';
  end if;
  insert into _v755r_results values('controlled_residue','PASS','no controlled v765 Klaverjas match/session rows remain');

  select count(*) into v_count from public.web_push_jobs where to_jsonb(web_push_jobs)::text ilike '%OC_V765%';
  if v_count<>0 then raise exception 'v755r controlled push residue=%',v_count; end if;
  insert into _v755r_results values('controlled_push_jobs','PASS','OC_V765 push rows=0');

  select unit_value::text into v_detail from public.drink_event_types where key='ice' limit 1;
  if v_detail is distinct from '2.8' then raise exception 'v755r Ice invariant failed: %',v_detail; end if;
  insert into _v755r_results values('ice_invariant','PASS','Ice=2.8');
end;
$proof$;

commit;

select check_name,result,detail from _v755r_results order by check_name;
