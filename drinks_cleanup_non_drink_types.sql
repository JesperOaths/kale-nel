begin;

create or replace function public.admin_audit_drinks_speed_noncanonical_v638(admin_session_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  admin_row record;
  rows_out jsonb := '[]'::jsonb;
begin
  select * into admin_row from public._require_valid_admin_session(admin_session_token);
  if coalesce(admin_row.ok,false) is not true then raise exception 'Ongeldige admin-sessie'; end if;
  if to_regclass('public.drink_speed_attempts') is null then return jsonb_build_object('table_exists',false,'rows','[]'::jsonb); end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by attempts desc), '[]'::jsonb) into rows_out
  from (
    select lower(coalesce(dsa.speed_type_key,dst.key,'')) as speed_type_key, coalesce(dsa.speed_type_label,dst.label,'') as label, count(*) as attempts
    from public.drink_speed_attempts dsa
    left join public.drink_speed_types dst on dst.id = dsa.speed_type_id
    where lower(coalesce(dsa.speed_type_key,dst.key,'')) not in (select key from public.drink_speed_allowed_types_v638 where enabled)
    group by 1,2
  ) x;
  return jsonb_build_object('table_exists',true,'rows',rows_out);
exception when undefined_column or undefined_table then
  return jsonb_build_object('table_exists',true,'error','schema_mismatch','message',SQLERRM);
end;
$$;

grant execute on function public.admin_audit_drinks_speed_noncanonical_v638(text) to anon, authenticated;

do $$
begin
  if to_regclass('public.drink_speed_types') is not null
     and exists(select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_types' and column_name='enabled') then
    update public.drink_speed_types
       set enabled = false
     where lower(key) not in (select key from public.drink_speed_allowed_types_v638 where enabled)
       and lower(key) in ('shot','shots','sterk','overig','other');
  end if;
end $$;

commit;
