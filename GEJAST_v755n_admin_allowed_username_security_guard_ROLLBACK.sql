-- GEJAST v755n safe rollback / boundary-preserving fallback.
--
-- This rollback intentionally DOES NOT restore the previous vulnerable behavior.
-- The controlled matrix proved that the old admin_remove_allowed_username path could
-- accept invalid admin tokens and that direct web-role DML on allowed_usernames was
-- exposed. A proven security boundary must not be rolled back.
--
-- If v755n causes a production issue after apply, use a forward fix that preserves:
--   * admin_check_session(...).ok = true before allowed-username mutations
--   * no INSERT/UPDATE/DELETE on public.allowed_usernames for PUBLIC/anon/authenticated
--   * no PUBLIC execute on the protected admin mutation RPCs
--
-- This file is safe to run as an emergency boundary-preserving rollback: it only
-- reasserts the hardened ACLs and PostgREST reloads. It does not modify function bodies.

begin;

revoke all on function public.admin_remove_allowed_username(text, bigint) from public;
revoke all on function public.admin_permanently_delete_allowed_username(text, bigint) from public;

grant execute on function public.admin_remove_allowed_username(text, bigint) to anon, authenticated;
grant execute on function public.admin_permanently_delete_allowed_username(text, bigint) to anon, authenticated;

revoke insert, update, delete on table public.allowed_usernames from public, anon, authenticated;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';

commit;
