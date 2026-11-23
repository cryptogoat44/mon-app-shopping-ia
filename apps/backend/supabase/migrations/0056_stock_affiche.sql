-- 0056 (lot « stock visible », 2026-11-22). Aucune donnée personnelle de plus.
--
-- Quand Google Lens dit qu'une offre est en stock ou épuisée, le membre le
-- voit sur la carte (« En stock » ou « Épuisée », d'après Google, au moment
-- de la recherche) et peut ne garder que les offres en stock. Aujourd'hui le
-- serveur lit déjà ce oui ou ce non (services/visualSearch.ts, inStock), mais
-- ne le range nulle part : une recherche relue (rechargement, historique,
-- boutiques arrivées ensuite) ne le connaît plus. Cette colonne le garde sur
-- la ligne de la proposition, rien d'autre : ni la page de la boutique, ni
-- une heure (celle de la recherche suffit), ni rien sur le membre.
--
-- Colonne :
-- product_matches.in_stock : true (en stock) ou false (épuisée) quand Google
--   le disait au moment de la recherche ; null quand il ne disait rien,
--   ailleurs que dans la recherche visuelle, et sur toutes les lignes d'avant.
--
-- Facultative pour le serveur : sans elle, rien n'est noté, et aucune carte
-- ne montre de stock, comme aujourd'hui (sonde du schéma, lib/stockColumn.ts).
-- Un serveur plus ancien fonctionne aussi sur une base qui l'a (valeur par
-- défaut : null). À appliquer à la main par le fondateur, d'abord sur
-- spotto-dev-2 (migrer-dev), puis sur spotto-prod. Ne demande que 0001
-- (vérifié ci-dessous). Rejouable sans effet (if not exists) ; ne supprime ni
-- ne modifie aucune donnée existante.
--
-- Retour en arrière (après avoir remis un serveur qui ne connaît pas 0056) :
--   alter table product_matches drop column if exists in_stock;

do $$
begin
  if to_regclass('public.product_matches') is null then
    raise exception '0056 demande la migration 0001 (propositions des recherches) : appliquez d''abord les migrations précédentes.';
  end if;
end;
$$;

alter table product_matches
  add column if not exists in_stock boolean;

notify pgrst, 'reload schema';
