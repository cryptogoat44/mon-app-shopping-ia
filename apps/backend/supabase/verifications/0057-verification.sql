-- Vérification de la migration 0057 (page look). Lecture seule. À lancer sur
-- la base où la migration vient d'être appliquée (spotto-dev-2, puis la
-- production). Avant la migration, elle répond false partout, sans erreur.
--
-- Résultat attendu : une seule ligne, six true, soit :
--   table_presente = true : shared_looks existe ;
--   rls = true : sa sécurité par ligne est active (aucune politique : personne d'autre que le serveur) ;
--   visiteur_ferme = true : la clé publique (anon) ne peut ni lire ni écrire la table ;
--   membre_ferme = true : un membre connecté (authenticated) non plus ;
--   aucune_fonction = true : aucune fonction de la base ne parle de shared_looks (rien d'ouvert au public) ;
--   une_page_par_piece = true : une page au plus par membre et par pièce.
select
  to_regclass('public.shared_looks') is not null as table_presente,
  coalesce((select relrowsecurity from pg_class where oid = to_regclass('public.shared_looks')), false) as rls,
  coalesce(not has_table_privilege('anon', to_regclass('public.shared_looks'), 'select, insert, update, delete'), false) as visiteur_ferme,
  coalesce(not has_table_privilege('authenticated', to_regclass('public.shared_looks'), 'select, insert, update, delete'), false) as membre_ferme,
  to_regclass('public.shared_looks') is not null
    and not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosrc ilike '%shared_looks%') as aucune_fonction,
  exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'shared_looks' and indexname = 'shared_looks_user_match' and indexdef ilike 'create unique index%') as une_page_par_piece;
