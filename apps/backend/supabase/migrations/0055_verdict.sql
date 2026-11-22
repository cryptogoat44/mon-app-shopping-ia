-- 0055 (lot « verdict », 2026-11-22). Aucune donnée personnelle de plus.
--
-- En tête des résultats, une phrase dit au membre si Spotto a retrouvé la
-- même pièce dans plusieurs boutiques (« Pièce identifiée, d'après les
-- titres des boutiques »), probablement (« Pièce probablement trouvée »), ou
-- seulement des pièces qui se ressemblent. Elle se décide d'après les titres
-- des offres de « Cette pièce dans d'autres boutiques » : nomment-ils la
-- marque et le modèle que l'IA a lus dans les titres de la recherche
-- visuelle ? Cette marque et ce modèle ne sont connus qu'au moment où la
-- section est cherchée, et ne sont jamais enregistrés (pas plus que la
-- requête) : le serveur note seulement, sur la ligne de chaque offre de la
-- section, un petit nombre, le « palier » de son titre. Le verdict lui-même
-- se calcule à chaque relecture (lib/verdict.ts), à partir des offres
-- réellement montrées.
--
-- Colonne :
-- product_matches.title_tier : 0 (le titre nomme la marque et le modèle),
--   1 (la marque seulement), 2 (ni l'un ni l'autre), dans « Cette pièce dans
--   d'autres boutiques » seulement ; null partout ailleurs, et sur toutes les
--   lignes d'avant (vérifié par la base : 0, 1, 2 ou rien).
--
-- Facultative pour le serveur : sans elle, rien n'est noté, et aucun verdict
-- n'est montré, comme aujourd'hui (sonde du schéma, lib/verdictColumn.ts).
-- Les recherches d'avant n'ont jamais de verdict quand leurs offres dans
-- d'autres boutiques n'ont pas de palier. Un serveur plus ancien fonctionne
-- aussi sur une base qui l'a (valeur par défaut : null). À appliquer à la
-- main par le fondateur, d'abord sur spotto-dev-2 (migrer-dev), puis sur
-- spotto-prod. Ne demande que 0001 (vérifié ci-dessous). Rejouable sans effet
-- (if not exists) ; ne supprime ni ne modifie aucune donnée existante.
--
-- Retour en arrière (après avoir remis un serveur qui ne connaît pas 0055) :
--   alter table product_matches drop column if exists title_tier;

do $$
begin
  if to_regclass('public.product_matches') is null then
    raise exception '0055 demande la migration 0001 (propositions des recherches) : appliquez d''abord les migrations précédentes.';
  end if;
end;
$$;

alter table product_matches
  add column if not exists title_tier smallint check (title_tier between 0 and 2);

notify pgrst, 'reload schema';
