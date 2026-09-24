-- Lot S (refonte du Spotter).
--
-- 1. Image haute définition des résultats. Google Lens (via SerpApi) renvoie
--    pour chaque résultat une petite vignette (`thumbnail`, ≈ 180 × 280 px,
--    déjà stockée dans image_url) ET l'image originale du marchand (`image`,
--    jusqu'à ≈ 1 800 × 2 400 px). L'app n'affichait que la vignette, étirée :
--    d'où des photos floues. On garde les deux : image_hd_url pour
--    l'affichage, image_url comme repli quand le marchand bloque l'affichage
--    de son image hors de son site (constaté : refus 403). Nullable : les
--    résultats déjà enregistrés n'en ont pas.
alter table product_matches add column if not exists image_hd_url text;

-- 2. Texte facultatif « Que cherchez-vous ? » (60 caractères au plus), transmis
--    à Google Lens seulement quand il est rempli. Donnée saisie par
--    l'utilisateur : incluse dans l'export RGPD (select * sur
--    product_searches) et supprimée avec le compte (cascade existante).
alter table product_searches add column if not exists query text
  check (query is null or char_length(query) <= 60);
