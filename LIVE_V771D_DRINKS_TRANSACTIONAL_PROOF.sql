-- v771d final Drinks lifecycle proof.
-- PURPOSE: prove create -> pending -> approve and create -> pending -> reject through the
-- same v664 contracts used by the frontend, then ROLLBACK every controlled row.
--
-- SAFETY:
-- - no COMMIT exists in this file;
-- - controlled sessions/events exist only inside one transaction;
-- - all public drink* tables + the session table are write-locked for the short proof;
-- - owned sequence state is captured and restored before ROLLBACK;
-- - no push-queue RPC is called, so no notification job is created;
-- - post-rollback counts, sequence state, controlled-session residue and Ice=2.8 are rechecked.

create temp table if not exists _v771d_baseline(
  table_name text primary key,
  row_count bigint not null
) on commit preserve rows;
truncate _v771d_baseline;

create temp table if not exists _v771d_sequences(
  seq_name text primary key,
  last_value bigint not null,
  is_called boolean not null
) on commit preserve rows;
truncate _v771d_sequences;

-- Read-only dependency preflight.
do $preflight$
begin
  if to_regclass('public.players') is null then raise exception 'v771d missing public.players'; end if;
  if to_regclass('public.gejast_player_sessions_v746') is null then raise exception 'v771d missing gejast_player_sessions_v746'; end if;
  if to_regclass('public.drink_events') is null then raise exception 'v771d missing drink_events'; end if;
  if to_regclass('public.drink_event_types') is null then raise exception 'v771d missing drink_event_types'; end if;
  if to_regprocedure('public.contract_drinks_write_v664(text,text,jsonb,text)') is null then raise exception 'v771d missing contract_drinks_write_v664(text,text,jsonb,text)'; end if;
  if to_regprocedure('public.contract_drinks_read_v664(text,double precision,double precision,integer,text)') is null then raise exception 'v771d missing contract_drinks_read_v664 current signature'; end if;
  if not exists(select 1 from public.drink_event_types where lower(key)='ice' and unit_value::numeric=2.8) then raise exception 'v771d Ice invariant is not 2.8 before proof'; end if;
end
$preflight$;

-- Baseline every Drinks table and the temporary-session table.
do $baseline$
declare r record; v_count bigint;
begin
  for r in
    select tablename
      from pg_tables
     where schemaname='public'
       and (tablename like 'drink%' or tablename='gejast_player_sessions_v746')
     order by tablename
  loop
    execute format('select count(*) from public.%I',r.tablename) into v_count;
    insert into _v771d_baseline(table_name,row_count) values(r.tablename,v_count);
  end loop;
end
$baseline$;

-- Capture sequence state owned by those tables so even sequence counters can be restored.
do $seqbaseline$
declare r record; v_last bigint; v_called boolean;
begin
  for r in
    select distinct pg_get_serial_sequence(format('%I.%I','public',c.table_name),c.column_name) as seq_name
      from information_schema.columns c
     where c.table_schema='public'
       and (c.table_name like 'drink%' or c.table_name='gejast_player_sessions_v746')
       and pg_get_serial_sequence(format('%I.%I','public',c.table_name),c.column_name) is not null
  loop
    execute format('select last_value,is_called from %s',r.seq_name) into v_last,v_called;
    insert into _v771d_sequences(seq_name,last_value,is_called) values(r.seq_name,v_last,v_called)
      on conflict(seq_name) do nothing;
  end loop;
end
$seqbaseline$;

begin;

-- Block concurrent Drinks/session writes during the proof while still allowing normal reads.
do $locks$
declare r record;
begin
  for r in select table_name from _v771d_baseline order by table_name
  loop
    execute format('lock table public.%I in share row exclusive mode',r.table_name);
  end loop;
end
$locks$;

-- Refuse to proceed if a real write raced between baseline capture and lock acquisition.
do $racecheck$
declare r record; v_count bigint; v_last bigint; v_called boolean;
begin
  for r in select * from _v771d_baseline order by table_name
  loop
    execute format('select count(*) from public.%I',r.table_name) into v_count;
    if v_count<>r.row_count then raise exception 'v771d concurrent write detected on %, retry later',r.table_name; end if;
  end loop;
  for r in select * from _v771d_sequences order by seq_name
  loop
    execute format('select last_value,is_called from %s',r.seq_name) into v_last,v_called;
    if v_last<>r.last_value or v_called<>r.is_called then raise exception 'v771d concurrent sequence activity detected on %, retry later',r.seq_name; end if;
  end loop;
end
$racecheck$;

-- Controlled lifecycle proof. Multiple independent verifier sessions are available so the
-- proof follows whatever current vote threshold is configured instead of assuming one vote.
do $proof$
declare
  v_ids bigint[];
  v_names text[];
  v_token_a text:='OC_V771D_DRINKS_A_'||txid_current()::text;
  v_token_b text:='OC_V771D_DRINKS_B_'||txid_current()::text;
  v_token_c text:='OC_V771D_DRINKS_C_'||txid_current()::text;
  v_token_d text:='OC_V771D_DRINKS_D_'||txid_current()::text;
  v_tokens text[];
  v_create_approve jsonb;
  v_create_reject jsonb;
  v_verify jsonb;
  v_read jsonb;
  v_approve_id bigint;
  v_reject_id bigint;
  v_status text;
  v_token text;
  v_ice numeric;
  v_lat double precision:=52.3676;
  v_lng double precision:=4.9041;
  v_accuracy double precision:=25;
