create table blocks (
  blocker_id uuid not null references profiles(id) on delete cascade,
  blocked_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);
create index on blocks (blocked_id);
alter table blocks enable row level security;

create table reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references profiles(id) on delete cascade,
  target_type text not null check (target_type in ('user', 'post')),
  target_id uuid not null,
  reason text not null check (reason in ('spam', 'inappropriate', 'harassment', 'other')),
  note text,
  created_at timestamptz not null default now()
);
create index on reports (target_type, target_id);
alter table reports enable row level security;
