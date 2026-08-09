-- v771d final Drinks lifecycle proof, Supabase SQL Editor safe.
-- PURPOSE: prove create -> pending -> approve and create -> pending -> reject through the
-- current v664 contracts, while rolling back every controlled Drinks/session row.
--
-- IMPORTANT TRANSACTION DESIGN:
-- - there is NO script-level BEGIN/COMMIT/ROLLBACK;
-- - the controlled lifecycle runs inside a PL/pgSQL exception subtransaction;
-- - a private SQLSTATE P771D is raised only after every lifecycle assertion succeeds;
-- - catching P771D rolls back only the controlled subtransaction, while outer in-memory
--   baselines survive for exact postchecks;
-- - unexpected errors are NOT swallowed: sequences are restored and the original error is re-raised;
-- - no permanent helper table, temp baseline table, push queue call, or committed drink row is created.

do $v771d$
declare
  r record;
  v_baseline jsonb := '[]'::jsonb;
  v_sequences jsonb := '[]'::jsonb;
  v_count bigint;
  v_last bigint;
  v_called boolean;

  v_creator_id bigint;
  v_creator_name text;
  v_verifier_ids bigint[];
  v_verifier_names text[];

  v_token_a text := 'OC_V771D_DRINKS_A_'||txid_current()::text;
  v_token_b text := 'OC_V771D_DRINKS_B_'||txid_current()::text;
  v_token_c text := 'OC_V771D_DRINKS_C_'||txid_current()::text;
  v_token_d text := 'OC_V771D_DRINKS_D_'||txid_current()::text;
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
  v_expected_rollback boolean := false;

  v_lat double precision := 52.3676;
  v_lng double precision := 4.9041;
  v_accuracy double precision := 25;
