-- v815: allow the service-role Edge Function to resolve a Printify token from Supabase Vault
-- without exposing the credential to browser roles or source control.

create or replace function public.get_printify_api_token_v815a()
returns text
language sql
security definer
set search_path to 'pg_catalog', 'public', 'vault'
as $$
  select nullif(btrim(ds.decrypted_secret), '')
  from vault.decrypted_secrets as ds
  where ds.name = 'kalenel_printify_api_token'
  order by ds.updated_at desc nulls last, ds.created_at desc
  limit 1;
$$;

revoke all on function public.get_printify_api_token_v815a() from public, anon, authenticated;
grant execute on function public.get_printify_api_token_v815a() to service_role;
