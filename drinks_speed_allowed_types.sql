begin;

create table if not exists public.drink_speed_allowed_types_v638 (
  key text primary key,
  label text not null,
  unit_value numeric not null default 1,
  sort_order integer not null default 100,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.drink_speed_allowed_types_v638(key,label,unit_value,sort_order,enabled) values
  ('bier','1 Bak',1,10,true),
  ('2bakken','2 Bakken',2,20,true),
  ('ice','Ice',2.8,30,true),
  ('wijnfles','Fles Wijn',9,40,true),
  ('liter_bier','Liter Bier',3,50,true)
on conflict (key) do update set label=excluded.label, unit_value=excluded.unit_value, sort_order=excluded.sort_order, enabled=excluded.enabled, updated_at=now();

do $$
begin
  if to_regclass('public.drink_speed_types') is not null then
    insert into public.drink_speed_types(key,label)
    select key,label from public.drink_speed_allowed_types_v638
    on conflict (key) do update set label=excluded.label;
    if exists(select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_types' and column_name='enabled') then
      update public.drink_speed_types set enabled = case when lower(key) = 'shot' then false else true end where lower(key) in ('bier','2bakken','ice','wijnfles','liter_bier','shot');
    end if;
  end if;
end $$;

create or replace function public.get_drinks_speed_allowed_types_v638()
returns jsonb
language sql
stable
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(jsonb_build_object('key',key,'label',label,'unit_value',unit_value,'sort_order',sort_order) order by sort_order,key), '[]'::jsonb)
  from public.drink_speed_allowed_types_v638
  where enabled is true;
$$;

grant select on public.drink_speed_allowed_types_v638 to anon, authenticated;
grant execute on function public.get_drinks_speed_allowed_types_v638() to anon, authenticated;

commit;
