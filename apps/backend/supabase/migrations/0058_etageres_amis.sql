-- 0058 (lot « étagères des amis », 2026-11-24) : montrer ses Envies et son
-- Vault à ses amis, si on le décide. Deux réglages séparés, éteints au départ,
-- que chaque membre allume lui-même : « Montrer mes Envies à mes amis » et
-- « Montrer mon Vault à mes amis ». Personne ne devient visible sans son geste.
--
-- Retour en arrière (après avoir remis un serveur qui ne connaît pas 0058 ;
-- le choix de chaque membre est alors perdu, rien d'autre ; les copies des
-- images des envies faites pour les amis restent dans collection_image_copies
-- et partent avec le compte, ou à la prochaine remise en ordre des copies) :
--   alter table profiles drop column if exists vault_shown_to_friends;
--   alter table profiles drop column if exists wishes_shown_to_friends;
--
-- Ce qu'elle ajoute :
-- 1. profiles.wishes_shown_to_friends : faux (rien de montré) pour tous au
--    départ, jamais vide. Vrai : les amis du membre (chacun suit l'autre, sans
--    blocage, compte non suspendu) voient ses envies en lecture seule (titre,
--    copie de l'image faite par le serveur, prix, boutique et lien ; jamais la
--    note, l'image du marchand, les alertes ni le nom des collections).
-- 2. profiles.vault_shown_to_friends : faux pour tous au départ, jamais vide.
--    Vrai : ses amis voient les pièces de son Vault (nom, catégorie, photo ;
--    jamais la date, la mention « achat vérifié » ni la recherche d'origine).
-- Les deux sont effacées avec le profil. Rien d'autre n'est enregistré :
-- aucune trace de qui a regardé, aucune notification.
--
-- Facultative pour le serveur : sans elle, /api/me ne renvoie pas les deux
-- réglages (l'app les cache), le profil d'un autre membre n'annonce aucune
-- étagère (l'app n'affiche aucun onglet), les deux lectures répondent une page
-- vide et l'enregistrement répond « indisponible » (404, sonde du schéma,
-- lib/friendShelves.ts) : personne n'est montré. Aucune exigence au-delà de ce
-- qui est déjà en production : la table des profils (0001), vérifiée
-- ci-dessous avant tout changement. D'abord sur spotto-dev-2 (migrer-dev),
-- puis sur spotto-prod. Rejouable sans effet (if not exists) ; ne supprime ni
-- ne modifie aucune donnée existante (deux colonnes ajoutées avec leur valeur
-- par défaut). Aucune règle d'accès nouvelle : profiles garde sa RLS active
-- sans politique, seul le serveur, avec sa clé secrète, la lit et l'écrit.
-- Aucun déclencheur, aucune fonction, aucun index.

do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'profiles') then
    raise exception '0058 demande la table des profils (migration 0001) : appliquez d''abord les migrations précédentes, puis relancez 0058.';
  end if;
end;
$$;

-- ---- Montrer mes Envies, mon Vault à mes amis ----
alter table profiles add column if not exists wishes_shown_to_friends boolean not null default false;
alter table profiles add column if not exists vault_shown_to_friends boolean not null default false;

notify pgrst, 'reload schema';
