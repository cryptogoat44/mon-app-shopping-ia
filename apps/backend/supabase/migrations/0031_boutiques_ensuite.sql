-- 0031 (lot « boutiques ensuite », 2026-11-08). Aucune donnée personnelle de plus.
--
-- Avec la voie C, une recherche par photo attendait Google Lens PUIS « Cette
-- pièce dans d'autres boutiques » (l'IA écrit une courte requête à partir des
-- titres Lens, puis Google Shopping) avant d'afficher le résultat. Désormais,
-- la nouvelle app reçoit les résultats Lens dès qu'ils arrivent ; les
-- boutiques sont cherchées ensuite, par un second appel
-- (POST /api/searches/:id/complement), une seule fois par recherche.
-- Les apps déjà installées ne demandent rien de tel : pour elles, rien ne change.
--
-- Ce qu'il faut dans la base :
-- - l'état de cette étape différée, pour qu'elle ne soit payée qu'une fois
--   par recherche, même avec deux appels simultanés, une relance ou un second
--   appareil (le passage « pending » → « running » se fait en une seule
--   instruction conditionnelle), et qu'une étape abandonnée ne coûte jamais
--   rien plus tard (« pending » de plus de 5 minutes : expirée, sans appel) ;
-- - l'ordre de Google des propositions Lens quand les mots tapés sous la
--   photo l'ont changé : l'IA lit les titres dans l'ordre de Google, jamais
--   dans celui des mots (qui ne partent nulle part). Ce rang n'est écrit que
--   dans ce cas, et effacé dès que l'étape démarre ou expire.
--
-- Colonnes :
-- product_searches.complement_deferred : null (lancement sans « boutiques
--   ensuite », ou aucune boutique à chercher), 'pending' (en attente de
--   l'appel de l'app), 'running' (étape en cours), 'done' (issue enregistrée
--   dans complement_status) ;
-- product_searches.complement_deferred_at : heure du dernier changement d'état ;
-- product_matches.lens_rank : place de la proposition dans la réponse de la
--   recherche visuelle, avant le tri par les mots (null le reste du temps).
--
-- Facultative pour le serveur : sans elle, il ignore la demande de la
-- nouvelle app et fait tout en une fois, comme avant (sonde du schéma,
-- lib/deferredComplement.ts). Un serveur plus ancien fonctionne aussi sur une
-- base qui l'a (valeurs par défaut : null). À appliquer à la main par le
-- fondateur, d'abord sur spotto-dev-2 (migrer-dev), puis sur spotto-prod.
-- Rejouable sans effet (if not exists) ; ne supprime ni ne modifie aucune
-- donnée existante.
--
-- Retour en arrière (après avoir remis un serveur qui ne connaît pas 0031) :
--   alter table product_searches drop column if exists complement_deferred, drop column if exists complement_deferred_at;
--   alter table product_matches drop column if exists lens_rank;

alter table product_searches
  add column if not exists complement_deferred text check (complement_deferred in ('pending', 'running', 'done')),
  add column if not exists complement_deferred_at timestamptz;

alter table product_matches
  add column if not exists lens_rank smallint check (lens_rank > 0);

notify pgrst, 'reload schema';
