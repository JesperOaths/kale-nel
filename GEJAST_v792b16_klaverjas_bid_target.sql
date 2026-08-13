-- GEJAST v792b16 — deterministic bid target matching the current runtime.
begin;
create or replace function public._klaverjas_online_bid_target_v792b16(bid jsonb)
returns integer
language plpgsql
immutable
security definer
set search_path to 'public'
as $function$
declare
  points integer := coalesce((bid ->> 'points')::integer,0);
  mode text := lower(coalesce(bid ->> 'mode',''));
  kind text := lower(coalesce(bid ->> 'kind',''));
begin
  if kind in ('pit','mars','doormars') or (mode='sans' and points=132) then return 162; end if;
  if mode='suit' then return greatest(82, points); end if;
  return points;
exception when others then
  return 0;
end;
$function$;
revoke execute on function public._klaverjas_online_bid_target_v792b16(jsonb) from public, anon, authenticated;
notify pgrst, 'reload schema';
commit;