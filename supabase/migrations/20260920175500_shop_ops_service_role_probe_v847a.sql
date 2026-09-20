create or replace function public.shop_ops_service_role_probe_v847()
returns boolean
language sql
security invoker
set search_path='public'
as $function$
  select true;
$function$;

revoke all on function public.shop_ops_service_role_probe_v847() from public, anon, authenticated;
grant execute on function public.shop_ops_service_role_probe_v847() to service_role;
