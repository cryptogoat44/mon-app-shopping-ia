-- Vérification de la migration 0048 (publications enregistrées). Lecture
-- seule. À lancer sur la base où la migration vient d'être appliquée
-- (spotto-dev-2, puis la production).
--
-- Résultat attendu : une seule ligne, true | true | true | true, soit :
--   enregistrees = true : saved_posts existe, une ligne par membre et par
--     publication, effacée avec la publication ou avec le compte ; la
--     collection redevient vide quand la collection est supprimée ; ses
--     trois index sont là ;
--   collection_du_meme_membre = true : la base refuse la collection d'un
--     autre membre (clé composée, PostgreSQL 15 ou plus). « false » ici, avec
--     true partout ailleurs : base plus ancienne, le serveur vérifie seul que
--     la collection est la vôtre (il le fait dans tous les cas) ;
--   protegee = true : RLS active, sans aucune règle d'accès public ;
--   fermee_au_public = true : ni les visiteurs ni les comptes connectés ne
--     peuvent lire ni écrire cette table.
-- Avant la migration (ou sans elle) : false | false | false | false, sans
-- erreur.
select
  to_regclass('public.saved_posts') is not null
    and exists (
      select 1 from pg_constraint
      where conrelid = to_regclass('public.saved_posts') and contype = 'p' and array_length(conkey, 1) = 2
    )
    and (select count(*) from pg_constraint
         where conrelid = to_regclass('public.saved_posts') and contype = 'f' and confdeltype = 'c') = 2
    and exists (
      select 1 from pg_constraint
      where conrelid = to_regclass('public.saved_posts') and conname = 'saved_posts_collection_fkey'
        and contype = 'f' and confdeltype = 'n' and confrelid = to_regclass('public.collections')
    )
    and to_regclass('public.saved_posts_list_idx') is not null
    and to_regclass('public.saved_posts_post_idx') is not null
    and to_regclass('public.saved_posts_collection_idx') is not null as enregistrees,
  exists (
    select 1 from pg_constraint
    where conrelid = to_regclass('public.saved_posts') and conname = 'saved_posts_collection_fkey'
      and array_length(conkey, 1) = 2
  ) as collection_du_meme_membre,
  coalesce((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'saved_posts'), false)
    and not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'saved_posts') as protegee,
  -- Avant la migration : faux (jamais une erreur pour une table absente).
  case when to_regclass('public.saved_posts') is null then false else
  not has_table_privilege('anon', 'public.saved_posts', 'select')
    and not has_table_privilege('anon', 'public.saved_posts', 'insert')
    and not has_table_privilege('authenticated', 'public.saved_posts', 'select')
    and not has_table_privilege('authenticated', 'public.saved_posts', 'insert')
    and not has_table_privilege('authenticated', 'public.saved_posts', 'update')
    and not has_table_privilege('authenticated', 'public.saved_posts', 'delete') end as fermee_au_public;