begin
  -- Read-only dependency preflight.
  if to_regclass('public.players') is null then raise exception 'v771d missing public.players'; end if;
  if to_regclass('public.gejast_player_sessions_v746') is null then raise exception 'v771d missing gejast_player_sessions_v746'; end if;
  if to_regclass('public.drink_events') is null then raise exception 'v771d missing drink_events'; end if;
  if to_regclass('public.drink_event_types') is null then raise exception 'v771d missing drink_event_types'; end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='drink_events' and column_name='player_id') then raise exception 'v771d missing drink_events.player_id'; end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='drink_events' and column_name='status') then raise exception 'v771d missing drink_events.status'; end if;
  if to_regprocedure('public.contract_drinks_write_v664(text,text,jsonb,text)') is null then raise exception 'v771d missing contract_drinks_write_v664(text,text,jsonb,text)'; end if;
  if to_regprocedure('public.contract_drinks_read_v664(text,double precision,double precision,integer,text)') is null then raise exception 'v771d missing contract_drinks_read_v664 current signature'; end if;
  if not exists(select 1 from public.drink_event_types where lower(key)='ice' and unit_value::numeric=2.8) then raise exception 'v771d Ice invariant is not 2.8 before proof'; end if;

  -- Lock all current Drinks tables plus the session table before baselining. These locks are
  -- re-entrant for this statement and block concurrent writes while the proof is active.
  for r in
    select tablename
      from pg_tables
     where schemaname='public'
       and (tablename like 'drink%' or tablename='gejast_player_sessions_v746')
     order by tablename
  loop
    execute format('lock table public.%I in share row exclusive mode',r.tablename);
  end loop;

  -- Capture exact row-count baselines in PL/pgSQL memory, not in temp tables.
  for r in
    select tablename
      from pg_tables
     where schemaname='public'
       and (tablename like 'drink%' or tablename='gejast_player_sessions_v746')
     order by tablename
  loop
    execute format('select count(*) from public.%I',r.tablename) into v_count;
    v_baseline := v_baseline || jsonb_build_array(jsonb_build_object('table_name',r.tablename,'row_count',v_count));
  end loop;

  -- Capture all serial/identity sequence states owned by the locked tables. Sequence operations
  -- are not transactional in PostgreSQL, so they are explicitly restored after subtransaction rollback.
  for r in
    select distinct pg_get_serial_sequence(format('%I.%I','public',c.table_name),c.column_name) as seq_name
      from information_schema.columns c
     where c.table_schema='public'
       and (c.table_name like 'drink%' or c.table_name='gejast_player_sessions_v746')
       and pg_get_serial_sequence(format('%I.%I','public',c.table_name),c.column_name) is not null
     order by 1
  loop
    execute format('select last_value,is_called from %s',r.seq_name) into v_last,v_called;
    v_sequences := v_sequences || jsonb_build_array(jsonb_build_object('seq_name',r.seq_name,'last_value',v_last,'is_called',v_called));
  end loop;

  -- Choose one free Friends-scope creator. Production enforces one pending drink per player.
  select p.id,p.display_name
    into v_creator_id,v_creator_name
    from public.players p
   where coalesce(p.active,true)=true
     and nullif(trim(p.display_name),'') is not null
     and lower(coalesce(p.site_scope,'friends'))='friends'
     and not exists(
       select 1
         from public.drink_events e
        where e.player_id=p.id
          and lower(coalesce(e.status,'pending'))='pending'
     )
   order by p.id
   limit 1;
  if v_creator_id is null then raise exception 'v771d proof requires one active friends-scope player with no existing pending drink'; end if;

  select array_agg(id order by id),array_agg(display_name order by id)
    into v_verifier_ids,v_verifier_names
    from (
      select p.id,p.display_name
        from public.players p
       where coalesce(p.active,true)=true
         and nullif(trim(p.display_name),'') is not null
         and lower(coalesce(p.site_scope,'friends'))='friends'
         and p.id<>v_creator_id
       order by p.id
       limit 3
    ) s;
  if coalesce(array_length(v_verifier_ids,1),0)<>3 then raise exception 'v771d proof requires three additional active friends-scope verifier players'; end if;
  v_tokens := array[v_token_b,v_token_c,v_token_d];

  -- Everything from session creation through lifecycle completion is inside one nested block.
  -- Only the private P771D signal is caught as success; all other exceptions propagate.
  begin
    insert into public.gejast_player_sessions_v746(session_token,player_id,display_name,site_scope,created_at,last_seen_at,expires_at)
    values
      (v_token_a,v_creator_id,v_creator_name,'friends',now(),now(),now()+interval '30 minutes'),
      (v_token_b,v_verifier_ids[1],v_verifier_names[1],'friends',now(),now(),now()+interval '30 minutes'),
      (v_token_c,v_verifier_ids[2],v_verifier_names[2],'friends',now(),now(),now()+interval '30 minutes'),
      (v_token_d,v_verifier_ids[3],v_verifier_names[3],'friends',now(),now(),now()+interval '30 minutes');

    -- Event 1: create and prove pending.
    v_create_approve := public.contract_drinks_write_v664(
      v_token_a,'create_event',
      jsonb_build_object('session_token',v_token_a,'event_type_key','bier','quantity',1,'lat',v_lat,'lng',v_lng,'accuracy',v_accuracy),
      'friends'
    );
    if coalesce((v_create_approve->>'ok')::boolean,true)=false then raise exception 'v771d approve fixture create returned ok=false: %',v_create_approve; end if;
    v_approve_id := coalesce(
      nullif(v_create_approve#>>'{data,drink_event_id}','')::bigint,
      nullif(v_create_approve#>>'{data,event_id}','')::bigint,
      nullif(v_create_approve#>>'{data,id}','')::bigint,
      nullif(v_create_approve->>'drink_event_id','')::bigint,
      nullif(v_create_approve->>'event_id','')::bigint,
      nullif(v_create_approve->>'id','')::bigint
    );
    if v_approve_id is null then raise exception 'v771d approve fixture missing event id: %',v_create_approve; end if;
    select lower(coalesce(status,'pending')) into v_status from public.drink_events where id=v_approve_id;
    if v_status<>'pending' then raise exception 'v771d approve fixture did not start pending: %',v_status; end if;

    v_read := public.contract_drinks_read_v664(v_token_b,v_lat,v_lng,40,'friends');
    if coalesce((v_read->>'ok')::boolean,true)=false then raise exception 'v771d approval pending read contract returned ok=false'; end if;
    if position(v_approve_id::text in v_read::text)=0 then raise exception 'v771d approval pending event not visible through current read contract'; end if;

    -- Approve to terminal with independent non-creator verifier sessions.
    foreach v_token in array v_tokens
    loop
      v_verify := public.contract_drinks_write_v664(
        v_token,'verify_event',
        jsonb_build_object('session_token',v_token,'drink_event_id',v_approve_id,'approved',true,'approve',true,'lat',v_lat,'lng',v_lng,'accuracy',v_accuracy),
        'friends'
      );
      if coalesce((v_verify->>'ok')::boolean,true)=false then raise exception 'v771d approval vote returned ok=false: %',v_verify; end if;
      select lower(coalesce(status,'pending')) into v_status from public.drink_events where id=v_approve_id;
      exit when v_status in ('verified','approved');
    end loop;
    if v_status not in ('verified','approved') then raise exception 'v771d approval lifecycle did not close after three independent verifiers: %',v_status; end if;
    if exists(select 1 from public.drink_events where player_id=v_creator_id and lower(coalesce(status,'pending'))='pending') then raise exception 'v771d creator still has a pending drink after approval closure'; end if;

    -- Event 2 starts only after Event 1 is terminal.
    v_create_reject := public.contract_drinks_write_v664(
      v_token_a,'create_event',
      jsonb_build_object('session_token',v_token_a,'event_type_key','bier','quantity',1,'lat',v_lat,'lng',v_lng,'accuracy',v_accuracy),
      'friends'
    );
    if coalesce((v_create_reject->>'ok')::boolean,true)=false then raise exception 'v771d reject fixture create returned ok=false: %',v_create_reject; end if;
    v_reject_id := coalesce(
      nullif(v_create_reject#>>'{data,drink_event_id}','')::bigint,
      nullif(v_create_reject#>>'{data,event_id}','')::bigint,
      nullif(v_create_reject#>>'{data,id}','')::bigint,
      nullif(v_create_reject->>'drink_event_id','')::bigint,
      nullif(v_create_reject->>'event_id','')::bigint,
      nullif(v_create_reject->>'id','')::bigint
    );
    if v_reject_id is null then raise exception 'v771d reject fixture missing event id: %',v_create_reject; end if;
    if v_reject_id=v_approve_id then raise exception 'v771d controlled event ids collided'; end if;
    select lower(coalesce(status,'pending')) into v_status from public.drink_events where id=v_reject_id;
    if v_status<>'pending' then raise exception 'v771d reject fixture did not start pending: %',v_status; end if;

    v_read := public.contract_drinks_read_v664(v_token_b,v_lat,v_lng,40,'friends');
    if coalesce((v_read->>'ok')::boolean,true)=false then raise exception 'v771d rejection pending read contract returned ok=false'; end if;
    if position(v_reject_id::text in v_read::text)=0 then raise exception 'v771d rejection pending event not visible through current read contract'; end if;

    foreach v_token in array v_tokens
    loop
      v_verify := public.contract_drinks_write_v664(
        v_token,'verify_event',
        jsonb_build_object('session_token',v_token,'drink_event_id',v_reject_id,'approved',false,'approve',false,'lat',v_lat,'lng',v_lng,'accuracy',v_accuracy),
        'friends'
      );
      if coalesce((v_verify->>'ok')::boolean,true)=false then raise exception 'v771d rejection vote returned ok=false: %',v_verify; end if;
      select lower(coalesce(status,'pending')) into v_status from public.drink_events where id=v_reject_id;
      exit when v_status in ('rejected','cancelled');
    end loop;
    if v_status not in ('rejected','cancelled') then raise exception 'v771d rejection lifecycle did not close after three independent verifiers: %',v_status; end if;

    -- Final read must expose both terminal outcomes before controlled rollback.
    v_read := public.contract_drinks_read_v664(v_token_a,v_lat,v_lng,40,'friends');
    if coalesce((v_read->>'ok')::boolean,true)=false then raise exception 'v771d final read contract returned ok=false'; end if;
    if position('recent_verified' in v_read::text)=0 or position(v_approve_id::text in v_read::text)=0 then raise exception 'v771d approved event missing from final read contract'; end if;
    if position('recent_rejected' in v_read::text)=0 or position(v_reject_id::text in v_read::text)=0 then raise exception 'v771d rejected event missing from final read contract'; end if;

    select unit_value::numeric into v_ice from public.drink_event_types where lower(key)='ice' limit 1;
    if v_ice<>2.8 then raise exception 'v771d Ice invariant changed inside proof: %',v_ice; end if;

    -- Reaching this private signal means every lifecycle assertion passed. Raising it rolls back
    -- all controlled DML in this nested block. It is the only exception interpreted as success.
    raise exception using errcode='P771D', message='v771d controlled rollback';
  exception
    when sqlstate 'P771D' then
      v_expected_rollback := true;
    when others then
      -- The failed nested subtransaction has already rolled back its table changes. Restore
      -- sequence state before re-raising the original error, because sequences are non-transactional.
      for r in
        select * from jsonb_to_recordset(v_sequences)
          as x(seq_name text,last_value bigint,is_called boolean)
        order by seq_name
      loop
        perform setval(r.seq_name::regclass,r.last_value,r.is_called);
      end loop;
      raise;
  end;

  if not v_expected_rollback then raise exception 'v771d controlled subtransaction did not execute expected rollback'; end if;

  -- Restore sequence states after the expected controlled rollback.
  for r in
    select * from jsonb_to_recordset(v_sequences)
      as x(seq_name text,last_value bigint,is_called boolean)
    order by seq_name
  loop
    perform setval(r.seq_name::regclass,r.last_value,r.is_called);
  end loop;

  -- Exact post-rollback checks while the write locks are still held.
  for r in
    select * from jsonb_to_recordset(v_baseline)
      as x(table_name text,row_count bigint)
    order by table_name
  loop
    execute format('select count(*) from public.%I',r.table_name) into v_count;
    if v_count<>r.row_count then raise exception 'v771d rollback count mismatch on %: baseline %, now %',r.table_name,r.row_count,v_count; end if;
  end loop;

  for r in
    select * from jsonb_to_recordset(v_sequences)
      as x(seq_name text,last_value bigint,is_called boolean)
    order by seq_name
  loop
    execute format('select last_value,is_called from %s',r.seq_name) into v_last,v_called;
    if v_last<>r.last_value or v_called<>r.is_called then raise exception 'v771d sequence not restored on %',r.seq_name; end if;
  end loop;

  if exists(select 1 from public.gejast_player_sessions_v746 where session_token like 'OC_V771D_DRINKS_%') then raise exception 'v771d controlled session residue remains'; end if;
  if not exists(select 1 from public.drink_event_types where lower(key)='ice' and unit_value::numeric=2.8) then raise exception 'v771d Ice invariant is not 2.8 after rollback'; end if;
end
$v771d$;

-- If the DO statement above raises any unexpected exception, execution stops before this table.
-- Therefore these PASS rows are emitted only after the lifecycle succeeded, the nested controlled
-- subtransaction rolled back, sequences were restored, and exact residue checks passed.
select * from (values
  ('approval_lifecycle','PASS','controlled drink created pending, exposed by current read contract, and closed as verified/approved'),
  ('rejection_lifecycle','PASS','second controlled drink created only after approval closure, exposed pending, and closed as rejected/cancelled'),
  ('one_pending_invariant','PASS','creator had no pre-existing pending drink and the second fixture started only after the first became terminal'),
  ('scope_and_sessions','PASS','one temporary creator session plus three independent friends-scope verifier sessions existed only inside the rolled-back subtransaction'),
  ('read_contract','PASS','current v664 read contract exposed each pending fixture and both final verified/rejected lifecycle states'),
  ('push_safety','PASS','no push-queue RPC was called; controlled rows were never committed or visible to the scheduled dispatcher'),
  ('ice_invariant','PASS','Ice unit value remained exactly 2.8 before, during and after proof'),
  ('rollback_counts','PASS','all public drink* tables and gejast_player_sessions_v746 returned to exact baseline row counts'),
  ('sequence_restore','PASS','all owned Drinks/session sequence states were restored exactly after controlled rollback'),
  ('controlled_residue','PASS','no OC_V771D_DRINKS session rows remain')
) as proof(check_name,result,detail)
order by check_name;
