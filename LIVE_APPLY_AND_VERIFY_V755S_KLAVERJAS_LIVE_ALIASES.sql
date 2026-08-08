-- v755s Klaverjas live aliases: production apply + controlled verification.
-- ONE TRANSACTION. Any failed assertion aborts the migration and every controlled write.

create temp table if not exists _v755s_results(
  check_name text primary key,
  result text not null,
  detail text not null
) on commit preserve rows;
truncate _v755s_results;

create temp table if not exists _v755s_baseline(
  key text primary key,
  value bigint not null
) on commit preserve rows;
truncate _v755s_baseline;
insert into _v755s_baseline values
  ('klaverjas_matches',(select count(*) from public.klaverjas_matches)),
  ('klaverjas_rounds',(select count(*) from public.klaverjas_rounds)),
  ('klaverjas_match_snapshots',(select count(*) from public.klaverjas_match_snapshots)),
  ('jas_games',(select count(*) from public.jas_games)),
  ('jas_game_entries',(select count(*) from public.jas_game_entries)),
  ('game_rating_rebuild_queue',(select count(*) from public.game_rating_rebuild_queue)),
  ('klaverjas_online_games',(select count(*) from public.klaverjas_online_games)),
  ('klaverjas_online_player_stats',(select count(*) from public.klaverjas_online_player_stats));

begin;

