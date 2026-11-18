-- Vérification de la migration 0047 (plusieurs photos par publication,
-- identifier des personnes). Lecture seule. À lancer sur la base où la
-- migration vient d'être appliquée (spotto-dev-2, puis la production).
--
-- Résultat attendu : une seule ligne, true | true | true | true | true, soit :
--   photos = true : post_media existe, positions 1 à 4, une seule par
--     publication, effacée avec la publication ou avec le compte ;
--   identifications = true : post_people_tags existe, une ligne par membre et
--     par publication, jamais l'auteur lui-même, effacée avec la publication
--     ou avec l'un des deux comptes ; ses deux index sont là ;
--   protegees = true : RLS active sur les deux tables, sans aucune règle
--     d'accès public ;
--   fermees_au_public = true : ni les visiteurs ni les comptes connectés ne
--     peuvent lire ni écrire ces deux tables ;
--   notification_acceptee = true : le type de notification « tag » est
--     accepté (depuis 0045).
-- Avant la migration (ou sans elle) : false | false | false | false | true,
-- sans erreur.
select
  to_regclass('public.post_media') is not null
    and exists (
      select 1 from pg_constraint
      where conrelid = to_regclass('public.post_media') and contype = 'u' and array_length(conkey, 1) = 2
    )
    and exists (
      select 1 from pg_constraint
      where conrelid = to_regclass('public.post_media') and contype = 'c'
        and pg_get_constraintdef(oid) like '%position" >= 1%'
        and pg_get_constraintdef(oid) like '%position" <= 4%'
    )
    and (select count(*) from pg_constraint
         where conrelid = to_regclass('public.post_media') and contype = 'f' and confdeltype = 'c') = 2
    and to_regclass('public.post_media_user_idx') is not null as photos,
  to_regclass('public.post_people_tags') is not null
    and exists (
      select 1 from pg_constraint
      where conrelid = to_regclass('public.post_people_tags') and contype = 'p' and array_length(conkey, 1) = 2
    )
    and exists (
      select 1 from pg_constraint
      where conrelid = to_regclass('public.post_people_tags') and contype = 'c'
        and pg_get_constraintdef(oid) like '%user_id <> author_id%'
    )
    and (select count(*) from pg_constraint
         where conrelid = to_regclass('public.post_people_tags') and contype = 'f' and confdeltype = 'c') = 3
    and to_regclass('public.post_people_tags_user_idx') is not null
    and to_regclass('public.post_people_tags_author_idx') is not null as identifications,
  coalesce((select bool_and(c.relrowsecurity) and count(*) = 2 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname in ('post_media', 'post_people_tags')), false)
    and not exists (select 1 from pg_policies where schemaname = 'public' and tablename in ('post_media', 'post_people_tags')) as protegees,
  -- Avant la migration : faux (jamais une erreur pour une table absente).
  case when to_regclass('public.post_media') is null or to_regclass('public.post_people_tags') is null then false else
  not has_table_privilege('anon', 'public.post_media', 'select')
    and not has_table_privilege('authenticated', 'public.post_media', 'select')
    and not has_table_privilege('authenticated', 'public.post_media', 'insert')
    and not has_table_privilege('authenticated', 'public.post_media', 'delete')
    and not has_table_privilege('anon', 'public.post_people_tags', 'select')
    and not has_table_privilege('authenticated', 'public.post_people_tags', 'select')
    and not has_table_privilege('authenticated', 'public.post_people_tags', 'insert')
    and not has_table_privilege('authenticated', 'public.post_people_tags', 'delete') end as fermees_au_public,
  exists (
    select 1 from pg_constraint
    where conrelid = to_regclass('public.notifications') and conname = 'notifications_type_check'
      and pg_get_constraintdef(oid) like '%''tag''%'
  ) as notification_acceptee;
