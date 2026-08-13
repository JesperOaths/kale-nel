-- GEJAST v792b4 — append-only round/trick history guard.
-- SQL-only follow-up; frontend VERSION remains v792.

begin;

create or replace function public._klaverjas_online_history_guard_v792b4(
  stored_state jsonb,
  next_state jsonb
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  old_phase text := coalesce(nullif(stored_state ->> 'phase',''), 'lobby');
  old_nonce text := coalesce(stored_state ->> 'deal_nonce','');
  new_nonce text := coalesce(next_state ->> 'deal_nonce','');
  old_rounds integer := case when jsonb_typeof(stored_state -> 'rounds')='array' then jsonb_array_length(stored_state -> 'rounds') else 0 end;
  new_rounds integer := case when jsonb_typeof(next_state -> 'rounds')='array' then jsonb_array_length(next_state -> 'rounds') else 0 end;
  old_taken integer := case when jsonb_typeof(stored_state -> 'taken')='array' then jsonb_array_length(stored_state -> 'taken') else 0 end;
  new_taken integer := case when jsonb_typeof(next_state -> 'taken')='array' then jsonb_array_length(next_state -> 'taken') else 0 end;
  idx integer;
begin
  if new_rounds < old_rounds or new_rounds > old_rounds + 1 then
    raise exception 'klaverjas_online_round_history_rewrite_rejected';
  end if;
  if old_rounds > 0 then
    for idx in 0..old_rounds - 1 loop
      if (next_state -> 'rounds' -> idx) is distinct from (stored_state -> 'rounds' -> idx) then
        raise exception 'klaverjas_online_round_history_rewrite_rejected';
      end if;
    end loop;
  end if;

  -- A new physical deal legitimately resets taken/trick state, but never completed rounds/totals.
  if new_nonce is distinct from old_nonce then
    if new_rounds <> old_rounds
       or coalesce(next_state -> 'totals','[0,0]'::jsonb) is distinct from coalesce(stored_state -> 'totals','[0,0]'::jsonb) then
      raise exception 'klaverjas_online_redeal_history_rewrite_rejected';
    end if;
    return;
  end if;

  if new_rounds = old_rounds then
    if coalesce(next_state -> 'totals','[0,0]'::jsonb) is distinct from coalesce(stored_state -> 'totals','[0,0]'::jsonb) then
      raise exception 'klaverjas_online_totals_without_round_rejected';
    end if;
  else
    if old_phase <> 'playing'
       or stored_state -> 'pending_trick' is null
       or old_taken <> 7
       or new_taken <> 8 then
      raise exception 'klaverjas_online_round_advance_rejected';
    end if;
    if coalesce(next_state -> 'rounds' -> (new_rounds - 1) -> 'totals','null'::jsonb)
       is distinct from coalesce(next_state -> 'totals','null'::jsonb) then
      raise exception 'klaverjas_online_round_totals_mismatch';
    end if;
  end if;

  if old_phase <> 'playing' then
    if coalesce(next_state -> 'taken','[]'::jsonb) is distinct from coalesce(stored_state -> 'taken','[]'::jsonb) then
      raise exception 'klaverjas_online_taken_history_rewrite_rejected';
    end if;
    return;
  end if;

  if new_taken < old_taken or new_taken > old_taken + 1 then
    raise exception 'klaverjas_online_taken_history_rewrite_rejected';
  end if;
  if old_taken > 0 then
    for idx in 0..old_taken - 1 loop
      if (next_state -> 'taken' -> idx) is distinct from (stored_state -> 'taken' -> idx) then
        raise exception 'klaverjas_online_taken_history_rewrite_rejected';
      end if;
    end loop;
  end if;

  if stored_state -> 'pending_trick' is null then
    if new_taken <> old_taken then raise exception 'klaverjas_online_taken_history_rewrite_rejected'; end if;
  elsif new_taken = old_taken + 1 then
    if coalesce(next_state -> 'taken' -> old_taken -> 'winner','null'::jsonb)
         is distinct from coalesce(stored_state #> '{pending_trick,winner}','null'::jsonb)
       or coalesce(next_state -> 'taken' -> old_taken -> 'cards','[]'::jsonb)
         is distinct from coalesce(stored_state #> '{pending_trick,cards}','[]'::jsonb)
       or coalesce(next_state -> 'taken' -> old_taken -> 'roem','null'::jsonb)
         is distinct from coalesce(stored_state #> '{pending_trick,roem}','null'::jsonb) then
      raise exception 'klaverjas_online_taken_history_rewrite_rejected';
    end if;
  end if;
end;
$function$;

revoke execute on function public._klaverjas_online_history_guard_v792b4(jsonb,jsonb) from public, anon, authenticated;
notify pgrst, 'reload schema';
commit;