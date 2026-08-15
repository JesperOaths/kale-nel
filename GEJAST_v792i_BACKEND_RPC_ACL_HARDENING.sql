-- GEJAST v792i - backend private-helper ACL hardening
-- SQL-only repository repair. Frontend VERSION remains v792.
-- This file intentionally contains privilege DDL only: no gameplay DML and no function-body replacement.
-- Production application requires explicit authorization and is NOT performed by repository CI.

begin;

-- Internal underscore-prefixed SECURITY DEFINER helpers are implementation details.
-- Shipped clients use public wrapper RPCs; anon/authenticated callers must not execute helpers directly.
do $gejast_acl$
declare
  fn record;
begin
  for fn in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and (
        p.proname like '\_pikken\_%' escape '\'
        or p.proname like '\_paardenrace\_%' escape '\'
      )
    order by p.oid::regprocedure::text
  loop
    execute format('revoke execute on function %s from public', fn.signature);
    execute format('revoke execute on function %s from anon', fn.signature);
    execute format('revoke execute on function %s from authenticated', fn.signature);
  end loop;
end
$gejast_acl$;

-- Fail closed if PUBLIC inheritance or an explicit role grant still leaves either browser role executable.
do $gejast_verify$
declare
  exposed_count integer;
begin
  select count(*)
    into exposed_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosecdef
    and (
      p.proname like '\_pikken\_%' escape '\'
      or p.proname like '\_paardenrace\_%' escape '\'
    )
    and (
      has_function_privilege('anon', p.oid, 'execute')
      or has_function_privilege('authenticated', p.oid, 'execute')
    );

  if exposed_count <> 0 then
    raise exception 'GEJAST v792i ACL hardening failed: % private SECURITY DEFINER helper(s) remain executable by anon/authenticated', exposed_count;
  end if;
end
$gejast_verify$;

commit;
