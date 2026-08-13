-- GEJAST v792b13 — allow the internal winner helper to evaluate partial tricks (1..4 cards).
begin;
create or replace function public._klaverjas_online_trick_winner_v792b6(cards jsonb, trump_suit text)
returns integer
language plpgsql
immutable
security definer
set search_path to 'public'
as $function$
declare
  play jsonb;
  suit text;
  rank text;
  lead_suit text;
  trump text := lower(coalesce(trump_suit,''));
  category integer;
  strength integer;
  best_category integer := -1;
  best_strength integer := -1;
  best_player integer := null;
begin
  if jsonb_typeof(cards) <> 'array' or jsonb_array_length(cards) < 1 or jsonb_array_length(cards) > 4 then return null; end if;
  lead_suit := cards #>> '{0,card,suit}';
  for play in select value from jsonb_array_elements(cards)
  loop
    suit := play #>> '{card,suit}';
    rank := play #>> '{card,rank}';
    if trump <> '' and trump <> 'sans' and suit = trump then category := 2;
    elsif suit = lead_suit then category := 1;
    else category := 0;
    end if;
    if category = 2 then
      strength := case rank when 'J' then 8 when '9' then 7 when 'A' then 6 when '10' then 5 when 'K' then 4 when 'Q' then 3 when '8' then 2 when '7' then 1 else 0 end;
    else
      strength := case rank when 'A' then 8 when '10' then 7 when 'K' then 6 when 'Q' then 5 when 'J' then 4 when '9' then 3 when '8' then 2 when '7' then 1 else 0 end;
    end if;
    if category > best_category or (category = best_category and strength > best_strength) then
      best_category := category;
      best_strength := strength;
      best_player := nullif(play ->> 'player','')::integer;
    end if;
  end loop;
  return best_player;
exception when others then
  return null;
end;
$function$;
revoke execute on function public._klaverjas_online_trick_winner_v792b6(jsonb,text) from public, anon, authenticated;
notify pgrst, 'reload schema';
commit;