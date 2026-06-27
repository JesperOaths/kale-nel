-- GEJAST v754: controlled Klaverjas online room cleanup.
-- Restores the public cleanup RPC expected by the live regression harness.
-- Use close_all=true only for controlled beta cleanup or an explicit admin reset.

begin;

create or replace function public.klaverjas_online_cleanup_rooms(
  site_scope_input text default 'friends',
  close_all boolean default false
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  use_scope text := case when lower(coalesce(site_scope_input, 'friends')) = 'family' then 'family' else 'friends' end;
  affected integer;
begin
  update public.klaverjas_online_games
     set status = 'closed',
         state = jsonb_set(
           jsonb_set(coalesce(state, '{}'::jsonb), '{phase}', '"closed"', true),
           '{closed_by}',
           '"cleanup"',
           true
         ),
         updated_at = now(),
         finished_at = coalesce(finished_at, now())
   where site_scope = use_scope
     and status not in ('finished', 'closed')
     and (
       close_all
       or (
         jsonb_array_length(coalesce(state -> 'players', '[]'::jsonb)) > 0
         and not exists (
           select 1
             from jsonb_array_elements(coalesce(state -> 'players', '[]'::jsonb)) p
            where not coalesce((p ->> 'is_bot')::boolean, false)
         )
         and updated_at < now() - interval '1 hour'
       )
     );

  get diagnostics affected = row_count;
  return affected;
end;
$fn$;

grant execute on function public.klaverjas_online_cleanup_rooms(text, boolean) to anon, authenticated;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';

commit;
