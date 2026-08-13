-- GEJAST v792b10 — internal card ordering helper for server-side legality checks.
begin;
create or replace function public._klaverjas_online_card_strength_v792b10(card jsonb, trump_suit text, lead_suit text)
returns integer
language plpgsql
immutable
security definer
set search_path to 'public'
as $function$
declare
  suit text := card ->> 'suit';
  rank text := card ->> 'rank';
  trump text := lower(coalesce(trump_suit,''));
  category integer;
  rank_strength integer;
begin
  if trump <> '' and trump <> 'sans' and suit = trump then category := 2;
  elsif suit = lead_suit then category := 1;
  else category := 0;
  end if;
  if category = 2 then
    rank_strength := case rank when 'J' then 8 when '9' then 7 when 'A' then 6 when '10' then 5 when 'K' then 4 when 'Q' then 3 when '8' then 2 when '7' then 1 else 0 end;
  else
    rank_strength := case rank when 'A' then 8 when '10' then 7 when 'K' then 6 when 'Q' then 5 when 'J' then 4 when '9' then 3 when '8' then 2 when '7' then 1 else 0 end;
  end if;
  return category * 100 + rank_strength;
end;
$function$;
revoke execute on function public._klaverjas_online_card_strength_v792b10(jsonb,text,text) from public, anon, authenticated;
notify pgrst, 'reload schema';
commit;