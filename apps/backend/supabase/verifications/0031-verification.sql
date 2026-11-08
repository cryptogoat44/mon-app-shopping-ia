-- Vérification de la migration 0031 (boutiques ensuite). Lecture seule. À
-- lancer sur la base où la migration vient d'être appliquée (spotto-dev-2,
-- puis la production).
--
-- Résultat attendu : une seule ligne, true | true | true, soit :
--   etat_differe = true : product_searches.complement_deferred existe ;
--   heure_etat = true : product_searches.complement_deferred_at existe ;
--   rang_lens = true : product_matches.lens_rank existe.
select
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'product_searches' and column_name = 'complement_deferred'
  ) as etat_differe,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'product_searches' and column_name = 'complement_deferred_at'
  ) as heure_etat,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'product_matches' and column_name = 'lens_rank'
  ) as rang_lens;
