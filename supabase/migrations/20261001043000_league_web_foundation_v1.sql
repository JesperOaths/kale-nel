create extension if not exists pgcrypto;

create table if not exists public.league_profiles_v1 (
  id uuid primary key default gen_random_uuid(),
  owner_player_id bigint not null,
  owner_display_name text,
  site_scope text not null default 'friends' check (site_scope in ('friends','family')),
  profile_key text not null,
  display_name text not null,
  game_name text,
  tag_line text,
  puuid text,
  platform_region text not null default 'euw1',
  routing_region text not null default 'europe',
  notes text,
  last_resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_player_id, site_scope, profile_key)
);

create index if not exists league_profiles_owner_idx
  on public.league_profiles_v1(owner_player_id, site_scope, updated_at desc);

create table if not exists public.league_match_cache_v1 (
  profile_id uuid not null references public.league_profiles_v1(id) on delete cascade,
  match_id text not null,
  owner_player_id bigint not null,
  game_start_at timestamptz,
  map_id integer,
  queue_id integer,
  game_duration_seconds integer,
  match_json jsonb,
  timeline_json jsonb,
  match_fetched_at timestamptz,
  timeline_fetched_at timestamptz,
  fetch_error text,
  updated_at timestamptz not null default now(),
  primary key(profile_id, match_id)
);

create index if not exists league_match_cache_profile_time_idx
  on public.league_match_cache_v1(profile_id, game_start_at desc nulls last, updated_at desc);

create table if not exists public.league_fetch_runs_v1 (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.league_profiles_v1(id) on delete cascade,
  owner_player_id bigint not null,
  status text not null default 'queued' check (status in ('queued','running','done','error','cancelled')),
  match_ids jsonb not null default '[]'::jsonb,
  completed_count integer not null default 0,
  total_count integer not null default 0,
  cache_hits integer not null default 0,
  last_error text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists league_fetch_runs_profile_idx
  on public.league_fetch_runs_v1(profile_id, started_at desc);

create table if not exists public.league_analysis_runs_v1 (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.league_profiles_v1(id) on delete cascade,
  owner_player_id bigint not null,
  source_kind text not null default 'web_basic',
  analyzer_version text not null,
  sample_match_ids jsonb not null default '[]'::jsonb,
  report_data jsonb not null default '{}'::jsonb,
  data_quality jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists league_analysis_runs_profile_idx
  on public.league_analysis_runs_v1(profile_id, created_at desc);

alter table public.league_profiles_v1 enable row level security;
alter table public.league_match_cache_v1 enable row level security;
alter table public.league_fetch_runs_v1 enable row level security;
alter table public.league_analysis_runs_v1 enable row level security;

revoke all on public.league_profiles_v1 from anon, authenticated;
revoke all on public.league_match_cache_v1 from anon, authenticated;
revoke all on public.league_fetch_runs_v1 from anon, authenticated;
revoke all on public.league_analysis_runs_v1 from anon, authenticated;
