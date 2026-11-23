-- Vérification de la migration 0055 (verdict). Lecture seule. À lancer sur
-- la base où la migration vient d'être appliquée (spotto-dev-2, puis la
-- production). Avant la migration, elle répond false | false | false, sans
-- erreur.
--
-- Résultat attendu : une seule ligne, true | true | true, soit :
--   colonne = true : product_matches.title_tier existe, un petit nombre ;
--   vide_par_defaut = true : sans valeur, une ligne reste vide (aucun palier), jamais 0, 1 ni 2 d'office ;
--   trois_valeurs = true : la colonne n'accepte que 0, 1, 2 ou rien.
select
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'product_matches' and column_name = 'title_tier' and data_type = 'smallint'
  ) as colonne,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'product_matches' and column_name = 'title_tier' and column_default is null and is_nullable = 'YES'
  ) as vide_par_defaut,
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.product_matches'::regclass and contype = 'c' and pg_get_constraintdef(oid) = 'CHECK (((title_tier >= 0) AND (title_tier <= 2)))'
  ) as trois_valeurs;
