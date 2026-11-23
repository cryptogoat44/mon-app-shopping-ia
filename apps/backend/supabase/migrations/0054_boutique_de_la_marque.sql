-- 0054 (lot « ordre des boutiques », 2026-11-21). Aucune donnée personnelle de plus.
--
-- Décision du fondateur (21 novembre 2026) : « Je ne veux mettre aucune
-- marque en avant ». Dans « Cette pièce dans d'autres boutiques » (la même
-- pièce, vendue dans plusieurs boutiques), seule la boutique officielle de
-- la marque de la pièce passe en tête ; partout ailleurs, chaque offre garde
-- sa place reçue. Cette marque n'est connue qu'au moment où la section est
-- cherchée : c'est celle que l'IA a lue dans les titres de la recherche
-- visuelle, vérifiée par le serveur. Elle n'est jamais enregistrée (pas plus
-- que la requête) : le serveur note seulement, sur la ligne de cette
-- boutique, que c'est elle. Deviner la marque plus tard, d'après les titres,
-- mettait en tête la boutique d'une autre marque (Mango dans une section
-- Zara, jules.com pour un sac Jules & Jenn).
--
-- Colonne :
-- product_matches.brand_shop : true sur la ligne de la boutique officielle de
--   la marque de la pièce, dans « Cette pièce dans d'autres boutiques »
--   seulement ; null partout ailleurs, et sur toutes les lignes d'avant
--   (jamais false : vérifié par la base).
--
-- Facultative pour le serveur : sans elle, rien n'est noté, et chaque
-- boutique officielle est rangée comme une boutique connue, avec sa
-- mention (sonde du schéma, lib/brandShopColumn.ts). Un serveur plus ancien fonctionne aussi
-- sur une base qui l'a (valeur par défaut : null). À appliquer à la main par
-- le fondateur, d'abord sur spotto-dev-2 (migrer-dev), puis sur spotto-prod.
-- Rejouable sans effet (if not exists) ; ne supprime ni ne modifie aucune
-- donnée existante.
--
-- Retour en arrière (après avoir remis un serveur qui ne connaît pas 0054) :
--   alter table product_matches drop column if exists brand_shop;

alter table product_matches
  add column if not exists brand_shop boolean check (brand_shop);

notify pgrst, 'reload schema';
