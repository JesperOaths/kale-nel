-- GEJAST v792b9 — reject malformed/null bid point payloads deterministically.
-- SQL-only follow-up; frontend VERSION remains v792.

begin;

create or replace function public._klaverjas_online_bid_valid_v792b5(new_bid jsonb, old_bid jsonb)
returns boolean
language plpgsql
immutable
security definer
set search_path to 'public'
as $function$
declare
  mode text := lower(coalesce(new_bid ->> 'mode',''));
  suit text := lower(coalesce(new_bid ->> 'suit',''));
  kind text := lower(coalesce(new_bid ->> 'kind',''));
  points integer;
  old_mode text := lower(coalesce(old_bid ->> 'mode',''));
  old_kind text := lower(coalesce(old_bid ->> 'kind',''));
  old_points integer;
  new_rank numeric;
  old_rank numeric;
  all_points boolean;
  old_all_points boolean;
begin
  if jsonb_typeof(new_bid) <> 'object' then return false; end if;
  begin points := nullif(new_bid ->> 'points','')::integer; exception when others then return false; end;
  if points is null then return false; end if;

  all_points := kind in ('pit','mars','doormars') or (mode='sans' and points=132);
  if all_points then return true; end if;

  if mode='sans' then
    if points < 70 or points > 130 or points % 10 <> 0 then return false; end if;
    new_rank := points + 0.1;
  elsif mode='suit' then
    if suit not in ('clubs','spades','hearts','diamonds')
       or points < 80 or points > 160 or points % 10 <> 0 then return false; end if;
    new_rank := points;
  else
    return false;
  end if;

  if old_bid is null or old_bid = 'null'::jsonb then return true; end if;
  begin old_points := nullif(old_bid ->> 'points','')::integer; exception when others then return false; end;
  if old_points is null then return false; end if;
  old_all_points := old_kind in ('pit','mars','doormars') or (old_mode='sans' and old_points=132);
  if old_all_points then return false; end if;
  old_rank := old_points + case when old_mode='sans' then 0.1 else 0 end;
  if mode='sans' then return new_rank >= old_rank; end if;
  return new_rank > old_rank;
end;
$function$;

revoke execute on function public._klaverjas_online_bid_valid_v792b5(jsonb,jsonb) from public, anon, authenticated;
notify pgrst, 'reload schema';
commit;