-- GEJAST v792b11 — mirror the current Amsterdam human-card legality rule server-side.
begin;
create or replace function public._klaverjas_online_card_legal_v792b11(
  hand jsonb,
  trick jsonb,
  player_seat integer,
  trump_suit text,
  chosen_card jsonb
)
returns boolean
language plpgsql
immutable
security definer
set search_path to 'public'
as $function$
declare
  lead_suit text;
  trump text := lower(coalesce(trump_suit,''));
  winner integer;
  winner_play jsonb;
  high_card jsonb;
  high_strength integer;
  has_follow boolean;
  has_trump boolean;
  has_over boolean;
begin
  if jsonb_typeof(hand) <> 'array' or jsonb_typeof(trick) <> 'array' then return false; end if;
  if not exists (select 1 from jsonb_array_elements(hand) c where c = chosen_card) then return false; end if;
  if jsonb_array_length(trick) = 0 then return true; end if;

  lead_suit := trick #>> '{0,card,suit}';
  has_follow := exists (select 1 from jsonb_array_elements(hand) c where c ->> 'suit' = lead_suit);
  if trump = '' or trump = 'sans' then
    return not has_follow or chosen_card ->> 'suit' = lead_suit;
  end if;

  winner := public._klaverjas_online_trick_winner_v792b6(trick, trump);
  select value into winner_play from jsonb_array_elements(trick)
   where nullif(value ->> 'player','')::integer = winner limit 1;
  high_card := winner_play -> 'card';

  if has_follow then
    if lead_suit <> trump then return chosen_card ->> 'suit' = lead_suit; end if;
    high_strength := public._klaverjas_online_card_strength_v792b10(high_card, trump, lead_suit);
    has_over := exists (
      select 1 from jsonb_array_elements(hand) c
       where c ->> 'suit' = trump
         and public._klaverjas_online_card_strength_v792b10(c, trump, lead_suit) > high_strength
    );
    return chosen_card ->> 'suit' = trump
       and (not has_over or public._klaverjas_online_card_strength_v792b10(chosen_card, trump, lead_suit) > high_strength);
  end if;

  has_trump := exists (select 1 from jsonb_array_elements(hand) c where c ->> 'suit' = trump);
  if not has_trump then return true; end if;
  if winner is not null and (winner % 2) = (player_seat % 2) then return true; end if;
  if not exists (select 1 from jsonb_array_elements(trick) p where p #>> '{card,suit}' = trump) then
    return chosen_card ->> 'suit' = trump;
  end if;

  high_strength := public._klaverjas_online_card_strength_v792b10(high_card, trump, lead_suit);
  has_over := exists (
    select 1 from jsonb_array_elements(hand) c
     where c ->> 'suit' = trump
       and public._klaverjas_online_card_strength_v792b10(c, trump, lead_suit) > high_strength
  );
  return chosen_card ->> 'suit' = trump
     and (not has_over or public._klaverjas_online_card_strength_v792b10(chosen_card, trump, lead_suit) > high_strength);
exception when others then
  return false;
end;
$function$;
revoke execute on function public._klaverjas_online_card_legal_v792b11(jsonb,jsonb,integer,text,jsonb) from public, anon, authenticated;
notify pgrst, 'reload schema';
commit;