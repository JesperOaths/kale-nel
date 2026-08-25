-- GEJAST v813h: repair the Paardenrace ladder scratch/result contract.
-- Production-applied 2026-08-25 after the authenticated visual campaign exposed
-- homepage bundle 500s caused by a missing history scratch relation.
-- Scratch relations are server implementation details and must never be browser-readable.

begin;

create table if not exists public._scratch_paardenrace_history_work (
  run_id text not null,
  event_at timestamptz not null,
  player_name text not null,
  room_code text,
  delta numeric not null default 0,
  rating_after numeric not null default 1000,
  title text
);

create index if not exists _scratch_paardenrace_history_work_run_id_idx
  on public._scratch_paardenrace_history_work(run_id);

revoke all privileges on table public._scratch_paardenrace_ladder_work from public, anon, authenticated;
revoke all privileges on table public._scratch_paardenrace_match_participants from public, anon, authenticated;
revoke all privileges on table public._scratch_paardenrace_history_work from public, anon, authenticated;

grant all privileges on table public._scratch_paardenrace_ladder_work to service_role;
grant all privileges on table public._scratch_paardenrace_match_participants to service_role;
grant all privileges on table public._scratch_paardenrace_history_work to service_role;

-- Preserve the already-shipped ladder calculation verbatim, but make the lifecycle
-- fail closed: assemble the complete response while run-scoped scratch rows still
-- exist, then erase all scratch rows before returning. Anchors intentionally fail
-- the migration if the deployed function drifts instead of silently patching the
-- wrong body.
do $$
declare
  v_oid oid;
  v_def text;
  v_original text;
  v_before text := E'  delete from public._scratch_paardenrace_match_participants where run_id = v_run_id;\r\n  delete from public._scratch_paardenrace_history_work where run_id = v_run_id;\r\n  delete from public._scratch_paardenrace_ladder_work where run_id = v_run_id;\r\n\r\n  return jsonb_build_object(';
  v_after text := E'  v_result := jsonb_build_object(';
  v_tail_before text := E'  );\r\n\r\nexception when others then';
  v_tail_after text := E'  );\r\n\r\n  delete from public._scratch_paardenrace_match_participants where run_id = v_run_id;\r\n  delete from public._scratch_paardenrace_history_work where run_id = v_run_id;\r\n  delete from public._scratch_paardenrace_ladder_work where run_id = v_run_id;\r\n\r\n  return v_result;\r\n\r\nexception when others then';
begin
  select p.oid
    into v_oid
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'get_paardenrace_ladder_public_scoped'
    and pg_get_function_identity_arguments(p.oid) = 'site_scope_input text, limit_count integer';

  if v_oid is null then
    raise exception 'get_paardenrace_ladder_public_scoped(text,integer) not found';
  end if;

  v_def := pg_get_functiondef(v_oid);
  v_original := v_def;

  if position(E'  v_history jsonb;\r\n' in v_def) = 0 then
    raise exception 'expected Paardenrace ladder declaration anchor not found';
  end if;
  v_def := replace(v_def, E'  v_history jsonb;\r\n', E'  v_history jsonb;\r\n  v_result jsonb;\r\n');

  if position(v_before in v_def) = 0 then
    raise exception 'expected pre-return cleanup anchor not found';
  end if;
  v_def := replace(v_def, v_before, v_after);

  if position(v_tail_before in v_def) = 0 then
    raise exception 'expected return tail anchor not found';
  end if;
  v_def := replace(v_def, v_tail_before, v_tail_after);

  if v_def = v_original then
    raise exception 'Paardenrace ladder function was not modified';
  end if;

  execute v_def;
end
$$;

notify pgrst, 'reload schema';

commit;
