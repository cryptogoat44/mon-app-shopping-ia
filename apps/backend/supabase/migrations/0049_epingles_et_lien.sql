-- 0049 (lot « vie sociale », 2026-11-19) : épingler des publications, et un
-- lien en bio. Un membre peut épingler jusqu'à 3 de ses publications « Une
-- photo » en haut de son profil, et afficher sous sa bio un lien vers un site
-- web (une adresse https, 200 caractères au plus).
--
-- Retour en arrière (après avoir remis un serveur qui ne connaît pas 0049 ;
-- les épingles et les liens des profils sont alors perdus, rien d'autre) :
--   drop index if exists posts_pinned_idx;
--   alter table posts drop column if exists pinned_at;
--   alter table profiles drop constraint if exists profiles_link_url_check;
--   alter table profiles drop column if exists link_url;
--
-- Ce qu'elle ajoute :
-- 1. posts.pinned_at : la date de l'épingle, vide pour une publication qui
--    n'est pas épinglée (toutes, au départ). La limite de 3 est tenue par le
--    serveur (il compte, puis épingle) : deux épingles au même instant peuvent
--    au pire en donner 4, et la lecture ne garde que les 3 plus récentes. Un
--    index sur les seules publications épinglées sert cette lecture.
-- 2. profiles.link_url : le lien affiché sur le profil, vide au départ. La
--    base n'accepte qu'une adresse qui commence par « https:// », sans espace,
--    de 200 caractères au plus ; le serveur vérifie le reste (nom de site
--    ordinaire, sans identifiant ni port, ni adresse IP, ni caractères
--    accentués ou spéciaux dans le nom du site). Effacé avec le profil.
--
-- Facultative pour le serveur : sans elle, l'app cache « Épingler sur mon
-- profil » et le champ « Lien », et les routes répondent « indisponible »
-- (sonde du schéma, lib/profileExtras.ts). Aucune exigence au-delà de ce qui
-- est déjà en production ; la garde ci-dessous documente l'ordre (0026, la
-- date du retrait d'une image copiée, sur la même table posts). D'abord sur
-- spotto-dev-2 (migrer-dev), puis sur spotto-prod. Indépendante de 0045,
-- 0046, 0047 et 0048. Rejouable sans effet (if not exists, contrainte
-- remplacée par son nom) ; ne supprime ni ne modifie aucune donnée existante.
-- Aucune règle d'accès nouvelle : posts et profiles gardent leur RLS active
-- sans politique, seul le serveur, avec sa clé secrète, les lit et les
-- écrit. Aucun déclencheur.

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'posts' and column_name = 'media_removed_at'
  ) then
    raise exception '0049 demande la migration 0026 (retrait d''une image copiée) : appliquez-la d''abord, puis relancez 0049.';
  end if;
end;
$$;

-- ---- Publications épinglées ----
alter table posts add column if not exists pinned_at timestamptz;
-- Les publications épinglées d'un membre, les plus récemment épinglées d'abord.
create index if not exists posts_pinned_idx on posts (user_id, pinned_at desc) where pinned_at is not null;

-- ---- Lien en bio ----
alter table profiles add column if not exists link_url text;
alter table profiles drop constraint if exists profiles_link_url_check;
alter table profiles add constraint profiles_link_url_check
  check (link_url is null or (char_length(link_url) <= 200 and link_url ~ '^https://[^[:space:]]+$'));

notify pgrst, 'reload schema';
