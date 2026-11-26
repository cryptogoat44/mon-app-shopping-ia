-- 0058 (lot « étagères des amis », 2026-11-24, réécrite le 2026-11-25 selon
-- le fondateur) : les Envies et le Vault d'un membre montrés à ses amis, par
-- défaut. Deux réglages séparés, allumés au départ, que chaque membre peut
-- éteindre d'un geste : « Montrer mes Envies à mes amis » et « Montrer mon
-- Vault à mes amis ». Personne n'est vu avant d'avoir été prévenu : les
-- étagères d'un membre ne s'ouvrent à ses amis qu'après qu'il a vu, dans une
-- app qui connaît la fonction, une information courte et l'a fermée (la date
-- de ce geste, vide au départ pour tous).
--
-- Retour en arrière (après avoir remis un serveur qui ne connaît pas 0058 ;
-- le choix de chaque membre et la date de l'information sont alors perdus,
-- rien d'autre ; les copies des images des envies faites pour les amis
-- restent dans collection_image_copies et partent avec le compte, ou à la
-- prochaine remise en ordre des copies) :
--   alter table profiles drop column if exists friend_shelves_informed_at;
--   alter table profiles drop column if exists vault_shown_to_friends;
--   alter table profiles drop column if exists wishes_shown_to_friends;
--
-- Ce qu'elle ajoute :
-- 1. profiles.wishes_shown_to_friends : vrai pour tous au départ (comptes
--    existants compris), jamais vide. Vrai, ET l'information vue (3.) : les
--    amis du membre (chacun suit l'autre, sans blocage, compte non suspendu)
--    voient en lecture seule ses envies, sauf celles rangées dans une
--    collection « Privée » (titre, copie de l'image faite par le serveur,
--    prix, boutique et lien, son alerte de prix et le nom de ses collections
--    « Mes amis » ; jamais l'image du marchand ni les nouvelles d'alerte).
-- 2. profiles.vault_shown_to_friends : vrai pour tous au départ, jamais vide.
--    Vrai, ET l'information vue : ses amis voient les pièces de son Vault
--    (nom, catégorie, photo, date d'ajout, mention « achat vérifié » ; jamais
--    la recherche d'origine).
-- 3. profiles.friend_shelves_informed_at : vide pour tous au départ (comptes
--    existants comme nouveaux). Écrite seulement par le geste du membre sur
--    l'information (« Compris » ou « Éteindre »), jamais par le serveur seul.
--    Vide : aucune étagère n'est ouverte, même réglages allumés.
-- Les trois sont effacées avec le profil. Rien d'autre n'est enregistré :
-- aucune trace de qui a regardé, aucune notification.
--
-- Facultative pour le serveur : sans elle (ou s'il manque une seule des trois
-- colonnes), /api/me ne renvoie pas les réglages (l'app les cache, ainsi que
-- l'information), le profil d'un autre membre n'annonce aucune étagère
-- (l'app n'affiche aucun onglet), les deux lectures répondent une page vide
-- et l'enregistrement répond « indisponible » (404, sonde du schéma,
-- lib/friendShelves.ts) : personne n'est montré. Aucune exigence au-delà de
-- ce qui est déjà en production : la table des profils (0001), vérifiée
-- ci-dessous avant tout changement. D'abord sur spotto-dev-2 (migrer-dev),
-- puis sur spotto-prod. Rejouable sans effet (if not exists) ; ne supprime ni
-- ne modifie aucune donnée existante (trois colonnes ajoutées avec leur
-- valeur par défaut). Aucune règle d'accès nouvelle : profiles garde sa
-- RLS active sans politique, seul le serveur, avec sa clé secrète, la lit et
-- l'écrit. Aucun déclencheur, aucune fonction, aucun index.

do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'profiles') then
    raise exception '0058 demande la table des profils (migration 0001) : appliquez d''abord les migrations précédentes, puis relancez 0058.';
  end if;
end;
$$;

-- ---- Montrer mes Envies, mon Vault à mes amis ; information vue ----
alter table profiles add column if not exists wishes_shown_to_friends boolean not null default true;
alter table profiles add column if not exists vault_shown_to_friends boolean not null default true;
alter table profiles add column if not exists friend_shelves_informed_at timestamptz;

notify pgrst, 'reload schema';
