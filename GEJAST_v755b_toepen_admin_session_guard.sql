-- GEJAST v755b: Toepen vault admin-session guard repair.
-- SQL-only forward fix after v755 Toepen backend apply.
-- Reason: production admin_check_session(text) returns {"ok":false} for invalid tokens
-- instead of throwing/null, so the v755 helper must inspect the ok field explicitly.

begin;

create or replace function public._v755_admin_session_ok(admin_session_token text)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  state jsonb;
  token_column text;
  ok boolean := false;
begin
  if nullif(trim(admin_session_token),'') is null then return false; end if;

  if to_regprocedure('public.admin_check_session(text)') is not null then
    begin
      execute 'select to_jsonb(public.admin_check_session($1))' into state using admin_session_token;
      if coalesce((state->>'ok')::boolean, false) is true then
        return true;
      end if;
      return false;
    exception when others then
      return false;
    end;
  end if;

  if to_regclass('public.admin_sessions') is not null then
    select column_name into token_column
      from information_schema.columns
     where table_schema='public' and table_name='admin_sessions'
       and column_name in ('admin_session_token','session_token','token')
     order by case column_name when 'admin_session_token' then 1 when 'session_token' then 2 else 3 end
     limit 1;
    if token_column is not null then
      execute format('select exists(select 1 from public.admin_sessions where %I=$1)',token_column)
        into ok using admin_session_token;
      return coalesce(ok,false);
    end if;
  end if;
  return false;
end;
$fn$;

revoke all on function public._v755_admin_session_ok(text) from public;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';

commit;
