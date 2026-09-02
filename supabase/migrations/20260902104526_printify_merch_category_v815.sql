-- v815: add the Merch shop category and make Despinoza-title routing a database invariant.

alter table public.shop_printify_products
  drop constraint if exists shop_printify_products_category_check;

alter table public.shop_printify_products
  add constraint shop_printify_products_category_check
  check (category in ('classic', 'oversized-boxy', 'merch'));

create or replace function public.shop_printify_products_category_guard_v815()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if position('despinoza' in lower(coalesce(new.title, ''))) > 0 then
    new.category := 'merch';
  elsif new.category not in ('classic', 'oversized-boxy', 'merch') then
    new.category := 'classic';
  end if;
  return new;
end;
$$;

revoke all on function public.shop_printify_products_category_guard_v815() from public, anon, authenticated;
grant execute on function public.shop_printify_products_category_guard_v815() to service_role;

drop trigger if exists shop_printify_products_category_guard_v815 on public.shop_printify_products;
create trigger shop_printify_products_category_guard_v815
before insert or update of title, category on public.shop_printify_products
for each row
execute function public.shop_printify_products_category_guard_v815();

update public.shop_printify_products
set category = 'merch'
where position('despinoza' in lower(coalesce(title, ''))) > 0
  and category <> 'merch';
