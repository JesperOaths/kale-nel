-- Read-only inspection of the single remaining OC_V764 marker reported by the final invariant scan.
-- Safe to run in Supabase SQL Editor. Does not modify production data.

select
  b.id,
  b.client_match_id,
  b.created_by_player_id,
  b.match_status,
  b.match_format,
  b.updated_at,
  array(
    select e.key
    from jsonb_each(to_jsonb(b)) as e(key, value)
    where e.value::text ilike '%OC_V764%'
    order by e.key
  ) as marker_columns
from public.beerpong_matches b
where to_jsonb(b)::text ilike '%OC_V764%'
order by b.id;
