create table if not exists public.shop_ops_scheduler_tokens_v847 (
  token_hash text primary key,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz null
);
alter table public.shop_ops_scheduler_tokens_v847 enable row level security;
revoke all on table public.shop_ops_scheduler_tokens_v847 from public, anon, authenticated;
grant select,insert,update,delete on table public.shop_ops_scheduler_tokens_v847 to service_role;

create or replace function public.shop_ops_mint_scheduler_token_v847()
returns text
language plpgsql
security definer
set search_path='public','extensions'
as $function$
declare
  v_token text;
  v_hash text;
begin
  delete from public.shop_ops_scheduler_tokens_v847
  where expires_at < now() - interval '1 day'
     or consumed_at < now() - interval '1 day';

  v_token := encode(extensions.gen_random_bytes(32),'hex');
  v_hash := encode(extensions.digest(v_token,'sha256'),'hex');

  insert into public.shop_ops_scheduler_tokens_v847(token_hash,expires_at)
  values(v_hash,now()+interval '5 minutes');

  return v_token;
end;
$function$;

revoke all on function public.shop_ops_mint_scheduler_token_v847() from public, anon, authenticated;
grant execute on function public.shop_ops_mint_scheduler_token_v847() to service_role;
