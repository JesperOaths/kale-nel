-- v815a: service-role-only Printify API token resolver.
-- The actual token is stored in Supabase Vault under the fixed name
-- `kalenel_printify_api_token`; this function exposes it only to service_role.

create or replace function public.get_printify_api_token_v815a()
returns text
language sql
security definer
set search_path = pg_catalog, public, vault
as $$
  select nullif(btrim(ds.decrypted_secret), '')
  from vault.decrypted_secrets as ds
  where ds.name = 'kalenel_printify_api_token'
  order by ds.updated_at desc nulls last, ds.created_at desc
  limit 1;
$$;

revoke all on function public.get_printify_api_token_v815a() from public;
revoke all on function public.get_printify_api_token_v815a() from anon;
revoke all on function public.get_printify_api_token_v815a() from authenticated;
grant execute on function public.get_printify_api_token_v815a() to service_role;

comment on function public.get_printify_api_token_v815a() is
  'Returns the Kalenel Printify API token from Supabase Vault to service_role only.';
