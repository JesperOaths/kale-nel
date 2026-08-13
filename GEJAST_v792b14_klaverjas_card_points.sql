-- GEJAST v792b14 — deterministic card points matching gejast-klaverjas-online.js.
begin;
create or replace function public._klaverjas_online_card_points_v792b14(card jsonb, trump_suit text)
returns integer
language plpgsql
immutable
security definer
set search_path to 'public'
as $function$
declare
  rank text := card ->> 'rank';
  is_trump boolean := lower(coalesce(trump_suit,'')) not in ('','sans')
    and card ->> 'suit' = lower(trump_suit);
begin
  if is_trump then
    return case rank when 'J' then 20 when '9' then 14 when 'A' then 11 when '10' then 10 when 'K' then 4 when 'Q' then 3 else 0 end;
  end if;
  return case rank when 'A' then 11 when '10' then 10 when 'K' then 4 when 'Q' then 3 when 'J' then 2 else 0 end;
end;
$function$;
revoke execute on function public._klaverjas_online_card_points_v792b14(jsonb,text) from public, anon, authenticated;
notify pgrst, 'reload schema';
commit;