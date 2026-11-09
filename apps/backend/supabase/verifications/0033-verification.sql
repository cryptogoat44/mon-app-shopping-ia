-- Vérification de la migration 0033 (collections d'envies). Lecture seule. À
-- lancer sur la base où la migration vient d'être appliquée (spotto-dev-2,
-- puis la production).
--
-- Résultat attendu : une seule ligne, true | true | true | true | true | true, soit :
--   tables = true : collections, collection_items et collection_image_copies existent ;
--   protegees = true : RLS active sur les trois, sans aucune règle d'accès
--     public (seul le serveur, avec sa clé secrète, les lit et les écrit) ;
--   fermees_au_public = true : ni les visiteurs ni les comptes connectés ne
--     peuvent lire ces tables ;
--   privee_par_defaut = true : une nouvelle collection est « privée » ;
--   meme_membre = true : la base vérifie que l'envie et la collection sont au même membre ;
--   suppression_en_cascade = true : collections, envies rangées et copies
--     partent avec le compte, la collection et l'envie.
select
  (select count(*) from pg_tables where schemaname = 'public'
     and tablename in ('collections', 'collection_items', 'collection_image_copies')) = 3 as tables,
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname in ('collections', 'collection_items', 'collection_image_copies') and c.relrowsecurity) = 3
    and not exists (select 1 from pg_policies where schemaname = 'public'
                    and tablename in ('collections', 'collection_items', 'collection_image_copies')) as protegees,
  not has_table_privilege('anon', 'public.collections', 'select')
    and not has_table_privilege('authenticated', 'public.collections', 'select')
    and not has_table_privilege('authenticated', 'public.collection_items', 'select')
    and not has_table_privilege('authenticated', 'public.collection_image_copies', 'select') as fermees_au_public,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'collections' and column_name = 'visibility'
      and column_default like '%private%'
  ) as privee_par_defaut,
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.collection_items'::regclass and contype = 'f'
      and confrelid = 'public.wishlist_items'::regclass and array_length(conkey, 1) = 2
  ) and exists (
    select 1 from pg_constraint
    where conrelid = 'public.collection_items'::regclass and contype = 'f'
      and confrelid = 'public.collections'::regclass and array_length(conkey, 1) = 2
  ) as meme_membre,
  (select count(*) from pg_constraint
     where contype = 'f' and confdeltype = 'c'
       and conrelid in ('public.collections'::regclass, 'public.collection_items'::regclass, 'public.collection_image_copies'::regclass)) >= 6
    as suppression_en_cascade;
