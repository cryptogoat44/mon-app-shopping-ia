-- 0046 (lot « vie sociale », 2026-11-18) : commentaires, suite. Sous une
-- publication, un membre peut répondre à un commentaire (un seul niveau),
-- aimer un commentaire et mentionner un membre avec « @pseudo ». Chaque
-- membre choisit qui peut le mentionner.
--
-- Retour en arrière (après avoir remis un serveur qui ne connaît pas 0046 ;
-- les réponses redeviennent alors des commentaires ordinaires, et les
-- « j'aime » des commentaires, les mentions et le réglage sont perdus : à ne
-- faire qu'en connaissance de cause). Les notifications « réponse » et
-- « mention » peuvent rester : leur type est accepté depuis 0045.
--   drop table if exists comment_mentions;
--   drop table if exists comment_reactions;
--   drop index if exists comments_parent_idx;
--   alter table comments drop column if exists parent_id;
--   alter table profiles drop constraint if exists profiles_mentions_from_check;
--   alter table profiles drop column if exists mentions_from;
--
-- Ce qu'elle ajoute :
-- 1. comments.parent_id : le commentaire auquel celui-ci répond (vide pour un
--    commentaire ordinaire). Un seul niveau : le serveur rattache une réponse
--    à une réponse au commentaire d'origine. Supprimer un commentaire
--    supprime ses réponses.
-- 2. comment_reactions : qui aime quel commentaire (un « j'aime » par membre
--    et par commentaire). Effacé avec le commentaire ou avec le compte.
-- 3. comment_mentions : qui est mentionné dans quel commentaire, par qui, et
--    le pseudo tel qu'il a été écrit. Une ligne par membre mentionné et par
--    commentaire ; jamais soi-même. Effacée avec le commentaire, avec le
--    compte mentionné ou avec le compte de l'auteur. L'auteur du commentaire
--    est recopié ici (author_id) : un blocage retire alors les mentions entre
--    deux comptes en une seule suppression, sans rien oublier.
-- 4. profiles.mentions_from : « Qui peut me mentionner » : 'everyone' (tout
--    le monde), 'following' (les comptes que je suis) ou 'nobody' (personne).
--    Valeur de départ : 'following', la plus protectrice des deux premières.
--    Aucun compte existant n'est mentionné sans cela : il n'y a encore aucune
--    mention.
--
-- Facultative pour le serveur : sans elle, les commentaires restent à plat
-- comme avant, les réponses, les « j'aime » et le réglage répondent
-- « indisponible », un « @pseudo » reste un simple texte, et l'app cache le
-- réglage (sonde du schéma, lib/comments.ts). À appliquer APRÈS 0045
-- (vérifié ci-dessous : elle porte les types de notification « réponse » et
-- « mention »), d'abord sur spotto-dev-2 (migrer-dev), puis sur spotto-prod.
-- Rejouable sans effet (if not exists, drop constraint if exists) ; ne
-- supprime ni ne modifie aucune donnée existante.
-- Aucune règle d'accès public : seul le serveur, avec sa clé secrète, lit et
-- écrit ces tables (RLS active, aucune politique). Aucun déclencheur.

do $$
begin
  if to_regclass('public.follow_requests') is null then
    raise exception '0046 demande la migration 0045 (compte privé) : appliquez-la d''abord, puis relancez 0046.';
  end if;
end;
$$;

-- ---- Réponses (un seul niveau) ----
alter table comments add column if not exists parent_id uuid references comments(id) on delete cascade;
-- Réponses d'un commentaire, les plus anciennes d'abord.
create index if not exists comments_parent_idx on comments (parent_id, created_at) where parent_id is not null;

-- ---- « J'aime » des commentaires ----
create table if not exists comment_reactions (
  comment_id uuid not null references comments(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id)
);
create index if not exists comment_reactions_user_idx on comment_reactions (user_id);
alter table comment_reactions enable row level security;

-- ---- Mentions ----
create table if not exists comment_mentions (
  comment_id uuid not null references comments(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  author_id uuid not null references profiles(id) on delete cascade,
  handle text not null check (handle ~ '^[a-z0-9_]{3,20}$'),
  created_at timestamptz not null default now(),
  primary key (comment_id, user_id),
  check (user_id <> author_id)
);
-- Mentions reçues par un compte ; mentions écrites par un compte (blocage, export).
create index if not exists comment_mentions_user_idx on comment_mentions (user_id);
create index if not exists comment_mentions_author_idx on comment_mentions (author_id, user_id);
alter table comment_mentions enable row level security;

-- Le serveur seul : ni les visiteurs, ni les comptes connectés.
revoke all on table comment_reactions from public, anon, authenticated;
grant select, insert, update, delete on table comment_reactions to service_role;
revoke all on table comment_mentions from public, anon, authenticated;
grant select, insert, update, delete on table comment_mentions to service_role;

-- ---- Réglage « Qui peut me mentionner » ----
alter table profiles add column if not exists mentions_from text not null default 'following';
alter table profiles drop constraint if exists profiles_mentions_from_check;
alter table profiles add constraint profiles_mentions_from_check check (mentions_from in ('everyone', 'following', 'nobody'));

notify pgrst, 'reload schema';