begin
  select array_agg(id order by id),array_agg(display_name order by id)
    into v_ids,v_names
    from (
      select id,display_name
        from public.players
       where coalesce(active,true)=true
         and nullif(trim(display_name),'') is not null
         and lower(coalesce(site_scope,'friends'))='friends'
       order by id
       limit 4
    ) s;
  if coalesce(array_length(v_ids,1),0)<>4 then raise exception 'v771d proof requires four active friends-scope players'; end if;

  insert into public.gejast_player_sessions_v746(session_token,player_id,display_name,site_scope,created_at,last_seen_at,expires_at)
  values
    (v_token_a,v_ids[1],v_names[1],'friends',now(),now(),now()+interval '30 minutes'),
    (v_token_b,v_ids[2],v_names[2],'friends',now(),now(),now()+interval '30 minutes'),
    (v_token_c,v_ids[3],v_names[3],'friends',now(),now(),now()+interval '30 minutes'),
    (v_token_d,v_ids[4],v_names[4],'friends',now(),now(),now()+interval '30 minutes');
  v_tokens:=array[v_token_b,v_token_c,v_token_d];

  -- Event 1: approval lifecycle.
  v_create_approve:=public.contract_drinks_write_v664(
    v_token_a,'create_event',
    jsonb_build_object('session_token',v_token_a,'event_type_key','bier','quantity',1,'lat',v_lat,'lng',v_lng,'accuracy',v_accuracy),
    'friends'
  );
  if coalesce((v_create_approve->>'ok')::boolean,true)=false then raise exception 'v771d approve fixture create returned ok=false: %',v_create_approve; end if;
  v_approve_id:=coalesce(
    nullif(v_create_approve#>>'{data,drink_event_id}','')::bigint,
    nullif(v_create_approve#>>'{data,event_id}','')::bigint,
    nullif(v_create_approve#>>'{data,id}','')::bigint,
    nullif(v_create_approve->>'drink_event_id','')::bigint,
    nullif(v_create_approve->>'event_id','')::bigint,
    nullif(v_create_approve->>'id','')::bigint
  );
  if v_approve_id is null then raise exception 'v771d approve fixture missing event id: %',v_create_approve; end if;

  -- Event 2: rejection lifecycle.
  v_create_reject:=public.contract_drinks_write_v664(
    v_token_a,'create_event',
    jsonb_build_object('session_token',v_token_a,'event_type_key','bier','quantity',1,'lat',v_lat,'lng',v_lng,'accuracy',v_accuracy),
    'friends'
  );
  if coalesce((v_create_reject->>'ok')::boolean,true)=false then raise exception 'v771d reject fixture create returned ok=false: %',v_create_reject; end if;
  v_reject_id:=coalesce(
    nullif(v_create_reject#>>'{data,drink_event_id}','')::bigint,
    nullif(v_create_reject#>>'{data,event_id}','')::bigint,
    nullif(v_create_reject#>>'{data,id}','')::bigint,
    nullif(v_create_reject->>'drink_event_id','')::bigint,
    nullif(v_create_reject->>'event_id','')::bigint,
    nullif(v_create_reject->>'id','')::bigint
  );
  if v_reject_id is null then raise exception 'v771d reject fixture missing event id: %',v_create_reject; end if;
  if v_reject_id=v_approve_id then raise exception 'v771d controlled event ids collided'; end if;

  select lower(coalesce(status,'pending')) into v_status from public.drink_events where id=v_approve_id;
  if v_status<>'pending' then raise exception 'v771d approve fixture did not start pending: %',v_status; end if;
  select lower(coalesce(status,'pending')) into v_status from public.drink_events where id=v_reject_id;
  if v_status<>'pending' then raise exception 'v771d reject fixture did not start pending: %',v_status; end if;

  -- Current read contract must expose the pending fixtures to another valid viewer.
  v_read:=public.contract_drinks_read_v664(v_token_b,v_lat,v_lng,40,'friends');
  if coalesce((v_read->>'ok')::boolean,true)=false then raise exception 'v771d pending read contract returned ok=false'; end if;
  if position(v_approve_id::text in v_read::text)=0 or position(v_reject_id::text in v_read::text)=0 then
    raise exception 'v771d pending events not visible through current read contract';
  end if;

  -- Approve with independent verifier sessions until current policy closes the request.
  foreach v_token in array v_tokens
  loop
    v_verify:=public.contract_drinks_write_v664(
      v_token,'verify_event',
      jsonb_build_object('session_token',v_token,'drink_event_id',v_approve_id,'approved',true,'approve',true,'lat',v_lat,'lng',v_lng,'accuracy',v_accuracy),
      'friends'
    );
    if coalesce((v_verify->>'ok')::boolean,true)=false then raise exception 'v771d approval vote returned ok=false: %',v_verify; end if;
    select lower(coalesce(status,'pending')) into v_status from public.drink_events where id=v_approve_id;
    exit when v_status in ('verified','approved');
  end loop;
  if v_status not in ('verified','approved') then raise exception 'v771d approval lifecycle did not close after three independent verifiers: %',v_status; end if;

  -- Reject a second request under the same current verifier policy.
  foreach v_token in array v_tokens
  loop
    v_verify:=public.contract_drinks_write_v664(
      v_token,'verify_event',
      jsonb_build_object('session_token',v_token,'drink_event_id',v_reject_id,'approved',false,'approve',false,'lat',v_lat,'lng',v_lng,'accuracy',v_accuracy),
      'friends'
    );
    if coalesce((v_verify->>'ok')::boolean,true)=false then raise exception 'v771d rejection vote returned ok=false: %',v_verify; end if;
    select lower(coalesce(status,'pending')) into v_status from public.drink_events where id=v_reject_id;
    exit when v_status in ('rejected','cancelled');
  end loop;
  if v_status not in ('rejected','cancelled') then raise exception 'v771d rejection lifecycle did not close after three independent verifiers: %',v_status; end if;

  -- Current read contract must expose both final lifecycle outcomes.
  v_read:=public.contract_drinks_read_v664(v_token_a,v_lat,v_lng,40,'friends');
  if coalesce((v_read->>'ok')::boolean,true)=false then raise exception 'v771d final read contract returned ok=false'; end if;
  if position('recent_verified' in v_read::text)=0 or position(v_approve_id::text in v_read::text)=0 then raise exception 'v771d approved event missing from final read contract'; end if;
  if position('recent_rejected' in v_read::text)=0 or position(v_reject_id::text in v_read::text)=0 then raise exception 'v771d rejected event missing from final read contract'; end if;

  select unit_value::numeric into v_ice from public.drink_event_types where lower(key)='ice' limit 1;
  if v_ice<>2.8 then raise exception 'v771d Ice invariant changed inside proof: %',v_ice; end if;
end
$proof$;

-- Sequences are non-transactional in PostgreSQL. Restore every sequence owned by the locked
-- Drinks/session tables *before* rollback while concurrent writes are still blocked.
do $restoreseq$
declare r record;
begin
  for r in select * from _v771d_sequences order by seq_name
  loop
    perform setval(r.seq_name::regclass,r.last_value,r.is_called);
  end loop;
end
$restoreseq$;

rollback;

-- Post-rollback proof: exact table counts, exact sequence state, no controlled sessions,
-- and Ice remains 2.8. Any mismatch aborts instead of returning PASS.
do $postcheck$
declare r record; v_count bigint; v_last bigint; v_called boolean;
begin
  for r in select * from _v771d_baseline order by table_name
  loop
    execute format('select count(*) from public.%I',r.table_name) into v_count;
    if v_count<>r.row_count then raise exception 'v771d rollback count mismatch on %: baseline %, now %',r.table_name,r.row_count,v_count; end if;
  end loop;
  for r in select * from _v771d_sequences order by seq_name
  loop
    execute format('select last_value,is_called from %s',r.seq_name) into v_last,v_called;
    if v_last<>r.last_value or v_called<>r.is_called then raise exception 'v771d sequence not restored on %',r.seq_name; end if;
  end loop;
  if exists(select 1 from public.gejast_player_sessions_v746 where session_token like 'OC_V771D_DRINKS_%') then raise exception 'v771d controlled session residue remains'; end if;
  if not exists(select 1 from public.drink_event_types where lower(key)='ice' and unit_value::numeric=2.8) then raise exception 'v771d Ice invariant is not 2.8 after rollback'; end if;
end
$postcheck$;

select * from (values
  ('approval_lifecycle','PASS','controlled drink created pending, exposed by current read contract, and closed as verified/approved'),
  ('rejection_lifecycle','PASS','second controlled drink created pending, exposed by current read contract, and closed as rejected/cancelled'),
  ('scope_and_sessions','PASS','four temporary friends-scope verifier sessions were used only inside the rolled-back transaction'),
  ('read_contract','PASS','current v664 read contract exposed pending and final verified/rejected lifecycle states'),
  ('push_safety','PASS','no push-queue RPC was called; uncommitted controlled rows were never visible to the scheduled dispatcher'),
  ('ice_invariant','PASS','Ice unit value remained exactly 2.8 before, during and after proof'),
  ('rollback_counts','PASS','all public drink* tables and gejast_player_sessions_v746 returned to exact baseline row counts'),
  ('sequence_restore','PASS','all owned Drinks/session sequence states were restored exactly before rollback'),
  ('controlled_residue','PASS','no OC_V771D_DRINKS session rows remain')
) as proof(check_name,result,detail)
order by check_name;
