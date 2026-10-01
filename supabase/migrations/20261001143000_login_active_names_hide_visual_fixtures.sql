-- Login selector hardening: only real, visible, PIN-capable player accounts may appear.
-- Applied to production on 2026-10-01 after exhaustive visual-audit fixtures polluted
-- the public selector during a period of Supabase resource pressure.

create or replace function public.get_login_active_names_v687(site_scope_input text default 'friends'::text)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  with scoped as (
    select distinct on (lower(btrim(p.display_name)))
      btrim(p.display_name)::text as display_name,
      p.id::bigint as player_id,
      case
        when lower(coalesce(nullif(btrim(p.site_scope),''),'friends')) = 'family' then 'family'
        else 'friends'
      end::text as site_scope
    from public.players p
    where nullif(btrim(p.display_name),'') is not null
      and coalesce(p.active,true) = true
      and coalesce(p.approved,true) = true
      and coalesce(p.is_dummy,false) = false
      and coalesce(p.hidden_from_public,false) = false
      and nullif(btrim(coalesce(p.pin_hash,'')),'') is not null
      and case
        when lower(coalesce(nullif(btrim(p.site_scope),''),'friends')) = 'family' then 'family'
        else 'friends'
      end = case
        when lower(coalesce(nullif(btrim(site_scope_input),''),'friends')) = 'family' then 'family'
        else 'friends'
      end
    order by lower(btrim(p.display_name)), p.updated_at desc nulls last, p.id desc
    limit 300
  ), rows as (
    select jsonb_build_object(
      'display_name', s.display_name,
      'name', s.display_name,
      'player_name', s.display_name,
      'player_id', s.player_id,
      'site_scope', s.site_scope,
      'active', true,
      'login_active', true,
      'has_pin', true,
      'total_matches', 0,
      'total_wins', 0,
      'best_rating', 1000
    ) as row
    from scoped s
  )
  select jsonb_build_object(
    'ok', true,
    'names', coalesce((select jsonb_agg(row->>'display_name' order by lower(row->>'display_name')) from rows), '[]'::jsonb),
    'players', coalesce((select jsonb_agg(row order by lower(row->>'display_name')) from rows), '[]'::jsonb)
  );
$function$;

grant execute on function public.get_login_active_names_v687(text) to anon, authenticated;
