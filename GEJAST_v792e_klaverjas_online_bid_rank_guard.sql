-- GEJAST v792e — Online Klaverjas bid-rank parity guard
-- SQL-only. Frontend VERSION remains v792.
--
-- Client parity facts:
--   * suit 80 has a target/rank of 82 (`bidTarget()` uses max(82, points));
--   * sans ranks by its literal point value + 0.1;
--   * the only all-points bid exposed by the current UI is 132 sans pit.
--
-- The first deterministic helper draft used raw suit points in bid rank and accepted arbitrary
-- kind=pit/mars/doormars shapes. Tighten those two edges so the persistent human-game boundary
-- matches the actual current browser contract instead of accepting malformed synthetic bids.

begin;

create or replace function public._klaverjas_online_bid_rank(bid_input jsonb)
returns numeric
language plpgsql
immutable
set search_path to 'public'
as $function$
declare
  points integer := coalesce(nullif(bid_input ->> 'points','')::integer,0);
  mode_text text := bid_input ->> 'mode';
begin
  if bid_input is null or bid_input='null'::jsonb or bid_input ->> 'action'='pass' then return -1; end if;
  if mode_text='sans' and points=132 and bid_input ->> 'kind'='pit' then return 10000; end if;
  if mode_text='suit' then return greatest(82,points); end if;
  if mode_text='sans' then return points + 0.1; end if;
  return -1;
end;
$function$;

create or replace function public._klaverjas_online_bid_valid(bid_input jsonb, current_bid jsonb, player_seat integer)
returns boolean
language plpgsql
immutable
set search_path to 'public'
as $function$
declare
  points integer := coalesce(nullif(bid_input ->> 'points','')::integer,0);
  mode_text text := bid_input ->> 'mode';
  suit_text text := bid_input ->> 'suit';
  kind_text text := bid_input ->> 'kind';
begin
  if bid_input is null or bid_input='null'::jsonb or bid_input ->> 'action'<>'bid' then return false; end if;
  if nullif(bid_input ->> 'player','')::integer<>player_seat then return false; end if;
  if coalesce(nullif(bid_input ->> 'team','')::integer,0)<>(case when player_seat in (0,2) then 1 else 2 end) then return false; end if;

  -- Current UI's only all-points contract. Reject malformed synthetic kind/mode/point mixtures.
  if kind_text is not null then
    return kind_text='pit' and mode_text='sans' and points=132
       and public._klaverjas_online_bid_rank(bid_input)>public._klaverjas_online_bid_rank(current_bid);
  end if;

  if mode_text='sans' then
    if suit_text is not null or points<70 or points>130 or points%10<>0 then return false; end if;
    return public._klaverjas_online_bid_rank(bid_input)>=public._klaverjas_online_bid_rank(current_bid);
  end if;

  if mode_text<>'suit' or suit_text not in ('clubs','spades','hearts','diamonds')
     or points<80 or points>160 or points%10<>0 then return false; end if;
  return public._klaverjas_online_bid_rank(bid_input)>public._klaverjas_online_bid_rank(current_bid);
end;
$function$;

revoke execute on function public._klaverjas_online_bid_rank(jsonb) from public, anon, authenticated;
revoke execute on function public._klaverjas_online_bid_valid(jsonb,jsonb,integer) from public, anon, authenticated;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';

commit;
