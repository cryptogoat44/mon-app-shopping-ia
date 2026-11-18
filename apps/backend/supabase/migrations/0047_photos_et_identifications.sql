-- 0047 (lot « vie sociale », 2026-11-18) : plusieurs photos par publication,
-- et identifier des personnes. Une publication « Une photo » peut contenir
-- jusqu'à 5 photos (un carrousel), et son auteur peut y identifier jusqu'à
-- 5 membres ; un membre identifié peut retirer son identification.
--
-- Retour en arrière (après avoir remis un serveur qui ne connaît pas 0047 ;
-- les photos 2 à 5 de chaque publication et toutes les identifications sont
-- alors perdues, et les fichiers des photos 2 à 5 restent dans le stockage,
-- dans le dossier de chaque membre, jusqu'à la suppression de son compte : à
-- ne faire qu'en connaissance de cause). Les notifications « identification »
-- peuvent rester : leur type est accepté depuis 0045.
--   drop table if exists post_people_tags;
--   drop table if exists post_media;
--
-- Ce qu'elle ajoute :
-- 1. post_media : les photos 2 à 5 d'une publication (position 1 à 4), sa
--    version d'affichage et sa miniature. La photo 1 reste dans
--    posts.media_url / media_thumb_url : le fil, les grilles, la modération
--    et les anciennes apps continuent de marcher sur la première photo. Une
--    position par publication ; effacée avec la publication ou avec le compte.
--    Les fichiers sont rangés comme ceux de la photo 1, dans le dossier du
--    membre (post-media/<compte>/…), vidé à la suppression du compte.
-- 2. post_people_tags : qui est identifié sur quelle publication, et quand.
--    Une ligne par membre et par publication ; jamais l'auteur lui-même.
--    L'auteur de la publication est recopié ici (author_id) : un blocage, un
--    abonnement retiré ou un compte passé en privé retire alors les
--    identifications entre deux comptes sans relire toutes les publications.
--    Effacée avec la publication, avec le compte identifié ou avec celui de
--    l'auteur.
--
-- Facultative pour le serveur : sans elle, une publication garde une seule
-- photo comme avant, « Identifier des personnes » est caché dans l'app, et
-- les routes des photos et des identifications répondent « indisponible »
-- (sonde du schéma, lib/postExtras.ts). À appliquer APRÈS 0046 (vérifié
-- ci-dessous : elle porte le réglage « Qui peut me mentionner », qui vaut
-- aussi pour les identifications), d'abord sur spotto-dev-2 (migrer-dev),
-- puis sur spotto-prod. Rejouable sans effet (if not exists) ; ne supprime ni
-- ne modifie aucune donnée existante.
-- Aucune règle d'accès public : seul le serveur, avec sa clé secrète, lit et
-- écrit ces tables (RLS active, aucune politique). Aucun déclencheur.

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'mentions_from'
  ) then
    raise exception '0047 demande la migration 0046 (commentaires, suite) : appliquez-la d''abord, puis relancez 0047.';
  end if;
end;
$$;

-- ---- Photos 2 à 5 d'une publication ----
create table if not exists post_media (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  post_id uuid not null references posts(id) on delete cascade,
  position smallint not null check (position between 1 and 4),
  media_url text not null,
  media_thumb_url text not null,
  created_at timestamptz not null default now(),
  unique (post_id, position)
);
-- Photos d'un compte (export) ; celles d'une publication passent par la clé unique.
create index if not exists post_media_user_idx on post_media (user_id);
alter table post_media enable row level security;

-- ---- Personnes identifiées ----
create table if not exists post_people_tags (
  post_id uuid not null references posts(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  author_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id),
  check (user_id <> author_id)
);
-- Identifications reçues par un compte ; faites par un compte, et entre deux comptes (blocage, abonnement, export).
create index if not exists post_people_tags_user_idx on post_people_tags (user_id);
create index if not exists post_people_tags_author_idx on post_people_tags (author_id, user_id);
alter table post_people_tags enable row level security;

-- Le serveur seul : ni les visiteurs, ni les comptes connectés.
revoke all on table post_media from public, anon, authenticated;
grant select, insert, update, delete on table post_media to service_role;
revoke all on table post_people_tags from public, anon, authenticated;
grant select, insert, update, delete on table post_people_tags to service_role;

notify pgrst, 'reload schema';
