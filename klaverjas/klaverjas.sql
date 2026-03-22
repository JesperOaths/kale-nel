create table games (
  id uuid primary key default uuid_generate_v4(),
  created_at timestamp default now(),
  finished boolean,
  score_wij int,
  score_zij int
);
