-- Vérification de la migration 0056 (stock affiché). Lecture seule. À lancer
-- sur la base où la migration vient d'être appliquée (spotto-dev-2, puis la
-- production). Avant la migration, elle répond false | false, sans erreur.
--
-- Résultat attendu : une seule ligne, true | true, soit :
--   colonne = true : product_matches.in_stock existe, oui / non ;
--   vide_par_defaut = true : sans valeur, une ligne reste vide (stock inconnu), jamais « oui » ni « non » d'office.
select
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'product_matches' and column_name = 'in_stock' and data_type = 'boolean'
  ) as colonne,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'product_matches' and column_name = 'in_stock' and column_default is null and is_nullable = 'YES'
  ) as vide_par_defaut;
