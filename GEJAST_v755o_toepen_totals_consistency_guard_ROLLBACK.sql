-- GEJAST v755o safe rollback / forward-fix note for Toepen totals consistency guard.
--
-- The controlled live matrix proved that the pre-v755o create_toepen_game path
-- accepted forged participant totals even when round results implied different
-- scores. Do not roll back to a function that accepts inconsistent totals.
--
-- If v755o causes a production issue, use a forward fix that preserves:
--   * valid player session resolution before writes
--   * saver must be one of the participants in the requested scope
--   * direct Toepen table writes remain closed to PUBLIC/anon/authenticated
--   * participant end_points must match the sum of persisted round penalties
--
-- This boundary-preserving rollback only reasserts the security boundary and
-- reloads PostgREST. It intentionally does not remove legitimate read grants.

begin;

revoke all on function public.create_toepen_game(text,jsonb,text) from public;
grant execute on function public.create_toepen_game(text,jsonb,text) to anon, authenticated;

revoke insert, update, delete on table public.toepen_games from public, anon, authenticated;
revoke insert, update, delete on table public.toepen_game_participants from public, anon, authenticated;
revoke insert, update, delete on table public.toepen_rounds from public, anon, authenticated;
revoke insert, update, delete on table public.toepen_round_results from public, anon, authenticated;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';

commit;
