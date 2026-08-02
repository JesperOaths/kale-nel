-- GEJAST v755h - Repair live Ice unit value drift
-- Scope: SQL-only, idempotent, single-row drink_event_types repair.
-- Expected production pre-state: exactly one active Ice row, primary key id=4,
-- with unit_value either the drifted 3.0 or already-correct 2.8.

begin;

do $$
declare
  v_active_ice_count integer;
  v_row public.drink_event_types%rowtype;
begin
  select count(*)
    into v_active_ice_count
    from public.drink_event_types
   where lower(coalesce(key, '')) = 'ice'
     and coalesce(is_active, true) is true;

  if v_active_ice_count <> 1 then
    raise exception 'GEJAST_v755h abort: expected exactly one active Ice row, found %', v_active_ice_count;
  end if;

  select *
    into v_row
    from public.drink_event_types
   where id = 4
     and lower(coalesce(key, '')) = 'ice'
     and coalesce(is_active, true) is true
   for update;

  if not found then
    raise exception 'GEJAST_v755h abort: expected active Ice row with primary key id=4';
  end if;

  if v_row.unit_value not in (3.0::numeric, 2.8::numeric) then
    raise exception 'GEJAST_v755h abort: Ice unit_value expected 3.0 or 2.8, found %', v_row.unit_value;
  end if;
end $$;

update public.drink_event_types
   set unit_value = 2.8::numeric
 where id = 4
   and lower(coalesce(key, '')) = 'ice'
   and coalesce(is_active, true) is true
   and unit_value <> 2.8::numeric
returning id, key, label, category, unit_value, sort_order, is_active, created_at;

select id, key, label, category, unit_value, sort_order, is_active, created_at
  from public.drink_event_types
 where id = 4
   and lower(coalesce(key, '')) = 'ice';

commit;
