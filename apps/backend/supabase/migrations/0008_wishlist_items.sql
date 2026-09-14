-- Envies (wishlist) réelle — la table n'existait pas du tout avant,
-- "Garder" sur l'écran Résultat ne sauvegardait donc jamais rien nulle
-- part. Même logique d'accès que vault_items : le backend passe toujours
-- par le service role, RLS activée sans policy (deny-by-default).

create table wishlist_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  product_match_id uuid references product_matches(id) on delete set null,
  title text not null,
  image_url text not null,
  reference text,
  price_min numeric(10,2),
  currency char(3) default 'EUR',
  merchant_name text,
  merchant_url text,
  created_at timestamptz not null default now(),
  unique (user_id, product_match_id)
);
create index on wishlist_items (user_id, created_at desc);

alter table wishlist_items enable row level security;
-- service_role a déjà tous les droits par défaut (voir 0004_grant_service_role.sql).
