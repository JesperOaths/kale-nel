-- v827: allow the protected shop admin connection page to store the production API token
-- in Supabase Vault without exposing it to browser roles or source control.

create or replace function public.set_printify_api_token_v827(
  admin_session_token text,
  api_token text
)
returns boolean
language plpgsql
security definer
set search_path to 'pg_catalog', 'public', 'vault'
as $$
declare
  v_ok boolean := false;
  v_existing_id uuid;
  v_token text := btrim(coalesce(api_token, ''));
begin
  select r.ok
    into v_ok
  from public._require_valid_admin_session(admin_session_token) as r
  limit 1;

  if not coalesce(v_ok, false) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  if length(v_token) < 20 or length(v_token) > 1000 then
    raise exception 'invalid_api_token' using errcode = '22023';
  end if;

  select s.id
    into v_existing_id
  from vault.secrets as s
  where s.name = 'kalenel_printify_api_token'
  order by s.updated_at desc nulls last, s.created_at desc
  limit 1;

  if v_existing_id is null then
    perform vault.create_secret(
      v_token,
      'kalenel_printify_api_token',
      'Kalenel shop production API token'
    );
  else
    perform vault.update_secret(
      v_existing_id,
      v_token,
      'kalenel_printify_api_token',
      'Kalenel shop production API token'
    );
  end if;

  return true;
end;
$$;

revoke all on function public.set_printify_api_token_v827(text, text) from public, anon, authenticated;
grant execute on function public.set_printify_api_token_v827(text, text) to service_role;
