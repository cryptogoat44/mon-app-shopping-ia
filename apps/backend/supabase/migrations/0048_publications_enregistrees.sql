-- 0048 (lot « vie sociale », 2026-11-18) : publications enregistrées. Un
-- membre peut enregistrer une publication qu'il voit (la sienne ou celle d'un
-- autre membre) pour la retrouver dans sa liste « Publications enregistrées »,
-- et la ranger, s'il le veut, dans une de ses collections. Ses publications
-- enregistrées ne sont visibles que par lui : ni l'auteur ni ses amis ne les
-- voient, même rangées dans une collection montrée à ses amis.
--
-- Retour en arrière (après avoir remis un serveur qui ne connaît pas 0048 ;
-- toutes les publications enregistrées sont alors perdues, rien d'autre) :
--   drop table if exists saved_posts;
--
-- Ce qu'elle ajoute :
-- 1. saved_posts : qui a enregistré quelle publication, quand, et dans
--    laquelle de ses collections (ou aucune). Une ligne par membre et par
--    publication. Rien de la publication n'est recopié ici (ni légende, ni
--    image) : le serveur relit la publication, et le droit de la voir, à
--    chaque lecture. Effacée avec la publication ou avec le compte.
-- 2. La collection est forcément une collection du MÊME membre, vérifiée par
--    la base (clé (collection_id, user_id), comme pour les envies d'une
--    collection, 0033). Supprimer la collection garde la publication
--    enregistrée, « sans collection ». Cette règle demande PostgreSQL 15 ou
--    plus récent (« on delete set null (collection_id) ») ; sur une base plus
--    ancienne, la collection est seulement rattachée par son identifiant (même
--    effet à la suppression), et la règle « même membre » est vérifiée par le
--    serveur seul (il la vérifie dans tous les cas). Le fichier de
--    vérification dit lequel des deux a été posé.
--
-- Facultative pour le serveur : sans elle, l'app cache le signet et la liste
-- « Publications enregistrées », et les routes répondent « indisponible »
-- (sonde du schéma, lib/savedPosts.ts). À appliquer APRÈS 0033 (vérifié
-- ci-dessous : les collections), d'abord sur spotto-dev-2 (migrer-dev), puis
-- sur spotto-prod. Indépendante de 0045, 0046 et 0047. Rejouable sans effet
-- (if not exists) ; ne supprime ni ne modifie aucune donnée existante.
-- Aucune règle d'accès public : seul le serveur, avec sa clé secrète, lit et
-- écrit cette table (RLS active, aucune politique). Aucun déclencheur.

do $$
begin
  if to_regclass('public.collections') is null then
    raise exception '0048 demande la migration 0033 (collections) : appliquez-la d''abord, puis relancez 0048.';
  end if;
end;
$$;

-- ---- Publications enregistrées ----
create table if not exists saved_posts (
  user_id uuid not null references profiles(id) on delete cascade,
  post_id uuid not null references posts(id) on delete cascade,
  -- Une de ses collections, ou aucune (« sans collection »).
  collection_id uuid,
  created_at timestamptz not null default now(),
  primary key (user_id, post_id)
);
-- Sa liste, les plus récentes d'abord ; les lignes d'une publication (cascade) ; celles d'une collection.
create index if not exists saved_posts_list_idx on saved_posts (user_id, created_at desc);
create index if not exists saved_posts_post_idx on saved_posts (post_id);
create index if not exists saved_posts_collection_idx on saved_posts (collection_id) where collection_id is not null;
alter table saved_posts enable row level security;

-- ---- La collection : une collection du même membre ----
-- Posée une seule fois (nommée), selon la version de PostgreSQL : la clé
-- composée avec « set null (collection_id) » (15 et plus), sinon la clé simple.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = to_regclass('public.saved_posts') and conname = 'saved_posts_collection_fkey'
  ) then
    if current_setting('server_version_num')::integer >= 150000 then
      execute 'alter table saved_posts add constraint saved_posts_collection_fkey '
        || 'foreign key (collection_id, user_id) references collections (id, user_id) on delete set null (collection_id)';
    else
      execute 'alter table saved_posts add constraint saved_posts_collection_fkey '
        || 'foreign key (collection_id) references collections (id) on delete set null';
    end if;
  end if;
end;
$$;

-- Le serveur seul : ni les visiteurs, ni les comptes connectés.
revoke all on table saved_posts from public, anon, authenticated;
grant select, insert, update, delete on table saved_posts to service_role;

notify pgrst, 'reload schema';
