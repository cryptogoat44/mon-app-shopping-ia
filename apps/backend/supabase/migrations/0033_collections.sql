-- 0033 (lot « collections », 2026-11-09) : des collections d'envies, que le
-- membre peut choisir de montrer à ses amis.
--
-- Retour en arrière (après avoir remis un serveur qui ne connaît pas 0033 ;
-- les collections sont alors perdues, les envies restent) :
--   drop table if exists collection_image_copies, collection_items, collections cascade;
--   alter table wishlist_items drop constraint if exists wishlist_items_id_user_id_key;
-- Les copies d'images restées dans le stockage (post-media/<membre>/…) ne
-- gênent rien : elles partent avec le compte de leur propriétaire.
--
-- Ce qu'elle ajoute :
-- 1. collections : nom (1 à 40 caractères), visibilité 'private' (par
--    défaut : vous seul) ou 'friends' (vos amis : chacun suit l'autre).
--    Supprimée avec le compte.
-- 2. collection_items : une envie dans une collection (une seule fois par
--    collection ; une envie peut être dans plusieurs collections). Supprimée
--    avec la collection, avec l'envie, avec le compte. La base vérifie que
--    l'envie et la collection sont au même membre.
-- 3. collection_image_copies : la copie de l'image d'une envie montrée aux
--    amis (dans notre stockage, jamais l'adresse du marchand), une seule par
--    envie, tant qu'elle est dans au moins une collection « Mes amis ».
--    Supprimée avec l'envie et avec le compte ; le serveur efface le fichier.
-- 4. wishlist_items : une contrainte d'unicité (id, user_id), sans effet sur
--    les données (id est déjà unique), qui sert aux vérifications ci-dessus.
--
-- Facultative pour le serveur : sans elle, les routes des collections
-- répondent « indisponible » et l'app cache les collections (sonde du
-- schéma, lib/collections.ts). À appliquer d'abord sur spotto-dev-2
-- (migrer-dev), puis sur spotto-prod. Rejouable sans effet (if not exists) ;
-- ne supprime ni ne modifie aucune donnée existante.
-- Aucune règle d'accès public : seul le serveur, avec sa clé secrète, lit et
-- écrit ces tables (RLS active, aucune politique).

-- ---- Envies : (id, user_id) unique, pour les clés étrangères ci-dessous ----
do $$
begin
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.wishlist_items'::regclass and conname = 'wishlist_items_id_user_id_key') then
    alter table wishlist_items add constraint wishlist_items_id_user_id_key unique (id, user_id);
  end if;
end;
$$;

-- ---- Collections ----
create table if not exists collections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  visibility text not null default 'private' check (visibility in ('private', 'friends')),
  visibility_changed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);
create index if not exists collections_user_idx on collections (user_id, created_at);
-- Collections montrées aux amis (profil d'un ami).
create index if not exists collections_user_friends_idx on collections (user_id) where visibility = 'friends';
alter table collections enable row level security;

-- ---- Envies d'une collection ----
create table if not exists collection_items (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid not null,
  wishlist_item_id uuid not null,
  -- Le membre (le même pour la collection et l'envie, vérifié par la base).
  user_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (collection_id, wishlist_item_id),
  foreign key (collection_id, user_id) references collections (id, user_id) on delete cascade,
  foreign key (wishlist_item_id, user_id) references wishlist_items (id, user_id) on delete cascade
);
create index if not exists collection_items_collection_idx on collection_items (collection_id, created_at desc);
create index if not exists collection_items_wishlist_item_idx on collection_items (wishlist_item_id, user_id);
create index if not exists collection_items_user_idx on collection_items (user_id);
alter table collection_items enable row level security;

-- ---- Copie de l'image montrée aux amis (une par envie) ----
create table if not exists collection_image_copies (
  wishlist_item_id uuid primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  -- Copie dans notre stockage (post-media/<membre>/…), en deux tailles.
  image_url text not null,
  image_thumb_url text not null,
  created_at timestamptz not null default now(),
  foreign key (wishlist_item_id, user_id) references wishlist_items (id, user_id) on delete cascade
);
create index if not exists collection_image_copies_user_idx on collection_image_copies (user_id);
alter table collection_image_copies enable row level security;

-- Le serveur seul : ni les visiteurs, ni les comptes connectés.
revoke all on table collections, collection_items, collection_image_copies from public, anon, authenticated;
grant select, insert, update, delete on table collections, collection_items, collection_image_copies to service_role;

notify pgrst, 'reload schema';
