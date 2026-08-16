-- GEJAST v801a safe rollback / forward-fix note for Toepen idempotency ownership.
--
-- Exact-v801 live proof demonstrated that the pre-v801a idempotency branch returned
-- an existing Toepen game_id to an unrelated valid same-scope player who supplied
-- the creator's client_match_id and a structurally valid payload.
-- Do not roll back to a function that reveals foreign existing match IDs.
--
-- Any forward repair must preserve:
--   * valid player session + site-scope validation before save/replay handling
--   * existing client_match_id rows are idempotent only for their owning player and scope
--   * ownerless historical rows fail closed rather than becoming replayable
--   * saver-participant validation and all v755o payload/totals consistency checks
--   * direct Toepen table writes remain closed to PUBLIC/anon/authenticated

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
