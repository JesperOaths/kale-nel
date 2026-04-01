begin;

-- Fix unit values used across drinks calculations.
update public.drink_event_types
   set unit_value = case lower(coalesce(key, ''))
     when 'bier' then 1
     when '2bakken' then 2
     when 'shot' then 1
     when 'wijnfles' then 9
     when 'ice' then 3
     when 'liter_bier' then 3
     else unit_value
   end
 where lower(coalesce(key, '')) in ('bier','2bakken','shot','wijnfles','ice','liter_bier');

-- Server-side safety net for combined speed attempts that omit client_attempt_id.
do $$
begin
  begin
    execute $$alter table public.drink_speed_attempts alter column client_attempt_id set default coalesce(gen_random_uuid()::text, md5(random()::text || clock_timestamp()::text))$$;
  exception when undefined_column then
    raise notice 'drink_speed_attempts.client_attempt_id not found; skipping default patch';
  when undefined_table then
    raise notice 'drink_speed_attempts table not found; skipping default patch';
  end;
end $$;

commit;
