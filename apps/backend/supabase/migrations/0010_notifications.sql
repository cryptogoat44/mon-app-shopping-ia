-- Notifications in-app : abonnement et like. Pas de préférences côté
-- utilisateur pour l'instant (tout est notifié), pas de notifications
-- push (infrastructure séparée, à ajouter plus tard si besoin).
create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,  -- destinataire
  actor_id uuid not null references profiles(id) on delete cascade, -- auteur de l'action
  type text not null check (type in ('follow', 'like')),
  post_id uuid references posts(id) on delete cascade,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index on notifications (user_id, created_at desc);

alter table notifications enable row level security;
-- service_role a déjà tous les droits par défaut (voir 0004_grant_service_role.sql).
