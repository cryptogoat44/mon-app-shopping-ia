-- Lot F (« le fil vivant ») — commentaires légers, section 5.A du programme.
-- À plat, ordre chronologique, 1 000 caractères au plus, jamais vides.
-- `hidden_at` : masquage par modération (lot 5.B). Suppression en cascade
-- avec la publication et avec le compte de l'auteur.
create table if not exists comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references posts(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  body text not null check (char_length(body) <= 1000 and char_length(btrim(body)) > 0),
  hidden_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists comments_post_id_created_at_idx on comments (post_id, created_at);
create index if not exists comments_user_id_idx on comments (user_id);
alter table comments enable row level security;

-- Notification in-app « nouveau commentaire » (à l'auteur de la publication).
alter table notifications drop constraint if exists notifications_type_check;
alter table notifications add constraint notifications_type_check check (type in ('follow', 'like', 'comment'));
alter table notifications add column if not exists comment_id uuid references comments(id) on delete cascade;

-- Signalement d'un commentaire.
alter table reports drop constraint if exists reports_target_type_check;
alter table reports add constraint reports_target_type_check check (target_type in ('user', 'post', 'comment'));
