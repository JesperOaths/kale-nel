-- GEJAST v793a — repair the public Rad stats function found broken by the full visual audit.
--
-- Production get_rad_stats_scoped() nested count/sum/min/max aggregates directly inside
-- jsonb_agg(), which PostgreSQL rejects with 42803 "aggregate function calls cannot be
-- nested". Keep the public contract and presentation payload unchanged, but pre-aggregate
-- each leaderboard into a bounded subquery before JSON aggregation.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_rad_stats_scoped(
  site_scope_input text DEFAULT 'friends'::text,
  limit_count integer DEFAULT 30
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_scope text := public._scope_norm(site_scope_input);
  v_limit integer := greatest(5, least(coalesce(limit_count, 30), 120));
BEGIN
  RETURN jsonb_build_object(
    'overview_cards', jsonb_build_array(
      jsonb_build_object(
        'label','Spins',
        'value', coalesce((select count(*) from public.rad_spin_events where site_scope = v_scope),0),
        'sub','Opgeslagen Caute Rad-draaien'
      ),
      jsonb_build_object(
        'label','Unieke draaiers',
        'value', coalesce((select count(distinct lower(player_name)) from public.rad_spin_events where site_scope = v_scope),0),
        'sub','Spelers met minstens één gelogde spin'
      ),
      jsonb_build_object(
        'label','Uitdeel-spins',
        'value', coalesce((select count(*) from public.rad_spin_events where site_scope = v_scope and coalesce(lower(segment_type),'') = 'target'),0),
        'sub','Spins waarbij iemand werd aangewezen'
      ),
      jsonb_build_object(
        'label','Aangewezen spelers',
        'value', coalesce((select count(*) from public.rad_target_events where site_scope = v_scope),0),
        'sub','Opgeslagen target-nominaties'
      )
    ),
    'story_cards', jsonb_build_array(
      jsonb_build_object(
        'label','Heetste segment',
        'value', coalesce((
          select segment_label
          from public.rad_spin_events
          where site_scope = v_scope
          group by segment_label
          order by count(*) desc, max(spun_at) desc
          limit 1
        ),'—'),
        'sub', coalesce((
          select count(*)::text || ' keer geraakt'
          from public.rad_spin_events
          where site_scope = v_scope
            and segment_label = (
              select segment_label
              from public.rad_spin_events
              where site_scope = v_scope
              group by segment_label
              order by count(*) desc, max(spun_at) desc
              limit 1
            )
        ),'Nog geen data')
      ),
      jsonb_build_object(
        'label','Chaoskapitein',
        'value', coalesce((
          select player_name
          from public.rad_spin_events
          where site_scope = v_scope
          group by player_name
          order by count(*) desc, max(spun_at) desc
          limit 1
        ),'—'),
        'sub', coalesce((
          select count(*)::text || ' spins'
          from public.rad_spin_events
          where site_scope = v_scope
            and lower(player_name)=lower((
              select player_name
              from public.rad_spin_events
              where site_scope=v_scope
              group by player_name
              order by count(*) desc, max(spun_at) desc
              limit 1
            ))
        ),'Nog geen data')
      ),
      jsonb_build_object(
        'label','Meest geraakt',
        'value', coalesce((
          select target_player_name
          from public.rad_target_events
          where site_scope = v_scope
          group by target_player_name
          order by count(*) desc, max(created_at) desc
          limit 1
        ),'—'),
        'sub', coalesce((
          select count(*)::text || ' keer uitgekozen'
          from public.rad_target_events
          where site_scope = v_scope
            and lower(target_player_name)=lower((
              select target_player_name
              from public.rad_target_events
              where site_scope=v_scope
              group by target_player_name
              order by count(*) desc, max(created_at) desc
              limit 1
            ))
        ),'Nog geen data')
      )
    ),
    'leaderboard_sections', jsonb_build_array(
      jsonb_build_object(
        'title','Populairste segmenten',
        'subtitle','Welke straffen of twists het vaakst landen.',
        'rows', coalesce((
          select jsonb_agg(
            jsonb_build_object('label', q.segment_label, 'value', q.hit_count, 'sub', q.segment_type)
            order by q.hit_count desc, q.last_spin desc
          )
          from (
            select segment_label,
                   count(*)::bigint as hit_count,
                   coalesce(max(segment_type),'segment') as segment_type,
                   max(spun_at) as last_spin
            from public.rad_spin_events
            where site_scope = v_scope
            group by segment_label
            order by hit_count desc, last_spin desc
            limit 8
          ) q
        ), '[]'::jsonb)
      ),
      jsonb_build_object(
        'title','Fanatiekste draaiers',
        'subtitle','Wie het rad het vaakst heeft getest.',
        'rows', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'label', q.player_name,
              'value', q.spin_count,
              'sub', q.target_spins::text || ' target-spins'
            )
            order by q.spin_count desc, q.last_spin desc
          )
          from (
            select player_name,
                   count(*)::bigint as spin_count,
                   count(*) filter (where coalesce(lower(segment_type),'')='target')::bigint as target_spins,
                   max(spun_at) as last_spin
            from public.rad_spin_events
            where site_scope = v_scope
            group by player_name
            order by spin_count desc, last_spin desc
            limit 8
          ) q
        ), '[]'::jsonb)
      ),
      jsonb_build_object(
        'title','Vaakst aangewezen',
        'subtitle','De pechvogels van het rad.',
        'rows', coalesce((
          select jsonb_agg(
            jsonb_build_object('label', q.target_player_name, 'value', q.target_count, 'sub', q.segment_label)
            order by q.target_count desc, q.last_target desc
          )
          from (
            select target_player_name,
                   count(*)::bigint as target_count,
                   min(segment_label) as segment_label,
                   max(created_at) as last_target
            from public.rad_target_events
            where site_scope = v_scope
            group by target_player_name
            order by target_count desc, last_target desc
            limit 8
          ) q
        ), '[]'::jsonb)
      )
    ),
    'table_sections', jsonb_build_array(
      jsonb_build_object(
        'title','Recente spins',
        'subtitle','Laatste opgeslagen uitkomsten van het rad.',
        'columns', jsonb_build_array('Tijd','Speler','Segment','Type'),
        'rows', coalesce((
          select jsonb_agg(
            jsonb_build_array(
              to_char(q.spun_at at time zone 'Europe/Amsterdam', 'DD-MM HH24:MI'),
              q.player_name,
              q.segment_label,
              coalesce(q.segment_type,'—')
            )
            order by q.spun_at desc
          )
          from (
            select spun_at, player_name, segment_label, segment_type
            from public.rad_spin_events
            where site_scope = v_scope
            order by spun_at desc
            limit v_limit
          ) q
        ), '[]'::jsonb)
      )
    ),
    'recent_rows', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'title', q.segment_label,
          'sub', q.player_name,
          'value', coalesce(q.segment_type,'spin'),
          'meta', to_char(q.spun_at at time zone 'Europe/Amsterdam','DD-MM HH24:MI')
        )
        order by q.spun_at desc
      )
      from (
        select spun_at, player_name, segment_label, segment_type
        from public.rad_spin_events
        where site_scope = v_scope
        order by spun_at desc
        limit v_limit
      ) q
    ), '[]'::jsonb)
  );
END;
$function$;

DO $verify$
DECLARE
  v_payload jsonb;
BEGIN
  v_payload := public.get_rad_stats_scoped('friends', 40);
  IF jsonb_typeof(v_payload->'overview_cards') <> 'array'
     OR jsonb_typeof(v_payload->'story_cards') <> 'array'
     OR jsonb_typeof(v_payload->'leaderboard_sections') <> 'array'
     OR jsonb_typeof(v_payload->'table_sections') <> 'array'
     OR jsonb_typeof(v_payload->'recent_rows') <> 'array' THEN
    RAISE EXCEPTION 'v793a Rad stats payload shape verification failed';
  END IF;
END;
$verify$;

COMMIT;
