-- GEJAST v792g — Online Klaverjas roem wrapper fix
-- SQL-only continuation of v792b-v792f. Frontend VERSION intentionally remains v792.
--
-- v792c correctly passes pending_trick.cards as [{player,card}, ...], but its roem helper
-- read rank/suit directly from each wrapper object. That made legitimate trick roem evaluate
-- to zero. Replace only that helper and preserve the existing v792c scoring semantics.

begin;

create or replace function public._klaverjas_online_roem_points(cards_input jsonb, trump_suit text)
returns integer
language plpgsql
immutable
set search_path to 'public'
as $function$
declare
  total_points integer := 0;
  normalized_cards jsonb := '[]'::jsonb;
  play_item jsonb;
  card_item jsonb;
  same_rank text;
  suit_text text;
  positions integer[];
  i integer;
  has_sequence boolean;
begin
  if jsonb_typeof(cards_input) <> 'array' or jsonb_array_length(cards_input) <> 4 then return 0; end if;

  -- pending_trick.cards/trick entries are play wrappers: {player, card}.
  -- Normalize once, then keep the original v792c roem calculation unchanged.
  for play_item in select * from jsonb_array_elements(cards_input)
  loop
    card_item := play_item -> 'card';
    if jsonb_typeof(card_item) <> 'object'
       or nullif(card_item ->> 'rank','') is null
       or nullif(card_item ->> 'suit','') is null then
      return 0;
    end if;
    normalized_cards := normalized_cards || jsonb_build_array(card_item);
  end loop;

  select min(card ->> 'rank') into same_rank
    from jsonb_array_elements(normalized_cards) play(card)
   having count(distinct card ->> 'rank') = 1 and count(*) = 4;
  if same_rank is not null then
    total_points := total_points + case when same_rank = 'J' then 200 else 100 end;
  end if;

  foreach suit_text in array array['clubs','spades','hearts','diamonds']::text[]
  loop
    select array_agg(pos order by pos) into positions
      from (
        select case card ->> 'rank'
          when 'A' then 1 when 'K' then 2 when 'Q' then 3 when 'J' then 4
          when '10' then 5 when '9' then 6 when '8' then 7 when '7' then 8 end as pos
          from jsonb_array_elements(normalized_cards) play(card)
         where card ->> 'suit' = suit_text
      ) ranked
     where pos is not null;

    has_sequence := false;
    if coalesce(array_length(positions,1),0) >= 3 then
      for i in 1..array_length(positions,1)-2 loop
        if positions[i+1] = positions[i] + 1 and positions[i+2] = positions[i] + 2 then
          if i + 3 <= array_length(positions,1) and positions[i+3] = positions[i] + 3 then
            total_points := total_points + 50;
          else
            total_points := total_points + 20;
          end if;
          has_sequence := true;
          exit;
        end if;
      end loop;
    end if;

    if suit_text = trump_suit
       and exists(select 1 from jsonb_array_elements(normalized_cards) play(card) where card ->> 'suit'=suit_text and card ->> 'rank'='K')
       and exists(select 1 from jsonb_array_elements(normalized_cards) play(card) where card ->> 'suit'=suit_text and card ->> 'rank'='Q') then
      total_points := total_points + 20;
    end if;
  end loop;

  return total_points;
end;
$function$;

revoke execute on function public._klaverjas_online_roem_points(jsonb,text) from public, anon, authenticated;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';

commit;
