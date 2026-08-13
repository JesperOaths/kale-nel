-- GEJAST v792b2 — strengthen canonical deck validation.
-- SQL-only follow-up; frontend VERSION remains v792.

begin;

create or replace function public._klaverjas_online_state_has_canonical_deck(state_input jsonb)
returns boolean
language sql
immutable
security definer
set search_path to 'public'
as $function$
  with cards as (
    select card from jsonb_path_query(coalesce(state_input, '{}'::jsonb), '$.hands[*][*]') card
    union all
    select card from jsonb_path_query(coalesce(state_input, '{}'::jsonb), '$.trick[*].card') card
    union all
    select card from jsonb_path_query(coalesce(state_input, '{}'::jsonb), '$.pending_trick.cards[*].card') card
    union all
    select card from jsonb_path_query(coalesce(state_input, '{}'::jsonb), '$.taken[*].cards[*].card') card
  ), normalized as (
    select card ->> 'id' as id, card ->> 'suit' as suit, card ->> 'rank' as rank from cards
  )
  select count(*) = 32
     and count(distinct id) = 32
     and coalesce(bool_and(
       suit in ('clubs','spades','hearts','diamonds')
       and rank in ('A','10','K','Q','J','9','8','7')
       and id = suit || '-' || rank
     ), false)
    from normalized
$function$;

revoke execute on function public._klaverjas_online_state_has_canonical_deck(jsonb) from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;