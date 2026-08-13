-- GEJAST v792b20 — cumulative match totals must equal old totals plus the appended round scores.
begin;
create or replace function public._klaverjas_online_cumulative_totals_guard_v792b20(stored_state jsonb, next_state jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  old_count integer := case when jsonb_typeof(stored_state -> 'rounds')='array' then jsonb_array_length(stored_state -> 'rounds') else 0 end;
  new_count integer := case when jsonb_typeof(next_state -> 'rounds')='array' then jsonb_array_length(next_state -> 'rounds') else 0 end;
  round_row jsonb;
  old0 integer := coalesce((stored_state #>> '{totals,0}')::integer,0);
  old1 integer := coalesce((stored_state #>> '{totals,1}')::integer,0);
  score0 integer;
  score1 integer;
begin
  if new_count = old_count then return; end if;
  if new_count <> old_count + 1 then raise exception 'klaverjas_online_cumulative_totals_invalid'; end if;
  round_row := next_state -> 'rounds' -> old_count;
  score0 := coalesce((round_row #>> '{result,scores,0}')::integer,0);
  score1 := coalesce((round_row #>> '{result,scores,1}')::integer,0);
  if coalesce((next_state #>> '{totals,0}')::integer,-1) <> old0 + score0
     or coalesce((next_state #>> '{totals,1}')::integer,-1) <> old1 + score1
     or coalesce((round_row #>> '{totals,0}')::integer,-1) <> old0 + score0
     or coalesce((round_row #>> '{totals,1}')::integer,-1) <> old1 + score1 then
    raise exception 'klaverjas_online_cumulative_totals_invalid';
  end if;
end;
$function$;
revoke execute on function public._klaverjas_online_cumulative_totals_guard_v792b20(jsonb,jsonb) from public, anon, authenticated;
notify pgrst, 'reload schema';
commit;