create or replace function public.get_klaverjas_live_state_public_v687(
  client_match_id_input text default null,
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  v_scope text := public._klaverjas_safe_scope(site_scope_input);
  v_client text := nullif(trim(coalesce(client_match_id_input,'')), '');
  v_row jsonb;
begin
  select jsonb_build_object(
    'client_match_id',m.client_match_id,'status',m.status,
    'updated_at',coalesce(m.updated_at,m.finished_at,m.started_at),
    'team_a_names',coalesce(m.team_w_player_names,'[]'::jsonb),
    'team_b_names',coalesce(m.team_z_player_names,'[]'::jsonb),
    'team_a_score',coalesce(m.final_score_w,0),'team_b_score',coalesce(m.final_score_z,0),
    'round_no',case when coalesce(m.payload_snapshot->>'round_no','') ~ '^\d+$'
                    then (m.payload_snapshot->>'round_no')::integer else coalesce(m.total_rounds_played,0) end,
    'payload',coalesce(m.payload_snapshot,'{}'::jsonb)
  ) into v_row
  from public.klaverjas_matches m
  where m.site_scope=v_scope
    and ((v_client is not null and m.client_match_id=v_client) or (v_client is null and m.status='active'))
  order by case when v_client is not null and m.client_match_id=v_client then 0 else 1 end,
           coalesce(m.updated_at,m.started_at) desc,m.id desc
  limit 1;

  if v_row is null then return jsonb_build_object('live_match',null,'live_matches','[]'::jsonb); end if;
  return jsonb_build_object('live_match',v_row,'live_matches',jsonb_build_array(v_row));
end;
$function$;

create or replace function public.start_klaverjas_live_match_v687(
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
  v_actor public.players%rowtype;
  v_scope text:=public._klaverjas_safe_scope(site_scope_input);
  v_client text:=nullif(trim(coalesce(client_match_id_input,'')),'');
  v_existing_id bigint; v_existing_owner bigint; v_existing_status text; v_existing_scope text;
  v_team_w jsonb:=coalesce(match_payload->'team_a_names',match_payload->'team_w_names','[]'::jsonb);
  v_team_z jsonb:=coalesce(match_payload->'team_b_names',match_payload->'team_z_names','[]'::jsonb);
  v_distinct_names integer; v_snapshot jsonb;
begin
  v_actor:=public._jas_session_player(session_token_input);
  if v_client is null then raise exception 'klaverjas_client_match_id_required'; end if;
  if jsonb_typeof(v_team_w)<>'array' or jsonb_array_length(v_team_w)<>2
     or jsonb_typeof(v_team_z)<>'array' or jsonb_array_length(v_team_z)<>2 then
    raise exception 'Klaverjassen verwacht precies twee spelers per team.';
  end if;
  select count(distinct lower(trim(value)))::integer into v_distinct_names
    from jsonb_array_elements_text(v_team_w||v_team_z) x(value);
  if v_distinct_names<>4 then raise exception 'Elke speler mag maar één keer meedoen.'; end if;

  select id,created_by_player_id,status,site_scope
    into v_existing_id,v_existing_owner,v_existing_status,v_existing_scope
    from public.klaverjas_matches where client_match_id=v_client for update;
  if found then
    if v_existing_owner is null then raise exception 'klaverjas_match_owner_unknown'; end if;
    if v_existing_owner<>v_actor.id then raise exception 'klaverjas_match_owner_mismatch'; end if;
    if v_existing_scope is distinct from v_scope then raise exception 'klaverjas_match_scope_mismatch'; end if;
    if v_existing_status<>'active' then raise exception 'klaverjas_live_match_not_active'; end if;
    return public.get_klaverjas_live_state_public_v687(v_client,v_scope)||jsonb_build_object('ok',true,'already_started',true);
  end if;

  v_snapshot:=coalesce(match_payload,'{}'::jsonb)||jsonb_build_object(
    'client_match_id',v_client,'team_a_names',v_team_w,'team_b_names',v_team_z,
    'team_a_score',0,'team_b_score',0,'round_no',0,
    'source',coalesce(nullif(trim(match_payload->>'source'),''),'klaverjas_live_v687'));

  perform public.klaverjas_upsert_match_state_scoped(
    session_token_input,null,v_scope,'[]'::jsonb,'[]'::jsonb,v_team_w,v_team_z,
    '[]'::jsonb,v_snapshot,'active',now());

  return public.get_klaverjas_live_state_public_v687(v_client,v_scope)||jsonb_build_object('ok',true,'already_started',false);
end;
$function$;

create or replace function public.update_klaverjas_live_match_v687(
  session_token_input text default null,
  client_match_id_input text default null,
  patch_payload jsonb default '{}'::jsonb,
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $function$
declare
  v_actor public.players%rowtype;
  v_scope text:=public._klaverjas_safe_scope(site_scope_input);
  v_client text:=nullif(trim(coalesce(client_match_id_input,'')),'');
  v_id bigint; v_owner bigint; v_status text; v_existing_scope text;
  v_team_w jsonb; v_team_z jsonb; v_snapshot jsonb; v_rounds jsonb:='[]'::jsonb;
  v_score_w integer; v_score_z integer; v_roem_w integer; v_roem_z integer; v_round_no integer; v_note text;
begin
  v_actor:=public._jas_session_player(session_token_input);
  if v_client is null then raise exception 'klaverjas_client_match_id_required'; end if;
  select m.id,m.created_by_player_id,m.status,m.site_scope,
         coalesce(m.team_w_player_names,'[]'::jsonb),coalesce(m.team_z_player_names,'[]'::jsonb),coalesce(m.payload_snapshot,'{}'::jsonb),
         coalesce(m.final_score_w,0),coalesce(m.final_score_z,0),coalesce(m.total_roem_w,0),coalesce(m.total_roem_z,0)
    into v_id,v_owner,v_status,v_existing_scope,v_team_w,v_team_z,v_snapshot,v_score_w,v_score_z,v_roem_w,v_roem_z
    from public.klaverjas_matches m where m.client_match_id=v_client for update;
  if not found then raise exception 'klaverjas_live_match_not_found'; end if;
  if v_owner is null then raise exception 'klaverjas_match_owner_unknown'; end if;
  if v_owner<>v_actor.id then raise exception 'klaverjas_match_owner_mismatch'; end if;
  if v_existing_scope is distinct from v_scope then raise exception 'klaverjas_match_scope_mismatch'; end if;
  if v_status<>'active' then raise exception 'klaverjas_live_match_not_active'; end if;

  if patch_payload?'team_a_score' then v_score_w:=(patch_payload->>'team_a_score')::integer; end if;
  if patch_payload?'team_b_score' then v_score_z:=(patch_payload->>'team_b_score')::integer; end if;
  if patch_payload?'roem_a' then v_roem_w:=(patch_payload->>'roem_a')::integer; end if;
  if patch_payload?'roem_b' then v_roem_z:=(patch_payload->>'roem_b')::integer; end if;
  v_round_no:=case when coalesce(patch_payload->>'round_no','')~'^\d+$' then (patch_payload->>'round_no')::integer
                   when coalesce(v_snapshot->>'round_no','')~'^\d+$' then (v_snapshot->>'round_no')::integer else 0 end;
  v_note:=coalesce(patch_payload->>'note',patch_payload->>'notes',v_snapshot->>'note',v_snapshot->>'notes','');
  v_snapshot:=v_snapshot||coalesce(patch_payload,'{}'::jsonb)||jsonb_build_object(
    'client_match_id',v_client,'team_a_names',v_team_w,'team_b_names',v_team_z,
    'team_a_score',v_score_w,'team_b_score',v_score_z,'roem_a',v_roem_w,'roem_b',v_roem_z,
    'round_no',greatest(v_round_no,0),'note',v_note,'source',coalesce(nullif(trim(v_snapshot->>'source'),''),'klaverjas_live_v687'));
  if v_round_no>0 or v_score_w<>0 or v_score_z<>0 or v_roem_w<>0 or v_roem_z<>0 then
    v_rounds:=jsonb_build_array(jsonb_build_object(
      'round',greatest(v_round_no,1),'roundNo',greatest(v_round_no,1),'team','W','bid',80,'suit','S',
      'baseW',v_score_w,'baseZ',v_score_z,'roemW',v_roem_w,'roemZ',v_roem_z,
      'fw',v_score_w,'fz',v_score_z,'note',v_note));
  end if;
  perform public.klaverjas_upsert_match_state_scoped(
    session_token_input,v_id,v_scope,'[]'::jsonb,'[]'::jsonb,v_team_w,v_team_z,v_rounds,v_snapshot,'active',null);
  return public.get_klaverjas_live_state_public_v687(v_client,v_scope)||jsonb_build_object('ok',true);
end;
$function$;

create or replace function public.finish_klaverjas_live_match_v687(
  session_token_input text default null,
  client_match_id_input text default null,
  patch_payload jsonb default '{}'::jsonb,
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $function$
declare
  v_actor public.players%rowtype;
  v_scope text:=public._klaverjas_safe_scope(site_scope_input);
  v_client text:=nullif(trim(coalesce(client_match_id_input,'')),'');
  v_id bigint; v_owner bigint; v_status text; v_existing_scope text;
  v_team_w jsonb; v_team_z jsonb; v_snapshot jsonb; v_rounds jsonb;
  v_score_w integer; v_score_z integer; v_roem_w integer; v_roem_z integer; v_round_no integer; v_note text;
begin
  v_actor:=public._jas_session_player(session_token_input);
  if v_client is null then raise exception 'klaverjas_client_match_id_required'; end if;
  select m.id,m.created_by_player_id,m.status,m.site_scope,
         coalesce(m.team_w_player_names,'[]'::jsonb),coalesce(m.team_z_player_names,'[]'::jsonb),coalesce(m.payload_snapshot,'{}'::jsonb),
         coalesce(m.final_score_w,0),coalesce(m.final_score_z,0),coalesce(m.total_roem_w,0),coalesce(m.total_roem_z,0)
    into v_id,v_owner,v_status,v_existing_scope,v_team_w,v_team_z,v_snapshot,v_score_w,v_score_z,v_roem_w,v_roem_z
    from public.klaverjas_matches m where m.client_match_id=v_client for update;
  if not found then raise exception 'klaverjas_live_match_not_found'; end if;
  if v_owner is null then raise exception 'klaverjas_match_owner_unknown'; end if;
  if v_owner<>v_actor.id then raise exception 'klaverjas_match_owner_mismatch'; end if;
  if v_existing_scope is distinct from v_scope then raise exception 'klaverjas_match_scope_mismatch'; end if;
  if v_status='finished' then
    return public.get_klaverjas_live_state_public_v687(v_client,v_scope)||jsonb_build_object('ok',true,'already_finished',true);
  end if;
  if v_status<>'active' then raise exception 'klaverjas_live_match_not_active'; end if;

  if patch_payload?'team_a_score' then v_score_w:=(patch_payload->>'team_a_score')::integer; end if;
  if patch_payload?'team_b_score' then v_score_z:=(patch_payload->>'team_b_score')::integer; end if;
  if patch_payload?'roem_a' then v_roem_w:=(patch_payload->>'roem_a')::integer; end if;
  if patch_payload?'roem_b' then v_roem_z:=(patch_payload->>'roem_b')::integer; end if;
  if v_score_w=v_score_z then raise exception 'Een Klaverjas-pot kan niet gelijk eindigen.'; end if;
  v_round_no:=case when coalesce(patch_payload->>'round_no','')~'^\d+$' then (patch_payload->>'round_no')::integer
                   when coalesce(v_snapshot->>'round_no','')~'^\d+$' then (v_snapshot->>'round_no')::integer else 1 end;
  v_note:=coalesce(patch_payload->>'note',patch_payload->>'notes',v_snapshot->>'note',v_snapshot->>'notes','');
  v_snapshot:=v_snapshot||coalesce(patch_payload,'{}'::jsonb)||jsonb_build_object(
    'client_match_id',v_client,'team_a_names',v_team_w,'team_b_names',v_team_z,
    'team_a_score',v_score_w,'team_b_score',v_score_z,'roem_a',v_roem_w,'roem_b',v_roem_z,
    'round_no',greatest(v_round_no,1),'note',v_note,'source',coalesce(nullif(trim(v_snapshot->>'source'),''),'klaverjas_live_v687'));
  v_rounds:=jsonb_build_array(jsonb_build_object(
    'round',greatest(v_round_no,1),'roundNo',greatest(v_round_no,1),'team','W','bid',80,'suit','S',
    'baseW',v_score_w,'baseZ',v_score_z,'roemW',v_roem_w,'roemZ',v_roem_z,
    'fw',v_score_w,'fz',v_score_z,'note',v_note));
  perform public.klaverjas_upsert_match_state_scoped(
    session_token_input,v_id,v_scope,'[]'::jsonb,'[]'::jsonb,v_team_w,v_team_z,v_rounds,v_snapshot,'finished',null);
  return public.get_klaverjas_live_state_public_v687(v_client,v_scope)||jsonb_build_object('ok',true,'already_finished',false);
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

revoke execute on function public.start_klaverjas_live_match_v687(text,text,jsonb,text) from public;
grant execute on function public.start_klaverjas_live_match_v687(text,text,jsonb,text) to anon,authenticated;
revoke execute on function public.update_klaverjas_live_match_v687(text,text,jsonb,text) from public;
grant execute on function public.update_klaverjas_live_match_v687(text,text,jsonb,text) to anon,authenticated;
revoke execute on function public.finish_klaverjas_live_match_v687(text,text,jsonb,text) from public;
grant execute on function public.finish_klaverjas_live_match_v687(text,text,jsonb,text) to anon,authenticated;
grant execute on function public.get_klaverjas_live_state_public_v687(text,text) to public,anon,authenticated;

-- Controlled proof.
do $proof$
declare
  v_ids bigint[]; v_names text[];
  v_token_a text:='OC_V766_KLAVERJAS_A_'||txid_current()::text;
  v_token_b text:='OC_V766_KLAVERJAS_B_'||txid_current()::text;
  v_token_stale text:='OC_V766_KLAVERJAS_STALE_'||txid_current()::text;
  v_client text:='OC_V766_KLAVERJAS_LIVE_'||txid_current()::text;
  v_payload jsonb; v_start jsonb; v_replay jsonb; v_live jsonb; v_update jsonb; v_finish jsonb; v_finish_replay jsonb;
  v_match_id bigint; v_owner bigint; v_count bigint; v_detail text;
begin
  select array_agg(id order by id),array_agg(display_name order by id)
    into v_ids,v_names
    from (select id,display_name from public.players where coalesce(active,true)=true and nullif(trim(display_name),'') is not null order by id limit 4) s;
  if coalesce(array_length(v_ids,1),0)<>4 then raise exception 'v755s proof requires four active players'; end if;

  insert into public.gejast_player_sessions_v746(session_token,player_id,display_name,site_scope,created_at,last_seen_at,expires_at)
  values
    (v_token_a,v_ids[1],v_names[1],'friends',now(),now(),now()+interval '30 minutes'),
    (v_token_b,v_ids[2],v_names[2],'friends',now(),now(),now()+interval '30 minutes'),
    (v_token_stale,v_ids[1],v_names[1],'friends',now()-interval '2 hours',now()-interval '2 hours',now()-interval '1 hour');

  v_payload:=jsonb_build_object(
    'team_a_names',to_jsonb(array[v_names[1],v_names[3]]),
    'team_b_names',to_jsonb(array[v_names[2],v_names[4]]),
    'team_a_score',0,'team_b_score',0,'roem_a',0,'roem_b',0,
    'notes','OC_V766 transaction-gated live proof','source','OC_V766');

  v_start:=public.start_klaverjas_live_match_v687(v_token_a,v_client,v_payload,'friends');
  if coalesce((v_start->>'ok')::boolean,false) is not true or coalesce((v_start->>'already_started')::boolean,true) is not false then
    raise exception 'v755s start failed: %',v_start;
  end if;
  select id,created_by_player_id into v_match_id,v_owner from public.klaverjas_matches where client_match_id=v_client;
  if v_match_id is null or v_owner is distinct from v_ids[1] then raise exception 'v755s start owner row failed'; end if;
  if (select status from public.klaverjas_matches where id=v_match_id)<>'active' then raise exception 'v755s start status failed'; end if;
  if (select count(*) from public.klaverjas_rounds where match_id=v_match_id)<>0 then raise exception 'v755s 0-0 start must not create a scoring round'; end if;
  insert into _v755s_results values('valid_uuid_start','PASS','UUID/text live match created active at 0-0 with correct creator and zero rounds');

  v_replay:=public.start_klaverjas_live_match_v687(v_token_a,v_client,v_payload,'friends');
  if coalesce((v_replay->>'already_started')::boolean,false) is not true then raise exception 'v755s start replay failed: %',v_replay; end if;
  if (select count(*) from public.klaverjas_matches where client_match_id=v_client)<>1 then raise exception 'v755s start replay duplicated row'; end if;
  insert into _v755s_results values('same_owner_start_replay','PASS','same owner start replay returned existing active row');

  v_live:=public.get_klaverjas_live_state_public_v687(v_client,'friends');
  if v_live#>>'{live_match,client_match_id}' is distinct from v_client
     or v_live#>>'{live_match,status}' is distinct from 'active'
     or (v_live#>>'{live_match,team_a_score}')::integer<>0
     or (v_live#>>'{live_match,team_b_score}')::integer<>0 then
    raise exception 'v755s public UUID getter failed: %',v_live;
  end if;
  insert into _v755s_results values('public_uuid_get','PASS','public scope-filtered getter resolves UUID/text client id');

  v_update:=public.update_klaverjas_live_match_v687(v_token_a,v_client,jsonb_build_object('team_a_score',40,'team_b_score',20,'round_no',3,'note','OC_V766 update'),'friends');
  if (v_update#>>'{live_match,status}')<>'active'
     or (v_update#>>'{live_match,team_a_score}')::integer<>40
     or (v_update#>>'{live_match,team_b_score}')::integer<>20
     or (v_update#>>'{live_match,round_no}')::integer<>3 then
    raise exception 'v755s live update failed: %',v_update;
  end if;
  insert into _v755s_results values('owner_live_update','PASS','owner update persisted 40-20 and public round_no=3');

  begin
    perform public.update_klaverjas_live_match_v687(v_token_b,v_client,jsonb_build_object('team_a_score',999),'friends');
    raise exception 'cross-owner update unexpectedly succeeded';
  exception when others then
    if position('klaverjas_match_owner_mismatch' in sqlerrm)=0 then raise; end if;
  end;
  insert into _v755s_results values('cross_player_owner_guard','PASS','different valid player rejected on live update');

  begin
    perform public.start_klaverjas_live_match_v687(null,'OC_V766_MISSING_'||txid_current()::text,v_payload,'friends');
    raise exception 'missing session unexpectedly succeeded';
  exception when others then
    if position('Log eerst in met een geldige spelersessie' in sqlerrm)=0 then raise; end if;
  end;
  begin
    perform public.update_klaverjas_live_match_v687('OC_V766_INVALID',v_client,'{}'::jsonb,'friends');
    raise exception 'invalid session unexpectedly succeeded';
  exception when others then
    if position('Log eerst in met een geldige spelersessie' in sqlerrm)=0 then raise; end if;
  end;
  begin
    perform public.finish_klaverjas_live_match_v687(v_token_stale,v_client,jsonb_build_object('team_a_score',120,'team_b_score',90),'friends');
    raise exception 'stale session unexpectedly succeeded';
  exception when others then
    if position('Log eerst in met een geldige spelersessie' in sqlerrm)=0 then raise; end if;
  end;
  insert into _v755s_results values('session_guards','PASS','missing, invalid and stale sessions rejected before live writes');

  v_finish:=public.finish_klaverjas_live_match_v687(v_token_a,v_client,jsonb_build_object('team_a_score',120,'team_b_score',90,'round_no',8,'note','OC_V766 finish'),'friends');
  if (v_finish#>>'{live_match,status}')<>'finished'
     or (v_finish#>>'{live_match,team_a_score}')::integer<>120
     or (v_finish#>>'{live_match,team_b_score}')::integer<>90
     or (v_finish#>>'{live_match,round_no}')::integer<>8
     or coalesce((v_finish->>'already_finished')::boolean,true) is not false then
    raise exception 'v755s finish failed: %',v_finish;
  end if;
  insert into _v755s_results values('owner_live_finish','PASS','owner finish persisted 120-90, round_no=8 and finished state');

  v_finish_replay:=public.finish_klaverjas_live_match_v687(v_token_a,v_client,jsonb_build_object('team_a_score',120,'team_b_score',90,'round_no',8),'friends');
  if coalesce((v_finish_replay->>'already_finished')::boolean,false) is not true then raise exception 'v755s finish replay failed: %',v_finish_replay; end if;
  if (select count(*) from public.klaverjas_matches where client_match_id=v_client)<>1 then raise exception 'v755s finish replay duplicated row'; end if;
  insert into _v755s_results values('same_owner_finish_replay','PASS','finished replay is idempotent and keeps one row');

  select count(*) into v_count from information_schema.table_privileges
   where table_schema='public'
     and table_name in ('klaverjas_matches','klaverjas_rounds','klaverjas_match_snapshots','jas_games','jas_game_entries','game_rating_rebuild_queue','klaverjas_online_games','klaverjas_online_player_stats')
     and grantee in ('PUBLIC','anon','authenticated') and privilege_type in ('INSERT','UPDATE','DELETE');
  if v_count<>0 then raise exception 'v755s direct DML grants remain: %',v_count; end if;
  insert into _v755s_results values('direct_dml_boundary','PASS','PUBLIC/anon/authenticated INSERT/UPDATE/DELETE grants=0 on target tables');

  if exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname in ('start_klaverjas_live_match_v687','update_klaverjas_live_match_v687','finish_klaverjas_live_match_v687')
       and exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE')
  ) then raise exception 'v755s PUBLIC execute remains on a write alias'; end if;
  insert into _v755s_results values('rpc_execute_boundary','PASS','write aliases PUBLIC=false; guarded web-role execution retained');

  if (select count(*) from public.jas_games)<>(select value from _v755s_baseline where key='jas_games')
     or (select count(*) from public.jas_game_entries)<>(select value from _v755s_baseline where key='jas_game_entries')
     or (select count(*) from public.game_rating_rebuild_queue)<>(select value from _v755s_baseline where key='game_rating_rebuild_queue') then
    raise exception 'v755s live aliases unexpectedly touched classic/rating tables';
  end if;
  insert into _v755s_results values('rating_history_isolation','PASS','jas_games/entries/rebuild queue unchanged by live proof');

  delete from public.klaverjas_matches where id=v_match_id and client_match_id=v_client and created_by_player_id=v_ids[1];
  if not found then raise exception 'v755s exact controlled match cleanup failed'; end if;
  delete from public.gejast_player_sessions_v746 where session_token in (v_token_a,v_token_b,v_token_stale);

  if (select count(*) from public.klaverjas_matches)<>(select value from _v755s_baseline where key='klaverjas_matches')
     or (select count(*) from public.klaverjas_rounds)<>(select value from _v755s_baseline where key='klaverjas_rounds')
     or (select count(*) from public.klaverjas_match_snapshots)<>(select value from _v755s_baseline where key='klaverjas_match_snapshots') then
    raise exception 'v755s legacy baseline not restored';
  end if;
  insert into _v755s_results values('baseline_restored','PASS','controlled live match/round/snapshot fixture removed exactly');

  if exists(select 1 from public.klaverjas_matches where to_jsonb(klaverjas_matches)::text ilike '%OC_V766%')
     or exists(select 1 from public.gejast_player_sessions_v746 where session_token ilike 'OC_V766_KLAVERJAS_%') then
    raise exception 'v755s controlled residue remains';
  end if;
  insert into _v755s_results values('controlled_residue','PASS','no controlled v766 Klaverjas match/session rows remain');

  select count(*) into v_count from public.web_push_jobs where to_jsonb(web_push_jobs)::text ilike '%OC_V766%';
  if v_count<>0 then raise exception 'v755s controlled push residue=%',v_count; end if;
  insert into _v755s_results values('controlled_push_jobs','PASS','OC_V766 push rows=0');

  select unit_value::text into v_detail from public.drink_event_types where key='ice' limit 1;
  if v_detail is distinct from '2.8' then raise exception 'v755s Ice invariant failed: %',v_detail; end if;
  insert into _v755s_results values('ice_invariant','PASS','Ice=2.8');
end;
$proof$;

commit;

select check_name,result,detail from _v755s_results order by check_name;
