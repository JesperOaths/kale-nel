alter table public.league_profiles_v1
  add column if not exists riot_account jsonb,
  add column if not exists rank_snapshot jsonb,
  add column if not exists ranked_fetched_at timestamptz;
