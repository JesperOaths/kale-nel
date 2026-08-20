-- GEJAST v812g: close sensitive direct-read views missed by v812f table-only scan.
-- SQL-only follow-up, grounded against production on 2026-08-21.

begin;

do $v812g$
declare r record;
begin
  for r in
    select n.nspname, c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('v','m')
      and (
        c.relname like 'admin\_%' escape '\'
        or c.relname ~* '(session|activation|claim|email|invite|token)'
        or c.relname in (
          'allowed_usernames','available_names','hidden_site_names',
          'active_web_push_presence','web_push_delivery_queue','web_push_job_attempts',
          'native_push_jobs','match_change_log',
          'scope_quarantine_boerenbridge_matches','scope_quarantine_game_match_summaries'
        )
      )
  loop
    execute format('revoke select on table %I.%I from public, anon, authenticated', r.nspname, r.relname);
  end loop;
end
$v812g$;

commit;
