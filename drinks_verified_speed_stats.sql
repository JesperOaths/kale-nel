begin;

create or replace function public.get_drinks_verified_speed_stats_v638(player_name_input text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  result jsonb := '{}'::jsonb;
begin
  if to_regclass('public.drink_speed_attempts') is null then
    return jsonb_build_object('players','[]'::jsonb,'rankings_by_type','[]'::jsonb,'recent_attempts','[]'::jsonb,'player_summary',jsonb_build_object(),'player_type_top5','[]'::jsonb,'extra_boxes','[]'::jsonb);
  end if;

  with allowed as (
    select key,label,sort_order from public.drink_speed_allowed_types_v638 where enabled
  ), attempts as (
    select
      coalesce(nullif(dsa.player_name,''), p.display_name, p.name, 'Onbekend') as player_name,
      lower(coalesce(dsa.speed_type_key, dst.key, '')) as speed_type_key,
      coalesce(dsa.speed_type_label, dst.label, a.label, dsa.speed_type_key, dst.key) as speed_type_label,
      dsa.duration_seconds::numeric as duration_seconds,
      coalesce(dsa.verified_at, dsa.created_at) as verified_at,
      dsa.created_at,
      dsa.status
    from public.drink_speed_attempts dsa
    left join public.drink_speed_types dst on dst.id = dsa.speed_type_id
    left join public.players p on p.id = dsa.player_id
    join allowed a on a.key = lower(coalesce(dsa.speed_type_key, dst.key, ''))
    where coalesce(lower(dsa.status),'verified') = 'verified'
      and dsa.duration_seconds is not null
      and dsa.duration_seconds > 0
  ), ranked as (
    select *, row_number() over(partition by speed_type_key order by duration_seconds asc, player_name asc) rn from attempts
  ), player_ranked as (
    select *, row_number() over(partition by player_name, speed_type_key order by duration_seconds asc, verified_at desc) prn from attempts
    where player_name_input is null or lower(player_name)=lower(player_name_input)
  )
  select jsonb_build_object(
    'players', coalesce((select jsonb_agg(distinct player_name order by player_name) from attempts), '[]'::jsonb),
    'rankings_by_type', coalesce((select jsonb_agg(jsonb_build_object('key',a.key,'label',a.label,'rows',coalesce((select jsonb_agg(to_jsonb(r) - 'rn' order by r.duration_seconds asc, r.player_name asc) from ranked r where r.speed_type_key=a.key and r.rn<=5),'[]'::jsonb)) order by a.sort_order) from allowed a), '[]'::jsonb),
    'recent_attempts', coalesce((select jsonb_agg(to_jsonb(x) order by x.verified_at desc) from (select * from attempts order by verified_at desc limit 20) x), '[]'::jsonb),
    'player_summary', coalesce((select jsonb_build_object('verified_attempt_count',count(*),'best_overall_seconds',min(duration_seconds)) from attempts where player_name_input is not null and lower(player_name)=lower(player_name_input)), jsonb_build_object()),
    'player_type_top5', coalesce((select jsonb_agg(jsonb_build_object('key',a.key,'label',a.label,'rows',coalesce((select jsonb_agg(to_jsonb(pr) - 'prn' order by pr.duration_seconds asc) from player_ranked pr where pr.speed_type_key=a.key and pr.prn<=5),'[]'::jsonb)) order by a.sort_order) from allowed a), '[]'::jsonb),
    'extra_boxes', jsonb_build_array(
      jsonb_build_object('label','Verified pogingen','value',(select count(*) from attempts),'meta','Alle geldige speedpogingen'),
      jsonb_build_object('label','Dranktypes','value',(select count(*) from allowed),'meta','Shot uitgesloten van speed')
    )
  ) into result;

  return result;
exception when undefined_column or undefined_table then
  return jsonb_build_object('error','schema_mismatch','message',SQLERRM);
end;
$$;

grant execute on function public.get_drinks_verified_speed_stats_v638(text) to anon, authenticated;

commit;
