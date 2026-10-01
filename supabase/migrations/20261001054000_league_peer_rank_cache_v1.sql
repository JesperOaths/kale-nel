alter table public.league_match_cache_v1
  add column if not exists peer_rank_json jsonb,
  add column if not exists peer_rank_fetched_at timestamptz;
